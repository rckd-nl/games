/*
 * app.v2.js — Didcot Dogs
 *
 * CHANGELOG
 * v2.23.1
 *   - FIXED: Draw choice cards persisted in the DOM after turn ended — opponent
 *     saw permanent "Pick one card" UI. Root cause: renderCardDrawChoice replaced
 *     section.innerHTML but renderAll/renderButtons never restored it. Fixed by:
 *     (a) _drawChoicePending flag tracks whether a choice is actively pending;
 *     (b) restoreDrawButton() recreates the draw button element if missing;
 *     (c) renderButtons() calls restoreDrawButton() whenever _drawChoicePending
 *     is false, clearing any stale choice UI on every renderAll cycle;
 *     (d) _resolveCardChoice restores the button BEFORE renderAll so the panel
 *     is clean before the opponent's state arrives via Firebase.
 *   - FIXED: _drawChoicePending and actionInProgress not reset in doReturnToMenu.
 *
 *   - FIXED: watchForPlayerDepartures listener never cancelled on doReturnToMenu
 *     — stale listener fired after menu return on null app.localHero. Now stores
 *     unsubscribe handle and cancels on doReturnToMenu.
 *   - FIXED: Empty deck permanently locked turn — drawCardForCurrentPlayer
 *     returned without calling endTurn when both piles empty. Now calls endTurn
 *     with a "turn skipped" status message.
 *   - FIXED: Skip turn UX — 3 separate modal/turn cycles replaced with one modal
 *     that consumes all skipTurns at once. Opponents see a single toast.
 *   - FIXED: just_sniffin stacked unboundedly. Now capped at +2 with clear
 *     status message showing current level.
 *   - ADDED: Status effects (sniffin penalty, skip turns) now visible on both
 *     own and opponent summary cards in the right panel.
 *
 * v2.22.0
 *   - FIXED: getRoutePlayability returned undefined instead of a playability
 *     object when player was null. confirmRouteModalPlay threw on play.playable,
 *     leaving actionInProgress=true permanently — route modal was stuck.
 *   - FIXED: confirmRouteModalPlay now guards against undefined play result.
 *   - ADDED: Draw-2-pick-1 mechanic. drawCardForCurrentPlayer draws two cards
 *     and renders an inline choice UI in the left panel — does not obscure the
 *     board. Player picks one; other goes to discard. Auto-takes if only 1 card.
 *   - UPDATED: Draw button enlarged to two-line DRAW/CARDS format.
 *
 * v2.21.2
 *   - FIXED: launchGameFromLobby double-launch guard replaced DOM style check
 *     with dedicated _gameAlreadyLaunched boolean flag.
 *   - FIXED: _countdownActive and _gameAlreadyLaunched not reset on
 *     doReturnToMenu — next game's countdown would silently refuse to fire.
 *   - REMOVED: _legacyReturnToMenu dead code.
 *   - FIXED: Non-optional hero-overlay DOM access in init() made defensive.
 *
 * v2.21.1
 *   - FIXED: Old duplicate lobby functions left behind from v2.21.0 rewrite
 *     were overriding the new v3 versions. Removed all duplicates.
 *
 * v2.21.0
 *   - REWRITE: Entire lobby/join/carousel/launch system replaced with a clean
 *     phase-driven flow: waiting → ready → countdown → playing.
 *     One fbSubscribeRoomExclusive listener per client drives all transitions.
 *   - ADDED: phase "ready" — host sees Start button, others wait.
 *   - ADDED: phase "countdown" — 3→2→1 fires simultaneously on all clients.
 *
 * v2.20.0 / v2.20.1
 *   - FIXED: waitForGameState restoreArrays before playerOrder guard.
 *   - FIXED: Joiner confirmed snapshot fetch after writes complete.
 *   - FIXED: Joiner greyout confirmed flag never set to true.
 *
 * v2.19.2 — previous stable version
 */

console.log("Didcot Dogs app.v2.js loaded — VERSION v2.23.1");

const APP_VERSION = "v2.23.1";
const DEV_AUTO_SIM = false;
const SVG_NS = "http://www.w3.org/2000/svg";
const XLINK_NS = "http://www.w3.org/1999/xlink";

// ─── Firebase ─────────────────────────────────────────────────────────────────
let _db = null;
let _firebaseSet, _firebaseGet, _firebaseRef, _firebaseOnValue, _firebaseOnDisconnect, _firebaseServerTimestamp;

async function initFirebase() {
  const { initializeApp } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js");
  const fb = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js");

  _firebaseSet          = fb.set;
  _firebaseGet          = fb.get;
  _firebaseRef          = fb.ref;
  _firebaseOnValue      = fb.onValue;
  _firebaseOnDisconnect = fb.onDisconnect;
  _firebaseServerTimestamp = fb.serverTimestamp;

  const firebaseApp = initializeApp({
    apiKey:            "AIzaSyADtUD_GrSbfzss3CeO79VbDeAOmIwxGfI",
    authDomain:        "didcot-dogs.firebaseapp.com",
    databaseURL:       "https://didcot-dogs-default-rtdb.europe-west1.firebasedatabase.app",
    projectId:         "didcot-dogs",
    storageBucket:     "didcot-dogs.firebasestorage.app",
    messagingSenderId: "1087104000704",
    appId:             "1:1087104000704:web:13dbe3478e3a0cc9e5c325"
  });

  _db = fb.getDatabase(firebaseApp);
  console.log("[DD] Firebase initialised");
}

function dbRef(path) { return _firebaseRef(_db, path); }

function generateRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

async function fbCreateRoom(state, creatorCharacter) {
  let code, attempts = 0;
  while (attempts < 10) {
    code = generateRoomCode();
    const existing = await _firebaseGet(dbRef(`rooms/${code}/state`));
    if (!existing.exists()) break;
    attempts++;
  }
  await _firebaseSet(dbRef(`rooms/${code}/state`), { ...state, phase: "waiting", createdAt: Date.now() });
  await _firebaseSet(dbRef(`rooms/${code}/presence/${creatorCharacter}`), { connected: true, lastSeen: Date.now() });
  console.log("[DD] Room created:", code);
  return code;
}

async function fbJoinRoom(code, character=null) {
  const snap = await _firebaseGet(dbRef(`rooms/${code}/state`));
  if (!snap.exists()) throw new Error(`Room ${code} not found.`);
  const state = snap.val();
  // Only register presence once a character is actually chosen
  if(character) {
    await _firebaseSet(dbRef(`rooms/${code}/presence/${character}`), { connected: true, lastSeen: Date.now() });
  }
  console.log("[DD] Room joined:", code, "playerCount:", state.playerCount);
  return state;
}

async function fbUpdatePresence(code, character) {
  if(!code||!_db) return;
  // Atomically update presence key to chosen character
  await _firebaseSet(dbRef(`rooms/${code}/presence/${character}`), { connected: true, lastSeen: Date.now() });
  // (no placeholder to clean up)
}

async function fbStartHeartbeat(code, character) {
  // Update lastSeen every 20s so 60s timeout can detect disconnects
  setInterval(async () => {
    if(!code||!_db||!character) return;
    try { await _firebaseSet(dbRef(`rooms/${code}/presence/${character}/lastSeen`), Date.now()); } catch(e){}
  }, 20000);
}

async function fbSelectCharacter(code, character, colour) {
  if(!code||!_db) return;
  await _firebaseSet(dbRef(`rooms/${code}/state/characterSelections/${character}`), { colour, pickedAt: Date.now() });
}

async function fbPushState(code, state) {
  if (!code || !_db) return;
  const { controlledHero, ...firebaseState } = state;
  try {
    await _firebaseSet(dbRef(`rooms/${code}/state`), {
      ...firebaseState,
      updatedAt: Date.now(),
    });
  } catch(e) { console.error("[DD] pushState failed:", e); }
}

// Active game subscriber — replaced on each new subscription to prevent stacking
let _activeGameUnsubscribe = null;

function fbSubscribeRoom(code, callback) {
  // Only stack for the greyout subscriber in showJoinLobby (which manages its own lifecycle).
  // For the main game subscriber, cancel any existing one first.
  return _firebaseOnValue(dbRef(`rooms/${code}/state`), snap => {
    if (snap.exists()) callback(snap.val());
  });
}

// Use this for the single canonical game state subscriber (carousel + gameplay)
function fbSubscribeRoomExclusive(code, callback) {
  if(_activeGameUnsubscribe) {
    _activeGameUnsubscribe();
    _activeGameUnsubscribe = null;
  }
  _activeGameUnsubscribe = _firebaseOnValue(dbRef(`rooms/${code}/state`), snap => {
    if(snap.exists()) callback(snap.val());
  });
}

function fbSubscribePresence(code, callback) {
  _firebaseOnValue(dbRef(`rooms/${code}/presence`), snap => {
    callback(snap.val() || {});
  });
}

// ─── App state ────────────────────────────────────────────────────────────────
const app = {
  rulesData: null, destinationData: null, svg: null, audit: null, state: null,
  roomCode: null, localHero: null,
  actionInProgress: false,  // prevents double-tap/double-click during async action
  boardView: { scale:1, panX:0, panY:0, minScale:1, maxScale:3, baseViewBox:null },
  modal: { routeId:null, chosenColor:null, selectedOptionIndex:null, options:[] }
};

// All 6 playable characters. routeClass/tokenClass are generated dynamically
// from the character name so no hardcoding needed beyond this list.
const ALL_CHARACTERS = ["Eric","Tango","Otis","Leroy","Sam","Rusty"];

function getPlayerConfig(name) {
  return {
    image: `./assets/${name.toLowerCase()}.png`,
    routeClass: `route-claimed-${name.toLowerCase()}`,
    tokenClass: `${name.toLowerCase()}-token`,
    badgeClass: name.toLowerCase(),
  };
}

// PLAYER_CONFIG is now a live proxy — kept for legacy call sites
const PLAYER_CONFIG = Object.fromEntries(
  ALL_CHARACTERS.map(n => [n, getPlayerConfig(n)])
);

// Player colours — separate from route/card colours
const PLAYER_COLOURS = {
  Aquamarine: "#00C9B1",
  Marigold:   "#FFAA00",
  Cerise:     "#E91E8C",
  Cobalt:     "#1565FF",
  Vermilion:  "#FF3D00",
  Chartreuse: "#8BC400",
  Wisteria:   "#9B6BB5",
  Tangerine:  "#FF6B00",
  Viridian:   "#40826D",
  Umber:      "#635147",
};

function getPlayerColour(playerName) {
  if(!app.state||!app.state.characterSelections) return "#ffffff";
  return PLAYER_COLOURS[app.state.characterSelections[playerName]?.colour] || "#ffffff";
}

const ROUTE_COLOUR_HEX = {
  red:"#d74b4b", orange:"#db7f2f", blue:"#2f6edb", green:"#1e8b4c",
  black:"#1d1d1d", pink:"#c64f8e", yellow:"#d6b300", grey:"#7a7a7a"
};

const CARD_COLOUR_HEX_MAP = {
  red:["#f3a3a3","#d74b4b"], orange:["#f2bf95","#db7f2f"], blue:["#8ab5ff","#2f6edb"],
  green:["#72c78e","#1e8b4c"], black:["#5b5b5b","#1d1d1d"], pink:["#ef9cc3","#c64f8e"],
  yellow:["#f0dd67","#d6b300"], rainbow:["#f3a3a3","#8ab5ff"]
};

const GLOW_COLOURS = {
  red:"rgba(215,75,75,0.9)", orange:"rgba(219,127,47,0.9)", blue:"rgba(47,110,219,0.9)",
  green:"rgba(30,139,76,0.9)", black:"rgba(120,120,120,0.8)", pink:"rgba(198,79,142,0.9)",
  yellow:"rgba(214,179,0,0.9)", rainbow:"rgba(255,255,255,0.7)"
};

const TOAST_NOTABLE = Symbol("notable");
const TOAST_SILENT  = Symbol("silent");

// ─── Utilities ────────────────────────────────────────────────────────────────
async function loadJson(url) {
  const r = await fetch(url, { cache:"no-store" });
  if (!r.ok) throw new Error(`Failed to load ${url} (${r.status})`);
  return r.json();
}
async function loadText(url) {
  const r = await fetch(url, { cache:"no-store" });
  if (!r.ok) throw new Error(`Failed to load ${url} (${r.status})`);
  return r.text();
}
function createSvgEl(tag, attrs={}) {
  const el = document.createElementNS(SVG_NS, tag);
  Object.entries(attrs).forEach(([k,v]) => el.setAttribute(k,v));
  return el;
}
function clamp(v,mn,mx) { return Math.max(mn, Math.min(mx, v)); }
function shuffle(arr) {
  const a=[...arr];
  for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}
  return a;
}
function parseRouteId(id) {
  const p=id.split("_to_");
  if(p.length!==2) throw new Error(`Bad route ID: ${id}`);
  return {a:p[0],b:p[1]};
}
function formatNodeName(id) { return String(id).replaceAll("_"," "); }
function formatRouteName(id) { const {a,b}=parseRouteId(id); return `${formatNodeName(a)} — ${formatNodeName(b)}`; }
function routesShareNode(a,b) {
  const pa=parseRouteId(a), pb=parseRouteId(b);
  return pa.a===pb.a||pa.a===pb.b||pa.b===pb.a||pa.b===pb.b;
}
function countCards(hand) {
  return hand.reduce((acc,c)=>{ acc[c]=(acc[c]||0)+1; return acc; },{});
}
function getDisplayRouteColor(c) { return c; }

// Returns the character name this client controls
function getViewHero() {
  return app.localHero || app.state?.controlledHero || null;
}

// Returns array of character names of all joined players, in turn order
function getActivePlayers() {
  if(!app.state) return [];
  const order = app.state.playerOrder;
  if(Array.isArray(order) && order.length) return order;
  // Fallback: keys from players object (set when characters confirmed)
  const playerKeys = Object.keys(app.state.players || {});
  if(playerKeys.length) return playerKeys;
  // Last resort: characterSelections keys
  return Object.keys(app.state.characterSelections || {});
}

// Get player state object for a character name — direct lookup, no slot indirection
function getPlayerByChar(charName) {
  if(!charName || !app.state?.players) return null;
  return app.state.players[charName] || null;
}

// Kept for any legacy call sites
function getSlotForCharacter(charName) { return charName; }

// ─── Board view ───────────────────────────────────────────────────────────────
function applyBoardViewTransform() {
  const svg=app.svg; if(!svg||!app.boardView.baseViewBox) return;
  const base=app.boardView.baseViewBox, scale=app.boardView.scale;
  const vw=base.w/scale, vh=base.h/scale;
  const cx=base.x+base.w/2, cy=base.y+base.h/2;
  const mX=(base.w-vw)/2, mY=(base.h-vh)/2;
  app.boardView.panX=clamp(app.boardView.panX,-mX,mX);
  app.boardView.panY=clamp(app.boardView.panY,-mY,mY);
  svg.setAttribute("viewBox",`${cx-vw/2+app.boardView.panX} ${cy-vh/2+app.boardView.panY} ${vw} ${vh}`);
}
function resetBoardView() {
  app.boardView.scale=1; app.boardView.panX=0; app.boardView.panY=0;
  applyBoardViewTransform();
}
function clientToSvgPoint(cx,cy) {
  const bw=document.getElementById("board-wrap"), svg=app.svg;
  if(!bw||!svg) return {x:0,y:0};
  const r=bw.getBoundingClientRect(), vb=svg.viewBox.baseVal;
  return { x:vb.x+(cx-r.left)*vb.width/r.width, y:vb.y+(cy-r.top)*vb.height/r.height };
}

// ─── Desktop scale-to-fit ─────────────────────────────────────────────────────
// Scales #game-shell down on sub-1920 DESKTOP screens so nothing is cut off.
// IMPORTANT: never apply a CSS transform on mobile — it breaks position:fixed
// children (HUD, sheet, bottom bar all use fixed positioning).
function applyDesktopScale() {
  const shell = document.getElementById("game-shell");
  if (!shell) return;

  // Treat anything that would use mobile layout as mobile — no transform there
  const isMobile = window.innerWidth <= 900 ||
    (window.innerHeight <= 500 && window.innerWidth > window.innerHeight);

  if (isMobile) {
    // Always clear any lingering transform on mobile
    shell.style.transform = "";
    shell.style.transformOrigin = "";
    shell.style.width = "";
    shell.style.height = "";
    const app_el = document.getElementById("app");
    if (app_el) { app_el.style.height = ""; app_el.style.alignItems = ""; }
    return;
  }

  // Desktop only — scale down if viewport is smaller than 1920×1080
  const scaleX = window.innerWidth  / 1920;
  const scaleY = window.innerHeight / 1080;
  const scale  = Math.min(scaleX, scaleY, 1); // never upscale

  if (scale < 1) {
    shell.style.transform = `scale(${scale})`;
    shell.style.transformOrigin = "top center";
    shell.style.width = "1920px";
    shell.style.height = "1080px";
    const app_el = document.getElementById("app");
    if (app_el) {
      app_el.style.height = `${1080 * scale}px`;
      app_el.style.alignItems = "flex-start";
    }
  } else {
    shell.style.transform = "";
    shell.style.transformOrigin = "";
    const app_el = document.getElementById("app");
    if (app_el) { app_el.style.height = ""; app_el.style.alignItems = ""; }
  }
}

function setupMobileBoardGestures() {
  const bw=document.getElementById("board-wrap"); if(!bw) return;
  let mode=null, startPan=null, startPinch=null;
  bw.addEventListener("touchstart", evt=>{
    if(evt.touches.length===1){
      mode="pan";
      startPan={fingerClient:{x:evt.touches[0].clientX,y:evt.touches[0].clientY},panXAtStart:app.boardView.panX,panYAtStart:app.boardView.panY};
    }
    if(evt.touches.length===2){
      mode="pinch";
      const midX=(evt.touches[0].clientX+evt.touches[1].clientX)/2, midY=(evt.touches[0].clientY+evt.touches[1].clientY)/2, mid={x:midX,y:midY};
      const dx=evt.touches[1].clientX-evt.touches[0].clientX, dy=evt.touches[1].clientY-evt.touches[0].clientY;
      startPinch={distance:Math.hypot(dx,dy),scaleAtStart:app.boardView.scale,panXAtStart:app.boardView.panX,panYAtStart:app.boardView.panY,midSvg:clientToSvgPoint(midX,midY),midClient:{x:midX,y:midY}};
    }
  },{passive:false});
  bw.addEventListener("touchmove", evt=>{
    evt.preventDefault();
    if(mode==="pan"&&evt.touches.length===1&&startPan){
      const base=app.boardView.baseViewBox, r=bw.getBoundingClientRect();
      const spx=(base.w/app.boardView.scale)/r.width;
      app.boardView.panX=startPan.panXAtStart-(evt.touches[0].clientX-startPan.fingerClient.x)*spx;
      app.boardView.panY=startPan.panYAtStart-(evt.touches[0].clientY-startPan.fingerClient.y)*((base.h/app.boardView.scale)/r.height);
      applyBoardViewTransform();
    }
    if(mode==="pinch"&&evt.touches.length===2&&startPinch){
      const dx=evt.touches[1].clientX-evt.touches[0].clientX, dy=evt.touches[1].clientY-evt.touches[0].clientY;
      const nd=Math.hypot(dx,dy), ns=clamp(startPinch.scaleAtStart*(nd/startPinch.distance),1,3);
      const midX=(evt.touches[0].clientX+evt.touches[1].clientX)/2, midY=(evt.touches[0].clientY+evt.touches[1].clientY)/2, mid={x:midX,y:midY};
      const base=app.boardView.baseViewBox, r=bw.getBoundingClientRect();
      app.boardView.scale=ns;
      app.boardView.panX=startPinch.midSvg.x-(base.x+base.w/2)-(mid.x-r.left-r.width/2)*(base.w/ns)/r.width;
      app.boardView.panY=startPinch.midSvg.y-(base.y+base.h/2)-(mid.y-r.top-r.height/2)*(base.h/ns)/r.height;
      applyBoardViewTransform();
    }
  },{passive:false});
  bw.addEventListener("touchend", evt=>{
    if(evt.touches.length===0){mode=null;startPan=null;startPinch=null;}
    else if(evt.touches.length===1){
      mode="pan";
      startPan={fingerClient:{x:evt.touches[0].clientX,y:evt.touches[0].clientY},panXAtStart:app.boardView.panX,panYAtStart:app.boardView.panY};
      startPinch=null;
    }
  });
}

