/*
 * app.v2.js — Didcot Dogs
 *
 * CHANGELOG
 * v2.11.0
 *   - ADDED: Mystery node system. 3 nodes always show ? on board.
 *   - ADDED: OH WHUPS — discard half your cards via selection modal.
 *   - ADDED: NOWHERE TO POO — skip next 3 turns.
 *   - ADDED: JUST SNIFFIN' — all routes cost +1 card for remainder of game.
 *   - ADDED: GIMME GIMME — steal 3 random cards from opponent.
 *   - ADDED: BRIGHT BROWN — choose a colour, steal all of that colour from opponent.
 *   - ADDED: HITCH A LIFT — teleport instantly to next destination.
 *   - ADDED: ZOOMIES — held inventory card; after next move, pick a free second move.
 *   - ADDED: POOP — place hidden poo trap on a node; opponent skips 3 turns on arrival.
 *   - FIXED: restoreArrays() handles mysteryNodes, poopedNodes, inventory arrays.
 *
 * v2.10.5 — target node pulse fix
 * v2.10.4 — desktop scale mobile guard
 * v2.10.3 — own-knowledge-only rendering
 * v2.9.1  — Firebase array fix
 * v2.9.0  — Complete rewrite of multiplayer integration.
 */

console.log("Didcot Dogs app.v2.js loaded — VERSION v2.13.0");

const APP_VERSION = "v2.13.0";
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

async function fbCreateRoom(state) {
  let code, attempts = 0;
  while (attempts < 10) {
    code = generateRoomCode();
    const existing = await _firebaseGet(dbRef(`rooms/${code}/state`));
    if (!existing.exists()) break;
    attempts++;
  }
  await _firebaseSet(dbRef(`rooms/${code}/state`), { ...state, phase: "waiting", createdAt: Date.now() });
  await _firebaseSet(dbRef(`rooms/${code}/presence/Eric`), { connected: true, lastSeen: Date.now() });
  console.log("[DD] Room created:", code);
  return code;
}

async function fbJoinRoom(code) {
  const snap = await _firebaseGet(dbRef(`rooms/${code}/state`));
  if (!snap.exists()) throw new Error(`Room ${code} not found.`);
  const state = snap.val();
  await _firebaseSet(dbRef(`rooms/${code}/presence/Tango`), { connected: true, lastSeen: Date.now() });
  if (state.phase === "waiting") {
    await _firebaseSet(dbRef(`rooms/${code}/state/phase`), "playing");
  }
  console.log("[DD] Room joined:", code, "state:", state.currentPlayer, "routes:", Object.keys(state.routes||{}).length);
  return state;
}

async function fbPushState(code, state) {
  if (!code || !_db) return;
  const { controlledHero, ...firebaseState } = state;
  try {
    await _firebaseSet(dbRef(`rooms/${code}/state`), firebaseState);
  } catch(e) { console.error("[DD] pushState failed:", e); }
}

