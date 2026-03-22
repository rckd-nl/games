/*
 * app.v2.js — Didcot Dogs
 *
 * CHANGELOG
 * v2.3.0
 *   - ADDED: Flying card animation on draw — card drops from draw pile
 *     position to hand strip, flips face-up mid-flight, lands then fades.
 *     Uses a fixed-position overlay div with getBoundingClientRect coords.
 *   - ADDED: Colour-matched glow on newly drawn card in hand strip.
 *     Glow uses the card's own colour, pulses for 1.5s then fades.
 *   - ADDED: Landscape mobile forces mobile layout (orientation: landscape
 *     and max-height: 500px) regardless of pixel width.
 * v2.2.0
 *   - ADDED: Visual draw and discard pile stacks in mobile HUD.
 *     Draw pile: 3 stacked face-down dark cards with paw SVG, count badge.
 *     Discard pile: top 3 cards shown face-up with rotations, messy feel.
 *     HUD grid updated to 4-col row 1 (turn + piles), destination row 2,
 *     action buttons row 3.
 * v2.1.0
 *   - IMPROVED: HUD destination pill shows ▸ prefix and completion progress
 *     badge; JS sets data-complete attribute for CSS accent colouring.
 *   - IMPROVED: HUD action buttons are rounded-square (not pill), with inner
 *     shadow for tactile feel; Draw card is accent-coloured, Routes is neutral.
 *   - IMPROVED: Bottom hand peek cards taller (+12px), chevron hint rendered
 *     above strip to signal interactivity.
 *   - IMPROVED: Destination reveal has scale-in + flip animation on open.
 *   - IMPROVED: Route pay modal shows route name/cost prominently at top;
 *     spend cards restored to full hand-card size (64×88px) on mobile.
 *   - IMPROVED: Start toast replaced with full-width identity card — portrait,
 *     name, wipe background — holds for 1.8s then slides out.
 *   - ADDED: End screen overlay (win/lose). Fires after fifth destination.
 *   - FIXED: showMobileHud() also reveals bottom bar + visible-shell on sheet.
 *   - FIXED: openMobileSheet / toggleMobileSheet guard on .visible-shell.
 * v2.0.0
 *   - FIXED: Pan/zoom now manipulates SVG viewBox directly instead of CSS
 *     transform. SVG re-renders as vector at every zoom level — no more
 *     pixellation at any zoom or on any device.
 *   - FIXED: Removed willChange:transform and CSS transform from SVG element.
 *   - FIXED: Board stays centred when fully zoomed out (no drift into empty space).
 *   - FIXED: #mobile-hud CSS had conflicting display:none / display:grid rules;
 *     the HUD is now shown via a class toggle so it reliably appears on mobile.
 *   - FIXED: Board viewport (board-wrap) uses CSS variables for HUD/bar heights
 *     so it can never bleed under them.
 *   - IMPROVED: Pinch-to-zoom focal point is correct — zooms around the midpoint
 *     of the two fingers in SVG coordinate space.
 *   - IMPROVED: Pan is clamped so the board cannot be dragged entirely off screen.
 *   - FIXED: showMobileHud() moved to startGameAs() — HUD is now hidden during
 *     hero-pick screen and only appears once a player is chosen.
 *   - NOTE: All other game logic is unchanged from v1.9.5.
 */

console.log("Didcot Dogs app.v2.js loaded");

const APP_VERSION = "v2.4.0";
const SVG_NS = "http://www.w3.org/2000/svg";
const XLINK_NS = "http://www.w3.org/1999/xlink";

const PLAYER_CONFIG = {
  Eric: {
    routeClass: "route-claimed-eric",
    badgeClass: "eric",
    image: "./assets/eric.png",
    tokenClass: "eric-token"
  },
  Tango: {
    routeClass: "route-claimed-tango",
    badgeClass: "tango",
    image: "./assets/tango.png",
    tokenClass: "tango-token"
  }
};

const ROUTE_COLOUR_HEX = {
  red: "#d74b4b",
  orange: "#db7f2f",
  blue: "#2f6edb",
  green: "#1e8b4c",
  black: "#1d1d1d",
  pink: "#c64f8e",
  yellow: "#d6b300",
  grey: "#7a7a7a"
};

// ---------------------------------------------------------------------------
// boardView now stores the current viewBox in SVG-user-unit space.
// baseViewBox is the full-fit viewBox set after tightenSvgViewBox().
// We derive the current viewBox from baseViewBox + pan/zoom.
// ---------------------------------------------------------------------------
let app = {
  rulesData: null,
  destinationData: null,
  svg: null,
  audit: null,
  state: null,
  boardView: {
    // zoom level: 1 = fully zoomed out (fit), up to maxScale
    scale: 1,
    // pan offset in SVG user units (0,0 = centred / no pan)
    panX: 0,
    panY: 0,
    minScale: 1,
    maxScale: 3,
    // set after SVG is loaded and tightened
    baseViewBox: null   // { x, y, w, h }
  },
  modal: {
    routeId: null,
    chosenColor: null,
    selectedOptionIndex: null,
    options: []
  }
};

// ---------------------------------------------------------------------------
// JSON / text loading
// ---------------------------------------------------------------------------
async function loadJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`Failed to load ${url} (${response.status})`);
  return response.json();
}

async function loadText(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`Failed to load ${url} (${response.status})`);
  return response.text();
}