// ─── SVG setup ────────────────────────────────────────────────────────────────
async function injectBoardSvg() {
  const host=document.getElementById("board-svg-host");
  host.innerHTML=await loadText("./assets/didcot-dogs-board.v1.svg");
  const svg=host.querySelector("svg");
  if(!svg) throw new Error("No SVG element found");
  svg.removeAttribute("width"); svg.removeAttribute("height");
  svg.setAttribute("preserveAspectRatio","xMidYMid meet");
  svg.style.background="transparent"; svg.style.willChange="auto"; svg.style.transform="";
  return svg;
}

function setupFullscreenButton() {
  const btn=document.getElementById("fullscreen-btn"); if(!btn) return;
  btn.addEventListener("click", async()=>{
    if(!document.fullscreenElement) await document.documentElement.requestFullscreen();
    else await document.exitFullscreen();
  });
}

function normalizeSvgNodeAliases(svg,rulesData) {
  Object.entries(rulesData.svgNodeIdAliases||{}).forEach(([from,to])=>{
    const n=svg.querySelector(`#${CSS.escape(from)}`); if(!n) return;
    n.setAttribute("data-original-id",from); n.setAttribute("id",to);
  });
}

function ensureSvgDefs(svg) {
  let defs=svg.querySelector("defs");
  if(!defs){defs=createSvgEl("defs");svg.insertBefore(defs,svg.firstChild);}
  if(!svg.querySelector("#wild-route-gradient")){
    const g=createSvgEl("linearGradient",{id:"wild-route-gradient",x1:"0%",y1:"0%",x2:"100%",y2:"0%"});
    [["0%","#ff4d4d"],["18%","#ff9f1c"],["36%","#ffe600"],["54%","#2ec27e"],["72%","#2f6edb"],["90%","#c64f8e"],["100%","#ff4d4d"]].forEach(([o,c])=>g.appendChild(createSvgEl("stop",{offset:o,"stop-color":c})));
    defs.appendChild(g);
  }
  ["eric","tango"].forEach(n=>{
    const id=`claim-gradient-${n}`;
    if(!svg.querySelector(`#${id}`)){
      const g=createSvgEl("linearGradient",{id,gradientUnits:"userSpaceOnUse",spreadMethod:"repeat",x1:"0",y1:"0",x2:"40",y2:"0"});
      const col=n==="eric"?"#19a7ff":"#ffe600";
      [["0%",col],["90%",col],["90%","#ffffff"],["100%","#ffffff"]].forEach(([o,c])=>g.appendChild(createSvgEl("stop",{offset:o,"stop-color":c})));
      defs.appendChild(g);
    }
  });
}

let __claimAnim=null;
function startClaimGradientAnimation(svg) {
  if(__claimAnim) return;
  const eg=svg.querySelector("#claim-gradient-eric"), tg=svg.querySelector("#claim-gradient-tango");
  if(!eg||!tg) return;
  const tick=now=>{
    const s=-((now/18)%40);
    eg.setAttribute("gradientTransform",`translate(${s} 0)`);
    tg.setAttribute("gradientTransform",`translate(${s} 0)`);
    __claimAnim=requestAnimationFrame(tick);
  };
  __claimAnim=requestAnimationFrame(tick);
}

function tightenSvgViewBox(svg) {
  const groups=["#Routes","#Labels","#Nodes"].map(s=>svg.querySelector(s));
  const boxes=groups.map(g=>{if(!g||!g.getBBox)return null;const b=g.getBBox();return isFinite(b.x)?b:null;}).filter(Boolean);
  if(!boxes.length) return;
  const x=Math.min(...boxes.map(b=>b.x))-68, y=Math.min(...boxes.map(b=>b.y))-60;
  const x2=Math.max(...boxes.map(b=>b.x+b.width))+68, y2=Math.max(...boxes.map(b=>b.y+b.height))+60;
  svg.setAttribute("viewBox",`${x} ${y} ${x2-x} ${y2-y}`);
  app.boardView.baseViewBox={x,y,w:x2-x,h:y2-y};
}

function getSvgAudit(svg,rulesData) {
  const rg=svg.querySelector("#Routes"), ng=svg.querySelector("#Nodes");
  const rids=(rg?[...rg.querySelectorAll("[id]")]:[]).map(e=>e.id).filter(Boolean);
  const nids=(ng?[...ng.querySelectorAll("[id]")]:[]).map(e=>e.id).filter(Boolean);
  return {routeIds:rids,nodeIds:nids,routeCount:rids.length,nodeCount:nids.length,
    missingRuleRoutes:Object.keys(rulesData.routes||{}).filter(id=>!rids.includes(id)),
    missingRuleNodes:(rulesData.nodes||[]).filter(id=>!nids.includes(id))};
}

// ─── Game state ───────────────────────────────────────────────────────────────
function assignRouteColours(routeIds,palette) {
  const assigned={};
  shuffle(routeIds).forEach(id=>{
    const blocked=Object.keys(assigned).filter(o=>routesShareNode(id,o)).map(o=>assigned[o]);
    const opts=shuffle(palette.filter(c=>!blocked.includes(c)));
    assigned[id]=opts[0]||shuffle(palette)[0];
  });
  return assigned;
}

function rerollSpecificRouteColours(ids) {
  const palette=app.rulesData.routeColours||[];
  ids.forEach(id=>{
    const blocked=Object.keys(app.state.routes).filter(o=>o!==id&&routesShareNode(id,o)).map(o=>app.state.routes[o].colour);
    const opts=shuffle(palette.filter(c=>!blocked.includes(c)));
    app.state.routes[id].colour=opts[0]||shuffle(palette)[0];
  });
}

function buildDeck(rulesData) {
  const cols=rulesData.drawColours||[], cpc=rulesData.deck?.copiesPerColour??8, rc=rulesData.deck?.rainbowCount??0;
  const deck=[];
  cols.forEach(c=>{for(let i=0;i<cpc;i++)deck.push(c);});
  for(let i=0;i<rc;i++)deck.push("rainbow");
  return shuffle(deck);
}

function createPlayerState(startNode) {
  return {
    currentNode:startNode, previousNode:null, hand:[],
    journeyRouteIds:[], destinationQueue:[], completedDestinations:[],
    completedCount:0, lastDrawColor:null,
    inventory:[],       // held special cards: "zoom", "poop"
    skipTurns:0,        // NOWHERE TO POO / POOP trap
    routeCostBonus:0,   // JUST SNIFFIN'
    pendingZoom:false,  // ZOOMIES waiting to activate
  };
}

function createInitialLocalState(rulesData, journeyTarget=null, playerCount=2, mysteryNodeCount=3) {
  const routeIds=Object.keys(rulesData.routes||{});
  const colours=assignRouteColours(routeIds,rulesData.routeColours||[]);
  const routes={};
  routeIds.forEach(id=>{routes[id]={colour:colours[id],claimedBy:null};});
  const allNodes = rulesData.nodes || [];
  const N = journeyTarget || rulesData.winCondition?.targetJourneysBeforeReturn || 5;
  const mCount = Math.min(mysteryNodeCount, 8);
  const mysteryNodes = pickMysteryNodes(allNodes, rulesData.startNode, [], rulesData.destinationPool||[], mCount);

  // Shuffle destinations upfront — stored in destPool for assignment at character confirm time
  const destPool = shuffle(rulesData.destinationPool||[]);

  return {
    phase: "waiting",
    playerCount,
    journeyTarget: N,
    mysteryNodeCount: mCount,
    currentPlayer: null,
    playerOrder: [],
    characterSelections: {},  // { charName: { colour, joinOrder } }
    gameStarted: false,
    selectedRouteId: null,
    drawPile: buildDeck(rulesData),
    discardPile: [],
    justCompleted: null,
    routes,
    mysteryNodes,
    poopedNodes: {},
    destPool,           // ordered pool; sliced per player at confirm time
    players: {},        // keyed by character name, populated at confirm time
  };
}

// createPlayerEntry removed — player state created inline at character confirmation

// Returns the number of destinations required to win — from game state (set at creation)
// Falls back to rulesData.winCondition.targetJourneysBeforeReturn then to 5.
function getJourneyTarget() {
  if(app.state?.journeyTarget) return app.state.journeyTarget;
  if(app.rulesData?.destinationPool?.length) {
    return Math.min(3, Math.floor(app.rulesData.destinationPool.length / 2)) || 1;
  }
  return 3; // safe default
}

function getCurrentTargetForPlayer(playerOrName) {
  const player = (typeof playerOrName === "string")
    ? (getPlayerByChar(playerOrName) || app.state?.players?.[playerOrName])
    : playerOrName;
  if(!player) return null;
  const N = getJourneyTarget();
  if(player.completedCount < N) return player.destinationQueue[player.completedCount] || null;
  return app.rulesData.winCondition?.finalDestination
    || app.rulesData.winCondition?.finalDestinationAfterFive
    || "Didcot";
}

// ─── Token / node helpers ─────────────────────────────────────────────────────
function getNodeElement(svg,nodeId) { return svg.querySelector(`#${CSS.escape(nodeId)}`); }
function getNodeCenter(svg,nodeId) {
  const el=getNodeElement(svg,nodeId);
  if(!el) throw new Error(`Node not found: ${nodeId}`);
  if(el.tagName.toLowerCase()==="circle") return {x:+el.getAttribute("cx"),y:+el.getAttribute("cy")};
  const b=el.getBBox(); return {x:b.x+b.width/2,y:b.y+b.height/2};
}
function ensureLayer(svg,id,alwaysOnTop=false) {
  let l=svg.querySelector(`#${CSS.escape(id)}`);
  if(!l){l=createSvgEl("g",{id});svg.appendChild(l);}
  else if(alwaysOnTop) svg.appendChild(l); // move to end = renders on top
  return l;
}
function ensureTokenDefs(svg) {
  let defs=svg.querySelector("defs");
  if(!defs){defs=createSvgEl("defs");svg.insertBefore(defs,svg.firstChild);}
  ALL_CHARACTERS.forEach(n=>{
    const id=`token-clip-${n}`;
    if(!svg.querySelector(`#${CSS.escape(id)}`)){
      const cp=createSvgEl("clipPath",{id});
      cp.appendChild(createSvgEl("circle",{cx:"0",cy:"0",r:"20"}));
      defs.appendChild(cp);
    }
  });
}
function ensurePlayerToken(svg,playerName) {
  ensureTokenDefs(svg);
  const layer=ensureLayer(svg,"token-layer");
  let g=svg.querySelector(`#token-${CSS.escape(playerName)}`);
  if(g) return g;
  const cfg=getPlayerConfig(playerName);
  const heroColour=getPlayerColour(playerName);
  g=createSvgEl("g",{id:`token-${playerName}`,class:`token-group ${cfg.tokenClass}`});
  const w=createSvgEl("g",{class:"token-wobble"});
  const tokenColour = getPlayerColour(playerName);
  const tc=createSvgEl("circle",{class:"token-circle",r:"24",fill:"#ffffff"});
  tc.style.stroke=tokenColour; tc.style.strokeWidth="5";
  w.appendChild(tc);
  const img=createSvgEl("image",{x:"-20",y:"-20",width:"40",height:"40",preserveAspectRatio:"xMidYMid meet","clip-path":`url(#token-clip-${playerName})`});
  const _imgCfg=getPlayerConfig(playerName);
  img.setAttributeNS(XLINK_NS,"xlink:href",_imgCfg.image);
  img.setAttribute("href",_imgCfg.image);
  w.appendChild(img); g.appendChild(w); layer.appendChild(g);
  return g;
}
function setTokenPosition(svg,name,x,y) { ensurePlayerToken(svg,name).setAttribute("transform",`translate(${x},${y})`); }
// Returns {x,y} offset for a token given how many tokens share its node
// Players arranged in a geometric formation: 1=centre, 2=side-by-side,
// 3=triangle, 4=square, 5=pentagon, 6=hexagon
function getTokenFormationPosition(indexAmongShared, totalShared, cx, cy) {
  if(totalShared === 1) return {x:cx, y:cy};
  const radius = 22;
  const angleOffset = -Math.PI/2; // start at top
  const angle = angleOffset + (2*Math.PI * indexAmongShared / totalShared);
  return {x: cx + radius*Math.cos(angle), y: cy + radius*Math.sin(angle)};
}

function renderTokens() {
  const activePlayers = getActivePlayers();
  if(!activePlayers.length) return;
  // Group players by current node
  const byNode = {};
  activePlayers.forEach(charName => {
    const player = getPlayerByChar(charName);
    if(!player) return;
    const node = player.currentNode;
    if(!byNode[node]) byNode[node] = [];
    byNode[node].push(charName);
  });
  // Position each token
  activePlayers.forEach(charName => {
    const player = getPlayerByChar(charName);
    if(!player) return;
    const node = player.currentNode;
    const c = getNodeCenter(app.svg, node);
    const group = byNode[node];
    const idx = group.indexOf(charName);
    const pos = getTokenFormationPosition(idx, group.length, c.x, c.y);
    setTokenPosition(app.svg, charName, pos.x, pos.y);
  });
}

function getConnectedNode(routeId,fromNode) {
  const {a,b}=parseRouteId(routeId);
  return a===fromNode?b:b===fromNode?a:null;
}

// ─── Payment / playability ────────────────────────────────────────────────────
function getPaymentOptionsForColor(routeId,playerName,chosenColor=null) {
  const player=getPlayerByChar(playerName), hc=player?countCards(player.hand):{};
  const rc=hc.rainbow||0, routeColour=app.state.routes[routeId].colour;
  const baseCost=app.rulesData.routes[routeId].length;
  const cost=baseCost+(player.routeCostBonus||0); // JUST SNIFFIN' penalty
  // All routes are a named colour. Rainbow cards act as wildcards for any colour.
  const ec=chosenColor||routeColour, owned=hc[ec]||0;
  const minR=Math.max(0,cost-owned), maxR=Math.min(rc,cost);
  const options=[];
  for(let r=minR;r<=maxR;r++){const uc=cost-r;if(uc<=owned)options.push({colourChoice:ec,useColourCount:uc,useRainbowCount:r});}
  return {affordable:options.length>0,isWild:false,availableColors:[routeColour],options};
}

function getRoutePlayability(routeId) {
  const pn=app.state.currentPlayer;
  const player=getPlayerByChar(pn);
  if(!player){console.warn("[DD] No player for",pn);return {playable:false,reason:"Waiting for game to start."};}
  const rs=app.state.routes[routeId];
  const cn=getConnectedNode(routeId,player.currentNode);
  if(!cn) return {playable:false,reason:"Route does not connect to current node."};
  if(rs.claimedBy) return {playable:false,reason:`Already claimed by ${rs.claimedBy}.`};
  // Backtrack check: only block if the ROUTE leads back to previousNode AND
  // it was the exact route used to arrive (prevent node-level blocking)
  if(player.previousNode&&cn===player.previousNode) return {playable:false,reason:"Cannot move straight back to previous node."};
  const pay=getPaymentOptionsForColor(routeId,pn);
  if(!pay.affordable) return {playable:false,reason:"Not enough matching cards.",targetNode:cn};
  return {playable:true,targetNode:cn,payment:pay};
}

function drawCard() {
  if(!app.state.drawPile.length){
    if(!app.state.discardPile.length) return null;
    app.state.drawPile=shuffle(app.state.discardPile); app.state.discardPile=[];
  }
  return app.state.drawPile.pop();
}

function removeSpecificCardsFromHand(hand,colour,useCol,useRain) {
  const h=[...hand]; let cl=useCol,rl=useRain; const spent=[];
  for(let i=h.length-1;i>=0&&cl>0;i--){if(h[i]===colour){spent.push(h[i]);h.splice(i,1);cl--;}}
  for(let i=h.length-1;i>=0&&rl>0;i--){if(h[i]==="rainbow"){spent.push(h[i]);h.splice(i,1);rl--;}}
  return {nextHand:h,spent};
}

// ─── Turn management ──────────────────────────────────────────────────────────
function isHost() {
  return app.state?.createdBy != null && app.state.createdBy === app.localHero;
}

function isMyTurn() {
  if(!app.roomCode) return true;
  if(!app.localHero) return true;
  if(!app.state.currentPlayer) return false;
  return app.state.currentPlayer===app.localHero;
}

function endTurn() {
  app.actionInProgress = false; // always release lock on turn end
  app.state.selectedRouteId=null;
  closeRouteModal();
  // Advance to next player in order
  const order = app.state.playerOrder || getActivePlayers();
  if(!order.length) { console.warn("[DD] endTurn: no playerOrder yet"); return; }
  const idx = order.indexOf(app.state.currentPlayer);
  const next = order[(idx+1) % order.length];
  if(!next) { console.warn("[DD] endTurn: next is undefined, order:", order); return; }
  app.state.currentPlayer = next;
  // Check skip turns — consume ALL remaining skips at once, one modal only
  const nextPlayer = getPlayerByChar(next);
  if(nextPlayer && nextPlayer.skipTurns > 0){
    const skipsLeft = nextPlayer.skipTurns;
    nextPlayer.skipTurns = 0; // consume all at once
    console.log("[DD] Skipping", next, "—", skipsLeft, "turn(s)");
    renderAll();
    if(app.roomCode) fbPushState(app.roomCode, app.state).then(()=>updateRoomHud());
    if(next === getViewHero()){
      // Skipped player sees one modal then turn passes
      showNowhereToPoModal(
        skipsLeft === 1 ? "Still looking for the right spot…" : `Sniffing around for ${skipsLeft} turns… 🐾`,
        () => { setTimeout(endTurn, 200); }
      );
    } else {
      showMobileToast(`${next} is sniffing around — ${skipsLeft} turn${skipsLeft!==1?"s":""} skipped`);
      // Non-local clients just receive updated state via Firebase subscriber
    }
    return;
  }
  console.log("[DD] endTurn → now",app.state.currentPlayer);
  renderAll();
  if(app.roomCode) {
    fbPushState(app.roomCode, app.state).then(()=>updateRoomHud());
  }
}

// ─── Animation ────────────────────────────────────────────────────────────────
function easeInOutCubic(t){return t<0.5?4*t*t*t:1-Math.pow(-2*t+2,3)/2;}

function getRouteTravelDirection(el,from,to,routeId){
  const tot=el.getTotalLength(),sp=el.getPointAtLength(0),ep=el.getPointAtLength(tot);
  const fc=getNodeCenter(app.svg,from),tc=getNodeCenter(app.svg,to);
  const sf=Math.hypot(sp.x-fc.x,sp.y-fc.y),ef=Math.hypot(ep.x-fc.x,ep.y-fc.y);
  const st=Math.hypot(sp.x-tc.x,sp.y-tc.y),et=Math.hypot(ep.x-tc.x,ep.y-tc.y);
  if(sf<=ef&&et<=st) return true;
  if(ef<sf&&st<et) return false;
  return parseRouteId(routeId).a===from;
}

function animateTokenAlongRoute(playerName,routeId,fromNode,toNode){
  return new Promise(resolve=>{
    const el=app.svg.querySelector(`#${CSS.escape(routeId)}`);
    if(!el||!el.getTotalLength){renderTokens();resolve();return;}
    const token=ensurePlayerToken(app.svg,playerName),tot=el.getTotalLength();
    const fwd=getRouteTravelDirection(el,fromNode,toNode,routeId),start=performance.now();
    function step(now){
      const t=Math.min(1,(now-start)/900),e=easeInOutCubic(t),p=fwd?e:1-e;
      const pt=el.getPointAtLength(tot*p);
      let x=pt.x,y=pt.y;
      // If another player is already at toNode, offset slightly
      const othersAtDest = getActivePlayers().filter(n =>
        n !== playerName && getPlayerByChar(n)?.currentNode === toNode
      );
      if(othersAtDest.length) { x += 18; }
      token.setAttribute("transform",`translate(${x},${y})`);
      if(t<1) requestAnimationFrame(step); else resolve();
    }
    requestAnimationFrame(step);
  });
}