function fbSubscribeRoom(code, callback) {
  _firebaseOnValue(dbRef(`rooms/${code}/state`), snap => {
    if (snap.exists()) callback(snap.val());
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
  boardView: { scale:1, panX:0, panY:0, minScale:1, maxScale:3, baseViewBox:null },
  modal: { routeId:null, chosenColor:null, selectedOptionIndex:null, options:[] }
};

const PLAYER_CONFIG = {
  Eric:  { routeClass:"route-claimed-eric",  badgeClass:"eric",  image:"./assets/eric.png",  tokenClass:"eric-token" },
  Tango: { routeClass:"route-claimed-tango", badgeClass:"tango", image:"./assets/tango.png", tokenClass:"tango-token" }
};

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

// Returns the hero whose perspective we're rendering from.
// In solo play this is controlledHero; in multiplayer it's localHero.
function getViewHero() {
  return app.localHero || app.state?.controlledHero || app.state?.currentPlayer || "Eric";
}

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

function createInitialLocalState(rulesData, journeyTarget=null) {
  const routeIds=Object.keys(rulesData.routes||{});
  const colours=assignRouteColours(routeIds,rulesData.routeColours||[]);
  const dests=shuffle(rulesData.destinationPool||[]);
  const routes={};
  routeIds.forEach(id=>{routes[id]={colour:colours[id],claimedBy:null};});
  const allNodes = rulesData.nodes || [];
  const mysteryNodes = pickMysteryNodes(allNodes, rulesData.startNode, []);
  // journeyTarget: chosen by creator, or fall back to JSON default, or 5
  const N = journeyTarget
    || rulesData.winCondition?.targetJourneysBeforeReturn
    || 5;
  return {
    currentPlayer:"Eric", gameStarted:false, selectedRouteId:null,
    journeyTarget: N,   // stored in state so Firebase syncs it to joiner
    drawPile:buildDeck(rulesData), discardPile:[], justCompleted:null, routes,
    mysteryNodes,
    poopedNodes:{},
    players:{
      Eric:{...createPlayerState(rulesData.startNode),destinationQueue:dests.slice(0,N)},
      Tango:{...createPlayerState(rulesData.startNode),destinationQueue:dests.slice(N,N*2)}
    }
  };
}

// Returns the number of destinations required to win — from game state (set at creation)
// Falls back to rulesData.winCondition.targetJourneysBeforeReturn then to 5.
function getJourneyTarget() {
  return app.state?.journeyTarget
    || app.rulesData?.winCondition?.targetJourneysBeforeReturn
    || 5;
}

function getCurrentTargetForPlayer(player) {
  const N = getJourneyTarget();
  if(player.completedCount < N) return player.destinationQueue[player.completedCount] || null;
  // Final destination is always Didcot — comes from winCondition.finalDestination
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
  ["Eric","Tango"].forEach(n=>{
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
  g=createSvgEl("g",{id:`token-${playerName}`,class:`token-group ${PLAYER_CONFIG[playerName].tokenClass}`});
  const w=createSvgEl("g",{class:"token-wobble"});
  w.appendChild(createSvgEl("circle",{class:"token-circle",r:"24",fill:"#ffffff"}));
  const img=createSvgEl("image",{x:"-20",y:"-20",width:"40",height:"40",preserveAspectRatio:"xMidYMid meet","clip-path":`url(#token-clip-${playerName})`});
  img.setAttributeNS(XLINK_NS,"xlink:href",PLAYER_CONFIG[playerName].image);
  img.setAttribute("href",PLAYER_CONFIG[playerName].image);
  w.appendChild(img); g.appendChild(w); layer.appendChild(g);
  return g;
}
function setTokenPosition(svg,name,x,y) { ensurePlayerToken(svg,name).setAttribute("transform",`translate(${x},${y})`); }
function getPlayerTokenAnchor(name,nodeId) {
  const c=getNodeCenter(app.svg,nodeId);
  const en=app.state.players.Eric.currentNode, tn=app.state.players.Tango.currentNode;
  if(en===tn&&nodeId===en) return name==="Eric"?{x:c.x-18,y:c.y}:{x:c.x+18,y:c.y};
  return {x:c.x,y:c.y};
}
function renderTokens() {
  Object.keys(app.state.players).forEach(n=>{
    const a=getPlayerTokenAnchor(n,app.state.players[n].currentNode);
    setTokenPosition(app.svg,n,a.x,a.y);
  });
}

function getConnectedNode(routeId,fromNode) {
  const {a,b}=parseRouteId(routeId);
  return a===fromNode?b:b===fromNode?a:null;
}

// ─── Payment / playability ────────────────────────────────────────────────────
function getPaymentOptionsForColor(routeId,playerName,chosenColor=null) {
  const player=app.state.players[playerName], hc=countCards(player.hand);
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
  const pn=app.state.currentPlayer, player=app.state.players[pn], rs=app.state.routes[routeId];
  const cn=getConnectedNode(routeId,player.currentNode);
  if(!cn) return {playable:false,reason:"Route does not connect to current node."};
  if(rs.claimedBy) return {playable:false,reason:`Already claimed by ${rs.claimedBy}.`};
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
function isMyTurn() {
  if(!app.roomCode) return true;
  if(!app.localHero) return true;
  return app.state.currentPlayer===app.localHero;
}

function endTurn() {
  app.state.selectedRouteId=null;
  closeRouteModal();
  const next=app.state.currentPlayer==="Eric"?"Tango":"Eric";
  app.state.currentPlayer=next;
  // Check if next player has skip turns (NOWHERE TO POO / POOP)
  const nextPlayer=app.state.players[next];
  if(nextPlayer.skipTurns>0){
    nextPlayer.skipTurns--;
    console.log("[DD] Skipping",next,"— turns left:",nextPlayer.skipTurns);
    // Show a toast to the skipped player if they are local
    if(next===getViewHero()){
      showMobileToast("Skipping your turn…");
      updateStatus("Your turn is being skipped!");
    }
    renderAll();
    if(app.roomCode) fbPushState(app.roomCode, app.state).then(()=>updateRoomHud());
    // Auto-end this skipped turn after a short delay
    setTimeout(endTurn, 1200);
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
      const op=playerName==="Eric"?"Tango":"Eric";
      if(app.state.players[op].currentNode===toNode){x+=playerName==="Eric"?-18:18;}
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
  const cfg=PLAYER_CONFIG[hero];

  const identity=document.getElementById("desktop-identity");
  if(identity&&cfg){
    identity.innerHTML=`
      <div class="desktop-identity-inner">
        <img class="desktop-identity-portrait"
             id="desktop-identity-portrait"
             data-hero="${hero}"
             src="${cfg.image}" alt="${hero}"
             style="border-color:${hero==="Eric"?"rgba(25,167,255,0.6)":"rgba(255,230,0,0.6)"}">
        <div class="desktop-identity-text">
          <div class="desktop-identity-label">YOU ARE</div>
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


// ─── Journey count picker ──────────────────────────────────────────────────────
// Shows before hero pick. Creator chooses how many destinations per player.
// Max = floor(destinationPool.length / 2), min = 1.
function showJourneyPicker(onConfirm) {
  const pool = app.rulesData.destinationPool || [];
  const maxJ = Math.floor(pool.length / 2);
  const defaultJ = app.rulesData.winCondition?.targetJourneysBeforeReturn || Math.min(5, maxJ);

  let overlay = document.getElementById("journey-picker-overlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "journey-picker-overlay";
    overlay.className = "mystery-modal-overlay"; // reuse same overlay style
    document.getElementById("game-shell").appendChild(overlay);
  }

  // Build option buttons 1..maxJ
  const options = Array.from({length: maxJ}, (_,i) => i+1);
  let chosen = defaultJ;

  function render() {
    overlay.innerHTML = `
      <div class="mystery-modal journey-picker-modal">
        <div class="mystery-modal-emoji">🗺️</div>
        <div class="mystery-modal-title">HOW MANY STOPS?</div>
        <div class="mystery-modal-body">
          Choose how many destination cards each player must complete before heading home.
          The final stop is always Didcot.
        </div>
        <div class="journey-picker-grid">
          ${options.map(n => `
            <button type="button" class="journey-picker-btn${n===chosen?" active":""}" data-n="${n}">
              <span class="journey-picker-num">${n}</span>
              <span class="journey-picker-lbl">${n===1?"stop":"stops"}</span>
            </button>`).join("")}
        </div>
        <div class="journey-picker-summary">
          ${chosen} destination${chosen===1?"":"s"} + Didcot = ${chosen+1} card${chosen+1===1?"":"s"} total
        </div>
        <div class="mystery-modal-actions">
          <button id="journey-picker-confirm" class="action-btn primary" type="button">Let's go!</button>
        </div>
      </div>`;

    overlay.querySelectorAll(".journey-picker-btn").forEach(btn => {
      btn.onclick = () => {
        chosen = +btn.dataset.n;
        render();
      };
    });

    document.getElementById("journey-picker-confirm").onclick = () => {
      overlay.classList.remove("open");
      onConfirm(chosen);
    };
  }

  render();
  overlay.classList.add("open");
}

// ─── Room screen ──────────────────────────────────────────────────────────────
function showScreen(id){ const e=document.getElementById(id); if(e) e.classList.add("active"); }
function hideScreen(id){ const e=document.getElementById(id); if(e) e.classList.remove("active"); }

function wireRoomButtons(){
  const createBtn=document.getElementById("room-create-btn");
  const joinBtn=document.getElementById("room-join-btn");
  const joinInput=document.getElementById("room-join-input");
  const errorEl=document.getElementById("room-error");

  createBtn.disabled=false; createBtn.textContent="Create game";
  joinBtn.disabled=false; joinBtn.textContent="Join";
  if(errorEl) errorEl.textContent="";

  createBtn.onclick = async()=>{
    createBtn.disabled=true; createBtn.textContent="Creating…"; errorEl.textContent="";
    // Show journey count picker before committing to Firebase
    showJourneyPicker(async (journeyTarget) => {
    try {
      const state=createInitialLocalState(app.rulesData, journeyTarget);
      state.currentPlayer="Eric";
      const code=await fbCreateRoom(state);
      app.roomCode=code;

      hideScreen("room-screen");
      document.getElementById("hero-overlay").classList.add("active");

      function creatorPickHero(hero){
        const joinerHero=hero==="Eric"?"Tango":"Eric";
        app.localHero=hero;
        app.state={...state, controlledHero:hero, currentPlayer:hero};
        sessionStorage.setItem("dd_room_code",code);
        sessionStorage.setItem("dd_hero",hero);
        fbPushState(code,{...state,currentPlayer:hero,phase:"waiting"});
        document.getElementById("hero-overlay").classList.remove("active");
        showMobileHud(); resetBoardView(); renderAll();
        showCurrentDestinationReveal(hero); showStartToast(hero);
        updateRoomHud();
        // Show waiting screen with cancel button
        const codeEl=document.getElementById("waiting-code");
        if(codeEl) codeEl.textContent=code;
        showScreen("waiting-screen");
        // Wire the waiting screen cancel button
        const cancelBtn=document.getElementById("waiting-cancel-btn");
        if(cancelBtn) cancelBtn.onclick=()=>returnToMenu();

        let started=false;
        fbSubscribePresence(code, presence=>{
          if(presence?.[joinerHero]?.connected&&!started){
            started=true;
            hideScreen("waiting-screen");
            console.log("[DD] Opponent joined, subscribing");
            let skipFirst=true;
            fbSubscribeRoom(code, remoteState=>{
              if(!remoteState||!remoteState.players) return;
              if(skipFirst){skipFirst=false;return;}
              console.log("[DD] Creator received remote state, currentPlayer:",remoteState.currentPlayer);
              app.state={...restoreArrays({...remoteState}),controlledHero:hero};
              renderAll(); updateRoomHud();
            });
          }
        });
      }
      document.getElementById("pick-eric-btn").onclick=()=>creatorPickHero("Eric");
      document.getElementById("pick-tango-btn").onclick=()=>creatorPickHero("Tango");
    } catch(err){
      errorEl.textContent=err.message;
      createBtn.disabled=false; createBtn.textContent="Create game";
    }
    }); // end showJourneyPicker
  };

  joinBtn.onclick = async()=>{
    const code=(joinInput.value||"").toUpperCase().trim();
    if(code.length!==4){ errorEl.textContent="Enter a 4-character code."; return; }
    joinBtn.disabled=true; joinBtn.textContent="Joining…"; errorEl.textContent="";
    try {
      const firebaseState=await fbJoinRoom(code);
      const creatorHero=firebaseState.currentPlayer||"Eric";
      const joinerHero=creatorHero==="Eric"?"Tango":"Eric";
      app.roomCode=code; app.localHero=joinerHero;
      sessionStorage.setItem("dd_room_code",code); sessionStorage.setItem("dd_hero",joinerHero);
      hideScreen("room-screen");
      launchGame(joinerHero, firebaseState);
    } catch(err){
      errorEl.textContent=err.message;
      joinBtn.disabled=false; joinBtn.textContent="Join";
    }
  };

  joinInput.onkeydown=e=>{if(e.key==="Enter")joinBtn.click();};
  joinInput.oninput=()=>{joinInput.value=joinInput.value.toUpperCase();};
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
  if(!state.poopedNodes) state.poopedNodes={};
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
    });
  }
  return state;
}

function launchGame(hero, firebaseState){
  console.log("[DD] launchGame hero:",hero,"routes:",Object.keys(firebaseState.routes||{}).length,"deck:",firebaseState.drawPile?.length,"currentPlayer:",firebaseState.currentPlayer);
  app.state={...restoreArrays({...firebaseState}), controlledHero:hero};
  app.localHero=hero;
  document.getElementById("hero-overlay").classList.remove("active");
  showMobileHud();
  resetBoardView();
  showStartToast(hero);
  renderAll();
  showCurrentDestinationReveal(hero);
  updateRoomHud();

  let skipFirst=true;
  fbSubscribeRoom(app.roomCode, remoteState=>{
    if(!remoteState||!remoteState.players) return;
    if(skipFirst){ skipFirst=false; return; }
    console.log("[DD] Remote state received, currentPlayer:",remoteState.currentPlayer,"localHero:",hero);
    app.state={...restoreArrays({...remoteState}), controlledHero:hero};
    renderAll();
    updateRoomHud();
  });
}

// ─── Return to menu ───────────────────────────────────────────────────────────
function returnToMenu(){
  sessionStorage.removeItem("dd_room_code"); sessionStorage.removeItem("dd_hero");
  app.roomCode=null; app.localHero=null;
  cancelAutoSim(); closeRouteModal(); closeDestinationReveal(); closeMobileSheet();
  app.state=createInitialLocalState(app.rulesData);

  ["mobile-hud","mobile-bottom-bar"].forEach(id=>{const e=document.getElementById(id);if(e)e.classList.remove("visible");});
  const sh=document.getElementById("mobile-sheet");if(sh)sh.classList.remove("visible-shell","expanded");
  ["waiting-screen","resuming-screen"].forEach(hideScreen);
  hideEndScreen();

  document.getElementById("hero-overlay").classList.remove("active");

  const pe=document.getElementById("pick-eric-btn");
  const pt=document.getElementById("pick-tango-btn");
  if(pe) pe.onclick=null;
  if(pt) pt.onclick=null;

  const di=document.getElementById("desktop-identity");
  if(di) di.innerHTML="";
  const ti=document.getElementById("desktop-turn-indicator");
  if(ti) ti.textContent="";
  const rhud=document.getElementById("room-hud");
  if(rhud) rhud.style.display="none";

  resetBoardView(); renderAll();
  showScreen("room-screen");
  wireRoomButtons();
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
    if(!el||app.state.routes[routeId].claimedBy) return;
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
  Object.keys(app.rulesData.routes||{}).forEach(routeId=>{
    const el=app.svg.querySelector(`#${CSS.escape(routeId)}`); if(!el) return;
    el.classList.remove("route-claimed-eric","route-claimed-tango","route-eligible","route-selected","route-blocked");
    const rs=app.state.routes[routeId], rc=rs.colour;
    el.style.strokeWidth="8"; el.style.cursor="pointer";
    el.style.stroke=ROUTE_COLOUR_HEX[rc]||"#7a7a7a";
    if(rs.claimedBy){el.classList.add(PLAYER_CONFIG[rs.claimedBy].routeClass);return;}
    const play=getRoutePlayability(routeId);
    if(play.playable) el.classList.add("route-eligible");
    if(app.state.selectedRouteId===routeId) el.classList.add("route-selected");
  });
  renderRouteCostBadges();
}

function renderTurnBadge(){
  const b=document.getElementById("turn-player-badge"); if(!b) return;
  b.className=`player-badge ${PLAYER_CONFIG[app.state.currentPlayer].badgeClass}`;
  b.textContent=`${app.state.currentPlayer} to play`;
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
  const player=app.state.players[hero];
  renderHandInto(wrap,player,"hand-card");
  player.lastDrawColor=null;
}

// Only show OWN player summary info — opponent details hidden
function renderPlayerSummary(){
  const wrap=document.getElementById("player-summary-wrap"); if(!wrap) return;
  wrap.innerHTML="";
  const hero=getViewHero();
  ["Eric","Tango"].forEach(n=>{
    const p=app.state.players[n];
    const isMe=n===hero;
    const t=isMe?getCurrentTargetForPlayer(p):null;
    const card=document.createElement("div");
    card.className=`player-summary-card${app.state.currentPlayer===n?" active":""}`;
    if(isMe){
      const targetTitle=t?(app.destinationData?.destinations[t]?.title||formatNodeName(t)):"—";
      card.innerHTML=`
        <div class="player-summary-name">${n} <span style="font-size:13px;opacity:0.5;font-family:var(--ui-font)">(you)</span></div>
        <div class="player-summary-meta">
          <span class="summary-row"><span class="summary-lbl">Location</span><span class="summary-val">${formatNodeName(p.currentNode)}</span></span>
          <span class="summary-row"><span class="summary-lbl">Cards</span><span class="summary-val">${p.hand.length}</span></span>
          <span class="summary-row"><span class="summary-lbl">Journeys</span><span class="summary-val">${Math.min(p.completedCount,getJourneyTarget())}/${getJourneyTarget()}</span></span>
          <span class="summary-row"><span class="summary-lbl">Target</span><span class="summary-val">${targetTitle}</span></span>
        </div>`;
    } else {
      // Opponent — only show location and journey count, nothing secret
      card.innerHTML=`
        <div class="player-summary-name">${n}</div>
        <div class="player-summary-meta">
          <span class="summary-row"><span class="summary-lbl">Location</span><span class="summary-val">${formatNodeName(p.currentNode)}</span></span>
          <span class="summary-row"><span class="summary-lbl">Journeys</span><span class="summary-val">${Math.min(p.completedCount,getJourneyTarget())}/${getJourneyTarget()}</span></span>
        </div>`;
    }
    wrap.appendChild(card);
  });
}

// Only render the VIEW HERO's destination sequence
function buildDestinationSequenceElement(playerName,showFlip=true){
  const player=app.state.players[playerName];
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
  const tid=getCurrentTargetForPlayer(app.state.players[hero]); if(!tid) return;
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
    <div><strong>Hero:</strong> ${app.localHero||app.state.controlledHero||"—"}</div>
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
  const player=app.state.players[hero];
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
  const b=document.getElementById("draw-card-btn");
  if(!b) return;
  const mine=isMyTurn();
  b.disabled=!mine;
  b.textContent=mine?"Draw card":"Waaaaiit…";
  b.classList.toggle("btn-waiting",!mine);
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

const MYSTERY_EVENTS = [
  {
    id:"oh_whups",
    title:"OH WHUPS",
    body:"Oopadays. You've lost half your cards.",
    emoji:"😬"
  },
  {
    id:"nowhere_to_poo",
    title:"NOWHERE TO POO",
    body:"Can't seem to find the right spot… just gonna look around for 3 turns.",
    emoji:"🔍"
  },
  {
    id:"just_sniffin",
    title:"JUST SNIFFIN'",
    body:"Slow progress. Routes require an extra card.",
    emoji:"👃"
  },
  {
    id:"gimme_gimme",
    title:"GIMME GIMME",
    body:"Nabbed! Take 3 of your opponent's cards and run away.",
    emoji:"🐾"
  },
  {
    id:"bright_brown",
    title:"BRIGHT BROWN",
    body:"Choose a colour. Opponent will give you all cards of that colour.",
    emoji:"💩"
  },
  {
    id:"zoomies",
    title:"ZOOMIES",
    body:"Zoom zoom zoom. Next time you move, make a second move for free.",
    emoji:"⚡"
  },
  {
    id:"poop",
    title:"POOP",
    body:"Drop a log, slow down your opponent!",
    emoji:"💩"
  },
  {
    id:"hitch_a_lift",
    title:"HITCH A LIFT",
    body:"Dad's here to give a ride! Travel immediately to the next destination.",
    emoji:"🚗"
  }
];

function pickMysteryNodes(allNodes, startNode, exclude=[]) {
  const pool = allNodes.filter(n => n !== startNode && !exclude.includes(n));
  const picked = [];
  const shuffled = shuffle([...pool]);
  for(const n of shuffled) {
    if(picked.length >= 3) break;
    picked.push(n);
  }
  return picked;
}

function rotateMysteryNode(triggeredNodeId) {
  if(!app.state.mysteryNodes) app.state.mysteryNodes=[];
  const allNodes = app.rulesData.nodes || [];
  const remaining = app.state.mysteryNodes.filter(n => n !== triggeredNodeId);
  // Pick a new node not already a mystery and not start node
  const exclude = [...remaining, app.rulesData.startNode,
    app.state.players.Eric.currentNode,
    app.state.players.Tango.currentNode];
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

// ── OH WHUPS ──────────────────────────────────────────────────────────────
function buildOhWhupsUI(content, playerName, okBtn, overlay, onDone) {
  const player = app.state.players[playerName];
  const hand = [...player.hand];
  const mustDiscard = Math.ceil(hand.length / 2);
  const counts = countCards(hand);
  const selected = {}; // colour -> count selected
  let totalSelected = 0;

  okBtn.disabled = true;
  okBtn.textContent = `Discard ${mustDiscard} cards`;

  function renderCards() {
    content.innerHTML = `<div class="mystery-card-select-label">Select ${mustDiscard} cards to discard (${totalSelected}/${mustDiscard})</div>
      <div class="mystery-card-select-grid"></div>`;
    const grid = content.querySelector(".mystery-card-select-grid");
    Object.entries(counts).forEach(([colour, count]) => {
      for(let i = 0; i < count; i++) {
        const idx = i;
        const sel = (selected[colour] || 0) > idx;
        const card = document.createElement("button");
        card.type = "button";
        card.className = `hand-card ${colour}${sel?" mystery-card-selected":""}`;
        card.innerHTML = `<div class="card-name">${colour}</div>`;
        card.onclick = () => {
          const cur = selected[colour] || 0;
          if(sel) {
            selected[colour] = Math.max(0, cur-1);
            totalSelected--;
          } else if(totalSelected < mustDiscard) {
            selected[colour] = cur+1;
            totalSelected++;
          }
          renderCards();
          okBtn.disabled = totalSelected < mustDiscard;
        };
        grid.appendChild(card);
      }
    });
  }
  renderCards();

  okBtn.onclick = () => {
    if(totalSelected < mustDiscard) return;
    // Remove selected cards from hand
    let h = [...player.hand];
    Object.entries(selected).forEach(([colour, n]) => {
      let removed = 0;
      h = h.filter(c => {
        if(c === colour && removed < n) { removed++; return false; }
        return true;
      });
    });
    const discarded = hand.length - h.length;
    player.hand = h;
    app.state.discardPile.push(...Object.entries(selected).flatMap(([c,n])=>Array(n).fill(c)));
    overlay.classList.remove("open");
    updateStatus(`Oh Whups! Discarded ${discarded} cards.`, TOAST_NOTABLE);
    onDone();
  };
}

// ── BRIGHT BROWN ──────────────────────────────────────────────────────────
function buildBrightBrownUI(content, playerName, okBtn, overlay, onDone) {
  const colours = ["red","orange","blue","green","black","pink","yellow"];
  let chosenColour = null;
  okBtn.disabled = true;
  okBtn.textContent = "Steal cards";

  content.innerHTML = `<div class="mystery-card-select-label">Choose a colour to steal from opponent:</div>
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
    const opponent = playerName === "Eric" ? "Tango" : "Eric";
    const oppPlayer = app.state.players[opponent];
    const stolen = oppPlayer.hand.filter(c => c === chosenColour);
    oppPlayer.hand = oppPlayer.hand.filter(c => c !== chosenColour);
    app.state.players[playerName].hand.push(...stolen);
    overlay.classList.remove("open");
    updateStatus(`Bright Brown! Stole ${stolen.length} ${chosenColour} card(s).`, TOAST_NOTABLE);
    onDone();
  };
}

// ── Apply effects for simple events ──────────────────────────────────────
function applyMysteryEffect(eventId, playerName) {
  const player = app.state.players[playerName];
  const opponent = playerName === "Eric" ? "Tango" : "Eric";
  const oppPlayer = app.state.players[opponent];

  switch(eventId) {
    case "nowhere_to_poo":
      player.skipTurns += 3;
      updateStatus("Nowhere to Poo! Skipping 3 turns.", TOAST_NOTABLE);
      break;

    case "just_sniffin":
      player.routeCostBonus = (player.routeCostBonus || 0) + 1;
      updateStatus("Just Sniffin'! Routes cost +1 card.", TOAST_NOTABLE);
      break;

    case "gimme_gimme": {
      const n = Math.min(3, oppPlayer.hand.length);
      const stolen = shuffle([...oppPlayer.hand]).slice(0, n);
      stolen.forEach(c => {
        const i = oppPlayer.hand.indexOf(c);
        if(i !== -1) oppPlayer.hand.splice(i, 1);
        player.hand.push(c);
      });
      updateStatus(`Gimme Gimme! Stole ${n} card(s) from ${opponent}.`, TOAST_NOTABLE);
      break;
    }

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

    default:
      break;
  }
}

// ── HITCH A LIFT ──────────────────────────────────────────────────────────
function applyHitchALift(playerName) {
  const player = app.state.players[playerName];
  // Complete destination first if currently on it
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
  const player = app.state.players[playerName];
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
  // Stepped in poop!
  delete app.state.poopedNodes[nodeId];
  app.state.players[playerName].skipTurns += 3;
  if(playerName === getViewHero()) {
    showPoopTrapModal();
  } else {
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
  const player = app.state.players[playerName];
  if(!player.inventory || !player.inventory.includes("zoom")) return Promise.resolve(false);
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

function renderAll(){
  renderTurnBadge(); renderCounts(); renderSelectedRouteCard(); renderActiveHand();
  renderPlayerSummary(); renderDestinationSequences(); renderRoutes(); renderTokens();
  renderTargetPulse(); renderDebug(app.audit); renderButtons(); renderMobileRoutesPanel();
  renderDesktopPiles(); renderMysteryNodes(); renderPoopNodes();
  renderInventoryBadge();
  if(app.roomCode) updateRoomHud();
}

function renderInventoryBadge() {
  const hero = getViewHero();
  if(!app.state) return;
  const player = app.state.players[hero];
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
  if(!isMyTurn()) return;
  if(!app.modal.routeId||app.modal.selectedOptionIndex===null) return;
  const routeId=app.modal.routeId, pay=app.modal.options[app.modal.selectedOptionIndex];
  const pn=app.state.currentPlayer, player=app.state.players[pn];
  const play=getRoutePlayability(routeId);
  if(!play.playable){closeRouteModal();renderAll();return;}
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
  endTurn();
}

// ─── Start toast / identity card ──────────────────────────────────────────────
function showStartToast(playerName){
  let card=document.getElementById("identity-card");
  if(!card){card=document.createElement("div");card.id="identity-card";card.className="identity-card";document.getElementById("game-shell").appendChild(card);}
  const cfg=PLAYER_CONFIG[playerName];
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
  const player=app.state.players[playerName], t=getCurrentTargetForPlayer(player);
  const N=getJourneyTarget();
  if(!t||player.completedCount>N) return;
  const dest=app.destinationData.destinations[t];
  openDestinationReveal(dest?.title||formatNodeName(t),dest?.description||"",player.completedCount+1);
}

function completeDestinationIfNeeded(playerName){
  const player=app.state.players[playerName], t=getCurrentTargetForPlayer(player);
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
    hideEndScreen(); sessionStorage.removeItem("dd_room_code"); sessionStorage.removeItem("dd_hero");
    app.roomCode=null; app.localHero=null;
    app.state=createInitialLocalState(app.rulesData);
    closeRouteModal(); closeDestinationReveal(); closeMobileSheet(); resetBoardView(); renderAll();
    document.getElementById("hero-overlay").classList.add("active");
    ["mobile-hud","mobile-bottom-bar"].forEach(id=>{const e=document.getElementById(id);if(e)e.classList.remove("visible");});
    const sh=document.getElementById("mobile-sheet");if(sh)sh.classList.remove("visible-shell","expanded");
    showScreen("room-screen"); wireRoomButtons();
  });
}
function showEndScreen(winnerName){
  buildEndScreenOverlay();
  const o=document.getElementById("end-screen-overlay"), mine=winnerName===app.localHero;
  document.getElementById("end-screen-headline").textContent=mine?"YOU WIN!":"YOU LOSE!";
  document.getElementById("end-screen-sub").textContent=mine?`${winnerName} completed all five. Legendary.`:`${winnerName} beat you to it.`;
  document.getElementById("end-screen-portrait").innerHTML=`<img src="${PLAYER_CONFIG[winnerName].image}" alt="${winnerName}" class="end-screen-portrait">`;
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
  const bot=app.state.currentPlayer, player=app.state.players[bot];
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

// ─── Draw card action ─────────────────────────────────────────────────────────
async function drawCardForCurrentPlayer(){
  if(!isMyTurn()) return;
  const pn=app.state.currentPlayer, card=drawCard();
  if(!card){updateStatus("No cards available.");renderAll();return;}
  const player=app.state.players[pn];
  await animateCardDraw(card);
  player.hand.push(card); player.lastDrawColor=card;
  closeMobileSheet(); renderAll();
  requestAnimationFrame(()=>triggerCardGlow(card));
  endTurn();
}

// ─── Route interactions ───────────────────────────────────────────────────────
function handleRouteHover(routeId){
  const play=getRoutePlayability(routeId), rc=getDisplayRouteColor(app.state.routes[routeId].colour), cost=app.rulesData.routes[routeId].length;
  updateStatus(play.playable?`${formatRouteName(routeId)} · ${rc} · cost ${cost} · eligible`:`${formatRouteName(routeId)} · ${rc} · cost ${cost} · ${play.reason}`);
}
function wireRouteInteractions(){
  Object.keys(app.rulesData.routes||{}).forEach(routeId=>{
    const el=app.svg.querySelector(`#${CSS.escape(routeId)}`);if(!el) return;
    el.addEventListener("mouseenter",()=>handleRouteHover(routeId));
    el.addEventListener("mouseleave",()=>updateStatus("Choose one action: draw a card or click a route to play it."));
    el.addEventListener("click",()=>handleRouteSelection(routeId));
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
    cancelAutoSim();
    sessionStorage.removeItem("dd_room_code"); sessionStorage.removeItem("dd_hero");
    app.roomCode=null; app.localHero=null;
    app.state=createInitialLocalState(app.rulesData);
    closeRouteModal(); closeDestinationReveal(); closeMobileSheet(); resetBoardView(); renderAll();
    updateStatus("Game reset.");
    showScreen("room-screen"); wireRoomButtons();
  });

  function soloPickHero(hero) {
    app.state=createInitialLocalState(app.rulesData); app.state.controlledHero=hero;
    document.getElementById("hero-overlay").classList.remove("active");
    showMobileHud(); resetBoardView(); showStartToast(hero); renderAll(); showCurrentDestinationReveal(hero);
  }
  document.getElementById("pick-eric-btn")?.addEventListener("click",()=>{
    if(!document.getElementById("pick-eric-btn").onclick) soloPickHero("Eric");
  });
  document.getElementById("pick-tango-btn")?.addEventListener("click",()=>{
    if(!document.getElementById("pick-tango-btn").onclick) soloPickHero("Tango");
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

// ─── Init ─────────────────────────────────────────────────────────────────────
async function init(){
  injectMobileBottomBar();
  setupFullscreenButton();
  applyDesktopScale();

  try { await initFirebase(); }
  catch(err){ console.error("[DD] Firebase failed:",err); }

  document.getElementById("hero-overlay").classList.remove("active");
  showScreen("room-screen");
  wireRoomButtons();

  try {
    // Single source of truth — all game data lives in this JSON.
    // Edit didcot-dogs-game.v1.json to change route lengths, destinations, deck etc.
    const gameData = await loadJson("./data/didcot-dogs-game.v1.json?v=3");
    const rulesData = gameData;           // routes, nodes, deck, win condition etc.
    const destinationData = { destinations: gameData.destinations }; // keep same shape

    const svg=await injectBoardSvg();
    ensureSvgDefs(svg); startClaimGradientAnimation(svg);
    normalizeSvgNodeAliases(svg,rulesData); tightenSvgViewBox(svg);

    app.rulesData=rulesData; app.destinationData=destinationData; app.svg=svg;
    app.audit=getSvgAudit(svg,rulesData);
    app.state=createInitialLocalState(rulesData);

    wireRouteInteractions(); wireControlButtons(); setupMobileBoardGestures();
    resetBoardView();

    const savedCode=sessionStorage.getItem("dd_room_code");
    const savedHero=sessionStorage.getItem("dd_hero");
    if(savedCode&&savedHero){
      hideScreen("room-screen");
      showScreen("resuming-screen");
      try {
        const state=await fbJoinRoom(savedCode);
        if(!state||!state.players||state.phase==="waiting") throw new Error("Game not ready");
        app.roomCode=savedCode; app.localHero=savedHero;
        hideScreen("resuming-screen");
        launchGame(savedHero, restoreArrays(state));
      } catch(e){
        console.warn("[DD] Resume failed:",e.message);
        sessionStorage.removeItem("dd_room_code"); sessionStorage.removeItem("dd_hero");
        hideScreen("resuming-screen");
        showScreen("room-screen");
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