// ---------------------------------------------------------------------------
// SVG element helpers
// ---------------------------------------------------------------------------
function createSvgEl(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  Object.entries(attrs).forEach(([key, value]) => el.setAttribute(key, value));
  return el;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

// ---------------------------------------------------------------------------
// ViewBox-based pan/zoom
//
// The SVG always fills #board-wrap 100%×100%.  We control what the user sees
// by changing the viewBox attribute.  At scale=1 the viewBox equals
// baseViewBox (full board visible, centred).  Zooming in shrinks the viewBox
// rectangle; panning shifts it.
// ---------------------------------------------------------------------------

function getBaseViewBox() {
  return app.boardView.baseViewBox;
}

/**
 * Compute the current viewBox from scale + pan and apply it to the SVG.
 * Pan is clamped so the viewport can never wander beyond the board content.
 */
function applyBoardViewTransform() {
  const svg = app.svg;
  if (!svg || !app.boardView.baseViewBox) return;

  const base = app.boardView.baseViewBox;
  const scale = app.boardView.scale;

  // Zoomed viewBox size (smaller = more zoomed in)
  const vw = base.w / scale;
  const vh = base.h / scale;

  // Centre of baseViewBox
  const cx = base.x + base.w / 2;
  const cy = base.y + base.h / 2;

  // Pan offsets are in SVG units.  Clamp so we can't pan outside the board.
  const maxPanX = (base.w - vw) / 2;
  const maxPanY = (base.h - vh) / 2;
  app.boardView.panX = clamp(app.boardView.panX, -maxPanX, maxPanX);
  app.boardView.panY = clamp(app.boardView.panY, -maxPanY, maxPanY);

  const vx = cx - vw / 2 + app.boardView.panX;
  const vy = cy - vh / 2 + app.boardView.panY;

  svg.setAttribute("viewBox", `${vx} ${vy} ${vw} ${vh}`);
}

function resetBoardView() {
  app.boardView.scale = 1;
  app.boardView.panX = 0;
  app.boardView.panY = 0;
  applyBoardViewTransform();
}

// ---------------------------------------------------------------------------
// Convert a point in screen/client pixels (relative to board-wrap) into
// SVG user units, using the current viewBox.
// ---------------------------------------------------------------------------
function clientToSvgPoint(clientX, clientY) {
  const boardWrap = document.getElementById("board-wrap");
  const svg = app.svg;
  if (!boardWrap || !svg) return { x: 0, y: 0 };

  const rect = boardWrap.getBoundingClientRect();
  const relX = clientX - rect.left;
  const relY = clientY - rect.top;

  const vb = svg.viewBox.baseVal;
  const scaleX = vb.width / rect.width;
  const scaleY = vb.height / rect.height;

  return {
    x: vb.x + relX * scaleX,
    y: vb.y + relY * scaleY
  };
}

// ---------------------------------------------------------------------------
// Touch gesture handling — pan (1 finger) and pinch-zoom (2 fingers)
// ---------------------------------------------------------------------------
function getTouchDistance(t1, t2) {
  const dx = t2.clientX - t1.clientX;
  const dy = t2.clientY - t1.clientY;
  return Math.hypot(dx, dy);
}

function getTouchMidpoint(t1, t2) {
  return {
    x: (t1.clientX + t2.clientX) / 2,
    y: (t1.clientY + t2.clientY) / 2
  };
}

function setupMobileBoardGestures() {
  const boardWrap = document.getElementById("board-wrap");
  if (!boardWrap) return;

  let mode = null;
  let startPan = null;   // { svgX, svgY } — SVG point under finger at pan start
  let startPinch = null;

  function onTouchStart(evt) {
    if (evt.touches.length === 1) {
      mode = "pan";
      const svgPt = clientToSvgPoint(evt.touches[0].clientX, evt.touches[0].clientY);
      startPan = {
        fingerClient: { x: evt.touches[0].clientX, y: evt.touches[0].clientY },
        panXAtStart: app.boardView.panX,
        panYAtStart: app.boardView.panY
      };
    }

    if (evt.touches.length === 2) {
      mode = "pinch";
      const mid = getTouchMidpoint(evt.touches[0], evt.touches[1]);
      startPinch = {
        distance: getTouchDistance(evt.touches[0], evt.touches[1]),
        scaleAtStart: app.boardView.scale,
        panXAtStart: app.boardView.panX,
        panYAtStart: app.boardView.panY,
        midSvg: clientToSvgPoint(mid.x, mid.y),
        midClient: mid
      };
    }
  }

  function onTouchMove(evt) {
    evt.preventDefault();

    if (mode === "pan" && evt.touches.length === 1 && startPan) {
      const base = app.boardView.baseViewBox;
      const boardWrap = document.getElementById("board-wrap");
      const rect = boardWrap.getBoundingClientRect();

      // How many SVG units per screen pixel at current zoom
      const svgUnitsPerPx = (base.w / app.boardView.scale) / rect.width;

      const dx = evt.touches[0].clientX - startPan.fingerClient.x;
      const dy = evt.touches[0].clientY - startPan.fingerClient.y;

      // Panning right moves the viewport left in SVG space (negative pan)
      app.boardView.panX = startPan.panXAtStart - dx * svgUnitsPerPx;
      app.boardView.panY = startPan.panYAtStart - dy * svgUnitsPerPx;

      applyBoardViewTransform();
    }

    if (mode === "pinch" && evt.touches.length === 2 && startPinch) {
      const newDistance = getTouchDistance(evt.touches[0], evt.touches[1]);
      const rawScale = startPinch.scaleAtStart * (newDistance / startPinch.distance);
      const nextScale = clamp(rawScale, app.boardView.minScale, app.boardView.maxScale);

      // Current midpoint in client space
      const mid = getTouchMidpoint(evt.touches[0], evt.touches[1]);

      // The SVG point under the pinch midpoint should stay fixed.
      // We achieve this by adjusting pan so that midSvg stays under mid.
      const base = app.boardView.baseViewBox;
      const boardWrap = document.getElementById("board-wrap");
      const rect = boardWrap.getBoundingClientRect();

      // What is the SVG unit/px ratio at the NEW scale?
      const svgUnitsPerPxNew = (base.w / nextScale) / rect.width;
      const svgUnitsPerPxNewY = (base.h / nextScale) / rect.height;

      // Mid in screen space relative to board-wrap centre
      const relX = mid.x - rect.left - rect.width / 2;
      const relY = mid.y - rect.top - rect.height / 2;

      // The SVG point under mid at the new scale and pan
      // We want: midSvg.x = baseCx + panX + relX * svgUnitsPerPxNew
      // => panX = midSvg.x - baseCx - relX * svgUnitsPerPxNew
      const baseCx = base.x + base.w / 2;
      const baseCy = base.y + base.h / 2;

      app.boardView.scale = nextScale;
      app.boardView.panX = startPinch.midSvg.x - baseCx - relX * svgUnitsPerPxNew;
      app.boardView.panY = startPinch.midSvg.y - baseCy - relY * svgUnitsPerPxNewY;

      applyBoardViewTransform();
    }
  }

  function onTouchEnd(evt) {
    if (evt.touches.length === 0) {
      mode = null;
      startPan = null;
      startPinch = null;
    } else if (evt.touches.length === 1) {
      // Finger lifted during pinch — switch to pan
      mode = "pan";
      startPan = {
        fingerClient: { x: evt.touches[0].clientX, y: evt.touches[0].clientY },
        panXAtStart: app.boardView.panX,
        panYAtStart: app.boardView.panY
      };
      startPinch = null;
    }
  }

  boardWrap.addEventListener("touchstart", onTouchStart, { passive: false });
  boardWrap.addEventListener("touchmove", onTouchMove, { passive: false });
  boardWrap.addEventListener("touchend", onTouchEnd);
}

// ---------------------------------------------------------------------------
// SVG injection and setup
// ---------------------------------------------------------------------------
async function injectBoardSvg() {
  const host = document.getElementById("board-svg-host");
  const svgText = await loadText("./assets/didcot-dogs-board.v1.svg");
  host.innerHTML = svgText;

  const svg = host.querySelector("svg");
  if (!svg) throw new Error("Injected SVG markup did not contain an <svg> element.");

  svg.removeAttribute("width");
  svg.removeAttribute("height");
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  svg.style.background = "transparent";
  // No CSS transform or willChange — viewBox controls everything now
  svg.style.willChange = "auto";
  svg.style.transform = "";
  return svg;
}

function setupFullscreenButton() {
  const btn = document.getElementById("fullscreen-btn");
  if (!btn) return;

  btn.addEventListener("click", async () => {
    const el = document.documentElement;
    if (!document.fullscreenElement) await el.requestFullscreen();
    else await document.exitFullscreen();
  });
}

function normalizeSvgNodeAliases(svg, rulesData) {
  const aliases = rulesData.svgNodeIdAliases || {};
  Object.entries(aliases).forEach(([fromId, toId]) => {
    const node = svg.querySelector(`#${CSS.escape(fromId)}`);
    if (!node) return;
    node.setAttribute("data-original-id", fromId);
    node.setAttribute("id", toId);
  });
}

function ensureSvgDefs(svg) {
  let defs = svg.querySelector("defs");
  if (!defs) {
    defs = createSvgEl("defs");
    svg.insertBefore(defs, svg.firstChild);
  }

  if (!svg.querySelector("#wild-route-gradient")) {
    const gradient = createSvgEl("linearGradient", {
      id: "wild-route-gradient",
      x1: "0%",
      y1: "0%",
      x2: "100%",
      y2: "0%"
    });

    [
      ["0%", "#ff4d4d"],
      ["18%", "#ff9f1c"],
      ["36%", "#ffe600"],
      ["54%", "#2ec27e"],
      ["72%", "#2f6edb"],
      ["90%", "#c64f8e"],
      ["100%", "#ff4d4d"]
    ].forEach(([offset, color]) => {
      const stop = createSvgEl("stop", { offset, "stop-color": color });
      gradient.appendChild(stop);
    });

    defs.appendChild(gradient);
  }

  if (!svg.querySelector("#claim-gradient-eric")) {
    const claimEric = createSvgEl("linearGradient", {
      id: "claim-gradient-eric",
      gradientUnits: "userSpaceOnUse",
      spreadMethod: "repeat",
      x1: "0",
      y1: "0",
      x2: "40",
      y2: "0"
    });

    [
      ["0%", "#19a7ff"],
      ["90%", "#19a7ff"],
      ["90%", "#ffffff"],
      ["100%", "#ffffff"]
    ].forEach(([offset, color]) => {
      const stop = createSvgEl("stop", { offset, "stop-color": color });
      claimEric.appendChild(stop);
    });

    defs.appendChild(claimEric);
  }

  if (!svg.querySelector("#claim-gradient-tango")) {
    const claimTango = createSvgEl("linearGradient", {
      id: "claim-gradient-tango",
      gradientUnits: "userSpaceOnUse",
      spreadMethod: "repeat",
      x1: "0",
      y1: "0",
      x2: "40",
      y2: "0"
    });

    [
      ["0%", "#ffe600"],
      ["90%", "#ffe600"],
      ["90%", "#ffffff"],
      ["100%", "#ffffff"]
    ].forEach(([offset, color]) => {
      const stop = createSvgEl("stop", { offset, "stop-color": color });
      claimTango.appendChild(stop);
    });

    defs.appendChild(claimTango);
  }
}

let __claimGradientAnimationHandle = null;

function startClaimGradientAnimation(svg) {
  if (__claimGradientAnimationHandle) return;

  const ericGradient = svg.querySelector("#claim-gradient-eric");
  const tangoGradient = svg.querySelector("#claim-gradient-tango");
  if (!ericGradient || !tangoGradient) return;

  const tick = (now) => {
    const shift = -((now / 18) % 40);
    ericGradient.setAttribute("gradientTransform", `translate(${shift} 0)`);
    tangoGradient.setAttribute("gradientTransform", `translate(${shift} 0)`);
    __claimGradientAnimationHandle = requestAnimationFrame(tick);
  };

  __claimGradientAnimationHandle = requestAnimationFrame(tick);
}

function getGroupBBox(group) {
  if (!group || typeof group.getBBox !== "function") return null;
  const bbox = group.getBBox();
  if (!Number.isFinite(bbox.x) || !Number.isFinite(bbox.y) || !Number.isFinite(bbox.width) || !Number.isFinite(bbox.height)) {
    return null;
  }
  return bbox;
}

function unionBBoxes(boxes) {
  const valid = boxes.filter(Boolean);
  if (!valid.length) return null;

  let minX = valid[0].x;
  let minY = valid[0].y;
  let maxX = valid[0].x + valid[0].width;
  let maxY = valid[0].y + valid[0].height;

  for (let i = 1; i < valid.length; i += 1) {
    const box = valid[i];
    minX = Math.min(minX, box.x);
    minY = Math.min(minY, box.y);
    maxX = Math.max(maxX, box.x + box.width);
    maxY = Math.max(maxY, box.y + box.height);
  }

  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function tightenSvgViewBox(svg) {
  const routesGroup = svg.querySelector("#Routes");
  const labelsGroup = svg.querySelector("#Labels");
  const nodesGroup = svg.querySelector("#Nodes");

  const contentBox = unionBBoxes([
    getGroupBBox(routesGroup),
    getGroupBBox(labelsGroup),
    getGroupBBox(nodesGroup)
  ]);

  if (!contentBox) return;

  const paddingX = 68;
  const paddingY = 60;
  const x = contentBox.x - paddingX;
  const y = contentBox.y - paddingY;
  const width = contentBox.width + paddingX * 2;
  const height = contentBox.height + paddingY * 2;

  svg.setAttribute("viewBox", `${x} ${y} ${width} ${height}`);

  // Store the fitted viewBox as base for our pan/zoom system
  app.boardView.baseViewBox = { x, y, w: width, h: height };
}

function getSvgAudit(svg, rulesData) {
  const routesGroup = svg.querySelector("#Routes");
  const nodesGroup = svg.querySelector("#Nodes");

  const routeElements = routesGroup ? Array.from(routesGroup.querySelectorAll("[id]")) : [];
  const nodeElements = nodesGroup ? Array.from(nodesGroup.querySelectorAll("[id]")) : [];

  const routeIds = routeElements.map(el => el.id).filter(Boolean);
  const nodeIds = nodeElements.map(el => el.id).filter(Boolean);

  return {
    routeIds,
    nodeIds,
    routeCount: routeIds.length,
    nodeCount: nodeIds.length,
    missingRuleRoutes: Object.keys(rulesData.routes || {}).filter(routeId => !routeIds.includes(routeId)),
    missingRuleNodes: (rulesData.nodes || []).filter(nodeId => !nodeIds.includes(nodeId))
  };
}

// ---------------------------------------------------------------------------
// Game logic helpers (unchanged from v1.9.5)
// ---------------------------------------------------------------------------
function shuffle(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function parseRouteId(routeId) {
  const parts = routeId.split("_to_");
  if (parts.length !== 2) throw new Error(`Could not parse route ID: ${routeId}`);
  return { a: parts[0], b: parts[1] };
}

function formatNodeName(nodeId) {
  return String(nodeId).replaceAll("_", " ");
}

function formatRouteName(routeId) {
  const { a, b } = parseRouteId(routeId);
  return `${formatNodeName(a)} — ${formatNodeName(b)}`;
}

function routesShareNode(routeIdA, routeIdB) {
  const a = parseRouteId(routeIdA);
  const b = parseRouteId(routeIdB);
  return a.a === b.a || a.a === b.b || a.b === b.a || a.b === b.b;
}

function assignRouteColours(routeIds, palette) {
  const assigned = {};
  const shuffledRoutes = shuffle(routeIds);

  shuffledRoutes.forEach(routeId => {
    const blocked = Object.keys(assigned)
      .filter(otherId => routesShareNode(routeId, otherId))
      .map(otherId => assigned[otherId]);

    const options = shuffle(palette.filter(color => !blocked.includes(color)));
    const fallback = shuffle(palette);
    assigned[routeId] = options[0] || fallback[0];
  });

  return assigned;
}

function rerollSpecificRouteColours(routeIdsToReroll) {
  const palette = app.rulesData.routeColours || [];
  routeIdsToReroll.forEach(routeId => {
    const blocked = Object.keys(app.state.routes)
      .filter(otherId => otherId !== routeId && routesShareNode(routeId, otherId))
      .map(otherId => app.state.routes[otherId].colour);

    const options = shuffle(palette.filter(color => !blocked.includes(color)));
    const fallback = shuffle(palette);
    app.state.routes[routeId].colour = options[0] || fallback[0];
  });
}

function buildDeck(rulesData) {
  const drawColours = rulesData.drawColours || [];
  const copiesPerColour = rulesData.deck?.copiesPerColour ?? 8;
  const rainbowCount = rulesData.deck?.rainbowCount ?? 4;

  const deck = [];
  drawColours.forEach(color => {
    for (let i = 0; i < copiesPerColour; i += 1) deck.push(color);
  });
  for (let i = 0; i < rainbowCount; i += 1) deck.push("rainbow");
  return shuffle(deck);
}

function createPlayerState(startNode) {
  return {
    currentNode: startNode,
    previousNode: null,
    hand: [],
    journeyRouteIds: [],
    destinationQueue: [],
    completedDestinations: [],
    completedCount: 0,
    lastDrawColor: null
  };
}

function createInitialLocalState(rulesData, controlledHero = null) {
  const routeIds = Object.keys(rulesData.routes || {});
  const routeColours = assignRouteColours(routeIds, rulesData.routeColours || []);
  const shuffledDestinations = shuffle(rulesData.destinationPool || []);
  const ericQueue = shuffledDestinations.slice(0, 5);
  const tangoQueue = shuffledDestinations.slice(5, 10);

  const routes = {};
  routeIds.forEach(routeId => {
    routes[routeId] = { colour: routeColours[routeId], claimedBy: null };
  });

  return {
    currentPlayer: controlledHero || "Eric",
    controlledHero,
    gameStarted: Boolean(controlledHero),
    selectedRouteId: null,
    drawPile: buildDeck(rulesData),
    discardPile: [],
    justCompleted: null,
    routes,
    players: {
      Eric: { ...createPlayerState(rulesData.startNode), destinationQueue: ericQueue },
      Tango: { ...createPlayerState(rulesData.startNode), destinationQueue: tangoQueue }
    }
  };
}

function getCurrentTargetForPlayer(player) {
  if (player.completedCount < 5) return player.destinationQueue[player.completedCount] || null;
  return app.rulesData.winCondition?.finalDestinationAfterFive || "Didcot";
}

function getNodeElement(svg, nodeId) {
  return svg.querySelector(`#${CSS.escape(nodeId)}`);
}

function getNodeCenter(svg, nodeId) {
  const el = getNodeElement(svg, nodeId);
  if (!el) throw new Error(`Node not found in SVG: ${nodeId}`);

  if (el.tagName.toLowerCase() === "circle") {
    return { x: Number(el.getAttribute("cx")), y: Number(el.getAttribute("cy")) };
  }

  const box = el.getBBox();
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

function ensureLayer(svg, layerId) {
  let layer = svg.querySelector(`#${CSS.escape(layerId)}`);
  if (layer) return layer;
  layer = createSvgEl("g", { id: layerId });
  svg.appendChild(layer);
  return layer;
}

function ensureTokenDefs(svg) {
  let defs = svg.querySelector("defs");
  if (!defs) {
    defs = createSvgEl("defs");
    svg.insertBefore(defs, svg.firstChild);
  }

  ["Eric", "Tango"].forEach(playerName => {
    const clipId = `token-clip-${playerName}`;
    if (!svg.querySelector(`#${CSS.escape(clipId)}`)) {
      const clipPath = createSvgEl("clipPath", { id: clipId });
      const clipCircle = createSvgEl("circle", { cx: "0", cy: "0", r: "20" });
      clipPath.appendChild(clipCircle);
      defs.appendChild(clipPath);
    }
  });
}

function ensurePlayerToken(svg, playerName) {
  ensureTokenDefs(svg);
  const layer = ensureLayer(svg, "token-layer");
  let group = svg.querySelector(`#token-${CSS.escape(playerName)}`);
  if (group) return group;

  group = createSvgEl("g", {
    id: `token-${playerName}`,
    class: `token-group ${PLAYER_CONFIG[playerName].tokenClass}`
  });

  const wobble = createSvgEl("g", { class: "token-wobble" });

  const circle = createSvgEl("circle", {
    class: "token-circle",
    r: "24",
    fill: "#ffffff"
  });

  const image = createSvgEl("image", {
    x: "-20",
    y: "-20",
    width: "40",
    height: "40",
    preserveAspectRatio: "xMidYMid meet",
    "clip-path": `url(#token-clip-${playerName})`
  });
  image.setAttributeNS(XLINK_NS, "xlink:href", PLAYER_CONFIG[playerName].image);
  image.setAttribute("href", PLAYER_CONFIG[playerName].image);

  wobble.appendChild(circle);
  wobble.appendChild(image);
  group.appendChild(wobble);
  layer.appendChild(group);
  return group;
}

function setTokenPosition(svg, playerName, x, y) {
  const token = ensurePlayerToken(svg, playerName);
  token.setAttribute("transform", `translate(${x}, ${y})`);
}

function getPlayerTokenAnchor(playerName, nodeId) {
  const center = getNodeCenter(app.svg, nodeId);
  const ericNode = app.state.players.Eric.currentNode;
  const tangoNode = app.state.players.Tango.currentNode;

  if (ericNode === tangoNode && nodeId === ericNode) {
    const sideGap = 18;
    return playerName === "Eric"
      ? { x: center.x - sideGap, y: center.y }
      : { x: center.x + sideGap, y: center.y };
  }

  return { x: center.x, y: center.y };
}

function renderTokens() {
  Object.keys(app.state.players).forEach(playerName => {
    const player = app.state.players[playerName];
    const anchor = getPlayerTokenAnchor(playerName, player.currentNode);
    setTokenPosition(app.svg, playerName, anchor.x, anchor.y);
  });
}

function getConnectedNode(routeId, fromNode) {
  const { a, b } = parseRouteId(routeId);
  if (a === fromNode) return b;
  if (b === fromNode) return a;
  return null;
}

function countCards(hand) {
  return hand.reduce((acc, card) => {
    acc[card] = (acc[card] || 0) + 1;
    return acc;
  }, {});
}

function getDisplayRouteColor(routeColor) {
  return routeColor === "grey" ? "wild" : routeColor;
}

function getPaymentOptionsForColor(routeId, playerName, chosenColor = null) {
  const player = app.state.players[playerName];
  const handCounts = countCards(player.hand);
  const rainbowCount = handCounts.rainbow || 0;
  const routeColour = app.state.routes[routeId].colour;
  const cost = app.rulesData.routes[routeId].length;

  const effectiveColor = chosenColor || routeColour;
  const owned = handCounts[effectiveColor] || 0;
  const minRainbow = Math.max(0, cost - owned);
  const maxRainbow = Math.min(rainbowCount, cost);

  const options = [];
  for (let rainbowUse = minRainbow; rainbowUse <= maxRainbow; rainbowUse += 1) {
    const useColourCount = cost - rainbowUse;
    if (useColourCount <= owned) {
      options.push({
        colourChoice: effectiveColor,
        useColourCount,
        useRainbowCount: rainbowUse
      });
    }
  }

  if (routeColour === "grey") {
    const availableColors = (app.rulesData.drawColours || []).filter(color => {
      const count = handCounts[color] || 0;
      return count + rainbowCount >= cost;
    });

    return {
      affordable: availableColors.length > 0,
      isWild: true,
      availableColors,
      options
    };
  }

  return {
    affordable: options.length > 0,
    isWild: false,
    availableColors: [routeColour],
    options
  };
}

function getRoutePlayability(routeId) {
  const currentPlayerName = app.state.currentPlayer;
  const currentPlayer = app.state.players[currentPlayerName];
  const routeState = app.state.routes[routeId];
  const connectedNode = getConnectedNode(routeId, currentPlayer.currentNode);

  if (!connectedNode) return { playable: false, reason: "Route does not connect to current node." };
  if (routeState.claimedBy) return { playable: false, reason: `Already claimed by ${routeState.claimedBy}.` };
  if (currentPlayer.previousNode && connectedNode === currentPlayer.previousNode) {
    return { playable: false, reason: "Cannot move straight back to previous node." };
  }

  const payment = getPaymentOptionsForColor(routeId, currentPlayerName);
  if (!payment.affordable) {
    return { playable: false, reason: "Not enough matching cards.", targetNode: connectedNode };
  }

  return { playable: true, targetNode: connectedNode, payment };
}

function drawCard() {
  if (!app.state.drawPile.length) {
    if (!app.state.discardPile.length) return null;
    app.state.drawPile = shuffle(app.state.discardPile);
    app.state.discardPile = [];
  }
  return app.state.drawPile.pop();
}

function removeSpecificCardsFromHand(hand, colourChoice, useColourCount, useRainbowCount) {
  const nextHand = [...hand];
  let colourLeft = useColourCount;
  let rainbowLeft = useRainbowCount;
  const spent = [];

  for (let i = nextHand.length - 1; i >= 0 && colourLeft > 0; i -= 1) {
    if (nextHand[i] === colourChoice) {
      spent.push(nextHand[i]);
      nextHand.splice(i, 1);
      colourLeft -= 1;
    }
  }

  for (let i = nextHand.length - 1; i >= 0 && rainbowLeft > 0; i -= 1) {
    if (nextHand[i] === "rainbow") {
      spent.push(nextHand[i]);
      nextHand.splice(i, 1);
      rainbowLeft -= 1;
    }
  }

  return { nextHand, spent };
}

function endTurn() {
  app.state.selectedRouteId = null;
  closeRouteModal();

  if (app.state.controlledHero) {
    app.state.currentPlayer = app.state.controlledHero;
  } else {
    app.state.currentPlayer = app.state.currentPlayer === "Eric" ? "Tango" : "Eric";
  }

  renderAll();
}

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function getRouteTravelDirection(routeEl, fromNode, toNode, routeId) {
  const total = routeEl.getTotalLength();
  const startPoint = routeEl.getPointAtLength(0);
  const endPoint = routeEl.getPointAtLength(total);

  const fromCenter = getNodeCenter(app.svg, fromNode);
  const toCenter = getNodeCenter(app.svg, toNode);

  const startToFrom = Math.hypot(startPoint.x - fromCenter.x, startPoint.y - fromCenter.y);
  const endToFrom = Math.hypot(endPoint.x - fromCenter.x, endPoint.y - fromCenter.y);
  const startToTo = Math.hypot(startPoint.x - toCenter.x, startPoint.y - toCenter.y);
  const endToTo = Math.hypot(endPoint.x - toCenter.x, endPoint.y - toCenter.y);

  if (startToFrom <= endToFrom && endToTo <= startToTo) return true;
  if (endToFrom < startToFrom && startToTo < endToTo) return false;

  const parsed = parseRouteId(routeId);
  return parsed.a === fromNode && parsed.b === toNode;
}

function animateTokenAlongRoute(playerName, routeId, fromNode, toNode) {
  return new Promise(resolve => {
    const routeEl = app.svg.querySelector(`#${CSS.escape(routeId)}`);
    if (!routeEl || typeof routeEl.getTotalLength !== "function") {
      renderTokens();
      resolve();
      return;
    }

    const token = ensurePlayerToken(app.svg, playerName);
    const total = routeEl.getTotalLength();
    const duration = 900;
    const forward = getRouteTravelDirection(routeEl, fromNode, toNode, routeId);
    const start = performance.now();

    function step(now) {
      const elapsed = now - start;
      const progress = Math.min(1, elapsed / duration);
      const eased = easeInOutCubic(progress);
      const routeProgress = forward ? eased : 1 - eased;
      const point = routeEl.getPointAtLength(total * routeProgress);

      let x = point.x;
      let y = point.y;

      const otherPlayer = playerName === "Eric" ? "Tango" : "Eric";
      if (app.state.players[otherPlayer].currentNode === toNode) {
        if (playerName === "Eric") x -= 18;
        if (playerName === "Tango") x += 18;
      }

      token.setAttribute("transform", `translate(${x}, ${y})`);

      if (progress < 1) requestAnimationFrame(step);
      else resolve();
    }

    requestAnimationFrame(step);
  });
}

// Toast priority levels — only NOTABLE events show the mobile toast
const TOAST_NOTABLE = Symbol("notable");
const TOAST_SILENT  = Symbol("silent");

let __toastTimer = null;

function updateStatus(text, priority = TOAST_SILENT) {
  // Always update desktop chip
  const chip = document.getElementById("status-chip");
  if (chip) chip.textContent = text;

  // Mobile toast — only show notable events
  if (priority === TOAST_NOTABLE) {
    showMobileToast(text);
  }
}

function showMobileToast(text) {
  let toast = document.getElementById("mobile-toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "mobile-toast";
    toast.className = "mobile-toast";
    // Insert after mobile-hud in game-shell
    const hud = document.getElementById("mobile-hud");
    if (hud && hud.parentNode) {
      hud.parentNode.insertBefore(toast, hud.nextSibling);
    } else {
      document.getElementById("game-shell").appendChild(toast);
    }
  }

  toast.textContent = text;
  toast.classList.remove("mobile-toast-hide");
  toast.classList.add("mobile-toast-show");

  if (__toastTimer) clearTimeout(__toastTimer);
  __toastTimer = setTimeout(() => {
    toast.classList.remove("mobile-toast-show");
    toast.classList.add("mobile-toast-hide");
  }, 2000);
}

function ensureRouteCostLayer() {
  return ensureLayer(app.svg, "route-cost-layer");
}

function handleRouteSelection(routeId) {
  app.state.selectedRouteId = routeId;
  renderAll();
  handleRouteHover(routeId);
  openRouteModal(routeId);
}

function renderRouteCostBadges() {
  const layer = ensureRouteCostLayer();
  layer.innerHTML = "";

  Object.keys(app.rulesData.routes || {}).forEach(routeId => {
    const routeEl = app.svg.querySelector(`#${CSS.escape(routeId)}`);
    if (!routeEl || app.state.routes[routeId].claimedBy) return;
    if (typeof routeEl.getTotalLength !== "function") return;

    const len = routeEl.getTotalLength();
    const mid = routeEl.getPointAtLength(len / 2);
    const routeColour = app.state.routes[routeId].colour;
    const isWild = routeColour === "grey";
    const hex = ROUTE_COLOUR_HEX[routeColour] || "#7a7a7a";
    const cost = app.rulesData.routes[routeId].length;

    const group = createSvgEl("g", {
      class: "route-cost-badge",
      transform: `translate(${mid.x}, ${mid.y})`,
      "data-route-id": routeId
    });
    group.style.cursor = "pointer";

    const circle = createSvgEl("circle", {
      r: "12",
      fill: "#ffffff",
      stroke: isWild ? "#c64f8e" : hex
    });

    const text = createSvgEl("text", {
      x: "0",
      y: "0",
      fill: isWild ? "#c64f8e" : hex,
      "text-anchor": "middle",
      "dominant-baseline": "middle",
      "alignment-baseline": "middle"
    });
    text.textContent = String(cost);
    text.setAttribute("dy", "0.02em");

    group.appendChild(circle);
    group.appendChild(text);

    group.addEventListener("click", evt => {
      evt.stopPropagation();
      handleRouteSelection(routeId);
    });

    group.addEventListener("mouseenter", evt => {
      evt.stopPropagation();
      handleRouteHover(routeId);
    });

    group.addEventListener("mouseleave", () => {
      updateStatus("Choose one action: draw a card or click a route to play it.");
    });

    layer.appendChild(group);
  });
}

function renderRoutes() {
  const routeIds = Object.keys(app.rulesData.routes || {});
  const selectedRouteId = app.state.selectedRouteId;

  routeIds.forEach(routeId => {
    const routeEl = app.svg.querySelector(`#${CSS.escape(routeId)}`);
    if (!routeEl) return;

    routeEl.classList.remove("route-claimed-eric", "route-claimed-tango", "route-eligible", "route-selected", "route-blocked");

    const routeState = app.state.routes[routeId];
    const routeColor = routeState.colour;
    const baseColour = ROUTE_COLOUR_HEX[routeColor] || "#7a7a7a";

    routeEl.style.strokeWidth = "8";
    routeEl.style.cursor = "pointer";
    routeEl.style.stroke = routeColor === "grey" ? "url(#wild-route-gradient)" : baseColour;

    if (routeState.claimedBy) {
      routeEl.classList.add(PLAYER_CONFIG[routeState.claimedBy].routeClass);
      return;
    }

    const playability = getRoutePlayability(routeId);

    if (playability.playable) {
      routeEl.classList.add("route-eligible");
    } else if (
      playability.reason !== "Route does not connect to current node." &&
      !getConnectedNode(routeId, app.state.players[app.state.currentPlayer].currentNode)
    ) {
      routeEl.classList.add("route-blocked");
    }

    if (selectedRouteId === routeId) {
      routeEl.classList.add("route-selected");
    }
  });

  renderRouteCostBadges();
}

function renderTurnBadge() {
  const badge = document.getElementById("turn-player-badge");
  if (!badge) return;
  badge.className = `player-badge ${PLAYER_CONFIG[app.state.currentPlayer].badgeClass}`;
  badge.textContent = `${app.state.currentPlayer} to play`;
}

function renderCounts() {
  const drawEl = document.getElementById("draw-pile-count");
  const discardEl = document.getElementById("discard-pile-count");
  if (drawEl) drawEl.textContent = app.state.drawPile.length;
  if (discardEl) discardEl.textContent = app.state.discardPile.length;
}

function renderSelectedRouteCard() {
  const card = document.getElementById("selected-route-card");
  if (!card) return;

  const routeId = app.state.selectedRouteId;
  card.className = "selected-route-card";

  if (!routeId) {
    card.textContent = "No route selected.";
    return;
  }

  const routeColour = getDisplayRouteColor(app.state.routes[routeId].colour);
  const cost = app.rulesData.routes[routeId].length;
  const playability = getRoutePlayability(routeId);

  if (playability.playable) {
    card.classList.add("valid");
    card.innerHTML = `
      <strong>${formatRouteName(routeId)}</strong><br>
      Colour: ${routeColour}<br>
      Cost: ${cost}<br>
      Destination node if played: ${formatNodeName(playability.targetNode)}
    `;
  } else {
    card.classList.add("invalid");
    card.innerHTML = `
      <strong>${formatRouteName(routeId)}</strong><br>
      Colour: ${routeColour}<br>
      Cost: ${cost}<br>
      ${playability.reason}
    `;
  }
}

function getHandStacks(hand) {
  const counts = countCards(hand);
  const order = ["red", "orange", "blue", "green", "black", "pink", "yellow", "rainbow"];
  return order
    .filter(color => (counts[color] || 0) > 0)
    .map(color => ({ color, count: counts[color] }));
}

function renderHandInto(container, player, cls = "hand-card") {
  container.innerHTML = "";
  const stacks = getHandStacks(player.hand);

  if (!stacks.length) {
    const empty = document.createElement("div");
    empty.className = "panel-copy";
    empty.textContent = "No cards yet.";
    container.appendChild(empty);
    return;
  }

  stacks.forEach(stack => {
    const el = document.createElement("div");
    el.className = `${cls} ${stack.color}`;
    if (player.lastDrawColor === stack.color && cls === "hand-card") {
      el.classList.add("draw-in");
    }
    if (player.lastDrawColor === stack.color && cls === "mobile-hand-peek-card") {
      el.style.setProperty("--glow-colour", GLOW_COLOURS[stack.color] || "rgba(255,255,255,0.7)");
      el.classList.add("card-glow-steady");
    }
    el.innerHTML = `
      <div class="card-name">${stack.color}</div>
      <div class="card-count">${stack.count}</div>
    `;
    container.appendChild(el);
  });
}

function renderActiveHand() {
  const wrap = document.getElementById("active-hand");
  if (!wrap) return;
  const player = app.state.players[app.state.currentPlayer];
  renderHandInto(wrap, player, "hand-card");
  player.lastDrawColor = null;
}

function renderPlayerSummary() {
  const wrap = document.getElementById("player-summary-wrap");
  if (!wrap) return;

  wrap.innerHTML = "";

  ["Eric", "Tango"].forEach(playerName => {
    const player = app.state.players[playerName];
    const target = getCurrentTargetForPlayer(player);
    const card = document.createElement("div");
    card.className = `player-summary-card${app.state.currentPlayer === playerName ? " active" : ""}`;
    card.innerHTML = `
      <div class="player-summary-name">${playerName}</div>
      <div class="player-summary-meta">
        Current node: ${formatNodeName(player.currentNode)}<br>
        Previous node: ${player.previousNode ? formatNodeName(player.previousNode) : "—"}<br>
        Hand size: ${player.hand.length}<br>
        Completed: ${Math.min(player.completedCount, 5)}/5<br>
        Active target: ${target ? formatNodeName(target) : "—"}
      </div>
    `;
    wrap.appendChild(card);
  });
}

function createDestinationActiveCard(title, body, flip = false) {
  const el = document.createElement("div");
  el.className = "destination-card active-card";
  if (flip) el.classList.add("flip-in");
  el.innerHTML = `
    <div class="destination-title">${title}</div>
    <div class="destination-body">${body}</div>
  `;
  return el;
}

function createDestinationQuestionCard() {
  const el = document.createElement("div");
  el.className = "destination-card hidden-card";
  el.textContent = "?";
  return el;
}

function createDestinationCompletedCard(title) {
  const el = document.createElement("div");
  el.className = "destination-card completed-card";
  el.innerHTML = `<div class="destination-title">✓ ${title}</div>`;
  return el;
}

function buildDestinationSequenceElement(playerName, showFlip = true) {
  const player = app.state.players[playerName];
  const sequence = document.createElement("div");
  sequence.className = "destination-sequence";

  const title = document.createElement("div");
  title.className = "sequence-title";
  title.textContent = `${playerName} routes`;

  const grid = document.createElement("div");
  grid.className = "destination-card-grid";

  for (let i = 0; i < 5; i += 1) {
    const destinationId = player.destinationQueue[i];
    const destination = app.destinationData.destinations[destinationId];
    const label = destination ? destination.title : formatNodeName(destinationId);
    const body = destination?.description || "";

    if (i < player.completedCount) {
      grid.appendChild(createDestinationCompletedCard(label));
    } else if (i === player.completedCount && player.completedCount < 5) {
      const shouldFlip = showFlip && app.state.justCompleted?.playerName === playerName;
      grid.appendChild(createDestinationActiveCard(label, body, shouldFlip));
    } else {
      grid.appendChild(createDestinationQuestionCard());
    }
  }

  sequence.appendChild(title);
  sequence.appendChild(grid);
  return sequence;
}

function renderDestinationSequences() {
  const wrap = document.getElementById("destination-sequences");
  if (!wrap) return;
  wrap.innerHTML = "";
  wrap.appendChild(buildDestinationSequenceElement(app.state.currentPlayer, true));
}

function renderTargetPulse() {
  app.svg.querySelectorAll(".target-node-pulse").forEach(el => el.classList.remove("target-node-pulse"));

  const targetNodeId = getCurrentTargetForPlayer(app.state.players[app.state.currentPlayer]);
  if (!targetNodeId) return;

  const targetEl = getNodeElement(app.svg, targetNodeId);
  if (targetEl) targetEl.classList.add("target-node-pulse");
}

function renderDebug(audit) {
  const leftDebug = document.getElementById("left-debug");
  if (!leftDebug) return;

  leftDebug.innerHTML = `
    <div class="debug-list">
      <div><strong>Version:</strong> ${APP_VERSION}</div>
      <div><strong>Local hero:</strong> ${app.state.controlledHero || "not chosen"}</div>
      <div><strong>Current player:</strong> ${app.state.currentPlayer}</div>
      <div><strong>Total SVG nodes:</strong> ${audit.nodeCount}</div>
      <div><strong>Total SVG routes:</strong> ${audit.routeCount}</div>
      <div><strong>Missing rule nodes:</strong> ${audit.missingRuleNodes.length}</div>
      <div><strong>Missing rule routes:</strong> ${audit.missingRuleRoutes.length}</div>
    </div>
  `;
}

function openMobileSheet() {
  const sheet = document.getElementById("mobile-sheet");
  if (sheet && sheet.classList.contains("visible-shell")) sheet.classList.add("expanded");
}

function closeMobileSheet() {
  const sheet = document.getElementById("mobile-sheet");
  if (sheet) sheet.classList.remove("expanded");
}

function toggleMobileSheet() {
  const sheet = document.getElementById("mobile-sheet");
  if (!sheet || !sheet.classList.contains("visible-shell")) return;
  sheet.classList.toggle("expanded");
}


// ─── CARD PILE VISUALS ────────────────────────────────────────────────────────

const CARD_COLOUR_HEX_MAP = {
  red:     ["#f3a3a3", "#d74b4b"],
  orange:  ["#f2bf95", "#db7f2f"],
  blue:    ["#8ab5ff", "#2f6edb"],
  green:   ["#72c78e", "#1e8b4c"],
  black:   ["#5b5b5b", "#1d1d1d"],
  pink:    ["#ef9cc3", "#c64f8e"],
  yellow:  ["#f0dd67", "#d6b300"],
  rainbow: ["#f3a3a3", "#8ab5ff"]
};

const PAW_SVG = `<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg" style="width:18px;height:18px;opacity:0.22">
  <ellipse cx="20" cy="26" rx="9" ry="7" fill="white"/>
  <ellipse cx="11" cy="19" rx="4.5" ry="3.5" fill="white"/>
  <ellipse cx="29" cy="19" rx="4.5" ry="3.5" fill="white"/>
  <ellipse cx="15" cy="13" rx="3.5" ry="2.8" fill="white"/>
  <ellipse cx="25" cy="13" rx="3.5" ry="2.8" fill="white"/>
</svg>`;

// Stable rotation from a string seed (so discard rotations don't jitter on re-render)
function seededRotation(seed, index) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (Math.imul(31, h) + seed.charCodeAt(i)) | 0;
  const angles = [-14, -8, -4, 4, 9, 15];
  return angles[Math.abs(h + index) % angles.length];
}

function renderDrawPile(container, count) {
  container.innerHTML = "";

  const wrapper = document.createElement("div");
  wrapper.className = "pile-wrap";

  // Stack of 3 face-down cards (or fewer if pile small)
  const stackCount = Math.min(count, 3);
  for (let i = 0; i < stackCount; i++) {
    const card = document.createElement("div");
    card.className = "pile-card pile-card-back";
    card.style.setProperty("--pile-offset", `${i * -2}px`);
    card.style.setProperty("--pile-rot", `${(i - 1) * 3}deg`);
    if (i === stackCount - 1) {
      // Top card gets the paw
      card.innerHTML = PAW_SVG;
    }
    wrapper.appendChild(card);
  }

  if (count === 0) {
    const empty = document.createElement("div");
    empty.className = "pile-card pile-card-empty";
    wrapper.appendChild(empty);
  }

  // Count badge
  const badge = document.createElement("div");
  badge.className = "pile-badge";
  badge.textContent = count;
  wrapper.appendChild(badge);

  const label = document.createElement("div");
  label.className = "pile-label";
  label.textContent = "Draw";
  wrapper.appendChild(label);

  container.appendChild(wrapper);
}

function renderDiscardPile(container, discardPile) {
  container.innerHTML = "";

  const wrapper = document.createElement("div");
  wrapper.className = "pile-wrap";

  const count = discardPile.length;
  const topCards = discardPile.slice(-3); // newest at end = top of visual stack

  if (count === 0) {
    const empty = document.createElement("div");
    empty.className = "pile-card pile-card-empty";
    wrapper.appendChild(empty);
  } else {
    topCards.forEach((colour, i) => {
      const card = document.createElement("div");
      card.className = "pile-card pile-card-face";
      const rot = seededRotation(colour + i, i);
      card.style.setProperty("--pile-rot", `${rot}deg`);
      card.style.setProperty("--pile-offset", `${i * -1}px`);
      const colours = CARD_COLOUR_HEX_MAP[colour] || ["#5b5b5b", "#1d1d1d"];
      if (colour === "rainbow") {
        card.style.background = "linear-gradient(135deg, #f3a3a3 0%, #f0dd67 25%, #72c78e 50%, #8ab5ff 75%, #ef9cc3 100%)";
      } else {
        card.style.background = `linear-gradient(180deg, ${colours[0]} 0%, ${colours[1]} 100%)`;
      }
      // No label on discard cards — colour is visible from the gradient
      wrapper.appendChild(card);
    });
  }

  const badge = document.createElement("div");
  badge.className = "pile-badge pile-badge-discard";
  badge.textContent = count;
  wrapper.appendChild(badge);

  const label = document.createElement("div");
  label.className = "pile-label";
  label.textContent = "Discard";
  wrapper.appendChild(label);

  container.appendChild(wrapper);
}

function renderMobileRoutesPanel() {
  const hudTurn = document.getElementById("mobile-hud-turn");
  const hudDraw = document.getElementById("mobile-hud-draw");
  const hudDestination = document.getElementById("mobile-hud-destination");
  const drawBtn = document.getElementById("mobile-open-sheet-btn");
  const routesBtn = document.getElementById("mobile-reset-view-btn");
  const sheetSummary = document.getElementById("mobile-sheet-summary");
  const sheetSelectedRoute = document.getElementById("mobile-sheet-selected-route");
  const sheetActions = document.getElementById("mobile-sheet-actions");
  const sheetHand = document.getElementById("mobile-sheet-hand");
  const sheetDestination = document.getElementById("mobile-sheet-destination");
  const handPeek = document.getElementById("mobile-hand-peek");

  if (!hudTurn || !hudDraw || !hudDestination || !drawBtn || !routesBtn || !sheetSummary || !sheetSelectedRoute || !sheetActions || !sheetHand || !sheetDestination || !handPeek) {
    return;
  }

  const currentPlayerName = app.state.currentPlayer;
  const currentPlayer = app.state.players[currentPlayerName];
  const currentTargetId = getCurrentTargetForPlayer(currentPlayer);
  const currentTargetTitle = currentTargetId
    ? (app.destinationData.destinations[currentTargetId]?.title || formatNodeName(currentTargetId))
    : "—";

  hudTurn.textContent = `${currentPlayerName}`;

  // Visual pile stacks replace the text draw counter
  renderDrawPile(hudDraw, app.state.drawPile.length);
  renderDiscardPile(
    document.getElementById("mobile-hud-discard") || hudDraw,
    app.state.discardPile
  );

  // Render into dedicated discard container if it exists
  const discardEl = document.getElementById("mobile-hud-discard");
  if (discardEl) renderDiscardPile(discardEl, app.state.discardPile);

  // Destination pill — show progress badge + target name
  const completedCount = Math.min(currentPlayer.completedCount, 5);
  hudDestination.innerHTML = `
    <span class="hud-dest-progress">${completedCount}/5</span>
    <span class="hud-dest-label">▸ ${currentTargetTitle}</span>
  `;
  hudDestination.dataset.complete = completedCount >= 5 ? "true" : "false";

  drawBtn.textContent = "Draw card";
  routesBtn.textContent = "Routes";

  // Chevron hint above hand strip
  const bar = document.getElementById("mobile-bottom-bar");
  if (bar && !bar.querySelector(".hand-chevron")) {
    const chev = document.createElement("div");
    chev.className = "hand-chevron";
    chev.innerHTML = "&#8964;";
    bar.insertBefore(chev, bar.firstChild);
  }

  sheetSummary.innerHTML = `
    <div class="player-summary-card active">
      <div class="player-summary-name">${currentPlayerName}</div>
      <div class="player-summary-meta">
        Current: ${formatNodeName(currentPlayer.currentNode)}<br>
        Previous: ${currentPlayer.previousNode ? formatNodeName(currentPlayer.previousNode) : "—"}<br>
        Completed: ${Math.min(currentPlayer.completedCount, 5)}/5<br>
        Target: ${currentTargetTitle}
      </div>
    </div>
  `;

  sheetSelectedRoute.innerHTML = "";
  sheetActions.innerHTML = "";
  sheetHand.innerHTML = "";
  sheetDestination.innerHTML = "";
  sheetDestination.appendChild(buildDestinationSequenceElement(currentPlayerName, false));

  handPeek.innerHTML = "";
  renderHandInto(handPeek, currentPlayer, "mobile-hand-peek-card");
}

function buildSpendPreviewCards(option) {
  const items = [];
  for (let i = 0; i < option.useColourCount; i += 1) items.push(option.colourChoice);
  for (let i = 0; i < option.useRainbowCount; i += 1) items.push("rainbow");
  return items;
}

function renderButtons() {
  const drawBtn = document.getElementById("draw-card-btn");
  if (drawBtn) drawBtn.disabled = false;
}

function renderAll() {
  renderTurnBadge();
  renderCounts();
  renderSelectedRouteCard();
  renderActiveHand();
  renderPlayerSummary();
  renderDestinationSequences();
  renderRoutes();
  renderTokens();
  renderTargetPulse();
  renderDebug(app.audit);
  renderButtons();
  renderMobileRoutesPanel();
}

function buildCardChoiceEl(color, active = false) {
  const card = document.createElement("button");
  card.type = "button";
  card.className = `route-colour-choice-card ${color}${active ? " active" : ""}`;
  card.textContent = color === "rainbow" ? "rainbow" : color;
  return card;
}

function renderRouteModalOptionStage() {
  const routeId = app.modal.routeId;
  const body = document.getElementById("route-modal-body");
  const subtitle = document.getElementById("route-modal-subtitle");
  const confirmBtn = document.getElementById("route-modal-confirm");

  body.innerHTML = "";
  confirmBtn.disabled = app.modal.selectedOptionIndex === null;

  subtitle.textContent = `Choose how to pay for ${formatRouteName(routeId)}.`;

  const optionList = document.createElement("div");
  optionList.className = "route-option-list";

  app.modal.options.forEach((option, index) => {
    const row = document.createElement("button");
    row.className = `route-option-row${app.modal.selectedOptionIndex === index ? " active" : ""}`;
    row.type = "button";

    const rowLabel = document.createElement("div");
    rowLabel.className = "route-option-row-label";
    rowLabel.textContent = `Option ${index + 1}`;

    const rowCards = document.createElement("div");
    rowCards.className = "route-option-row-cards";

    buildSpendPreviewCards(option).forEach(cardColor => {
      const card = document.createElement("div");
      card.className = `route-spend-card ${cardColor}`;
      card.textContent = cardColor;
      rowCards.appendChild(card);
    });

    row.appendChild(rowLabel);
    row.appendChild(rowCards);

    row.addEventListener("click", () => {
      app.modal.selectedOptionIndex = index;
      renderRouteModalOptionStage();
    });

    optionList.appendChild(row);
  });

  body.appendChild(optionList);
  confirmBtn.disabled = app.modal.selectedOptionIndex === null;
}

function openRouteModal(routeId) {
  const playability = getRoutePlayability(routeId);
  if (!playability.playable) {
    // Only toast affordability / connectivity errors, not hover noise
    const isBlocker = playability.reason.includes("enough") || playability.reason.includes("connect");
    updateStatus(playability.reason, isBlocker ? TOAST_NOTABLE : TOAST_SILENT);
    return;
  }

  app.modal.routeId = routeId;
  app.modal.selectedOptionIndex = null;
  app.modal.chosenColor = null;

  const overlay = document.getElementById("route-modal-overlay");
  const title = document.getElementById("route-modal-title");
  const subtitle = document.getElementById("route-modal-subtitle");
  const body = document.getElementById("route-modal-body");
  const confirmBtn = document.getElementById("route-modal-confirm");

  title.textContent = formatRouteName(routeId);
  body.innerHTML = "";
  confirmBtn.disabled = true;

  // Cost banner — route name + cost prominently at top of body
  const routeColor = app.state.routes[routeId].colour;
  const routeCost = app.rulesData.routes[routeId].length;
  const bannerColour = routeColor === "grey" ? "wild" : routeColor;
  const banner = document.createElement("div");
  banner.className = "route-modal-cost-banner";
  banner.innerHTML = `
    <span><strong>${formatRouteName(routeId)}</strong><br>
    <span style="font-size:13px;opacity:0.7">${bannerColour} route</span></span>
    <span class="route-modal-cost-pip">${routeCost}</span>
  `;
  body.appendChild(banner);

  if (routeColor === "grey") {
    const payment = getPaymentOptionsForColor(routeId, app.state.currentPlayer);
    subtitle.textContent = "Wild route. Choose a colour you want to play with.";

    const row = document.createElement("div");
    row.className = "route-colour-card-row";

    payment.availableColors.forEach(color => {
      const card = buildCardChoiceEl(color, app.modal.chosenColor === color);
      card.addEventListener("click", () => {
        app.modal.chosenColor = color;
        app.modal.options = getPaymentOptionsForColor(routeId, app.state.currentPlayer, color).options;
        app.modal.selectedOptionIndex = null;
        renderRouteModalOptionStage();
      });
      row.appendChild(card);
    });

    body.appendChild(row);
  } else {
    app.modal.chosenColor = routeColor;
    app.modal.options = getPaymentOptionsForColor(routeId, app.state.currentPlayer, routeColor).options;
    renderRouteModalOptionStage();
  }

  overlay.classList.add("open");
}

function closeRouteModal() {
  document.getElementById("route-modal-overlay").classList.remove("open");
  app.modal.routeId = null;
  app.modal.chosenColor = null;
  app.modal.selectedOptionIndex = null;
  app.modal.options = [];
}

async function confirmRouteModalPlay() {
  if (!app.modal.routeId || app.modal.selectedOptionIndex === null) return;

  const routeId = app.modal.routeId;
  const chosenPayment = app.modal.options[app.modal.selectedOptionIndex];
  const currentPlayerName = app.state.currentPlayer;
  const currentPlayer = app.state.players[currentPlayerName];
  const playability = getRoutePlayability(routeId);

  if (!playability.playable) {
    closeRouteModal();
    renderAll();
    updateStatus(playability.reason);
    return;
  }

  const handResult = removeSpecificCardsFromHand(
    currentPlayer.hand,
    chosenPayment.colourChoice,
    chosenPayment.useColourCount,
    chosenPayment.useRainbowCount
  );

  currentPlayer.hand = handResult.nextHand;
  app.state.discardPile.push(...handResult.spent);

  const fromNode = currentPlayer.currentNode;
  const toNode = getConnectedNode(routeId, fromNode);

  app.state.routes[routeId].claimedBy = currentPlayerName;
  currentPlayer.previousNode = fromNode;
  currentPlayer.currentNode = toNode;
  currentPlayer.journeyRouteIds.push(routeId);

  app.state.selectedRouteId = null;
  closeRouteModal();
  renderAll();
  updateStatus(`${currentPlayerName} → ${formatNodeName(toNode)}`, TOAST_NOTABLE);

  await animateTokenAlongRoute(currentPlayerName, routeId, fromNode, toNode);
  completeDestinationIfNeeded(currentPlayerName);
  renderAll();

  if (!app.state.controlledHero) {
    endTurn();
  }
}

function showStartToast(playerName) {
  // Build or reuse the identity card overlay
  let card = document.getElementById("identity-card");
  if (!card) {
    card = document.createElement("div");
    card.id = "identity-card";
    card.className = "identity-card";
    document.getElementById("game-shell").appendChild(card);
  }

  const cfg = PLAYER_CONFIG[playerName];
  card.innerHTML = `
    <div class="identity-wipe"></div>
    <div class="identity-inner">
      <div class="identity-kicker">YOU ARE</div>
      <div class="identity-portrait-wrap">
        <img class="identity-portrait" src="${cfg.image}" alt="${playerName}">
      </div>
      <div class="identity-name">${playerName.toUpperCase()}</div>
    </div>
  `;

  card.classList.remove("identity-out");
  card.classList.add("identity-in");

  window.setTimeout(() => {
    card.classList.remove("identity-in");
    card.classList.add("identity-out");
  }, 1800);
}

function openDestinationReveal(title, body, destinationNumber = null) {
  const prefix = destinationNumber ? `Destination #${destinationNumber}` : "Destination";
  document.getElementById("destination-reveal-title").textContent = `${prefix} — ${title}`;
  document.getElementById("destination-reveal-body").textContent = body;
  document.getElementById("destination-reveal-overlay").classList.add("open");
}

function closeDestinationReveal() {
  document.getElementById("destination-reveal-overlay").classList.remove("open");
}

function showCurrentDestinationReveal(playerName) {
  const player = app.state.players[playerName];
  const target = getCurrentTargetForPlayer(player);
  if (!target || player.completedCount >= 5) return;

  const destination = app.destinationData.destinations[target];
  const title = destination?.title || formatNodeName(target);
  const body = destination?.description || "";
  openDestinationReveal(title, body, player.completedCount + 1);
}

function startGameAs(playerName) {
  app.state = createInitialLocalState(app.rulesData, playerName);
  document.getElementById("hero-overlay").classList.remove("active");
  showMobileHud();   // only show after hero chosen — hides during pick screen
  resetBoardView();
  showStartToast(playerName);
  renderAll();
  showCurrentDestinationReveal(playerName);
  updateStatus(`${playerName} begins. Choose one action: draw a card or click a route to play it.`);
}

function completeDestinationIfNeeded(playerName) {
  const player = app.state.players[playerName];
  const target = getCurrentTargetForPlayer(player);

  if (!target || player.currentNode !== target) {
    app.state.justCompleted = null;
    return false;
  }

  app.state.justCompleted = { playerName, destinationId: target };

  if (player.completedCount < 5) {
    player.completedDestinations.push(target);
    player.completedCount += 1;
  } else {
    player.completedCount += 1;
  }

  const releasedRoutes = [...player.journeyRouteIds];
  releasedRoutes.forEach(routeId => {
    app.state.routes[routeId].claimedBy = null;
  });
  rerollSpecificRouteColours(releasedRoutes);

  player.journeyRouteIds = [];
  player.previousNode = null;

  if (player.completedCount > 5) {
    updateStatus(`${playerName} wins!`, TOAST_NOTABLE);
    setTimeout(() => showEndScreen(playerName), 800);
  } else {
    const nextTarget = getCurrentTargetForPlayer(player);
    if (player.completedCount >= 5) {
      updateStatus(`Five done! Head to ${formatNodeName(nextTarget)}`, TOAST_NOTABLE);
    } else {
      const nextDestination = app.destinationData.destinations[nextTarget];
      updateStatus(`✓ ${formatNodeName(target)}! Next: ${formatNodeName(nextTarget)}`, TOAST_NOTABLE);
      openDestinationReveal(
        nextDestination?.title || formatNodeName(nextTarget),
        nextDestination?.description || "",
        player.completedCount + 1
      );
    }
  }

  return true;
}


// ─── FLYING CARD ANIMATION ────────────────────────────────────────────────────
// Reads pixel positions of draw pile and hand strip, creates a fixed overlay
// card that animates from pile to hand, flipping face-up mid-flight.

const GLOW_COLOURS = {
  red:     "rgba(215,75,75,0.9)",
  orange:  "rgba(219,127,47,0.9)",
  blue:    "rgba(47,110,219,0.9)",
  green:   "rgba(30,139,76,0.9)",
  black:   "rgba(120,120,120,0.8)",
  pink:    "rgba(198,79,142,0.9)",
  yellow:  "rgba(214,179,0,0.9)",
  rainbow: "rgba(255,255,255,0.7)"
};

function getDrawPileRect() {
  const el = document.getElementById("mobile-hud-draw");
  if (!el) return null;
  const wrap = el.querySelector(".pile-wrap");
  return (wrap || el).getBoundingClientRect();
}

function getHandTargetRect(colour) {
  // Find the card in the peek strip matching this colour
  const peek = document.getElementById("mobile-hand-peek");
  if (!peek) return null;
  const cards = peek.querySelectorAll(".mobile-hand-peek-card");
  for (const card of cards) {
    if (card.classList.contains(colour)) return card.getBoundingClientRect();
  }
  // Fallback: bottom-centre of screen
  return { left: window.innerWidth / 2 - 27, top: window.innerHeight - 90, width: 54, height: 86 };
}

function animateCardDraw(colour) {
  return new Promise(resolve => {
    const fromRect = getDrawPileRect();
    if (!fromRect) { resolve(); return; }

    // Create overlay card — starts face-down at pile, ends face-up at hand
    const fly = document.createElement("div");
    fly.className = "flying-card flying-card-back";
    fly.style.cssText = `
      position: fixed;
      width: 34px;
      height: 48px;
      border-radius: 8px;
      z-index: 9999;
      pointer-events: none;
      transform-style: preserve-3d;
      will-change: transform, top, left, opacity;
      left: ${fromRect.left + fromRect.width / 2 - 17}px;
      top: ${fromRect.top + fromRect.height / 2 - 24}px;
      transition: none;
    `;
    document.body.appendChild(fly);

    // After a tick, start the flight
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const toRect = getHandTargetRect(colour);
        const toLeft = toRect ? toRect.left + toRect.width / 2 - 17 : window.innerWidth / 2 - 17;
        const toTop  = toRect ? toRect.top  + toRect.height / 2 - 24 : window.innerHeight - 80;

        // Phase 1 (0–50%): travel to destination, still face-down
        // Phase 2 (50%): flip to face-up (rotateY 90deg midpoint)
        // Phase 3 (50–100%): continue face-up to land position

        const colours = CARD_COLOUR_HEX_MAP[colour] || ["#5b5b5b", "#1d1d1d"];
        const faceBg = colour === "rainbow"
          ? "linear-gradient(135deg, #f3a3a3 0%, #f0dd67 25%, #72c78e 50%, #8ab5ff 75%, #ef9cc3 100%)"
          : `linear-gradient(180deg, ${colours[0]} 0%, ${colours[1]} 100%)`;

        const duration = 480;
        const start = performance.now();

        function step(now) {
          const t = Math.min(1, (now - start) / duration);
          const ease = t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t+2,3)/2;

          const x = fromRect.left + fromRect.width/2  - 17 + (toLeft - (fromRect.left + fromRect.width/2  - 17)) * ease;
          const y = fromRect.top  + fromRect.height/2 - 24 + (toTop  - (fromRect.top  + fromRect.height/2 - 24)) * ease;

          // Arc — card rises slightly in the middle
          const arc = Math.sin(t * Math.PI) * -40;

          // Flip at midpoint
          let rotY = 0;
          if (t < 0.45) {
            rotY = 0;
          } else if (t < 0.55) {
            // Flip through 90deg
            rotY = ((t - 0.45) / 0.1) * 90;
            if (rotY >= 90) {
              // Switch to face-up appearance
              fly.classList.remove("flying-card-back");
              fly.classList.add("flying-card-face");
              fly.style.background = faceBg;
            }
          } else {
            // Already face-up, continue from -90 back to 0
            rotY = 90 - ((t - 0.55) / 0.45) * 90;
          }

          fly.style.left = `${x}px`;
          fly.style.top  = `${y + arc}px`;
          fly.style.transform = `rotateY(${rotY}deg) scale(${0.9 + ease * 0.1})`;

          if (t < 1) {
            requestAnimationFrame(step);
          } else {
            // Land: fade out
            fly.style.transition = "opacity 180ms ease";
            fly.style.opacity = "0";
            setTimeout(() => { fly.remove(); resolve(); }, 200);
          }
        }

        requestAnimationFrame(step);
      });
    });
  });
}