// ─── Status / toast ───────────────────────────────────────────────────────────
let __toastTimer=null;
function updateStatus(text,priority=TOAST_SILENT){
  const chip=document.getElementById("status-chip"); if(chip) chip.textContent=text;
  if(priority===TOAST_NOTABLE) showMobileToast(text);
}
function showMobileToast(text){
  let t=document.getElementById("mobile-toast");
  if(!t){
    t=document.createElement("div"); t.id="mobile-toast"; t.className="mobile-toast";
    const hud=document.getElementById("mobile-hud");
    if(hud&&hud.parentNode) hud.parentNode.insertBefore(t,hud.nextSibling);
    else document.getElementById("game-shell").appendChild(t);
  }
  t.textContent=text; t.classList.remove("mobile-toast-hide"); t.classList.add("mobile-toast-show");
  if(__toastTimer) clearTimeout(__toastTimer);
  __toastTimer=setTimeout(()=>{t.classList.remove("mobile-toast-show");t.classList.add("mobile-toast-hide");},2000);
}

// ─── Room HUD ─────────────────────────────────────────────────────────────────
function updateRoomHud(){
  if(!app.roomCode) return;
  const mine=app.state.currentPlayer===app.localHero;
  const hero=app.localHero||"?";
  const cfg=getPlayerConfig(hero);

  const identity=document.getElementById("desktop-identity");
  if(identity&&cfg){
    identity.innerHTML=`
      <div class="desktop-identity-inner">
        <img class="desktop-identity-portrait"
             id="desktop-identity-portrait"
             data-hero="${hero}"
             src="${cfg.image}" alt="${hero}"
             style="border-color:${getPlayerColour(hero)}">
        <div class="desktop-identity-text">
          <div class="desktop-identity-label">${isHost()?"HOST · YOU ARE":"YOU ARE"}</div>
          <div class="desktop-identity-name">${hero.toUpperCase()}</div>
          <div class="desktop-identity-room">Room: <strong>${app.roomCode}</strong></div>
        </div>
      </div>`;
  }

  requestAnimationFrame(startPortraitWobble);

  const ti=document.getElementById("desktop-turn-indicator");
  if(ti){
    ti.className=`desktop-turn-indicator ${mine?"desktop-turn-mine":"desktop-turn-theirs"}`;
    ti.textContent=mine?"YOUR TURN":`${app.state.currentPlayer}'s turn`;
  }

  renderTurnBadge();

  const turnPill=document.getElementById("mobile-hud-turn");
  if(turnPill){
    turnPill.innerHTML=`
      <span style="opacity:0.55;font-size:11px;letter-spacing:0.08em">${app.roomCode}</span>
      <span style="margin:0 6px;opacity:0.3">·</span>
      <span style="color:${mine?"#ffe600":"rgba(255,255,255,0.6)"}">
        ${mine?"YOUR TURN":`${app.state.currentPlayer}'s turn`}
      </span>`;
    turnPill.style.fontFamily="var(--header-font)";
  }
}


// ─── Room screen ──────────────────────────────────────────────────────────────
function showScreen(id){ const e=document.getElementById(id); if(e) e.classList.add("active"); }
function hideScreen(id){ const e=document.getElementById(id); if(e) e.classList.remove("active"); }


// ═══════════════════════════════════════════════════════════════════════════
// LOBBY SYSTEM v3 — phase-driven, no polling, no race conditions
//
// Phase flow:
//   "waiting"   — room open, players joining
//   "ready"     — room full, host sees Start button, others see waiting
//   "countdown" — 3→2→1, all clients show simultaneously
//   "playing"   — game running
//
// Rules:
//   - Every client watches phase via ONE fbSubscribeRoomExclusive listener
//   - No polling. No greyout subscribers. No carousel timing races.
//   - Creator writes all state. Joiner writes only their own slice.
//   - app.state is only set from confirmed Firebase snapshots.
// ═══════════════════════════════════════════════════════════════════════════

function getLobbyOverlay() {
  let o = document.getElementById("lobby-overlay");
  if(!o) {
    o = document.createElement("div");
    o.id = "lobby-overlay";
    o.className = "lobby-overlay";
    document.getElementById("game-shell").appendChild(o);
  }
  return o;
}

function showLobby(html) {
  const o = getLobbyOverlay();
  o.innerHTML = html;
  o.classList.add("open");
}

function hideLobby() {
  const o = document.getElementById("lobby-overlay");
  if(o) { o.classList.remove("open"); o.innerHTML=""; }
}

// ── Contrast helper ───────────────────────────────────────────────────────
function contrastText(hex) {
  const r=parseInt(hex.slice(1,3),16), g=parseInt(hex.slice(3,5),16), b=parseInt(hex.slice(5,7),16);
  const lum = 0.2126*(r/255) + 0.7152*(g/255) + 0.0722*(b/255);
  return lum > 0.45 ? "#111111" : "#ffffff";
}

// ── CREATE LOBBY ──────────────────────────────────────────────────────────
function showCreateLobby() {
  const pool = app.rulesData.destinationPool || [];
  const maxJ = Math.floor(pool.length / 2);
  const nonDestNodes = (app.rulesData.nodes||[]).filter(n =>
    n !== app.rulesData.startNode && !pool.includes(n)
  );
  const maxM = Math.min(nonDestNodes.length, 8);
  const colourNames = Object.keys(PLAYER_COLOURS);
  const playerOptions = [2,3,4,5,6];
  const journeyOptions = Array.from({length: maxJ}, (_,i) => i+1);

  let sel = { character: null, colour: null, playerCount: null, journeyTarget: null, mysteryCount: 3 };

  function render() {
    const canConfirm = sel.character && sel.colour && sel.playerCount && sel.journeyTarget;
    showLobby(`
      <div class="lobby-inner">
        <div class="lobby-wipe lobby-wipe-a"></div>
        <div class="lobby-wipe lobby-wipe-b"></div>
        <div class="lobby-noise"></div>
        <div class="lobby-content">
          <div class="lobby-kicker">Didcot Dogs</div>
          <div class="lobby-title">CREATE GAME</div>
          <div class="lobby-section">
            <div class="lobby-section-label">Pick your dog</div>
            <div class="lobby-char-grid">
              ${ALL_CHARACTERS.map(c => `
                <button type="button" class="lobby-char-btn${sel.character===c?" active":""}" data-char="${c}">
                  <div class="lobby-char-frame"><img src="./assets/${c.toLowerCase()}.png" alt="${c}"></div>
                  <div class="lobby-char-name">${c}</div>
                </button>`).join("")}
            </div>
          </div>
          <div class="lobby-section">
            <div class="lobby-section-label">Pick your colour</div>
            <div class="lobby-colour-grid">
              ${colourNames.map(name => {
                const hex=PLAYER_COLOURS[name], fg=contrastText(hex);
                return `<button type="button" class="lobby-colour-btn${sel.colour===name?" active":""}" data-colour="${name}" style="background:${hex};color:${fg};border-color:${sel.colour===name?"rgba(255,230,0,0.8)":"transparent"}">${name}</button>`;
              }).join("")}
            </div>
          </div>
          <div class="lobby-row-pickers">
            <div class="lobby-section lobby-section-half">
              <div class="lobby-section-label">Players</div>
              <div class="lobby-num-grid">
                ${playerOptions.map(n=>`<button type="button" class="lobby-num-btn${sel.playerCount===n?" active":""}" data-val="${n}">${n}</button>`).join("")}
              </div>
            </div>
            <div class="lobby-section lobby-section-half">
              <div class="lobby-section-label">Destinations each</div>
              <div class="lobby-num-grid">
                ${journeyOptions.map(n=>{
                  const maxForCount = sel.playerCount ? Math.floor(pool.length / sel.playerCount) : maxJ;
                  const tooHigh = n > maxForCount;
                  if(sel.journeyTarget && sel.journeyTarget > maxForCount) sel.journeyTarget = null;
                  return `<button type="button" class="lobby-num-btn${sel.journeyTarget===n?" active":""}${tooHigh?" greyed":""}" data-val="${n}" ${tooHigh?"disabled":""}>${n}</button>`;
                }).join("")}
              </div>
            </div>
          </div>
          <div class="lobby-section">
            <div class="lobby-section-label">Mystery boxes on board (0–${maxM})</div>
            <div class="lobby-num-grid">
              ${Array.from({length:maxM+1},(_,i)=>i).map(n=>`<button type="button" class="lobby-num-btn${sel.mysteryCount===n?" active":""}" data-val="${n}">${n}</button>`).join("")}
            </div>
          </div>
          <div class="lobby-actions">
            <button id="lobby-back-btn" class="action-btn subtle" type="button">← Menu</button>
            <button id="lobby-confirm-btn" class="action-btn primary" type="button" ${canConfirm?"":"disabled"}>
              ${canConfirm?"Create room →":"Select all options"}
            </button>
          </div>
        </div>
      </div>`);

    document.querySelectorAll(".lobby-char-btn").forEach(btn => {
      btn.onclick = () => { sel.character = btn.dataset.char; render(); };
    });
    document.querySelectorAll(".lobby-colour-btn").forEach(btn => {
      btn.onclick = () => { sel.colour = btn.dataset.colour; render(); };
    });
    const pcGrid = document.querySelectorAll(".lobby-row-pickers .lobby-section-half");
    if(pcGrid[0]) pcGrid[0].querySelectorAll(".lobby-num-btn").forEach(btn => {
      btn.onclick = () => { sel.playerCount = +btn.dataset.val; render(); };
    });
    if(pcGrid[1]) pcGrid[1].querySelectorAll(".lobby-num-btn").forEach(btn => {
      btn.onclick = () => { sel.journeyTarget = +btn.dataset.val; render(); };
    });
    const allNumGrids = document.querySelectorAll(".lobby-num-grid");
    if(allNumGrids[allNumGrids.length-1]) {
      allNumGrids[allNumGrids.length-1].querySelectorAll(".lobby-num-btn").forEach(btn => {
        btn.onclick = () => { sel.mysteryCount = +btn.dataset.val; render(); };
      });
    }
    document.getElementById("lobby-back-btn").onclick = () => {
      hideLobby();
      showScreen("room-screen");
      startFallingDogs();
      wireRoomButtons();
    };
    const confirmBtn = document.getElementById("lobby-confirm-btn");
    if(confirmBtn && !confirmBtn.disabled) {
      confirmBtn.onclick = async () => {
        confirmBtn.disabled = true; confirmBtn.textContent = "Creating…";
        try {
          const state = createInitialLocalState(app.rulesData, sel.journeyTarget, sel.playerCount, sel.mysteryCount);
          const startNode = app.rulesData.startNode || "Didcot";
          const N = state.journeyTarget;
          state.characterSelections[sel.character] = { colour: sel.colour, joinOrder: 0 };
          state.createdBy = sel.character;
          state.players[sel.character] = {
            ...createPlayerState(startNode),
            destinationQueue: (state.destPool||[]).slice(0, N),
            joinOrder: 0,
          };
          const code = await fbCreateRoom(state, sel.character);
          app.roomCode = code;
          app.localHero = sel.character;
          sessionStorage.setItem("dd_room_code", code);
          sessionStorage.setItem("dd_hero", sel.character);
          sessionStorage.setItem("dd_colour", sel.colour);
          fbStartHeartbeat(code, sel.character);
          // Single subscriber drives ALL phase transitions from here
          startLobbySubscriber(code, sel.character);
        } catch(e) {
          confirmBtn.disabled = false; confirmBtn.textContent = "Create room →";
          console.error("[DD] Create failed:", e);
        }
      };
    }
  }
  render();
}

// ── JOIN LOBBY ────────────────────────────────────────────────────────────
function showJoinLobby(code, remoteState) {
  const taken = Object.keys(remoteState.characterSelections||{});
  const takenColours = Object.values(remoteState.characterSelections||{}).map(v=>v.colour);
  const colourNames = Object.keys(PLAYER_COLOURS);
  let sel = { character: null, colour: null };

  function render() {
    const canConfirm = sel.character && sel.colour;
    showLobby(`
      <div class="lobby-inner">
        <div class="lobby-wipe lobby-wipe-a"></div>
        <div class="lobby-wipe lobby-wipe-b"></div>
        <div class="lobby-noise"></div>
        <div class="lobby-content">
          <div class="lobby-kicker">Didcot Dogs — ${code}</div>
          <div class="lobby-title">JOIN GAME</div>
          <div class="lobby-game-info">
            <span>${remoteState.playerCount} players</span>
            <span>·</span>
            <span>${remoteState.journeyTarget} destination${remoteState.journeyTarget===1?"":"s"} each</span>
          </div>
          <div class="lobby-section">
            <div class="lobby-section-label">Pick your dog</div>
            <div class="lobby-char-grid">
              ${ALL_CHARACTERS.map(c => {
                const isTaken = taken.includes(c);
                return `<button type="button" class="lobby-char-btn${sel.character===c?" active":""}${isTaken?" taken":""}" data-char="${c}" ${isTaken?"disabled":""}>
                  <div class="lobby-char-frame"><img src="./assets/${c.toLowerCase()}.png" alt="${c}"></div>
                  <div class="lobby-char-name">${c}${isTaken?" ✓":""}</div>
                </button>`;
              }).join("")}
            </div>
          </div>
          <div class="lobby-section">
            <div class="lobby-section-label">Pick your colour</div>
            <div class="lobby-colour-grid">
              ${colourNames.map(name => {
                const isTaken = takenColours.includes(name);
                const hex = PLAYER_COLOURS[name], fg = contrastText(hex);
                return `<button type="button" class="lobby-colour-btn${sel.colour===name?" active":""}${isTaken?" taken":""}" data-colour="${name}" ${isTaken?"disabled":""} style="background:${isTaken?"#1a1a2e":hex};color:${isTaken?"rgba(255,255,255,0.25)":fg};border-color:${sel.colour===name?"rgba(255,230,0,0.8)":"transparent"};${isTaken?"text-decoration:line-through":""}">
                  ${name}
                </button>`;
              }).join("")}
            </div>
          </div>
          <div class="lobby-actions">
            <button id="lobby-back-btn" class="action-btn subtle" type="button">← Menu</button>
            <button id="lobby-confirm-btn" class="action-btn primary" type="button" ${canConfirm?"":"disabled"}>
              ${canConfirm?"Join room →":"Select dog + colour"}
            </button>
          </div>
        </div>
      </div>`);

    document.querySelectorAll(".lobby-char-btn:not([disabled])").forEach(btn => {
      btn.onclick = () => { sel.character = btn.dataset.char; render(); };
    });
    document.querySelectorAll(".lobby-colour-btn:not([disabled])").forEach(btn => {
      btn.onclick = () => { sel.colour = btn.dataset.colour; render(); };
    });
    document.getElementById("lobby-back-btn").onclick = () => {
      hideLobby();
      showScreen("room-screen");
      startFallingDogs();
      wireRoomButtons();
    };
    const confirmBtn = document.getElementById("lobby-confirm-btn");
    if(confirmBtn && !confirmBtn.disabled) {
      confirmBtn.onclick = async () => {
        confirmBtn.disabled = true; confirmBtn.textContent = "Joining…";
        try {
          // Re-fetch to guard against character stolen since render
          const freshSnap = await _firebaseGet(dbRef(`rooms/${code}/state`));
          const freshState = freshSnap.val();
          const nowTaken = Object.keys(freshState.characterSelections||{});
          if(nowTaken.includes(sel.character)) {
            sel.character = null;
            const takenColoursNow = Object.values(freshState.characterSelections||{}).map(v=>v.colour);
            if(takenColoursNow.includes(sel.colour)) sel.colour = null;
            confirmBtn.disabled = false; confirmBtn.textContent = "Join room →";
            render();
            showMobileToast("Oops! That dog was just taken. Pick another.");
            return;
          }
          const joinOrder = nowTaken.length;
          const N = freshState.journeyTarget || 5;
          const rawPool = freshState.destPool || [];
          const pool = Array.isArray(rawPool) ? rawPool
            : Object.keys(rawPool).sort((a,b)=>+a-+b).map(k=>rawPool[k]);
          const destQueue = pool.slice(joinOrder * N, (joinOrder + 1) * N);
          const startNode = app.rulesData?.startNode || "Didcot";

          // Write both entries — await each so they're confirmed before we proceed
          await _firebaseSet(dbRef(`rooms/${code}/state/characterSelections/${sel.character}`),
            { colour: sel.colour, joinOrder });
          await _firebaseSet(dbRef(`rooms/${code}/state/players/${sel.character}`), {
            ...createPlayerState(startNode),
            destinationQueue: destQueue,
            joinOrder,
          });
          await fbUpdatePresence(code, sel.character);

          // Set identity — state will arrive via subscriber below
          app.localHero = sel.character;
          app.roomCode = code;
          sessionStorage.setItem("dd_room_code", code);
          sessionStorage.setItem("dd_hero", sel.character);
          sessionStorage.setItem("dd_colour", sel.colour);
          fbStartHeartbeat(code, sel.character);
          // Single subscriber drives ALL phase transitions from here
          startLobbySubscriber(code, sel.character);
        } catch(e) {
          confirmBtn.disabled = false; confirmBtn.textContent = "Join room →";
          console.error("[DD] Join failed:", e);
        }
      };
    }
  }
  render();
}

// ── LOBBY SUBSCRIBER — single source of truth for all phase transitions ───
//
// Called by both creator and joiner after their writes are confirmed.
// Watches phase field and drives: waiting → ready → countdown → playing.
// No polling. No separate greyout subscribers. One listener per client.
//
function startLobbySubscriber(code, myCharacter) {
  console.log("[DD] startLobbySubscriber", code, myCharacter);
  fbSubscribeRoomExclusive(code, raw => {
    if(!raw) return;
    const state = restoreArrays({...raw});
    // Always keep identity set
    app.localHero = myCharacter;
    app.roomCode = code;
    app.state = { ...state, controlledHero: myCharacter };

    switch(state.phase) {
      case "waiting":
        renderWaitingScreen(code, myCharacter, state);
        break;
      case "ready":
        renderReadyScreen(code, myCharacter, state);
        break;
      case "countdown":
        // Only render once — guard with a flag on the overlay
        renderCountdownScreen(code, myCharacter, state);
        break;
      case "playing":
        launchGameFromLobby(code, myCharacter, state);
        break;
    }
  });
}

// ── WAITING screen — shown to all until room is full ─────────────────────
function renderWaitingScreen(code, myCharacter, state) {
  const joined = Object.keys(state.characterSelections||{}).length;
  const total = state.playerCount || 2;
  const entries = Object.entries(state.characterSelections||{})
    .sort((a,b) => (a[1].joinOrder||0) - (b[1].joinOrder||0));

  showLobby(`
    <div class="lobby-inner">
      <div class="lobby-wipe lobby-wipe-a"></div>
      <div class="lobby-wipe lobby-wipe-b"></div>
      <div class="lobby-noise"></div>
      <div class="lobby-content">
        <div class="lobby-kicker">Didcot Dogs</div>
        <div class="lobby-title">WAITING…</div>
        <div class="lobby-waiting-code-wrap">
          <div class="lobby-waiting-code-label">Share this code</div>
          <div class="lobby-waiting-code">${code}</div>
        </div>
        <div class="lobby-waiting-players">
          ${Array.from({length:total},(_,i) => {
            const entry = entries[i];
            if(entry) {
              const [char, data] = entry;
              const col = PLAYER_COLOURS[data.colour]||"#888";
              const fg = contrastText(col);
              return `<div class="lobby-waiting-slot lobby-waiting-slot-filled" style="background:${col};border-color:${col}">
                <img src="./assets/${char.toLowerCase()}.png" alt="${char}" style="width:40px;height:40px;border-radius:50%;border:3px solid rgba(255,255,255,0.6);background:rgba(255,255,255,0.9)">
                <span style="color:${fg};font-weight:700">${char}</span>
                ${data.joinOrder===0?`<span class="lobby-host-badge" style="color:${fg}">HOST</span>`:""}
                ${char===myCharacter&&data.joinOrder!==0?`<span class="lobby-host-badge" style="color:${fg}">YOU</span>`:""}
              </div>`;
            }
            return `<div class="lobby-waiting-slot lobby-waiting-slot-empty">
              <div class="waiting-dots" style="display:flex;gap:4px;justify-content:center">
                <div class="waiting-dot"></div><div class="waiting-dot"></div><div class="waiting-dot"></div>
              </div>
            </div>`;
          }).join("")}
        </div>
        <div class="lobby-waiting-sub">${joined}/${total} players joined</div>
        <div style="margin-top:16px">
          <button id="waiting-back-btn" class="action-btn subtle" type="button">← Back to menu</button>
        </div>
      </div>
    </div>`);

  document.getElementById("waiting-back-btn").onclick = () => doReturnToMenu();

  // Creator advances phase to "ready" once room is full
  // Only the creator writes — all other clients just watch
  const isCreator = state.createdBy === myCharacter;
  if(isCreator && joined >= total) {
    _firebaseSet(dbRef(`rooms/${code}/state/phase`), "ready");
  }
}

// ── READY screen — host sees Start, others see waiting for host ───────────
function renderReadyScreen(code, myCharacter, state) {
  const isCreator = state.createdBy === myCharacter;
  const entries = Object.entries(state.characterSelections||{})
    .sort((a,b) => (a[1].joinOrder||0) - (b[1].joinOrder||0));

  showLobby(`
    <div class="lobby-inner">
      <div class="lobby-wipe lobby-wipe-a"></div>
      <div class="lobby-wipe lobby-wipe-b"></div>
      <div class="lobby-noise"></div>
      <div class="lobby-content">
        <div class="lobby-kicker">Didcot Dogs</div>
        <div class="lobby-title">ALL IN!</div>
        <div class="lobby-waiting-players">
          ${entries.map(([char, data]) => {
            const col = PLAYER_COLOURS[data.colour]||"#888";
            const fg = contrastText(col);
            return `<div class="lobby-waiting-slot lobby-waiting-slot-filled" style="background:${col};border-color:${col}">
              <img src="./assets/${char.toLowerCase()}.png" alt="${char}" style="width:40px;height:40px;border-radius:50%;border:3px solid rgba(255,255,255,0.6);background:rgba(255,255,255,0.9)">
              <span style="color:${fg};font-weight:700">${char}</span>
              ${char===myCharacter?`<span class="lobby-host-badge" style="color:${fg}">YOU</span>`:""}
            </div>`;
          }).join("")}
        </div>
        <div style="margin-top:24px;text-align:center">
          ${isCreator
            ? `<button id="start-game-btn" class="action-btn primary" type="button" style="font-size:20px;padding:16px 40px">Start game →</button>`
            : `<div class="lobby-waiting-sub">Waiting for host to start…</div>
               <div class="waiting-dots" style="display:flex;gap:4px;justify-content:center;margin-top:12px">
                 <div class="waiting-dot"></div><div class="waiting-dot"></div><div class="waiting-dot"></div>
               </div>`
          }
        </div>
        <div style="margin-top:16px">
          <button id="waiting-back-btn" class="action-btn subtle" type="button">← Back to menu</button>
        </div>
      </div>
    </div>`);

  document.getElementById("waiting-back-btn").onclick = () => doReturnToMenu();
  if(isCreator) {
    document.getElementById("start-game-btn").onclick = async () => {
      document.getElementById("start-game-btn").disabled = true;
      // Write turn order and advance to countdown — one atomic-ish sequence
      const players = Object.keys(state.characterSelections||{});
      const order = shuffle([...players]);
      await _firebaseSet(dbRef(`rooms/${code}/state/playerOrder`), order);
      await _firebaseSet(dbRef(`rooms/${code}/state/currentPlayer`), order[0]);
      await _firebaseSet(dbRef(`rooms/${code}/state/phase`), "countdown");
    };
  }
}

// ── COUNTDOWN screen — 3→2→1, all clients fire simultaneously ────────────
let _countdownActive = false;
function renderCountdownScreen(code, myCharacter, state) {
  if(_countdownActive) return; // subscriber may fire multiple times — only run once
  _countdownActive = true;

  showLobby(`
    <div class="lobby-inner" style="display:flex;align-items:center;justify-content:center;min-height:100vh">
      <div class="lobby-content" style="text-align:center">
        <div class="lobby-kicker">Didcot Dogs</div>
        <div id="countdown-number" style="font-family:var(--header-font);font-size:180px;line-height:1;color:#ffe600;text-shadow:0 0 60px rgba(255,230,0,0.5)">3</div>
        <div style="font-family:var(--header-font);font-size:22px;opacity:0.5;letter-spacing:0.15em">GET READY</div>
      </div>
    </div>`);

  let count = 3;
  const el = () => document.getElementById("countdown-number");
  const tick = setInterval(() => {
    count--;
    if(count > 0) {
      if(el()) el().textContent = count;
    } else {
      clearInterval(tick);
      _countdownActive = false;
      hideLobby();
      launchGameFromLobby(code, myCharacter, state);
    }
  }, 1000);
}

// ── LAUNCH — transition from lobby into the game ──────────────────────────
let _gameAlreadyLaunched = false;
function launchGameFromLobby(code, myCharacter, state) {
  // Guard: subscriber fires on every state change — only launch once
  if(_gameAlreadyLaunched) return;
  _gameAlreadyLaunched = true;

  // If phase isn't playing yet, write it (creator only, idempotent)
  if(state.phase !== "playing" && state.createdBy === myCharacter) {
    _firebaseSet(dbRef(`rooms/${code}/state/phase`), "playing");
  }

  app.localHero = myCharacter;
  app.roomCode = code;
  app.state = { ...state, controlledHero: myCharacter, phase: "playing" };

  hideLobby();
  hideScreen("room-screen");
  showMobileHud();
  resetBoardView();
  showStartToast(myCharacter);
  renderAll();
  showCurrentDestinationReveal(myCharacter);
  updateRoomHud();

  // Hand off to the canonical game subscriber
  fbSubscribeRoomExclusive(code, remoteRaw => {
    if(!remoteRaw || !remoteRaw.players) return;
    app.state = { ...restoreArrays({...remoteRaw}), controlledHero: myCharacter };
    renderAll();
    updateRoomHud();
  });
  watchForPlayerDepartures(code);
  console.log("[DD] Game launched. Hero:", myCharacter, "Turn:", state.currentPlayer);
}

// ── WIRE ROOM BUTTONS ─────────────────────────────────────────────────────────
function wireRoomButtons() {
  const createBtn  = document.getElementById("room-create-btn");
  const joinBtn    = document.getElementById("room-join-btn");
  const joinInput  = document.getElementById("room-join-input");
  const errorEl    = document.getElementById("room-error");

  createBtn.disabled = false; createBtn.textContent = "Create game";
  joinBtn.disabled   = false; joinBtn.textContent   = "Join";
  if(errorEl) errorEl.textContent = "";

  createBtn.onclick = () => {
    hideScreen("room-screen");
    showCreateLobby();
  };

  joinBtn.onclick = async () => {
    const code = (joinInput.value||"").toUpperCase().trim();
    if(code.length !== 4) { errorEl.textContent = "Enter a 4-character code."; return; }
    joinBtn.disabled = true; joinBtn.textContent = "Joining…"; errorEl.textContent = "";
    try {
      const firebaseState = await fbJoinRoom(code);
      if(!firebaseState || !firebaseState.playerCount) throw new Error("Room not found or already started.");
      const joined = Object.keys(firebaseState.characterSelections||{}).length;
      if(joined >= firebaseState.playerCount) throw new Error("Room is full.");
      hideScreen("room-screen");
      showJoinLobby(code, firebaseState);
    } catch(err) {
      errorEl.textContent = err.message;
      joinBtn.disabled = false; joinBtn.textContent = "Join";
    }
  };

  joinInput.onkeydown = e => { if(e.key === "Enter") joinBtn.click(); };
  joinInput.oninput   = () => { joinInput.value = joinInput.value.toUpperCase(); };
}

function restoreArrays(state) {
  const toArr = v => {
    if (!v) return [];
    if (Array.isArray(v)) return v;
    const keys = Object.keys(v);
    if (keys.length === 0) return [];
    if (keys.every(k => !isNaN(k))) return keys.sort((a,b)=>+a-+b).map(k=>v[k]);
    return v;
  };
  state.drawPile    = toArr(state.drawPile);
  state.discardPile = toArr(state.discardPile);
  state.mysteryNodes = toArr(state.mysteryNodes);
  state.playerOrder  = toArr(state.playerOrder);
  if(!state.poopedNodes) state.poopedNodes={};
  if(!state.characterSelections) state.characterSelections={};
  // destPool is an array stored in Firebase
  if(state.destPool) state.destPool = toArr(state.destPool);
  if (state.players) {
    Object.keys(state.players).forEach(name => {
      const p = state.players[name];
      p.hand              = toArr(p.hand);
      p.journeyRouteIds   = toArr(p.journeyRouteIds);
      p.destinationQueue  = toArr(p.destinationQueue);
      p.completedDestinations = toArr(p.completedDestinations);
      p.inventory         = toArr(p.inventory);
      if(p.skipTurns===undefined) p.skipTurns=0;
      if(p.routeCostBonus===undefined) p.routeCostBonus=0;
      if(p.pendingZoom===undefined) p.pendingZoom=false;
      // Remove skipMessages — computed fresh, never stored in Firebase
      delete p.skipMessages;
    });
  }
  return state;
}

function launchGame(hero, firebaseState){
  // Used for session resume only — normal flow uses startCarousel
  console.log("[DD] launchGame (resume) hero:",hero);
  app.state={...restoreArrays({...firebaseState}), controlledHero:hero};
  app.localHero=hero;
  hideScreen("room-screen");
  showMobileHud();
  resetBoardView();
  showStartToast(hero);
  renderAll();
  showCurrentDestinationReveal(hero);
  updateRoomHud();
  fbSubscribeRoomExclusive(app.roomCode, remoteState=>{
    if(!remoteState||!remoteState.players) return;
    app.state={...restoreArrays({...remoteState}), controlledHero:hero};
    renderAll(); updateRoomHud();
  });
}

// ─── Return to menu ───────────────────────────────────────────────────────────

// ─── Quit confirmation & opponent notification ────────────────────────────────

function showQuitConfirmation() {
  // Always show confirmation before quitting
  let overlay = document.getElementById("mystery-modal-overlay");
  if(!overlay) {
    overlay = document.createElement("div");
    overlay.id = "mystery-modal-overlay";
    overlay.className = "mystery-modal-overlay";
    document.getElementById("game-shell").appendChild(overlay);
  }
  const inGame = gameIsRunning() && app.roomCode;
  overlay.innerHTML = `
    <div class="mystery-modal">
      <div class="mystery-modal-emoji">🚪</div>
      <div class="mystery-modal-title">QUIT TO MENU?</div>
      <div class="mystery-modal-body">${
        inGame
          ? "This will remove you from the game. Your opponents will be notified and the game will pause until a replacement joins."
          : "Return to the main menu?"
      }</div>
      <div class="mystery-modal-actions">
        <button id="quit-cancel-btn" class="action-btn subtle" type="button">Keep playing</button>
        <button id="quit-confirm-btn" class="action-btn primary" type="button">Quit to menu</button>
      </div>
    </div>`;
  overlay.classList.add("open");

  document.getElementById("quit-cancel-btn").onclick = () => overlay.classList.remove("open");
  document.getElementById("quit-confirm-btn").onclick = async () => {
    overlay.classList.remove("open");
    if(inGame) await notifyPlayerLeft();
    doReturnToMenu();
  };
}

async function notifyPlayerLeft() {
  if(!app.roomCode || !app.localHero || !_db) return;
  try {
    // Write departure to Firebase — remaining players will see this
    await _firebaseSet(dbRef(`rooms/${app.roomCode}/state/playerLeft`), {
      character: app.localHero,
      leftAt: Date.now(),
    });
    // Remove from characterSelections so slot is free
    await _firebaseSet(dbRef(`rooms/${app.roomCode}/state/characterSelections/${app.localHero}`), null);
    // Remove presence
    await _firebaseSet(dbRef(`rooms/${app.roomCode}/presence/${app.localHero}`), null);
  } catch(e) { console.warn("[DD] notifyPlayerLeft failed:", e); }
}

function doReturnToMenu() {
  sessionStorage.removeItem("dd_room_code");
  sessionStorage.removeItem("dd_hero");
  sessionStorage.removeItem("dd_colour");
  app.roomCode=null; app.localHero=null;
  cancelAutoSim(); closeRouteModal(); closeDestinationReveal(); closeMobileSheet();

  // Null out state — renderAll and gameIsRunning both guard against this
  app.state = null;
  app.localHero = null;
  app.roomCode = null;
  app.actionInProgress = false;
  _countdownActive = false;
  _gameAlreadyLaunched = false;
  _drawChoicePending = false;
  if(_activeGameUnsubscribe) { _activeGameUnsubscribe(); _activeGameUnsubscribe = null; }
  if(_departureUnsubscribe) { _departureUnsubscribe(); _departureUnsubscribe = null; }

  ["mobile-hud","mobile-bottom-bar"].forEach(id=>{
    const e=document.getElementById(id);if(e)e.classList.remove("visible");
  });
  const sh=document.getElementById("mobile-sheet");
  if(sh) sh.classList.remove("visible-shell","expanded");
  ["waiting-screen","resuming-screen"].forEach(hideScreen);
  hideEndScreen();
  document.getElementById("hero-overlay")?.classList.remove("active");

  // Hide lobby/carousel overlays
  ["mystery-modal-overlay","journey-picker-overlay","lobby-overlay","carousel-overlay"].forEach(id=>{
    const el=document.getElementById(id);
    if(el) { el.classList.remove("open"); el.innerHTML=""; }
  });

  const di=document.getElementById("desktop-identity");
  if(di) di.innerHTML="";
  const ti=document.getElementById("desktop-turn-indicator");
  if(ti) ti.textContent="";

  // Show room screen — renderAll is guarded so blank state won't render
  // Explicitly hide game panels to ensure clean state
  ["left-panel","right-panel","board-wrap"].forEach(id => {
    const el = document.getElementById(id);
    if(el) el.style.display = "";  // clear any inline display, let CSS handle it
  });
  showScreen("room-screen");
  startFallingDogs();
  wireRoomButtons();
}

// Watch for opponents leaving — show notification to remaining players
let _departureUnsubscribe = null;
function watchForPlayerDepartures(code) {
  // Cancel any previous departure listener before registering a new one
  if(_departureUnsubscribe) { _departureUnsubscribe(); _departureUnsubscribe = null; }
  const sessionStart = Date.now();
  _departureUnsubscribe = _firebaseOnValue(dbRef(`rooms/${code}/state/playerLeft`), snap => {
    if(!snap.exists() || !app.localHero) return;
    const left = snap.val();
    if(!left || left.character === app.localHero) return;
    if(left.leftAt < sessionStart) return;
    if(Date.now() - left.leftAt > 120000) return;
    const state = app.state;
    if(!state) return;
    showPlayerLeftNotification(left.character, state, code);
  });
}

function showPlayerLeftNotification(whoLeft, remoteState, code) {
  let overlay = document.getElementById("mystery-modal-overlay");
  if(!overlay) {
    overlay = document.createElement("div");
    overlay.id = "mystery-modal-overlay";
    overlay.className = "mystery-modal-overlay";
    document.getElementById("game-shell").appendChild(overlay);
  }
  const remaining = Object.keys(remoteState.characterSelections||{}).length;
  const total = remoteState.playerCount;
  overlay.innerHTML = `
    <div class="mystery-modal">
      <div class="mystery-modal-emoji">😢</div>
      <div class="mystery-modal-title">${whoLeft.toUpperCase()} LEFT</div>
      <div class="mystery-modal-body">
        ${whoLeft} has quit the game. The room now has ${remaining}/${total} players.
        A new player can join with code <strong>${code}</strong>, or you can quit too.
      </div>
      <div class="mystery-modal-actions">
        <button id="player-left-stay-btn" class="action-btn subtle" type="button">Keep playing</button>
        <button id="player-left-quit-btn" class="action-btn primary" type="button">Quit to menu</button>
      </div>
    </div>`;
  overlay.classList.add("open");
  document.getElementById("player-left-stay-btn").onclick = () => overlay.classList.remove("open");
  document.getElementById("player-left-quit-btn").onclick = () => {
    overlay.classList.remove("open");
    showQuitConfirmation();
  };
}

function returnToMenu(){
  showQuitConfirmation();
}


// ─── Portrait harsh wobble ────────────────────────────────────────────────────
let __wobbleTimer = null;
function startPortraitWobble() {
  if (__wobbleTimer) return;
  function snap() {
    const img = document.getElementById("desktop-identity-portrait");
    if (!img) { __wobbleTimer = null; return; }
    const deg = (Math.random() < 0.5 ? -1 : 1) * 15;
    img.style.transform = `rotate(${deg}deg)`;
    img.style.transition = "transform 60ms step-end";
    const next = 500 + Math.random() * 1000;
    __wobbleTimer = setTimeout(snap, next);
  }
  snap();
}
function stopPortraitWobble() {
  if (__wobbleTimer) { clearTimeout(__wobbleTimer); __wobbleTimer = null; }
  const img = document.getElementById("desktop-identity-portrait");
  if (img) { img.style.transform = ""; }
}

// ─── Rendering ────────────────────────────────────────────────────────────────
function ensureRouteCostLayer(){ return ensureLayer(app.svg,"route-cost-layer"); }

function handleRouteSelection(routeId){
  app.state.selectedRouteId=routeId; renderAll();
  handleRouteHover(routeId); openRouteModal(routeId);
}

function renderRouteCostBadges(){
  const layer=ensureRouteCostLayer(); layer.innerHTML="";
  Object.keys(app.rulesData.routes||{}).forEach(routeId=>{
    const el=app.svg.querySelector(`#${CSS.escape(routeId)}`);
    if(!el||!app.state.routes[routeId]||app.state.routes[routeId].claimedBy) return;
    if(!el.getTotalLength) return;
    const len=el.getTotalLength(), mid=el.getPointAtLength(len/2);
    const rc=app.state.routes[routeId].colour;
    const hex=ROUTE_COLOUR_HEX[rc]||"#7a7a7a", cost=app.rulesData.routes[routeId].length;
    const g=createSvgEl("g",{class:"route-cost-badge",transform:`translate(${mid.x},${mid.y})`,"data-route-id":routeId});
    g.style.cursor="pointer";
    g.appendChild(createSvgEl("circle",{r:"12",fill:"#ffffff",stroke:hex}));
    const txt=createSvgEl("text",{x:"0",y:"0",fill:hex,"text-anchor":"middle","dominant-baseline":"middle"});
    txt.textContent=String(cost); txt.setAttribute("dy","0.02em"); g.appendChild(txt);
    g.addEventListener("click",evt=>{evt.stopPropagation();handleRouteSelection(routeId);});
    g.addEventListener("mouseenter",evt=>{evt.stopPropagation();handleRouteHover(routeId);});
    g.addEventListener("mouseleave",()=>updateStatus("Choose one action: draw a card or click a route to play it."));
    layer.appendChild(g);
  });
}

function renderRoutes(){
  if(!app.state.routes) return;
  Object.keys(app.rulesData.routes||{}).forEach(routeId=>{
    const el=app.svg.querySelector(`#${CSS.escape(routeId)}`); if(!el) return;
    el.classList.remove("route-claimed-eric","route-claimed-tango","route-eligible","route-selected","route-blocked","route-claimed");
    const rs=app.state.routes[routeId]; if(!rs) return;
    const rc=rs.colour;
    el.style.strokeWidth="8"; el.style.cursor="pointer";
    el.style.stroke=ROUTE_COLOUR_HEX[rc]||"#7a7a7a";
    if(rs.claimedBy){
      el.style.stroke=getPlayerColour(rs.claimedBy);
      el.style.strokeWidth="12";
      el.style.strokeOpacity="1";
      el.classList.add("route-claimed");
      return;
    }
    const play=getRoutePlayability(routeId);
    if(play.playable) el.classList.add("route-eligible");
    if(app.state.selectedRouteId===routeId) el.classList.add("route-selected");
  });
  renderRouteCostBadges();
}

function renderTurnBadge(){
  const b=document.getElementById("turn-player-badge"); if(!b) return;
  const cp=app.state.currentPlayer;
  if(!cp){b.textContent="Waiting…";return;}
  const colour=getPlayerColour(cp);
  b.className="player-badge";
  b.style.color=colour;
  b.style.borderColor=`${colour}44`;
  b.textContent=`${cp} to play`;
  const ti=document.getElementById("desktop-turn-indicator");
  if(ti){
    const mine=isMyTurn();
    ti.className=`desktop-turn-indicator ${mine?"desktop-turn-mine":"desktop-turn-theirs"}`;
    ti.textContent=mine?"YOUR TURN":`${app.state.currentPlayer}'s turn`;
  }
}