function triggerCardGlow(colour) {
  const peek = document.getElementById("mobile-hand-peek");
  if (!peek) return;
  // Remove steady glow from all cards first
  peek.querySelectorAll(".mobile-hand-peek-card").forEach(card => {
    card.classList.remove("card-glow-steady");
  });
  // Add steady glow only to the latest drawn colour
  peek.querySelectorAll(".mobile-hand-peek-card").forEach(card => {
    if (card.classList.contains(colour)) {
      card.style.setProperty("--glow-colour", GLOW_COLOURS[colour] || "rgba(255,255,255,0.7)");
      card.classList.add("card-glow-steady");
    }
  });
}

async function drawCardForCurrentPlayer() {
  const currentPlayerName = app.state.currentPlayer;
  const card = drawCard();

  if (!card) {
    updateStatus("No cards available to draw.");
    renderAll();
    return;
  }

  const player = app.state.players[currentPlayerName];

  // Fire fly animation before mutating state so pile position is still visible
  const isMobile = window.innerWidth <= 767 ||
    (window.innerHeight <= 500 && window.innerWidth > window.innerHeight);
  if (isMobile) {
    await animateCardDraw(card);
  }

  player.hand.push(card);
  player.lastDrawColor = card;
  updateStatus(`${currentPlayerName} drew ${card}.`); // silent on mobile
  closeMobileSheet();
  renderAll();

  // Trigger glow on the landed card
  if (isMobile) {
    requestAnimationFrame(() => triggerCardGlow(card));
  }

  if (!app.state.controlledHero) {
    endTurn();
  }
}