function renderCounts(){
  const d=document.getElementById("draw-pile-count"), dc=document.getElementById("discard-pile-count");
  if(d) d.textContent=app.state.drawPile.length;
  if(dc) dc.textContent=app.state.discardPile.length;
}

function renderSelectedRouteCard(){
  const card=document.getElementById("selected-route-card"); if(!card) return;
  const routeId=app.state.selectedRouteId; card.className="selected-route-card";
  if(!routeId){card.textContent="No route selected.";return;}
  const rc=getDisplayRouteColor(app.state.routes[routeId].colour), cost=app.rulesData.routes[routeId].length;
  const play=getRoutePlayability(routeId);
  if(play.playable){
    card.classList.add("valid");
    card.innerHTML=`<strong>${formatRouteName(routeId)}</strong><br>Colour: ${rc}<br>Cost: ${cost}<br>→ ${formatNodeName(play.targetNode)}`;
  } else {
    card.classList.add("invalid");
    card.innerHTML=`<strong>${formatRouteName(routeId)}</strong><br>${play.reason}`;
  }
}

function getHandStacks(hand){
  const counts=countCards(hand);
  return ["red","orange","blue","green","black","pink","yellow","rainbow"].filter(c=>counts[c]>0).map(c=>({color:c,count:counts[c]}));
}

function renderHandInto(container,player,cls="hand-card"){
  container.innerHTML="";
  const stacks=getHandStacks(player.hand);
  if(!stacks.length){const e=document.createElement("div");e.className="panel-copy";e.textContent="No cards yet.";container.appendChild(e);return;}
  stacks.forEach(s=>{
    const el=document.createElement("div"); el.className=`${cls} ${s.color}`;
    if(player.lastDrawColor===s.color&&cls==="hand-card") el.classList.add("draw-in");
    if(player.lastDrawColor===s.color&&cls==="mobile-hand-peek-card"){
      el.style.setProperty("--glow-colour",GLOW_COLOURS[s.color]||"rgba(255,255,255,0.7)");
      el.classList.add("card-glow-steady");
    }
    el.innerHTML=`<div class="card-name">${s.color}</div><div class="card-count">${s.count}</div>`;
    container.appendChild(el);
  });
}

// Always render the VIEW HERO's hand — never the opponent's
function renderActiveHand(){
  const wrap=document.getElementById("active-hand"); if(!wrap) return;
  const hero=getViewHero();
  const player=hero?(getPlayerByChar(hero)||app.state.players[hero]):null;
  if(!player){wrap.innerHTML="";return;}
  renderHandInto(wrap,player,"hand-card");
  player.lastDrawColor=null;
}

// Show own info in full, opponents show only location + journey count
function renderPlayerSummary(){
  const wrap=document.getElementById("player-summary-wrap"); if(!wrap) return;
  wrap.innerHTML="";
  const hero=getViewHero();
  const active=getActivePlayers();
  if(!active.length) return;
  active.forEach(n=>{
    const p=getPlayerByChar(n); if(!p) return;
    const isMe=n===hero;
    const colour=getPlayerColour(n);
    const t=isMe?getCurrentTargetForPlayer(p):null;
    const card=document.createElement("div");
    card.className=`player-summary-card${app.state.currentPlayer===n?" active":""}`;
    card.style.setProperty("--player-colour", colour);
    if(isMe){
      const targetTitle=t?(app.destinationData?.destinations[t]?.title||formatNodeName(t)):"—";
      const effects=[];
      if(p.routeCostBonus>0) effects.push(`👃 +${p.routeCostBonus} card cost`);
      if(p.skipTurns>0) effects.push(`⏸ Skipping ${p.skipTurns} turn${p.skipTurns!==1?"s":""}`);
      card.innerHTML=`
        <div class="player-summary-name" style="color:${colour}">${n} <span style="font-size:13px;opacity:0.5;font-family:var(--ui-font);color:rgba(255,255,255,0.5)">(you)</span></div>
        <div class="player-summary-meta">
          <span class="summary-row"><span class="summary-lbl">Location</span><span class="summary-val">${formatNodeName(p.currentNode)}</span></span>
          <span class="summary-row"><span class="summary-lbl">Cards</span><span class="summary-val">${p.hand.length}</span></span>
          <span class="summary-row"><span class="summary-lbl">Journeys</span><span class="summary-val">${Math.min(p.completedCount,getJourneyTarget())}/${getJourneyTarget()}</span></span>
          <span class="summary-row"><span class="summary-lbl">Target</span><span class="summary-val">${targetTitle}</span></span>
          ${effects.map(e=>`<span class="summary-row summary-effect"><span class="summary-val" style="color:#ffe600;font-size:12px">${e}</span></span>`).join("")}
        </div>`;
    } else {
      const effects=[];
      if(p.routeCostBonus>0) effects.push(`👃 +${p.routeCostBonus} cost`);
      if(p.skipTurns>0) effects.push(`⏸ ${p.skipTurns} skip${p.skipTurns!==1?"s":""}`);
      card.innerHTML=`
        <div class="player-summary-name" style="color:${colour}">${n}</div>
        <div class="player-summary-meta">
          <span class="summary-row"><span class="summary-lbl">Location</span><span class="summary-val">${formatNodeName(p.currentNode)}</span></span>
          <span class="summary-row"><span class="summary-lbl">Journeys</span><span class="summary-val">${Math.min(p.completedCount,getJourneyTarget())}/${getJourneyTarget()}</span></span>
          ${effects.map(e=>`<span class="summary-row summary-effect"><span class="summary-val" style="color:#ffe600;font-size:12px">${e}</span></span>`).join("")}
        </div>`;
    }
    wrap.appendChild(card);
  });
}

// Only render the VIEW HERO's destination sequence
function buildDestinationSequenceElement(playerName,showFlip=true){
  const player=getPlayerByChar(playerName)||app.state.players?.[playerName];
  if(!player) return document.createElement("div");
  const N=getJourneyTarget();
  const seq=document.createElement("div"); seq.className="destination-sequence";
  const title=document.createElement("div"); title.className="sequence-title"; title.textContent="Your routes";
  const grid=document.createElement("div"); grid.className="destination-card-grid";
  // Show N journey destinations + the final Didcot card
  for(let i=0;i<=N;i++){
    let label, body, el;
    if(i < N){
      // Regular destination
      const did=player.destinationQueue[i], dest=app.destinationData.destinations[did];
      label=dest?dest.title:formatNodeName(did); body=dest?.description||"";
    } else {
      // Final Didcot card — always last
      const finalDest=app.destinationData.destinations["Didcot"];
      label=finalDest?.title||"Didcot"; body=finalDest?.description||"";
    }
    if(i<player.completedCount){
      el=document.createElement("div");el.className="destination-card completed-card";
      el.innerHTML=`<div class="destination-title">✓ ${label}</div>`;
    } else if(i===player.completedCount){
      el=document.createElement("div");el.className="destination-card active-card";
      if(showFlip&&app.state.justCompleted?.playerName===playerName)el.classList.add("flip-in");
      el.innerHTML=`<div class="destination-title">${label}</div><div class="destination-body">${body}</div>`;
    } else {
      el=document.createElement("div");el.className="destination-card hidden-card";el.textContent="?";
    }
    grid.appendChild(el);
  }
  seq.appendChild(title); seq.appendChild(grid); return seq;
}

// Always render only the local player's destination sequence
function renderDestinationSequences(){
  const wrap=document.getElementById("destination-sequences"); if(!wrap) return;
  wrap.innerHTML="";
  const hero=getViewHero();
  wrap.appendChild(buildDestinationSequenceElement(hero,true));
}

function renderTargetPulse(){
  app.svg.querySelectorAll(".target-node-pulse").forEach(e=>e.classList.remove("target-node-pulse"));
  const hero=getViewHero();
  const heroPlayer=hero?(getPlayerByChar(hero)||app.state.players?.[hero]):null;
  if(!heroPlayer) return;
  const tid=getCurrentTargetForPlayer(heroPlayer); if(!tid) return;
  // Pulse the node circle
  app.svg.querySelectorAll(`#${CSS.escape(tid)}`).forEach(e=>e.classList.add("target-node-pulse"));
  // Also pulse the label text — labels have no IDs so match by text content
  const labelName = formatNodeName(tid); // e.g. "Wittenham Clumps"
  const labelsGroup = app.svg.querySelector("#Labels");
  if(labelsGroup){
    labelsGroup.querySelectorAll("text").forEach(t=>{
      // Build full text content from all tspans
      const full = [...t.querySelectorAll("tspan")].map(s=>s.textContent.trim()).join(" ").trim();
      if(full === labelName) t.classList.add("target-node-pulse");
    });
  }
}

function renderDebug(audit){
  const d=document.getElementById("left-debug"); if(!d) return;
  d.innerHTML=`<div class="debug-list">
    <div><strong>Version:</strong> ${APP_VERSION}</div>
    <div><strong>Room:</strong> ${app.roomCode||"solo"}</div>
    <div><strong>Hero:</strong> ${app.localHero||"—"} / Players: ${(app.state.playerOrder||[]).join(",") || "—"}</div>
    <div><strong>Turn:</strong> ${app.state.currentPlayer}</div>
    <div><strong>My turn:</strong> ${isMyTurn()}</div>
    <div><strong>SVG nodes:</strong> ${audit.nodeCount} routes: ${audit.routeCount}</div>
  </div>`;
}

// Card piles
const PAW_SVG=`<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg" style="width:18px;height:18px;opacity:0.22"><ellipse cx="20" cy="26" rx="9" ry="7" fill="white"/><ellipse cx="11" cy="19" rx="4.5" ry="3.5" fill="white"/><ellipse cx="29" cy="19" rx="4.5" ry="3.5" fill="white"/><ellipse cx="15" cy="13" rx="3.5" ry="2.8" fill="white"/><ellipse cx="25" cy="13" rx="3.5" ry="2.8" fill="white"/></svg>`;

function seededRotation(seed,i){let h=0;for(let j=0;j<seed.length;j++)h=(Math.imul(31,h)+seed.charCodeAt(j))|0;return[-14,-8,-4,4,9,15][Math.abs(h+i)%6];}

function renderDrawPile(container,count){
  container.innerHTML="";
  const w=document.createElement("div"); w.className="pile-wrap";
  const sc=Math.min(count,3);
  for(let i=0;i<sc;i++){const c=document.createElement("div");c.className="pile-card pile-card-back";c.style.setProperty("--pile-offset",`${i*-2}px`);c.style.setProperty("--pile-rot",`${(i-1)*3}deg`);if(i===sc-1)c.innerHTML=PAW_SVG;w.appendChild(c);}
  if(!count){const e=document.createElement("div");e.className="pile-card pile-card-empty";w.appendChild(e);}
  const b=document.createElement("div");b.className="pile-badge";b.textContent=count;w.appendChild(b);
  const l=document.createElement("div");l.className="pile-label";l.textContent="Draw";w.appendChild(l);
  container.appendChild(w);
}

function renderDiscardPile(container,discardPile){
  container.innerHTML="";
  const w=document.createElement("div"); w.className="pile-wrap";
  const count=discardPile.length, top=discardPile.slice(-3);
  if(!count){const e=document.createElement("div");e.className="pile-card pile-card-empty";w.appendChild(e);}
  else{top.forEach((col,i)=>{const c=document.createElement("div");c.className="pile-card pile-card-face";c.style.setProperty("--pile-rot",`${seededRotation(col+i,i)}deg`);c.style.setProperty("--pile-offset",`${i*-1}px`);const cols=CARD_COLOUR_HEX_MAP[col]||["#5b5b5b","#1d1d1d"];c.style.background=col==="rainbow"?"linear-gradient(135deg,#f3a3a3,#f0dd67,#72c78e,#8ab5ff,#ef9cc3)":`linear-gradient(180deg,${cols[0]},${cols[1]})`;w.appendChild(c);});}
  const b=document.createElement("div");b.className="pile-badge pile-badge-discard";b.textContent=count;w.appendChild(b);
  const l=document.createElement("div");l.className="pile-label";l.textContent="Discard";w.appendChild(l);
  container.appendChild(w);
}

function renderMobileRoutesPanel(){
  const hudTurn=document.getElementById("mobile-hud-turn");
  const hudDraw=document.getElementById("mobile-hud-draw");
  const hudDest=document.getElementById("mobile-hud-destination");
  const drawBtn=document.getElementById("mobile-open-sheet-btn");
  const routesBtn=document.getElementById("mobile-reset-view-btn");
  const sheetSum=document.getElementById("mobile-sheet-summary");
  const sheetHand=document.getElementById("mobile-sheet-hand");
  const sheetDest=document.getElementById("mobile-sheet-destination");
  const handPeek=document.getElementById("mobile-hand-peek");
  if(!hudTurn||!hudDraw||!hudDest||!handPeek) return;

  // Always show the VIEW HERO's data
  const hero=getViewHero();
  const player=hero ? (getPlayerByChar(hero)||app.state.players[hero]) : null;
  if(!player) return;
  const tid=getCurrentTargetForPlayer(player);
  const ttitle=tid?(app.destinationData.destinations[tid]?.title||formatNodeName(tid)):"—";
  const comp=Math.min(player.completedCount,getJourneyTarget());

  hudTurn.textContent=app.state.currentPlayer;
  renderDrawPile(hudDraw,app.state.drawPile.length);
  const discEl=document.getElementById("mobile-hud-discard");
  if(discEl) renderDiscardPile(discEl,app.state.discardPile);

  hudDest.innerHTML=`<span class="hud-dest-progress">${comp}/5</span><span class="hud-dest-label">▸ ${ttitle}</span>`;
  hudDest.dataset.complete=comp>=5?"true":"false";
  if(drawBtn) drawBtn.textContent="Draw card";
  if(routesBtn) routesBtn.textContent="Routes";

  const bar=document.getElementById("mobile-bottom-bar");
  if(bar&&!bar.querySelector(".hand-chevron")){const ch=document.createElement("div");ch.className="hand-chevron";ch.innerHTML="&#8964;";bar.insertBefore(ch,bar.firstChild);}

  if(sheetSum) sheetSum.innerHTML=`<div class="player-summary-card active"><div class="player-summary-name">${hero}</div><div class="player-summary-meta">Node: ${formatNodeName(player.currentNode)}<br>Done: ${comp}/5<br>Target: ${ttitle}</div></div>`;
  if(sheetHand){sheetHand.innerHTML="";renderHandInto(sheetHand,player,"mobile-hand-peek-card");}
  if(sheetDest){sheetDest.innerHTML="";sheetDest.appendChild(buildDestinationSequenceElement(hero,false));}
  handPeek.innerHTML=""; renderHandInto(handPeek,player,"mobile-hand-peek-card");
}

function renderButtons(){
  const running = gameIsRunning();
  const mine = running && isMyTurn();

  // If it's not our turn (or game not running), always clear any pending choice UI
  if(!mine && _drawChoicePending) {
    _drawChoicePending = false;
    app.actionInProgress = false;
  }

  // Restore the button if the choice UI is showing but shouldn't be
  if(!_drawChoicePending) restoreDrawButton();

  const b = document.getElementById("draw-card-btn");
  if(!b) return;
  b.disabled = !mine || app.actionInProgress;
  b.innerHTML = mine
    ? `<span class="draw-btn-line1">DRAW</span><span class="draw-btn-line2">CARDS</span>`
    : `<span class="draw-btn-line1">${running ? "WAIT" : "—"}</span>`;
  b.classList.toggle("btn-waiting", running && !mine);
}

function renderDesktopPiles(){
  const drawEl=document.getElementById("desktop-draw-pile");
  const discEl=document.getElementById("desktop-discard-pile");
  if(drawEl) renderDrawPile(drawEl, app.state.drawPile.length);
  if(discEl) renderDiscardPile(discEl, app.state.discardPile);
}


// ═══════════════════════════════════════════════════════════════════════════
// MYSTERY NODE SYSTEM
// ═══════════════════════════════════════════════════════════════════════════

// ─── Mystery events — loaded from JSON at init, editable separately ─────────
// Populated by loadMysteryEvents() in init(). Edit didcot-dogs-events.v1.json.
let MYSTERY_EVENTS = [];

async function loadMysteryEvents() {
  try {
    const data = await loadJson("./data/didcot-dogs-events.v1.json?v=1");
    MYSTERY_EVENTS = data.events || [];
    console.log("[DD] Mystery events loaded:", MYSTERY_EVENTS.length);
  } catch(e) {
    console.warn("[DD] Events JSON failed, using built-in defaults:", e.message);
    MYSTERY_EVENTS = _defaultMysteryEvents();
  }
}

function _defaultMysteryEvents() {
  return [
    { id:"oh_whups",        title:"OH WHUPS",          body:"Oopadays. You've lost half your cards.",                                           emoji:"😬" },
    { id:"nowhere_to_poo",  title:"NOWHERE TO POO",    body:"Can't seem to find the right spot… just gonna look around for 3 turns.",          emoji:"🔍" },
    { id:"just_sniffin",    title:"JUST SNIFFIN'",     body:"Slow progress. Routes require an extra card.",                                     emoji:"👃" },
    { id:"gimme_gimme",     title:"GIMME GIMME",       body:"Nabbed! Take 3 of your opponent's cards and run away.",                           emoji:"🐾" },
    { id:"bright_brown",    title:"BRIGHT BROWN",      body:"Choose a colour. Opponent will give you all cards of that colour.",                emoji:"💩" },
    { id:"zoomies",         title:"ZOOMIES",           body:"Zoom zoom zoom. Next time you move, make a second move for free.",                 emoji:"⚡" },
    { id:"poop",            title:"POOP",              body:"Drop a log, slow down your opponent!",                                            emoji:"💩" },
    { id:"hitch_a_lift",    title:"HITCH A LIFT",      body:"Dad's here to give a ride! Travel immediately to the next destination.",          emoji:"🚗" },
    { id:"rainbow_warrior", title:"RAINBOW WARRIOR",   body:"All rainbows are mine!",                                                          emoji:"🌈" },
    { id:"bin_dipper",      title:"BIN DIPPER",        body:"Have a rummage around and pick five tasty treats.",                               emoji:"🗑️" },
  ];
}

function pickMysteryNodes(allNodes, startNode, exclude=[], destinationPool=[], count=3) {
  // Mystery nodes can only appear on nodes NOT in the destinationPool
  const pool = allNodes.filter(n =>
    n !== startNode &&
    !exclude.includes(n) &&
    !destinationPool.includes(n)
  );
  const picked = [];
  const shuffled = shuffle([...pool]);
  for(const n of shuffled) {
    if(picked.length >= count) break;
    picked.push(n);
  }
  return picked;
}

function rotateMysteryNode(triggeredNodeId) {
  if(!app.state.mysteryNodes) app.state.mysteryNodes=[];
  const allNodes = app.rulesData.nodes || [];
  const destPool = app.rulesData.destinationPool || [];
  const remaining = app.state.mysteryNodes.filter(n => n !== triggeredNodeId);
  const activePlayers = getActivePlayers();
  const currentNodes = activePlayers.map(n => getPlayerByChar(n)?.currentNode).filter(Boolean);
  const exclude = [...remaining, app.rulesData.startNode, ...currentNodes, ...destPool];
  const pool = allNodes.filter(n => !exclude.includes(n));
  const newNode = shuffle([...pool])[0];
  if(newNode) remaining.push(newNode);
  app.state.mysteryNodes = remaining;
}

// ── Mystery node SVG rendering ────────────────────────────────────────────
function renderMysteryNodes() {
  if(!app.svg) return;
  app.svg.querySelectorAll(".mystery-node-marker").forEach(e=>e.remove());
  const layer = ensureLayer(app.svg, "mystery-layer", true);
  layer.innerHTML = "";
  const nodes = app.state.mysteryNodes || [];
  nodes.forEach(nodeId => {
    try {
      const c = getNodeCenter(app.svg, nodeId);
      const g = createSvgEl("g", {class:"mystery-node-marker", transform:`translate(${c.x},${c.y})`});

      // Pulsing outer ring — use transform:scale animation, not r animation
      // (r animation unreliable cross-browser, also avoids #Nodes circle !important)
      const ring = createSvgEl("circle", {r:"26", fill:"none", stroke:"#ffe600",
        "stroke-width":"2.5", class:"mystery-ring"});
      // Inline style on fill/stroke beats any stylesheet !important
      ring.style.fill = "none";
      ring.style.stroke = "#ffe600";

      // Dark background — inline style to defeat #Nodes circle fill:white !important
      const bg = createSvgEl("circle", {r:"22"});
      bg.style.fill = "#0e1118";
      bg.style.stroke = "#ffe600";
      bg.style.strokeWidth = "2.5";

      // ? label — inline fill to defeat text fill:#000 !important
      const txt = createSvgEl("text", {
        "text-anchor":"middle", "dominant-baseline":"middle",
        "font-size":"22", "font-weight":"800",
        style:"font-family:var(--header-font,sans-serif);pointer-events:none;fill:#ffe600"
      });
      txt.textContent = "?";

      g.appendChild(ring); g.appendChild(bg); g.appendChild(txt);
      layer.appendChild(g);
    } catch(e) { /* node not in SVG */ }
  });
}

// ── Poop node rendering (only visible to placer) ──────────────────────────
function renderPoopNodes() {
  if(!app.svg) return;
  app.svg.querySelectorAll(".poop-node-marker").forEach(e=>e.remove());
  const layer = ensureLayer(app.svg, "poop-layer", true);
  layer.innerHTML = "";
  const hero = getViewHero();
  const poops = app.state.poopedNodes || {};
  Object.entries(poops).forEach(([nodeId, placedBy]) => {
    if(placedBy !== hero) return; // only show your own poops
    try {
      const c = getNodeCenter(app.svg, nodeId);
      const g = createSvgEl("g", {class:"poop-node-marker", transform:`translate(${c.x},${c.y})`});
      const txt = createSvgEl("text", {
        "text-anchor":"middle", "dominant-baseline":"middle",
        "font-size":"20", style:"pointer-events:none", dy:"-24"
      });
      txt.textContent = "💩";
      g.appendChild(txt);
      layer.appendChild(g);
    } catch(e) {}
  });
}

// ── Mystery event trigger ─────────────────────────────────────────────────
// Returns a Promise that resolves when the event is fully handled
function triggerMysteryEvent(nodeId, playerName) {
  const event = MYSTERY_EVENTS[Math.floor(Math.random() * MYSTERY_EVENTS.length)];
  rotateMysteryNode(nodeId);
  return new Promise(resolve => {
    showMysteryEventModal(event, playerName, resolve);
  });
}

function showMysteryEventModal(event, playerName, onDone) {
  // Build modal in DOM
  let overlay = document.getElementById("mystery-modal-overlay");
  if(!overlay) {
    overlay = document.createElement("div");
    overlay.id = "mystery-modal-overlay";
    overlay.className = "mystery-modal-overlay";
    document.getElementById("game-shell").appendChild(overlay);
  }
  overlay.innerHTML = `
    <div class="mystery-modal">
      <div class="mystery-modal-emoji">${event.emoji}</div>
      <div class="mystery-modal-title">${event.title}</div>
      <div class="mystery-modal-body">${event.body}</div>
      <div id="mystery-modal-content"></div>
      <div class="mystery-modal-actions">
        <button id="mystery-modal-ok" class="action-btn primary" type="button">OK!</button>
      </div>
    </div>`;
  overlay.classList.add("open");

  const content = document.getElementById("mystery-modal-content");
  const okBtn = document.getElementById("mystery-modal-ok");
  okBtn.disabled = false;

  // Build event-specific UI
  switch(event.id) {
    case "oh_whups":
      buildOhWhupsUI(content, playerName, okBtn, overlay, onDone);
      break;
    case "bright_brown":
      buildBrightBrownUI(content, playerName, okBtn, overlay, onDone);
      break;
    case "gimme_gimme":
      buildGimmeGimmeUI(content, playerName, okBtn, overlay, onDone);
      break;
    case "bin_dipper":
      buildBinDipperUI(content, playerName, okBtn, overlay, onDone);
      break;
    default:
      okBtn.onclick = () => {
        overlay.classList.remove("open");
        applyMysteryEffect(event.id, playerName);
        onDone();
      };
  }
}

function closeMysteryModal() {
  const o = document.getElementById("mystery-modal-overlay");
  if(o) o.classList.remove("open");
}

function showNowhereToPoModal(message, onDone) {
  let overlay = document.getElementById("mystery-modal-overlay");
  if(!overlay) {
    overlay = document.createElement("div");
    overlay.id = "mystery-modal-overlay";
    overlay.className = "mystery-modal-overlay";
    document.getElementById("game-shell").appendChild(overlay);
  }
  overlay.innerHTML = `
    <div class="mystery-modal nowhere-modal">
      <div class="mystery-modal-emoji">🐾</div>
      <div class="mystery-modal-title">NOWHERE TO POO</div>
      <div class="mystery-modal-body nowhere-message">${message}</div>
      <div class="nowhere-countdown" id="nowhere-countdown">5</div>
    </div>`;
  overlay.classList.add("open");
  let secs = 5;
  const countEl = document.getElementById("nowhere-countdown");
  const timer = setInterval(() => {
    secs--;
    if(countEl) countEl.textContent = secs;
    if(secs <= 0) {
      clearInterval(timer);
      overlay.classList.remove("open");
      onDone();
    }
  }, 1000);
}

// ── OH WHUPS ──────────────────────────────────────────────────────────────
function buildOhWhupsUI(content, playerName, okBtn, overlay, onDone) {
  const player = getPlayerByChar(playerName)||app.state.players?.[playerName];
  if(!player) return;
  const hand = [...player.hand];
  if(!hand.length) {
    content.innerHTML = `<div class="mystery-card-select-label">No cards to discard!</div>`;
    okBtn.textContent = "OK!"; okBtn.disabled = false;
    okBtn.onclick = () => { overlay.classList.remove("open"); onDone(); };
    return;
  }
  const mustDiscard = Math.ceil(hand.length / 2);
  // Expand hand to individual cards (not stacked) for per-card selection
  const cards = hand.map((colour, idx) => ({ colour, idx, selected: false }));
  let totalSelected = 0;

  okBtn.disabled = true;
  okBtn.textContent = `Discard ${mustDiscard} cards`;

  function renderCards() {
    content.innerHTML = `<div class="mystery-card-select-label">Select ${mustDiscard} cards to discard (${totalSelected}/${mustDiscard})</div>
      <div class="whups-card-grid"></div>`;
    const grid = content.querySelector(".whups-card-grid");
    cards.forEach((c, i) => {
      const btn = document.createElement("button");
      btn.type = "button";
      // Use inline styles for reliable sizing — avoids .hand-card CSS conflicts
      btn.style.cssText = `
        width:54px;height:76px;border-radius:10px;padding:6px;
        position:relative;flex-shrink:0;cursor:pointer;
        border:${c.selected?"3px solid #ffe600":"2px solid rgba(0,0,0,0.18)"};
        box-shadow:${c.selected?"0 0 12px rgba(255,230,0,0.6)":"0 4px 10px rgba(0,0,0,0.25)"};
        transform:${c.selected?"translateY(-6px)":"none"};
        transition:transform 80ms ease,box-shadow 80ms ease;
        display:flex;align-items:flex-end;font-size:10px;font-weight:700;
        text-transform:capitalize;color:${["yellow"].includes(c.colour)?"#222":"#fff"};
        font-family:var(--ui-font);
      `;
      // Colour gradient background
      const gradMap = {
        red:"#f3a3a3,#d74b4b", orange:"#f2bf95,#db7f2f", blue:"#8ab5ff,#2f6edb",
        green:"#72c78e,#1e8b4c", black:"#5b5b5b,#1d1d1d", pink:"#ef9cc3,#c64f8e",
        yellow:"#f0dd67,#d6b300",
        rainbow:"#f3a3a3 0%,#f0dd67 24%,#72c78e 48%,#8ab5ff 72%,#ef9cc3 100%"
      };
      const grad = gradMap[c.colour] || "gray,gray";
      btn.style.background = c.colour==="rainbow"
        ? `linear-gradient(135deg,${grad})`
        : `linear-gradient(180deg,${grad})`;
      btn.textContent = c.colour;
      btn.onclick = () => {
        if(c.selected) { c.selected=false; totalSelected--; }
        else if(totalSelected < mustDiscard) { c.selected=true; totalSelected++; }
        renderCards();
        okBtn.disabled = totalSelected < mustDiscard;
      };
      grid.appendChild(btn);
    });
  }
  renderCards();

  okBtn.onclick = () => {
    if(totalSelected < mustDiscard) return;
    const toDiscard = cards.filter(c=>c.selected).map(c=>c.colour);
    // Remove from player hand by index
    const selectedIndices = new Set(cards.filter(c=>c.selected).map(c=>c.idx));
    player.hand = player.hand.filter((_,i) => !selectedIndices.has(i));
    app.state.discardPile.push(...toDiscard);
    overlay.classList.remove("open");
    updateStatus(`Oh Whups! Discarded ${toDiscard.length} cards.`, TOAST_NOTABLE);
    onDone();
  };
}

// ── BRIGHT BROWN ──────────────────────────────────────────────────────────
function buildBrightBrownUI(content, playerName, okBtn, overlay, onDone) {
  const colours = ["red","orange","blue","green","black","pink","yellow"];
  let chosenColour = null;
  okBtn.disabled = true;
  okBtn.textContent = "Steal cards";

  content.innerHTML = `<div class="mystery-card-select-label">Choose a colour to steal from ALL opponents:</div>
    <div class="mystery-colour-grid"></div>`;
  const grid = content.querySelector(".mystery-colour-grid");
  colours.forEach(colour => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `route-colour-choice-card ${colour}`;
    btn.textContent = colour;
    btn.onclick = () => {
      chosenColour = colour;
      grid.querySelectorAll(".route-colour-choice-card").forEach(b=>b.classList.remove("active"));
      btn.classList.add("active");
      okBtn.disabled = false;
    };
    grid.appendChild(btn);
  });

  okBtn.onclick = () => {
    if(!chosenColour) return;
    const myPlayer = getPlayerByChar(playerName);
    if(!myPlayer){overlay.classList.remove("open");onDone();return;}
    const opponents = getActivePlayers().filter(n => n !== playerName);
    let totalStolen = 0;
    opponents.forEach(oppName => {
      const opp = getPlayerByChar(oppName)||app.state.players[oppName];
      if(!opp) return;
      const stolen = opp.hand.filter(c => c === chosenColour);
      opp.hand = opp.hand.filter(c => c !== chosenColour);
      myPlayer.hand.push(...stolen);
      totalStolen += stolen.length;
    });
    overlay.classList.remove("open");
    updateStatus(`Bright Brown! Stole ${totalStolen} ${chosenColour} card(s) from all opponents.`, TOAST_NOTABLE);
    onDone();
  };
}

// ── GIMME GIMME — pick opponent to steal from ────────────────────────────
function buildGimmeGimmeUI(content, playerName, okBtn, overlay, onDone) {
  const opponents = getActivePlayers().filter(n => n !== playerName);
  if(!opponents.length) {
    content.innerHTML = `<div class="mystery-card-select-label">No opponents to steal from!</div>`;
    okBtn.textContent = "OK!"; okBtn.disabled = false;
    okBtn.onclick = () => { overlay.classList.remove("open"); onDone(); };
    return;
  }
  let chosen = null;
  okBtn.disabled = true;
  okBtn.textContent = "Steal 3 cards";

  content.innerHTML = `<div class="mystery-card-select-label">Pick an opponent to steal from:</div>
    <div class="gimme-opponent-grid"></div>`;
  const grid = content.querySelector(".gimme-opponent-grid");
  opponents.forEach(oppName => {
    const opp = getPlayerByChar(oppName)||app.state.players[oppName];
    const cardCount = opp?.hand?.length || 0;
    const col = getPlayerColour(oppName);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "gimme-opponent-btn";
    btn.style.borderColor = chosen===oppName ? "#ffe600" : "rgba(255,255,255,0.16)";
    btn.style.background = chosen===oppName ? `${col}33` : "rgba(255,255,255,0.05)";
    btn.innerHTML = `
      <img src="./assets/${oppName.toLowerCase()}.png" style="width:40px;height:40px;border-radius:50%;border:2px solid ${col};background:rgba(255,255,255,0.9)">
      <span style="color:${col};font-family:var(--header-font);font-size:16px">${oppName}</span>
      <span style="opacity:0.55;font-size:12px">${cardCount} card${cardCount!==1?"s":""}</span>`;
    btn.onclick = () => {
      chosen = oppName;
      grid.querySelectorAll(".gimme-opponent-btn").forEach(b => {
        b.style.borderColor = "rgba(255,255,255,0.16)";
        b.style.background = "rgba(255,255,255,0.05)";
      });
      btn.style.borderColor = "#ffe600";
      btn.style.background = `${col}33`;
      okBtn.disabled = false;
    };
    grid.appendChild(btn);
  });

  okBtn.onclick = () => {
    if(!chosen) return;
    const myPlayer = getPlayerByChar(playerName);
    const oppPlayer = getPlayerByChar(chosen);
    if(!oppPlayer) { overlay.classList.remove("open"); onDone(); return; }
    const n = Math.min(3, oppPlayer.hand.length);
    const stolen = shuffle([...oppPlayer.hand]).slice(0, n);
    stolen.forEach(c => {
      const i = oppPlayer.hand.indexOf(c);
      if(i !== -1) oppPlayer.hand.splice(i, 1);
      myPlayer.hand.push(c);
    });
    overlay.classList.remove("open");
    updateStatus(`Gimme Gimme! Stole ${n} card(s) from ${chosen}.`, TOAST_NOTABLE);
    onDone();
  };
}

// ── BIN DIPPER — pick 5 from discard pile ────────────────────────────────
function buildBinDipperUI(content, playerName, okBtn, overlay, onDone) {
  const myPlayer = getPlayerByChar(playerName);
  if(!myPlayer) { onDone(); return; }
  const pile = [...(app.state.discardPile||[])];
  if(!pile.length) {
    content.innerHTML = `<div class="mystery-card-select-label">Oh no, it's bin day! The binman has thrown away all the treats.</div>`;
    okBtn.textContent = "Continue"; okBtn.disabled = false;
    okBtn.onclick = () => { overlay.classList.remove("open"); onDone(); };
    return;
  }
  const maxPick = Math.min(5, pile.length);
  // Show all cards in discard pile, expanded
  const cards = pile.map((colour, idx) => ({ colour, idx, selected: false }));
  let totalSelected = 0;
  okBtn.disabled = true;
  okBtn.textContent = `Pick ${maxPick} card${maxPick!==1?"s":""}`;

  function renderCards() {
    content.innerHTML = `
      <div class="mystery-card-select-label">Pick ${maxPick} card${maxPick!==1?"s":""} from the discard pile (${totalSelected}/${maxPick})</div>
      <div class="whups-card-grid"></div>`;
    const grid = content.querySelector(".whups-card-grid");
    cards.forEach((c, i) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.style.cssText = `
        width:54px;height:76px;border-radius:10px;padding:6px;
        position:relative;flex-shrink:0;cursor:pointer;
        border:${c.selected?"3px solid #ffe600":"2px solid rgba(0,0,0,0.18)"};
        box-shadow:${c.selected?"0 0 12px rgba(255,230,0,0.6)":"0 4px 10px rgba(0,0,0,0.25)"};
        transform:${c.selected?"translateY(-6px)":"none"};
        transition:transform 80ms ease;
        display:flex;align-items:flex-end;font-size:10px;font-weight:700;
        text-transform:capitalize;color:${["yellow"].includes(c.colour)?"#222":"#fff"};
        font-family:var(--ui-font);
      `;
      const gradMap = {
        red:"#f3a3a3,#d74b4b", orange:"#f2bf95,#db7f2f", blue:"#8ab5ff,#2f6edb",
        green:"#72c78e,#1e8b4c", black:"#5b5b5b,#1d1d1d", pink:"#ef9cc3,#c64f8e",
        yellow:"#f0dd67,#d6b300",
        rainbow:"#f3a3a3 0%,#f0dd67 24%,#72c78e 48%,#8ab5ff 72%,#ef9cc3 100%"
      };
      const grad = gradMap[c.colour] || "gray,gray";
      btn.style.background = c.colour==="rainbow"
        ? `linear-gradient(135deg,${grad})`
        : `linear-gradient(180deg,${grad})`;
      btn.textContent = c.colour;
      btn.onclick = () => {
        if(c.selected) { c.selected=false; totalSelected--; }
        else if(totalSelected < maxPick) { c.selected=true; totalSelected++; }
        renderCards();
        okBtn.disabled = totalSelected < maxPick;
      };
      grid.appendChild(btn);
    });
  }
  renderCards();

  okBtn.onclick = () => {
    if(totalSelected < maxPick) return;
    const picked = cards.filter(c=>c.selected).map(c=>c.colour);
    // Remove picked from discard pile
    const pickedIndices = new Set(cards.filter(c=>c.selected).map(c=>c.idx));
    app.state.discardPile = app.state.discardPile.filter((_,i) => !pickedIndices.has(i));
    myPlayer.hand.push(...picked);
    overlay.classList.remove("open");
    updateStatus(`Bin Dipper! Grabbed ${picked.length} tasty treat${picked.length!==1?"s":""} from the bin.`, TOAST_NOTABLE);
    onDone();
  };
}

// ── Apply effects for simple events ──────────────────────────────────────
function applyMysteryEffect(eventId, playerName) {
  const player = getPlayerByChar(playerName);
  if(!player) return;
  // For legacy 2-player event effects, find first opponent
  const opponents = getActivePlayers().filter(n => n !== playerName);
  const opponent = opponents[0] || null;
  const oppPlayer = opponent ? getPlayerByChar(opponent) : null;

  switch(eventId) {
    case "nowhere_to_poo":
      player.skipTurns += 3;
      // skipMessages computed from skipTurns in endTurn — no need to store
      updateStatus("Nowhere to Poo! Skipping 3 turns.", TOAST_NOTABLE);
      break;

    case "just_sniffin": {
      const current = player.routeCostBonus || 0;
      if(current >= 2) {
        updateStatus("Just Sniffin'! Already at max sniff level — no further penalty.", TOAST_NOTABLE);
      } else {
        player.routeCostBonus = current + 1;
        updateStatus(`Just Sniffin'! Routes cost +${player.routeCostBonus} card${player.routeCostBonus!==1?"s":""}. (${player.routeCostBonus}/2 max)`, TOAST_NOTABLE);
      }
      break;
    }

    case "gimme_gimme":
      // Handled via modal — see showMysteryEventModal switch
      break;

    case "zoomies":
      player.inventory = [...(player.inventory||[]), "zoom"];
      player.pendingZoom = false;
      updateStatus("Zoomies! You have a free second move ready.", TOAST_NOTABLE);
      break;

    case "poop":
      player.inventory = [...(player.inventory||[]), "poop"];
      updateStatus("Poop! You're holding a poo — drop it on a node.", TOAST_NOTABLE);
      break;

    case "hitch_a_lift":
      applyHitchALift(playerName);
      break;

    case "rainbow_warrior": {
      const myPl = getPlayerByChar(playerName);
      if(!myPl) break;
      const opps = getActivePlayers().filter(n => n !== playerName);
      let total = 0;
      opps.forEach(oppName => {
        const opp = getPlayerByChar(oppName)||app.state.players[oppName];
        if(!opp) return;
        const rainbows = opp.hand.filter(c => c === "rainbow");
        opp.hand = opp.hand.filter(c => c !== "rainbow");
        myPl.hand.push(...rainbows);
        total += rainbows.length;
      });
      updateStatus(`🌈 Rainbow Warrior! Swiped ${total} rainbow card(s) from all opponents.`, TOAST_NOTABLE);
      break;
    }

    default:
      break;
  }
}