function handleRouteHover(routeId) {
  const playability = getRoutePlayability(routeId);
  const routeColour = getDisplayRouteColor(app.state.routes[routeId].colour);
  const cost = app.rulesData.routes[routeId].length;

  if (playability.playable) {
    updateStatus(`${formatRouteName(routeId)} · ${routeColour} · cost ${cost} · eligible`);
  } else {
    updateStatus(`${formatRouteName(routeId)} · ${routeColour} · cost ${cost} · ${playability.reason}`);
  }
}

function wireRouteInteractions() {
  Object.keys(app.rulesData.routes || {}).forEach(routeId => {
    const routeEl = app.svg.querySelector(`#${CSS.escape(routeId)}`);
    if (!routeEl) return;

    routeEl.addEventListener("mouseenter", () => {
      handleRouteHover(routeId);
    });

    routeEl.addEventListener("mouseleave", () => {
      updateStatus("Choose one action: draw a card or click a route to play it.");
    });

    routeEl.addEventListener("click", () => {
      handleRouteSelection(routeId);
    });
  });
}

function resetLocalGame() {
  app.state = createInitialLocalState(app.rulesData, app.state.controlledHero || "Eric");
  closeRouteModal();
  closeDestinationReveal();
  closeMobileSheet();
  resetBoardView();
  renderAll();
  if (app.state.controlledHero) showCurrentDestinationReveal(app.state.controlledHero);
  updateStatus("Local game reset.");
}