// ── HITCH A LIFT ──────────────────────────────────────────────────────────
function applyHitchALift(playerName) {
  const player = getPlayerByChar(playerName);
  if(!player) return;
  completeDestinationIfNeeded(playerName);
  const target = getCurrentTargetForPlayer(player);
  if(!target) { updateStatus("Hitch a Lift! Nowhere to go.", TOAST_NOTABLE); return; }
  player.currentNode = target;
  player.previousNode = null; // warp clears backtrack restriction
  updateStatus(`Hitch a Lift! Warped to ${formatNodeName(target)}.`, TOAST_NOTABLE);
  renderTokens();
  // Complete again in case warped directly onto destination
  completeDestinationIfNeeded(playerName);
}

// ── POOP drop prompt ──────────────────────────────────────────────────────
function maybePromptPoopDrop(playerName, nodeId) {
  const player = getPlayerByChar(playerName);
  if(!player.inventory || !player.inventory.includes("poop")) return Promise.resolve();
  if(playerName !== getViewHero()) return Promise.resolve();
  return new Promise(resolve => {
    let overlay = document.getElementById("mystery-modal-overlay");
    if(!overlay) {
      overlay = document.createElement("div");
      overlay.id = "mystery-modal-overlay";
      overlay.className = "mystery-modal-overlay";
      document.getElementById("game-shell").appendChild(overlay);
    }
    overlay.innerHTML = `
      <div class="mystery-modal">
        <div class="mystery-modal-emoji">💩</div>
        <div class="mystery-modal-title">Do a poo?</div>
        <div class="mystery-modal-body">You're at ${formatNodeName(nodeId)}. Leave a surprise for your opponent?</div>
        <div class="mystery-modal-actions">
          <button id="poop-no-btn" class="action-btn subtle" type="button">Not here</button>
          <button id="poop-yes-btn" class="action-btn primary" type="button">💩 Yes!</button>
        </div>
      </div>`;
    overlay.classList.add("open");
    document.getElementById("poop-no-btn").onclick = () => { overlay.classList.remove("open"); resolve(); };
    document.getElementById("poop-yes-btn").onclick = () => {
      // Consume poop from inventory
      const idx = player.inventory.indexOf("poop");
      if(idx !== -1) player.inventory.splice(idx, 1);
      if(!app.state.poopedNodes) app.state.poopedNodes = {};
      app.state.poopedNodes[nodeId] = playerName;
      overlay.classList.remove("open");
      updateStatus(`💩 Left a surprise at ${formatNodeName(nodeId)}!`, TOAST_NOTABLE);
      renderPoopNodes();
      resolve();
    };
  });
}

// ── POOP trap check ───────────────────────────────────────────────────────
function checkPoopTrap(playerName, nodeId) {
  if(!app.state.poopedNodes) return false;
  const placedBy = app.state.poopedNodes[nodeId];
  if(!placedBy || placedBy === playerName) return false;
  // Stepped in poop! Wipe the node immediately — only first victim
  delete app.state.poopedNodes[nodeId];
  const victim = getPlayerByChar(playerName);
  if(victim) victim.skipTurns += 3;
  if(playerName === getViewHero()) {
    showPoopTrapModal();
  } else {
    showMobileToast(`${playerName} stepped in poop! 3 turns skipped.`);
    updateStatus(`${playerName} stepped in poop! 3 turns skipped.`, TOAST_NOTABLE);
  }
  return true;
}

function showPoopTrapModal() {
  let overlay = document.getElementById("mystery-modal-overlay");
  if(!overlay) {
    overlay = document.createElement("div");
    overlay.id = "mystery-modal-overlay";
    overlay.className = "mystery-modal-overlay";
    document.getElementById("game-shell").appendChild(overlay);
  }
  overlay.innerHTML = `
    <div class="mystery-modal">
      <div class="mystery-modal-emoji">💩</div>
      <div class="mystery-modal-title">YOU STEPPED IN POOP!</div>
      <div class="mystery-modal-body">Stay here and clean your shoes for 3 turns.</div>
      <div class="mystery-modal-actions">
        <button id="mystery-modal-ok" class="action-btn primary" type="button">Ugh…</button>
      </div>
    </div>`;
  overlay.classList.add("open");
  document.getElementById("mystery-modal-ok").onclick = () => overlay.classList.remove("open");
}

// ── ZOOMIES activation ────────────────────────────────────────────────────
function maybeActivateZoom(playerName) {
  const player = getPlayerByChar(playerName);
  if(!player || !player.inventory || !player.inventory.includes("zoom")) return Promise.resolve(false);
  if(playerName !== getViewHero()) {
    // Opponent used zoom — consume silently
    const idx = player.inventory.indexOf("zoom");
    if(idx !== -1) player.inventory.splice(idx, 1);
    return Promise.resolve(false);
  }
  // Find eligible connected routes from current node
  const currentNode = player.currentNode;
  const eligibleRoutes = Object.keys(app.rulesData.routes).filter(routeId => {
    const rs = app.state.routes[routeId];
    if(rs.claimedBy) return false;
    const cn = getConnectedNode(routeId, currentNode);
    if(!cn) return false;
    if(cn === player.previousNode) return false;
    return true;
  });
  if(!eligibleRoutes.length) {
    // No zoom targets — consume and skip
    const idx = player.inventory.indexOf("zoom");
    if(idx !== -1) player.inventory.splice(idx, 1);
    updateStatus("Zoomies fizzled — no connected routes!", TOAST_NOTABLE);
    return Promise.resolve(false);
  }
  // Show zoom route picker
  return new Promise(resolve => {
    let overlay = document.getElementById("mystery-modal-overlay");
    if(!overlay) {
      overlay = document.createElement("div");
      overlay.id = "mystery-modal-overlay";
      overlay.className = "mystery-modal-overlay";
      document.getElementById("game-shell").appendChild(overlay);
    }
    overlay.innerHTML = `
      <div class="mystery-modal">
        <div class="mystery-modal-emoji">⚡</div>
        <div class="mystery-modal-title">WHERE ARE YOU ZOOMING?</div>
        <div class="mystery-modal-body">Pick a connected route for your free second move.</div>
        <div id="zoom-route-list" class="mystery-route-list"></div>
        <div class="mystery-modal-actions">
          <button id="zoom-skip-btn" class="action-btn subtle" type="button">Skip zoom</button>
        </div>
      </div>`;
    overlay.classList.add("open");
    const list = document.getElementById("zoom-route-list");
    eligibleRoutes.forEach(routeId => {
      const to = getConnectedNode(routeId, currentNode);
      const rc = getDisplayRouteColor(app.state.routes[routeId].colour);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "route-option-row";
      btn.innerHTML = `<strong>${formatNodeName(to)}</strong> <span style="opacity:0.6;font-size:13px">via ${formatRouteName(routeId)} (${rc})</span>`;
      btn.onclick = async () => {
        overlay.classList.remove("open");
        // Consume zoom
        const idx = player.inventory.indexOf("zoom");
        if(idx !== -1) player.inventory.splice(idx, 1);
        // Execute free move
        const from = player.currentNode;
        app.state.routes[routeId].claimedBy = playerName;
        player.previousNode = from;
        player.currentNode = to;
        player.journeyRouteIds.push(routeId);
        renderAll();
        updateStatus(`⚡ Zoomed to ${formatNodeName(to)}!`, TOAST_NOTABLE);
        await animateTokenAlongRoute(playerName, routeId, from, to);
        completeDestinationIfNeeded(playerName);
        renderAll();
        resolve(true);
      };
      list.appendChild(btn);
    });
    document.getElementById("zoom-skip-btn").onclick = () => {
      overlay.classList.remove("open");
      resolve(false);
    };
  });
}

// ── Check if landing on mystery node ─────────────────────────────────────
function isMysteryNode(nodeId) {
  return (app.state.mysteryNodes||[]).includes(nodeId);
}


// ─── Destination node colouring ───────────────────────────────────────────────
// All destination pool nodes show as red on the board.
// The current player's active target shows as rainbow pulse (handled by renderTargetPulse).
// Other players' targets are not revealed.
function renderDestinationNodes() {
  if(!app.svg) return;
  const destPool = app.rulesData.destinationPool || [];
  const hero = getViewHero();
  const heroPlayer = hero ? (getPlayerByChar(hero)||app.state.players?.[hero]) : null;
  const activeTarget = heroPlayer ? getCurrentTargetForPlayer(heroPlayer) : null;
  const nodesGroup = app.svg.querySelector("#Nodes");
  if(!nodesGroup) return;
  nodesGroup.querySelectorAll("circle").forEach(el => {
    const nodeId = el.id;
    if(!nodeId) return;
    if(destPool.includes(nodeId) && nodeId !== activeTarget) {
      // Destination node — show as red, but not override the rainbow pulse
      el.style.fill = "#e53935";
      el.style.stroke = "#b71c1c";
    } else if(!destPool.includes(nodeId) && nodeId !== activeTarget) {
      // Reset to white
      el.style.fill = "";
      el.style.stroke = "";
    }
  });
}

function gameIsRunning() {
  // Game is running when we have characterSelections, a currentPlayer, playerOrder,
  // and the SVG is loaded. Without these, rendering will produce a blank board.
  return !!(
    app.svg &&
    app.rulesData &&
    app.state?.routes &&
    app.state?.currentPlayer &&
    app.state?.playerOrder?.length &&
    Object.keys(app.state?.characterSelections||{}).length > 0
  );
}

function renderAll(){
  if(!app.svg || !app.rulesData || !app.state || !app.state.routes) return; // not ready
  renderTurnBadge(); renderCounts(); renderSelectedRouteCard(); renderActiveHand();
  renderPlayerSummary(); renderDestinationSequences(); renderRoutes(); renderTokens();
  renderTargetPulse(); renderDebug(app.audit); renderButtons(); renderMobileRoutesPanel();
  renderDesktopPiles(); renderMysteryNodes(); renderPoopNodes(); renderDestinationNodes();
  renderInventoryBadge();
  if(app.roomCode) updateRoomHud();
}

function renderInventoryBadge() {
  const hero = getViewHero();
  if(!app.state||!hero) return;
  const player = getPlayerByChar(hero);
  if(!player) return;
  const inv = player.inventory || [];
  // Show in left panel below draw button
  let badge = document.getElementById("inventory-badge");
  if(!badge) {
    badge = document.createElement("div");
    badge.id = "inventory-badge";
    badge.className = "inventory-badge";
    const drawBtn = document.getElementById("draw-card-btn");
    if(drawBtn && drawBtn.parentNode) drawBtn.parentNode.insertBefore(badge, drawBtn.nextSibling);
  }
  if(!inv.length) { badge.innerHTML = ""; return; }
  badge.innerHTML = inv.map(item => {
    if(item === "zoom") return `<span class="inv-item inv-zoom">⚡ ZOOMIES</span>`;
    if(item === "poop") return `<span class="inv-item inv-poop">💩 POOP</span>`;
    return `<span class="inv-item">${item}</span>`;
  }).join("");
  // Status indicators
  const bits = [];
  if(player.skipTurns > 0) bits.push(`⏸ Skipping ${player.skipTurns} turn(s)`);
  if(player.routeCostBonus > 0) bits.push(`+${player.routeCostBonus} card cost`);
  const statusBadge = document.getElementById("status-effect-badge") || (() => {
    const el = document.createElement("div");
    el.id = "status-effect-badge";
    el.className = "status-effect-badge";
    if(badge.parentNode) badge.parentNode.insertBefore(el, badge.nextSibling);
    return el;
  })();
  statusBadge.innerHTML = bits.map(b=>`<span class="status-effect-item">${b}</span>`).join("");
}

// ─── Modals ───────────────────────────────────────────────────────────────────
function openMobileSheet(){const s=document.getElementById("mobile-sheet");if(s&&s.classList.contains("visible-shell"))s.classList.add("expanded");}
function closeMobileSheet(){const s=document.getElementById("mobile-sheet");if(s)s.classList.remove("expanded");}
function toggleMobileSheet(){const s=document.getElementById("mobile-sheet");if(!s||!s.classList.contains("visible-shell"))return;s.classList.toggle("expanded");}

function buildCardChoiceEl(color,active=false){
  const card=document.createElement("button");card.type="button";
  card.className=`route-colour-choice-card ${color}${active?" active":""}`;card.textContent=color;return card;
}

function renderRouteModalOptionStage(){
  const routeId=app.modal.routeId;
  const body=document.getElementById("route-modal-body"),confirmBtn=document.getElementById("route-modal-confirm");
  body.innerHTML=""; confirmBtn.disabled=app.modal.selectedOptionIndex===null;
  document.getElementById("route-modal-subtitle").textContent=`Choose how to pay for ${formatRouteName(routeId)}.`;
  const list=document.createElement("div"); list.className="route-option-list";
  app.modal.options.forEach((opt,idx)=>{
    const row=document.createElement("button");row.className=`route-option-row${app.modal.selectedOptionIndex===idx?" active":""}`;row.type="button";
    const lbl=document.createElement("div");lbl.className="route-option-row-label";lbl.textContent=`Option ${idx+1}`;
    const cards=document.createElement("div");cards.className="route-option-row-cards";
    [...Array(opt.useColourCount).fill(opt.colourChoice),...Array(opt.useRainbowCount).fill("rainbow")].forEach(c=>{const cd=document.createElement("div");cd.className=`route-spend-card ${c}`;cd.textContent=c;cards.appendChild(cd);});
    row.appendChild(lbl);row.appendChild(cards);
    row.addEventListener("click",()=>{app.modal.selectedOptionIndex=idx;renderRouteModalOptionStage();});
    list.appendChild(row);
  });
  body.appendChild(list); confirmBtn.disabled=app.modal.selectedOptionIndex===null;
}

function openRouteModal(routeId){
  const play=getRoutePlayability(routeId);
  if(!play.playable){updateStatus(play.reason,TOAST_NOTABLE);return;}
  app.modal.routeId=routeId; app.modal.selectedOptionIndex=null; app.modal.chosenColor=null;
  const overlay=document.getElementById("route-modal-overlay");
  document.getElementById("route-modal-title").textContent=formatRouteName(routeId);
  const body=document.getElementById("route-modal-body"); body.innerHTML="";
  document.getElementById("route-modal-confirm").disabled=true;
  const rc=app.state.routes[routeId].colour,cost=app.rulesData.routes[routeId].length;
  const banner=document.createElement("div");banner.className="route-modal-cost-banner";
  banner.innerHTML=`<span><strong>${formatRouteName(routeId)}</strong><br><span style="font-size:13px;opacity:0.7">${rc} route</span></span><span class="route-modal-cost-pip">${cost}</span>`;
  body.appendChild(banner);
  // All routes are a named colour — go straight to payment options.
  app.modal.chosenColor=rc;
  app.modal.options=getPaymentOptionsForColor(routeId,app.state.currentPlayer,rc).options;
  renderRouteModalOptionStage();
  overlay.classList.add("open");
}

function closeRouteModal(){
  document.getElementById("route-modal-overlay").classList.remove("open");
  app.modal.routeId=null; app.modal.chosenColor=null; app.modal.selectedOptionIndex=null; app.modal.options=[];
}

async function confirmRouteModalPlay(){
  if(!isMyTurn() || app.actionInProgress) return;
  if(!app.modal.routeId||app.modal.selectedOptionIndex===null) return;
  app.actionInProgress = true;
  const routeId=app.modal.routeId, pay=app.modal.options[app.modal.selectedOptionIndex];
  const pn=app.state.currentPlayer;
  const player=getPlayerByChar(pn);
  if(!player){app.actionInProgress=false;closeRouteModal();return;}
  const play=getRoutePlayability(routeId);
  if(!play||!play.playable){app.actionInProgress=false;closeRouteModal();renderAll();return;}
  const {nextHand,spent}=removeSpecificCardsFromHand(player.hand,pay.colourChoice,pay.useColourCount,pay.useRainbowCount);
  player.hand=nextHand; app.state.discardPile.push(...spent);
  const from=player.currentNode, to=getConnectedNode(routeId,from);
  app.state.routes[routeId].claimedBy=pn; player.previousNode=from; player.currentNode=to;
  player.journeyRouteIds.push(routeId);
  app.state.selectedRouteId=null; closeRouteModal(); renderAll();
  updateStatus(`${pn} → ${formatNodeName(to)}`,TOAST_NOTABLE);
  await animateTokenAlongRoute(pn,routeId,from,to);

  // Check poop trap before completing destination
  checkPoopTrap(pn, to);

  // Check mystery node
  if(isMysteryNode(to)) {
    await triggerMysteryEvent(to, pn);
  }

  // Complete destination (may reveal new destination card)
  completeDestinationIfNeeded(pn);
  renderAll();

  // Check ZOOMIES inventory — only for current local hero
  if(pn === getViewHero()) {
    await maybePromptPoopDrop(pn, to);
    await maybeActivateZoom(pn);
  }

  renderAll();
  app.actionInProgress = false;
  endTurn();
}

// ─── Start toast / identity card ──────────────────────────────────────────────
function showStartToast(playerName){
  let card=document.getElementById("identity-card");
  if(!card){card=document.createElement("div");card.id="identity-card";card.className="identity-card";document.getElementById("game-shell").appendChild(card);}
  const cfg=getPlayerConfig(playerName);
  card.innerHTML=`<div class="identity-wipe"></div><div class="identity-inner"><div class="identity-kicker">YOU ARE</div><div class="identity-portrait-wrap"><img class="identity-portrait" src="${cfg.image}" alt="${playerName}"></div><div class="identity-name">${playerName.toUpperCase()}</div></div>`;
  card.classList.remove("identity-out"); card.classList.add("identity-in");
  setTimeout(()=>{card.classList.remove("identity-in");card.classList.add("identity-out");},1800);
}

function openDestinationReveal(title,body,num=null){
  const pfx=num?`Destination #${num}`:"Destination";
  document.getElementById("destination-reveal-title").textContent=`${pfx} — ${title}`;
  document.getElementById("destination-reveal-body").textContent=body;
  document.getElementById("destination-reveal-overlay").classList.add("open");
}
function closeDestinationReveal(){document.getElementById("destination-reveal-overlay").classList.remove("open");}
function showCurrentDestinationReveal(playerName){
  const player=getPlayerByChar(playerName)||app.state.players?.[playerName];
  if(!player) return;
  const t=getCurrentTargetForPlayer(player);
  const N=getJourneyTarget();
  if(!t||player.completedCount>N) return;
  const dest=app.destinationData.destinations[t];
  openDestinationReveal(dest?.title||formatNodeName(t),dest?.description||"",player.completedCount+1);
}

function completeDestinationIfNeeded(playerName){
  const player=getPlayerByChar(playerName)||app.state.players?.[playerName];
  if(!player) return false;
  const t=getCurrentTargetForPlayer(player);
  if(!t||player.currentNode!==t){app.state.justCompleted=null;return false;}
  const N=getJourneyTarget();
  app.state.justCompleted={playerName,destinationId:t};
  player.completedDestinations.push(t);
  player.completedCount++;
  [...player.journeyRouteIds].forEach(id=>{app.state.routes[id].claimedBy=null;});
  rerollSpecificRouteColours([...player.journeyRouteIds]);
  player.journeyRouteIds=[]; player.previousNode=null;
  if(player.completedCount>N){
    // Won — completed all N destinations AND the final Didcot return
    updateStatus(`${playerName} wins!`,TOAST_NOTABLE);
    setTimeout(()=>showEndScreen(playerName),800);
  } else {
    const nt=getCurrentTargetForPlayer(player), nd=app.destinationData.destinations[nt];
    if(player.completedCount===N){
      // Just completed last regular destination — now head to Didcot
      updateStatus(`${player.completedCount} done! Now head to ${formatNodeName(nt)}`,TOAST_NOTABLE);
      openDestinationReveal(nd?.title||formatNodeName(nt),nd?.description||"",player.completedCount+1);
    } else {
      updateStatus(`✓ ${formatNodeName(t)}! Next: ${formatNodeName(nt)}`,TOAST_NOTABLE);
      openDestinationReveal(nd?.title||formatNodeName(nt),nd?.description||"",player.completedCount+1);
    }
  }
  return true;
}

// ─── End screen ───────────────────────────────────────────────────────────────
function buildEndScreenOverlay(){
  if(document.getElementById("end-screen-overlay")) return;
  const o=document.createElement("div");o.id="end-screen-overlay";o.className="end-screen-overlay";
  o.innerHTML=`<div class="end-screen-loop"><div class="end-screen-wipe end-screen-wipe-a"></div><div class="end-screen-wipe end-screen-wipe-b"></div><div class="end-screen-wipe end-screen-wipe-c"></div><div class="end-screen-noise"></div></div><div class="end-screen-inner"><div class="end-screen-kicker">Didcot Dogs</div><div id="end-screen-headline" class="end-screen-headline">YOU WIN!</div><div id="end-screen-sub" class="end-screen-sub"></div><div id="end-screen-portrait" class="end-screen-portrait-wrap"></div><button id="end-screen-play-again" class="action-btn primary end-screen-btn" type="button">Play again</button></div>`;
  document.getElementById("game-shell").appendChild(o);
  document.getElementById("end-screen-play-again").addEventListener("click",()=>{
    hideEndScreen();
    doReturnToMenu();
  });
}
function showEndScreen(winnerName){
  buildEndScreenOverlay();
  const o=document.getElementById("end-screen-overlay"), mine=winnerName===app.localHero;
  document.getElementById("end-screen-headline").textContent=mine?"YOU WIN!":"YOU LOSE!";
  const jt = getJourneyTarget();
  document.getElementById("end-screen-sub").textContent=mine?`${winnerName} completed all ${jt}. Legendary.`:`${winnerName} beat you to it.`;
  document.getElementById("end-screen-portrait").innerHTML=`<img src="${getPlayerConfig(winnerName).image}" alt="${winnerName}" class="end-screen-portrait">`;
  o.className=`end-screen-overlay active ${mine?"end-win":"end-lose"}`;
}
function hideEndScreen(){const o=document.getElementById("end-screen-overlay");if(o)o.className="end-screen-overlay";}

// ─── Auto-sim ─────────────────────────────────────────────────────────────────
let __autoSimTimer=null;
function cancelAutoSim(){if(__autoSimTimer){clearTimeout(__autoSimTimer);__autoSimTimer=null;}}
function scheduleAutoSim(){
  if(!DEV_AUTO_SIM||!app.state.controlledHero||app.state.currentPlayer===app.state.controlledHero) return;
  cancelAutoSim();
  __autoSimTimer=setTimeout(()=>{__autoSimTimer=null;runAutoSimTurn();},8000+Math.random()*4000);
}
function runAutoSimTurn(){
  if(!app.state.controlledHero||app.state.currentPlayer===app.state.controlledHero) return;
  const bot=app.state.currentPlayer, player=getPlayerByChar(bot);
  const card=drawCard();if(card){player.hand.push(card);player.lastDrawColor=card;}
  app.state.currentPlayer=app.state.controlledHero; renderAll();
}

// ─── Card draw animation ──────────────────────────────────────────────────────
function getDrawPileRect(){
  const mob=window.innerWidth<=767||(window.innerHeight<=500&&window.innerWidth>window.innerHeight);
  const id=mob?"mobile-hud-draw":"desktop-draw-pile";
  const e=document.getElementById(id); if(!e)return null;
  return(e.querySelector(".pile-wrap")||e).getBoundingClientRect();
}
function getHandTargetRect(colour){
  const mob=window.innerWidth<=767||(window.innerHeight<=500&&window.innerWidth>window.innerHeight);
  if(mob){
    const peek=document.getElementById("mobile-hand-peek");if(!peek)return null;
    for(const c of peek.querySelectorAll(".mobile-hand-peek-card"))if(c.classList.contains(colour))return c.getBoundingClientRect();
    return{left:window.innerWidth/2-27,top:window.innerHeight-90,width:54,height:86};
  }
  const hand=document.getElementById("active-hand");if(!hand)return null;
  for(const c of hand.querySelectorAll(".hand-card"))if(c.classList.contains(colour))return c.getBoundingClientRect();
  return hand.getBoundingClientRect();
}
function animateCardDraw(colour){
  return new Promise(resolve=>{
    const fr=getDrawPileRect();if(!fr){resolve();return;}
    const fly=document.createElement("div");fly.className="flying-card flying-card-back";
    fly.style.cssText=`position:fixed;width:34px;height:48px;border-radius:8px;z-index:9999;pointer-events:none;transform-style:preserve-3d;left:${fr.left+fr.width/2-17}px;top:${fr.top+fr.height/2-24}px;`;
    document.body.appendChild(fly);
    requestAnimationFrame(()=>requestAnimationFrame(()=>{
      const tr=getHandTargetRect(colour);
      const tl=tr?tr.left+tr.width/2-17:window.innerWidth/2-17, tt=tr?tr.top+tr.height/2-24:window.innerHeight-80;
      const cols=CARD_COLOUR_HEX_MAP[colour]||["#5b5b5b","#1d1d1d"];
      const fb=colour==="rainbow"?"linear-gradient(135deg,#f3a3a3,#f0dd67,#72c78e,#8ab5ff,#ef9cc3)":`linear-gradient(180deg,${cols[0]},${cols[1]})`;
      const dur=480, start=performance.now();
      function step(now){
        const t=Math.min(1,(now-start)/dur), e=t<0.5?4*t*t*t:1-Math.pow(-2*t+2,3)/2;
        const x=fr.left+fr.width/2-17+(tl-(fr.left+fr.width/2-17))*e;
        const y=fr.top+fr.height/2-24+(tt-(fr.top+fr.height/2-24))*e+Math.sin(t*Math.PI)*-40;
        let ry=0;
        if(t>=0.45&&t<0.55){ry=((t-0.45)/0.1)*90;if(ry>=90){fly.classList.remove("flying-card-back");fly.classList.add("flying-card-face");fly.style.background=fb;}}
        else if(t>=0.55){ry=90-((t-0.55)/0.45)*90;}
        fly.style.left=`${x}px`;fly.style.top=`${y}px`;fly.style.transform=`rotateY(${ry}deg) scale(${0.9+e*0.1})`;
        if(t<1)requestAnimationFrame(step);
        else{fly.style.transition="opacity 180ms ease";fly.style.opacity="0";setTimeout(()=>{fly.remove();resolve();},200);}
      }
      requestAnimationFrame(step);
    }));
  });
}
function triggerCardGlow(colour){
  const peek=document.getElementById("mobile-hand-peek");if(!peek)return;
  peek.querySelectorAll(".mobile-hand-peek-card").forEach(c=>{c.classList.remove("card-glow-steady");});
  peek.querySelectorAll(`.mobile-hand-peek-card.${colour}`).forEach(c=>{c.style.setProperty("--glow-colour",GLOW_COLOURS[colour]||"rgba(255,255,255,0.7)");c.classList.add("card-glow-steady");});
}

// ─── Draw card action — draw 2, pick 1, other goes to discard ────────────────
//
// The choice UI renders inline in the left panel (desktop), replacing the
// draw button temporarily. renderButtons() always restores the section when
// no choice is pending or it's not the local player's turn.
//
let _drawChoicePending = false; // true while waiting for player to pick a card

function drawCardForCurrentPlayer(){
  if(!isMyTurn() || app.actionInProgress || _drawChoicePending) return;
  const pn = app.state.currentPlayer;
  const player = getPlayerByChar(pn);
  if(!player){ console.warn("[DD] Draw: no player for", pn); return; }

  // Draw two cards from the deck
  const cardA = drawCard();
  const cardB = drawCard();

  if(!cardA && !cardB){
    updateStatus("No cards left — turn skipped.", TOAST_NOTABLE);
    endTurn();
    return;
  }

  // If only one card available, auto-take it — no choice needed
  if(!cardB){
    player.hand.push(cardA); player.lastDrawColor = cardA;
    closeMobileSheet(); renderAll();
    requestAnimationFrame(() => triggerCardGlow(cardA));
    endTurn();
    return;
  }

  // Two cards available — show pick UI, lock actions until chosen
  app.actionInProgress = true;
  _drawChoicePending = true;
  renderCardDrawChoice(pn, player, cardA, cardB);
}

function renderCardDrawChoice(pn, player, cardA, cardB) {
  const section = document.getElementById("draw-card-btn")?.parentElement;
  if(!section){ _resolveCardChoice(pn, player, cardA, cardB, cardA); return; }

  const gradMap = {
    red:"#f3a3a3,#d74b4b", orange:"#f2bf95,#db7f2f", blue:"#8ab5ff,#2f6edb",
    green:"#72c78e,#1e8b4c", black:"#5b5b5b,#1d1d1d", pink:"#ef9cc3,#c64f8e",
    yellow:"#f0dd67,#d6b300",
    rainbow:"#f3a3a3 0%,#f0dd67 25%,#72c78e 50%,#8ab5ff 75%,#ef9cc3 100%"
  };

  function cardBg(c) {
    const g = gradMap[c] || "gray,gray";
    return c === "rainbow"
      ? `linear-gradient(135deg,${g})`
      : `linear-gradient(180deg,${g})`;
  }
  function cardFg(c) { return c === "yellow" ? "#222" : "#fff"; }

  section.innerHTML = `
    <div class="draw-choice-wrap">
      <div class="draw-choice-label">Pick one card</div>
      <div class="draw-choice-cards">
        <button type="button" class="draw-choice-card" id="draw-pick-a"
          style="background:${cardBg(cardA)};color:${cardFg(cardA)}">
          <span class="draw-choice-card-name">${cardA}</span>
        </button>
        <button type="button" class="draw-choice-card" id="draw-pick-b"
          style="background:${cardBg(cardB)};color:${cardFg(cardB)}">
          <span class="draw-choice-card-name">${cardB}</span>
        </button>
      </div>
      <div class="draw-choice-sub">The other goes to discard</div>
    </div>`;

  document.getElementById("draw-pick-a").onclick = () =>
    _resolveCardChoice(pn, player, cardA, cardB, cardA);
  document.getElementById("draw-pick-b").onclick = () =>
    _resolveCardChoice(pn, player, cardA, cardB, cardB);
}

function restoreDrawButton() {
  // Always restore the section to just the draw button — called by renderButtons
  const existing = document.getElementById("draw-card-btn");
  if(existing) return; // button already present, nothing to restore
  const section = document.querySelector("#left-panel .panel-section:has(.draw-choice-wrap)") ||
                  document.querySelector(".draw-choice-wrap")?.parentElement;
  if(!section) return;
  section.innerHTML = `<button id="draw-card-btn" class="action-btn primary draw-card-btn-big" type="button"></button>`;
  // Re-wire the button since we just recreated it
  document.getElementById("draw-card-btn")?.addEventListener("click", drawCardForCurrentPlayer);
}

async function _resolveCardChoice(pn, player, cardA, cardB, chosen) {
  const discarded = chosen === cardA ? cardB : cardA;
  player.hand.push(chosen);
  player.lastDrawColor = chosen;
  app.state.discardPile.push(discarded);
  _drawChoicePending = false;
  app.actionInProgress = false;

  // Restore the section to the draw button before renderAll so it renders cleanly
  restoreDrawButton();
  renderAll();
  await animateCardDraw(chosen);
  requestAnimationFrame(() => triggerCardGlow(chosen));
  closeMobileSheet();
  endTurn();
}

// ─── Route interactions ───────────────────────────────────────────────────────
function handleRouteHover(routeId){
  if(!app.state?.routes?.[routeId]) return;
  const play=getRoutePlayability(routeId), rc=getDisplayRouteColor(app.state.routes[routeId].colour), cost=app.rulesData.routes[routeId].length;
  updateStatus(play.playable?`${formatRouteName(routeId)} · ${rc} · cost ${cost} · eligible`:`${formatRouteName(routeId)} · ${rc} · cost ${cost} · ${play.reason}`);
}
function wireRouteInteractions(){
  Object.keys(app.rulesData.routes||{}).forEach(routeId=>{
    const el=app.svg.querySelector(`#${CSS.escape(routeId)}`);if(!el) return;
    el.addEventListener("mouseenter",()=>{ if(gameIsRunning()) handleRouteHover(routeId); });
    el.addEventListener("mouseleave",()=>{ if(gameIsRunning()) updateStatus("Choose one action: draw a card or click a route to play it."); });
    el.addEventListener("click",()=>{ if(gameIsRunning()) handleRouteSelection(routeId); });
  });
}

// ─── Mobile HUD ───────────────────────────────────────────────────────────────
function injectMobileBottomBar(){
  if(document.getElementById("mobile-bottom-bar")) return;
  const gs=document.getElementById("game-shell"), sc=document.getElementById("status-chip");
  if(!gs||!sc) return;
  const w=document.createElement("div");w.id="mobile-bottom-bar";w.innerHTML=`<div id="mobile-hand-peek"></div>`;
  gs.insertBefore(w,sc);
}
function showMobileHud(){
  const mob=window.innerWidth<=767||(window.innerHeight<=500&&window.innerWidth>window.innerHeight);
  if(!mob) return;
  const hud=document.getElementById("mobile-hud");if(hud)hud.classList.add("visible");
  const bar=document.getElementById("mobile-bottom-bar");if(bar)bar.classList.add("visible");
  const sh=document.getElementById("mobile-sheet");if(sh)sh.classList.add("visible-shell");
}

// ─── Control buttons ──────────────────────────────────────────────────────────
function wireControlButtons(){
  document.getElementById("draw-card-btn")?.addEventListener("click",drawCardForCurrentPlayer);
  document.getElementById("menu-btn")?.addEventListener("click",returnToMenu);
  document.getElementById("mobile-menu-btn")?.addEventListener("click",returnToMenu);
  document.getElementById("reset-local-btn")?.addEventListener("click",()=>{
    doReturnToMenu();
  });

  document.getElementById("mobile-open-sheet-btn")?.addEventListener("click",drawCardForCurrentPlayer);
  document.getElementById("mobile-reset-view-btn")?.addEventListener("click",toggleMobileSheet);
  document.getElementById("mobile-sheet-handle")?.addEventListener("click",closeMobileSheet);
  document.getElementById("route-modal-close")?.addEventListener("click",closeRouteModal);
  document.getElementById("route-modal-cancel")?.addEventListener("click",closeRouteModal);
  document.getElementById("route-modal-confirm")?.addEventListener("click",async()=>await confirmRouteModalPlay());
  document.getElementById("route-modal-overlay")?.addEventListener("click",evt=>{if(evt.target.id==="route-modal-overlay")closeRouteModal();});
  document.getElementById("destination-reveal-close")?.addEventListener("click",closeDestinationReveal);
  document.getElementById("destination-reveal-overlay")?.addEventListener("click",evt=>{if(evt.target.id==="destination-reveal-overlay")closeDestinationReveal();});

  document.getElementById("debug-toggle-btn")?.addEventListener("click",()=>{
    const dbg=document.getElementById("left-debug");
    const btn=document.getElementById("debug-toggle-btn");
    if(!dbg) return;
    const hidden=dbg.classList.toggle("left-debug-hidden");
    if(btn) btn.textContent=hidden?"Version info ▾":"Version info ▴";
  });
}


// ─── Falling dogs animation on room screen ────────────────────────────────────
function startFallingDogs() {
  const container = document.getElementById("room-screen");
  if(!container) return;
  container.querySelectorAll(".room-dog").forEach(e=>e.remove());
  // Spawn 18 dogs — each character appears 3 times, fully randomised
  const dogPool = [...ALL_CHARACTERS, ...ALL_CHARACTERS, ...ALL_CHARACTERS];
  shuffle(dogPool).forEach((char, i) => {
    const el = document.createElement("div");
    el.className = "room-dog";
    el.innerHTML = `<img src="./assets/${char.toLowerCase()}.png" alt="${char}">`;
    const leftPct = 2 + Math.random() * 92;          // fully random x
    const delay = Math.random() * 10;                 // spread over 10s window
    const duration = 3.5 + Math.random() * 4;         // 3.5–7.5s fall
    const size = 40 + Math.floor(Math.random() * 40); // 40–80px
    const rotStart = -25 + Math.random() * 50;
    const rotEnd = rotStart + (-40 + Math.random() * 80);
    el.style.left = `${leftPct}%`;
    el.style.setProperty("--dog-rot-start", `${rotStart}deg`);
    el.style.setProperty("--dog-rot-end", `${rotEnd}deg`);
    el.style.animationDelay = `${delay}s`;
    el.style.animationDuration = `${duration}s`;
    el.querySelector("img").style.width = `${size}px`;
    el.querySelector("img").style.height = `${size}px`;
    container.appendChild(el);
  });
}

// ─── Init ─────────────────────────────────────────────────────────────────────
async function init(){
  injectMobileBottomBar();
  setupFullscreenButton();
  applyDesktopScale();

  try { await initFirebase(); }
  catch(err){ console.error("[DD] Firebase failed:",err); }

  // Load mystery events from JSON (falls back to built-in if missing)
  await loadMysteryEvents();

  document.getElementById("hero-overlay")?.classList.remove("active");
  showScreen("room-screen");
  wireRoomButtons();
  startFallingDogs();

  try {
    // Single source of truth — all game data lives in this JSON.
    // Edit didcot-dogs-game.v1.json to change route lengths, destinations, deck etc.
    const gameData = await loadJson("./data/didcot-dogs-game.v1.json?v=5");
    // Infer destinationPool from destinations keys, excluding the final return node
    const finalDest = gameData.winCondition?.finalDestination || "Didcot";
    gameData.destinationPool = Object.keys(gameData.destinations || {})
      .filter(k => k !== finalDest);
    const rulesData = gameData;
    const destinationData = { destinations: gameData.destinations };

    const svg=await injectBoardSvg();
    ensureSvgDefs(svg); startClaimGradientAnimation(svg);
    normalizeSvgNodeAliases(svg,rulesData); tightenSvgViewBox(svg);

    app.rulesData=rulesData; app.destinationData=destinationData; app.svg=svg;
    app.audit=getSvgAudit(svg,rulesData);
    // Don't create a full game state at startup — leave null so gameIsRunning()=false
    // A real state is created only when a game is actually created or joined
    app.state=null;

    wireRouteInteractions(); wireControlButtons(); setupMobileBoardGestures();
    resetBoardView();

    const savedCode=sessionStorage.getItem("dd_room_code");
    const savedHero=sessionStorage.getItem("dd_hero");
    if(savedCode&&savedHero&&savedHero!=="null"&&savedHero!=="undefined"){
      hideScreen("room-screen");
      showScreen("resuming-screen");
      try {
        const state=await fbJoinRoom(savedCode, savedHero);
        if(!state||!state.players) throw new Error("Game not ready");
        if(state.phase==="waiting") throw new Error("Game not started yet");
        // Verify this character is still in the game
        if(!state.characterSelections?.[savedHero]) throw new Error("Character no longer in game");
        // Set localHero BEFORE launchGame so getViewHero() works immediately
        app.roomCode=savedCode;
        app.localHero=savedHero;
        hideScreen("resuming-screen");
        launchGame(savedHero, restoreArrays(state));
      } catch(e){
        console.warn("[DD] Resume failed:",e.message);
        sessionStorage.removeItem("dd_room_code"); sessionStorage.removeItem("dd_hero"); sessionStorage.removeItem("dd_colour");
        hideScreen("resuming-screen");
        showScreen("room-screen");
        startFallingDogs();
      }
    }
    console.log("[DD] Game data loaded v"+gameData.version+". Routes:",Object.keys(rulesData.routes||{}).length);
  } catch(err){
    console.error("[DD] Data load error:",err);
    const errEl=document.getElementById("room-error");
    if(errEl) errEl.textContent=`Failed to load game data: ${err.message}`;
  }
}

window.addEventListener("resize",()=>{
  if(app.svg&&app.boardView.baseViewBox) applyBoardViewTransform();
  applyDesktopScale();
});
document.addEventListener("DOMContentLoaded",()=>{setupFullscreenButton();init();});