function injectMobileBottomBar() {
  if (document.getElementById("mobile-bottom-bar")) return;

  const gameShell = document.getElementById("game-shell");
  const statusChip = document.getElementById("status-chip");
  if (!gameShell || !statusChip) return;

  const wrap = document.createElement("div");
  wrap.id = "mobile-bottom-bar";
  wrap.innerHTML = `<div id="mobile-hand-peek"></div>`;

  gameShell.insertBefore(wrap, statusChip);
}

// ---------------------------------------------------------------------------
// Show the mobile HUD by adding a class rather than relying on conflicting
// display:none / display:grid in CSS
// ---------------------------------------------------------------------------
function showMobileHud() {
  const hud = document.getElementById("mobile-hud");
  if (hud) hud.classList.add("visible");
  const bar = document.getElementById("mobile-bottom-bar");
  if (bar) bar.classList.add("visible");
  const sheet = document.getElementById("mobile-sheet");
  if (sheet) sheet.classList.add("visible-shell");
}


// ─── END SCREEN ──────────────────────────────────────────────────────────────

function buildEndScreenOverlay() {
  if (document.getElementById("end-screen-overlay")) return;
  const overlay = document.createElement("div");
  overlay.id = "end-screen-overlay";
  overlay.className = "end-screen-overlay";
  overlay.innerHTML = `
    <div class="end-screen-loop">
      <div class="end-screen-wipe end-screen-wipe-a"></div>
      <div class="end-screen-wipe end-screen-wipe-b"></div>
      <div class="end-screen-wipe end-screen-wipe-c"></div>
      <div class="end-screen-noise"></div>
    </div>
    <div class="end-screen-inner">
      <div id="end-screen-kicker" class="end-screen-kicker">Didcot Dogs</div>
      <div id="end-screen-headline" class="end-screen-headline">YOU WIN!</div>
      <div id="end-screen-sub" class="end-screen-sub"></div>
      <div id="end-screen-portrait" class="end-screen-portrait-wrap"></div>
      <button id="end-screen-play-again" class="action-btn primary end-screen-btn" type="button">Play again</button>
    </div>
  `;
  document.getElementById("game-shell").appendChild(overlay);

  document.getElementById("end-screen-play-again").addEventListener("click", () => {
    hideEndScreen();
    resetLocalGame();
    document.getElementById("hero-overlay").classList.add("active");
    const hud = document.getElementById("mobile-hud");
    const bar = document.getElementById("mobile-bottom-bar");
    const sheet = document.getElementById("mobile-sheet");
    if (hud) hud.classList.remove("visible");
    if (bar) bar.classList.remove("visible");
    if (sheet) sheet.classList.remove("visible-shell", "expanded");
  });
}

function showEndScreen(winnerName) {
  buildEndScreenOverlay();
  const overlay = document.getElementById("end-screen-overlay");
  const isWin = winnerName === app.state.controlledHero;
  document.getElementById("end-screen-headline").textContent = isWin ? "YOU WIN!" : "YOU LOSE!";
  document.getElementById("end-screen-sub").textContent = isWin
    ? `${winnerName} completed all five destinations. Legendary.`
    : `${winnerName} beat you to it. Better luck next time.`;
  const pw = document.getElementById("end-screen-portrait");
  pw.innerHTML = `<img src="${PLAYER_CONFIG[winnerName].image}" alt="${winnerName}" class="end-screen-portrait">`;
  overlay.className = "end-screen-overlay active " + (isWin ? "end-win" : "end-lose");
}

function hideEndScreen() {
  const overlay = document.getElementById("end-screen-overlay");
  if (overlay) overlay.className = "end-screen-overlay";
}

function wireControlButtons() {
  document.getElementById("draw-card-btn").addEventListener("click", () => {
    drawCardForCurrentPlayer();
  });

  document.getElementById("reset-local-btn").addEventListener("click", () => {
    resetLocalGame();
  });

  document.getElementById("pick-eric-btn").addEventListener("click", () => {
    startGameAs("Eric");
  });

  document.getElementById("pick-tango-btn").addEventListener("click", () => {
    startGameAs("Tango");
  });

  document.getElementById("mobile-open-sheet-btn").addEventListener("click", () => {
    drawCardForCurrentPlayer();
  });

  document.getElementById("mobile-reset-view-btn").addEventListener("click", () => {
    toggleMobileSheet();
  });

  document.getElementById("mobile-sheet-handle").addEventListener("click", () => {
    closeMobileSheet();
  });

  document.getElementById("route-modal-close").addEventListener("click", closeRouteModal);
  document.getElementById("route-modal-cancel").addEventListener("click", closeRouteModal);
  document.getElementById("route-modal-confirm").addEventListener("click", async () => {
    await confirmRouteModalPlay();
  });

  document.getElementById("route-modal-overlay").addEventListener("click", evt => {
    if (evt.target.id === "route-modal-overlay") closeRouteModal();
  });

  document.getElementById("destination-reveal-close").addEventListener("click", closeDestinationReveal);
  document.getElementById("destination-reveal-overlay").addEventListener("click", evt => {
    if (evt.target.id === "destination-reveal-overlay") closeDestinationReveal();
  });
}

async function init() {
  try {
    injectMobileBottomBar();

    const [rulesData, destinationData] = await Promise.all([
      loadJson("./data/didcot-dogs-rules.v1.json"),
      loadJson("./data/didcot-dogs-destinations.v1.json")
    ]);

    const svg = await injectBoardSvg();
    ensureSvgDefs(svg);
    startClaimGradientAnimation(svg);
    normalizeSvgNodeAliases(svg, rulesData);
    tightenSvgViewBox(svg);   // sets app.boardView.baseViewBox

    const audit = getSvgAudit(svg, rulesData);
    const state = createInitialLocalState(rulesData);

    app = {
      rulesData,
      destinationData,
      svg,
      audit,
      state,
      boardView: {
        scale: 1,
        panX: 0,
        panY: 0,
        minScale: 1,
        maxScale: 3,
        baseViewBox: app.boardView.baseViewBox   // preserve from tightenSvgViewBox
      },
      modal: {
        routeId: null,
        chosenColor: null,
        selectedOptionIndex: null,
        options: []
      }
    };

    wireRouteInteractions();
    wireControlButtons();
    setupMobileBoardGestures();
    // showMobileHud() is called inside startGameAs() so the HUD stays
    // hidden during the hero-pick screen.
    resetBoardView();
    renderAll();
    updateStatus("Pick your hero to begin.");
  } catch (error) {
    console.error(error);
    document.getElementById("status-chip").textContent = `Error loading board: ${error.message}`;
  }
}

window.addEventListener("resize", () => {
  if (!app.svg || !app.boardView.baseViewBox) return;
  applyBoardViewTransform();
});

document.addEventListener("DOMContentLoaded", () => {
  setupFullscreenButton();
  init();
});
