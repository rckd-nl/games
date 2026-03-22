console.log("Didcot Dogs app.v1.js loaded");

const APP_VERSION = "v1.10.0";
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

let app = {
  rulesData: null,
  destinationData: null,
  svg: null,
  audit: null,
  state: null,
  modal: {
    routeId: null,
    chosenColor: null,
    selectedOptionIndex: null,
    options: []
  },
  view: {
    scale: 1,
    minScale: 1,
    maxScale: 3.2,
    x: 0,
    y: 0,
    initialized: false,
    pointers: new Map(),
    dragStartX: 0,
    dragStartY: 0,
    startX: 0,
    startY: 0,
    pinchStartScale: 1,
    pinchStartDistance: 0,
    pinchWorldX: 0,
    pinchWorldY: 0,
    resizeObserver: null,
    raf: 0
  }
};

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

function createSvgEl(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  Object.entries(attrs).forEach(([key, value]) => el.setAttribute(key, value));
  return el;
}

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
  host.style.transformOrigin = "0 0";
  host.style.willChange = "transform";
  return svg;
}

function isMobileViewport() {
  return window.matchMedia("(max-width: 900px)").matches;
}

function getBoardViewportMetrics() {
  const viewport = document.getElementById("board-wrap");
  const host = document.getElementById("board-svg-host");
  const svg = app.svg;
  if (!viewport || !host || !svg) return null;

  const viewportRect = viewport.getBoundingClientRect();
  const viewBox = svg.viewBox?.baseVal;
  if (!viewBox || !viewBox.width || !viewBox.height) return null;

  const fitScale = Math.min(viewportRect.width / viewBox.width, viewportRect.height / viewBox.height);
  const boardWidth = viewBox.width * fitScale;
  const boardHeight = viewBox.height * fitScale;

  return {
    viewport,
    host,
    viewportRect,
    viewBox,
    fitScale,
    boardWidth,
    boardHeight,
    scaledWidth: boardWidth * app.view.scale,
    scaledHeight: boardHeight * app.view.scale
  };
}

function clampViewState() {
  const metrics = getBoardViewportMetrics();
  if (!metrics) return;

  const overflowX = Math.max(0, metrics.scaledWidth - metrics.viewportRect.width);
  const overflowY = Math.max(0, metrics.scaledHeight - metrics.viewportRect.height);

  const minX = -overflowX;
  const maxX = 0;
  const minY = -overflowY;
  const maxY = 0;

  app.view.x = Math.min(maxX, Math.max(minX, app.view.x));
  app.view.y = Math.min(maxY, Math.max(minY, app.view.y));
}

function queueBoardTransform() {
  if (app.view.raf) return;
  app.view.raf = requestAnimationFrame(() => {
    app.view.raf = 0;
    applyBoardTransform();
  });
}

function applyBoardTransform() {
  const metrics = getBoardViewportMetrics();
  if (!metrics) return;

  clampViewState();

  metrics.host.style.width = `${metrics.boardWidth}px`;
  metrics.host.style.height = `${metrics.boardHeight}px`;
  metrics.host.style.transform = `translate3d(${app.view.x}px, ${app.view.y}px, 0) scale(${app.view.scale})`;
  metrics.host.dataset.scale = String(app.view.scale);
}

function centerBoardForMobile(force = false) {
  const metrics = getBoardViewportMetrics();
  if (!metrics) return;

  app.view.minScale = 1;
  app.view.maxScale = 3.2;

  if (!app.view.initialized || force) {
    app.view.scale = 1;
    app.view.x = Math.min(0, (metrics.viewportRect.width - metrics.boardWidth) / 2);
    app.view.y = Math.min(0, (metrics.viewportRect.height - metrics.boardHeight) / 2);
    app.view.initialized = true;
  }

  queueBoardTransform();
}

function getPinchDistance(a, b) {
  return Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);
}

function getPinchCenter(a, b) {
  return {
    x: (a.clientX + b.clientX) / 2,
    y: (a.clientY + b.clientY) / 2
  };
}

function setScaleAroundViewportPoint(newScale, viewportClientX, viewportClientY) {
  const metrics = getBoardViewportMetrics();
  if (!metrics) return;

  const clampedScale = Math.min(app.view.maxScale, Math.max(app.view.minScale, newScale));
  const localX = viewportClientX - metrics.viewportRect.left;
  const localY = viewportClientY - metrics.viewportRect.top;
  const worldX = (localX - app.view.x) / app.view.scale;
  const worldY = (localY - app.view.y) / app.view.scale;

  app.view.scale = clampedScale;
  app.view.x = localX - worldX * app.view.scale;
  app.view.y = localY - worldY * app.view.scale;
  queueBoardTransform();
}

function setupBoardPanZoom() {
  const viewport = document.getElementById("board-wrap");
  const resetBtn = document.getElementById("mobile-reset-view-btn");
  if (!viewport) return;

  const onPointerDown = event => {
    if (!isMobileViewport()) return;
    viewport.setPointerCapture?.(event.pointerId);
    app.view.pointers.set(event.pointerId, { clientX: event.clientX, clientY: event.clientY });

    if (app.view.pointers.size === 1) {
      app.view.dragStartX = event.clientX;
      app.view.dragStartY = event.clientY;
      app.view.startX = app.view.x;
      app.view.startY = app.view.y;
    }

    if (app.view.pointers.size === 2) {
      const [a, b] = [...app.view.pointers.values()];
      const center = getPinchCenter(a, b);
      const metrics = getBoardViewportMetrics();
      app.view.pinchStartScale = app.view.scale;
      app.view.pinchStartDistance = getPinchDistance(a, b);
      if (metrics) {
        const localX = center.x - metrics.viewportRect.left;
        const localY = center.y - metrics.viewportRect.top;
        app.view.pinchWorldX = (localX - app.view.x) / app.view.scale;
        app.view.pinchWorldY = (localY - app.view.y) / app.view.scale;
      }
    }
  };

  const onPointerMove = event => {
    if (!app.view.pointers.has(event.pointerId)) return;
    app.view.pointers.set(event.pointerId, { clientX: event.clientX, clientY: event.clientY });

    if (app.view.pointers.size === 1) {
      app.view.x = app.view.startX + (event.clientX - app.view.dragStartX);
      app.view.y = app.view.startY + (event.clientY - app.view.dragStartY);
      queueBoardTransform();
      return;
    }

    if (app.view.pointers.size === 2) {
      const [a, b] = [...app.view.pointers.values()];
      const center = getPinchCenter(a, b);
      const distance = getPinchDistance(a, b);
      const metrics = getBoardViewportMetrics();
      if (!metrics || !app.view.pinchStartDistance) return;

      app.view.scale = Math.min(app.view.maxScale, Math.max(app.view.minScale, app.view.pinchStartScale * (distance / app.view.pinchStartDistance)));
      const localX = center.x - metrics.viewportRect.left;
      const localY = center.y - metrics.viewportRect.top;
      app.view.x = localX - app.view.pinchWorldX * app.view.scale;
      app.view.y = localY - app.view.pinchWorldY * app.view.scale;
      queueBoardTransform();
    }
  };

  const onPointerUp = event => {
    app.view.pointers.delete(event.pointerId);
    if (app.view.pointers.size === 1) {
      const [remaining] = [...app.view.pointers.values()];
      app.view.dragStartX = remaining.clientX;
      app.view.dragStartY = remaining.clientY;
      app.view.startX = app.view.x;
      app.view.startY = app.view.y;
    }
  };

  viewport.addEventListener("pointerdown", onPointerDown);
  viewport.addEventListener("pointermove", onPointerMove);
  viewport.addEventListener("pointerup", onPointerUp);
  viewport.addEventListener("pointercancel", onPointerUp);
  viewport.addEventListener("lostpointercapture", onPointerUp);

  viewport.addEventListener("wheel", event => {
    if (!isMobileViewport()) return;
    event.preventDefault();
    const zoomFactor = event.deltaY < 0 ? 1.12 : 0.9;
    setScaleAroundViewportPoint(app.view.scale * zoomFactor, event.clientX, event.clientY);
  }, { passive: false });

  viewport.addEventListener("dblclick", event => {
    if (!isMobileViewport()) return;
    event.preventDefault();
    const nextScale = app.view.scale < 1.6 ? 1.8 : 1;
    setScaleAroundViewportPoint(nextScale, event.clientX, event.clientY);
  });

  resetBtn?.addEventListener("dblclick", event => {
    event.preventDefault();
    centerBoardForMobile(true);
  });

  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", () => queueBoardTransform());
  }

  if (typeof ResizeObserver === "function") {
    app.view.resizeObserver?.disconnect?.();
    app.view.resizeObserver = new ResizeObserver(() => {
      centerBoardForMobile(!isMobileViewport());
      queueBoardTransform();
    });
    app.view.resizeObserver.observe(viewport);
  }
}

function setupFullscreenButton() {
  const btn = document.getElementById("fullscreen-btn");
  if (!btn) return;

  btn.addEventListener("click", async () => {
    const el = document.documentElement;
    if (!document.fullscreenElement) await el.requestFullscreen?.();
    else await document.exitFullscreen?.();
  });
}

function normalizeName(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeSvgNodeAliases(svg, rulesData) {
  const nodeIds = Object.keys(rulesData.nodes || {});
  nodeIds.forEach(nodeId => {
    const normalized = normalizeName(nodeId);
    const exact = svg.querySelector(`#${CSS.escape(nodeId)}`);
    if (exact) exact.dataset.nodeId = nodeId;

    const byData = svg.querySelector(`[data-node-id="${CSS.escape(nodeId)}"]`);
    if (byData) return;

    const candidates = [...svg.querySelectorAll("[id]")].filter(el => normalizeName(el.id) === normalized);
    if (candidates[0]) candidates[0].dataset.nodeId = nodeId;
  });
}

function tightenSvgViewBox(svg) {
  try {
    const bbox = svg.getBBox();
    const pad = 24;
    svg.setAttribute("viewBox", `${bbox.x - pad} ${bbox.y - pad} ${bbox.width + pad * 2} ${bbox.height + pad * 2}`);
  } catch (error) {
    console.warn("Could not tighten SVG viewBox", error);
  }
}

function ensureSvgDefs(svg) {
  let defs = svg.querySelector("defs");
  if (!defs) {
    defs = createSvgEl("defs");
    svg.insertBefore(defs, svg.firstChild);
  }

  if (!svg.querySelector("#claim-gradient")) {
    const gradient = createSvgEl("linearGradient", {
      id: "claim-gradient",
      x1: "0%",
      y1: "0%",
      x2: "100%",
      y2: "0%"
    });

    const stop1 = createSvgEl("stop", { offset: "0%", "stop-color": "#ffffff", "stop-opacity": "0.2" });
    const stop2 = createSvgEl("stop", { offset: "50%", "stop-color": "#ffffff", "stop-opacity": "0.9" });
    const stop3 = createSvgEl("stop", { offset: "100%", "stop-color": "#ffffff", "stop-opacity": "0.2" });

    gradient.appendChild(stop1);
    gradient.appendChild(stop2);
    gradient.appendChild(stop3);
    defs.appendChild(gradient);
  }
}

function startClaimGradientAnimation(svg) {
  const gradient = svg.querySelector("#claim-gradient");
  if (!gradient) return;

  let offset = 0;
  function step() {
    offset = (offset + 0.8) % 100;
    gradient.setAttribute("x1", `${offset - 100}%`);
    gradient.setAttribute("x2", `${offset}%`);
    requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

function getSvgAudit(svg, rulesData) {
  const svgIds = new Set([...svg.querySelectorAll("[id]")].map(el => el.id));
  const ruleNodeIds = Object.keys(rulesData.nodes || {});
  const ruleRouteIds = Object.keys(rulesData.routes || {});

  return {
    nodeCount: ruleNodeIds.length,
    routeCount: ruleRouteIds.length,
    missingRuleNodes: ruleNodeIds.filter(id => !svgIds.has(id) && !svg.querySelector(`[data-node-id="${CSS.escape(id)}"]`)),
    missingRuleRoutes: ruleRouteIds.filter(id => !svgIds.has(id))
  };
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function randomItem(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function shuffle(list) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function createRouteColourPool() {
  return [
    ...Array(10).fill("red"),
    ...Array(10).fill("orange"),
    ...Array(10).fill("blue"),
    ...Array(10).fill("green"),
    ...Array(10).fill("black"),
    ...Array(8).fill("pink"),
    ...Array(8).fill("yellow"),
    ...Array(10).fill("grey")
  ];
}

function assignRandomRouteColours(routes) {
  const pool = shuffle(createRouteColourPool());
  const routeIds = Object.keys(routes);
  const assigned = {};

  routeIds.forEach((routeId, index) => {
    const preferred = routes[routeId].colour;
    assigned[routeId] = {
      ...routes[routeId],
      colour: preferred === "grey" ? "grey" : (pool[index % pool.length] || preferred || "grey"),
      claimedBy: null
    };
  });

  return assigned;
}

function buildDrawPileDeck() {
  const colours = [
    ...Array(12).fill("red"),
    ...Array(12).fill("orange"),
    ...Array(12).fill("blue"),
    ...Array(12).fill("green"),
    ...Array(12).fill("black"),
    ...Array(10).fill("pink"),
    ...Array(10).fill("yellow"),
    ...Array(12).fill("rainbow")
  ];
  return shuffle(colours);
}

function getStartNodeForPlayer(playerName) {
  return playerName === "Eric" ? "didcot-parkway" : "didcot-parkway";
}

function getDefaultDestinationSequence(destinationData) {
  return destinationData.order?.slice(0, 5) || Object.keys(destinationData.destinations || {}).slice(0, 5);
}

function createPlayerState(playerName, destinationData) {
  return {
    name: playerName,
    hand: [],
    currentNode: getStartNodeForPlayer(playerName),
    previousNode: null,
    completedDestinations: [],
    completedCount: 0,
    destinationSequence: getDefaultDestinationSequence(destinationData),
    journeyRouteIds: [],
    lastDrawColor: null
  };
}

function createInitialLocalState(rulesData, controlledHero = null) {
  return {
    currentPlayer: "Eric",
    controlledHero,
    selectedRouteId: null,
    drawPile: buildDrawPileDeck(),
    discardPile: [],
    justCompleted: null,
    routes: assignRandomRouteColours(deepClone(rulesData.routes || {})),
    players: {
      Eric: createPlayerState("Eric", app.destinationData || { destinations: {}, order: [] }),
      Tango: createPlayerState("Tango", app.destinationData || { destinations: {}, order: [] })
    }
  };
}

function formatNodeName(value) {
  return String(value || "")
    .replace(/-/g, " ")
    .replace(/\b\w/g, char => char.toUpperCase());
}

function formatRouteName(routeId) {
  const route = app.rulesData.routes[routeId];
  if (!route) return formatNodeName(routeId);
  return `${formatNodeName(route.from)} → ${formatNodeName(route.to)}`;
}

function getDisplayRouteColor(color) {
  return color === "grey" ? "wild" : color;
}

function getCurrentTargetForPlayer(player) {
  return player.destinationSequence[player.completedCount] || "didcot-parkway";
}

function countCards(hand) {
  return hand.reduce((acc, color) => {
    acc[color] = (acc[color] || 0) + 1;
    return acc;
  }, {});
}

function drawCard() {
  if (!app.state.drawPile.length && app.state.discardPile.length) {
    app.state.drawPile = shuffle(app.state.discardPile);
    app.state.discardPile = [];
  }
  return app.state.drawPile.pop() || null;
}

function endTurn() {
  const previous = app.state.currentPlayer;
  app.state.currentPlayer = previous === "Eric" ? "Tango" : "Eric";
  renderAll();
}

function getNodeElement(svg, nodeId) {
  return svg.querySelector(`[data-node-id="${CSS.escape(nodeId)}"]`) || svg.querySelector(`#${CSS.escape(nodeId)}`);
}

function getConnectedNode(routeId, fromNode) {
  const route = app.rulesData.routes[routeId];
  if (!route) return fromNode;
  if (route.from === fromNode) return route.to;
  if (route.to === fromNode) return route.from;
  return fromNode;
}

function getAdjacentRoutesForNode(nodeId) {
  return Object.entries(app.rulesData.routes || {})
    .filter(([, route]) => route.from === nodeId || route.to === nodeId)
    .map(([routeId]) => routeId);
}
function getPaymentOptionsForColor(routeId, playerName, chosenColour = null) {
  const route = app.state.routes[routeId];
  const length = route.length;
  const player = app.state.players[playerName];
  const counts = countCards(player.hand);

  const availableColors = ["red","orange","blue","green","black","pink","yellow"]
    .filter(color => (counts[color] || 0) + (counts.rainbow || 0) >= length);

  const coloursToCheck = chosenColour
    ? [chosenColour]
    : (route.colour === "grey" ? availableColors : [route.colour]);

  const options = [];

  coloursToCheck.forEach(color => {
    const colourCount = counts[color] || 0;
    const rainbowCount = counts.rainbow || 0;
    const maxColourUse = Math.min(length, colourCount);

    for (let useColourCount = maxColourUse; useColourCount >= 0; useColourCount -= 1) {
      const useRainbowCount = length - useColourCount;
      if (useRainbowCount <= rainbowCount) {
        options.push({ colourChoice: color, useColourCount, useRainbowCount });
      }
    }
  });

  return { availableColors, options };
}

function getRoutePlayability(routeId) {
  const playerName = app.state.currentPlayer;
  const player = app.state.players[playerName];
  const route = app.state.routes[routeId];
  const baseRoute = app.rulesData.routes[routeId];

  if (!route || !baseRoute) return { playable: false, reason: "Unknown route." };
  if (route.claimedBy) return { playable: false, reason: "Already claimed." };

  const isAdjacent = baseRoute.from === player.currentNode || baseRoute.to === player.currentNode;
  if (!isAdjacent) return { playable: false, reason: "Not adjacent." };

  const payment = getPaymentOptionsForColor(routeId, playerName);

  if (route.colour === "grey") {
    if (!payment.availableColors.length) return { playable: false, reason: "Not enough cards." };
    return { playable: true, reason: "OK" };
  }

  if (!payment.options.length) return { playable: false, reason: "Need more cards." };
  return { playable: true, reason: "OK" };
}

function removeSpecificCardsFromHand(hand, colour, useColourCount, useRainbowCount) {
  const spent = [];
  const nextHand = [];

  let colourNeeded = useColourCount;
  let rainbowNeeded = useRainbowCount;

  hand.forEach(card => {
    if (card === colour && colourNeeded > 0) {
      spent.push(card);
      colourNeeded--;
      return;
    }
    if (card === "rainbow" && rainbowNeeded > 0) {
      spent.push(card);
      rainbowNeeded--;
      return;
    }
    nextHand.push(card);
  });

  return { spent, nextHand };
}

function updateStatus(message) {
  const chip = document.getElementById("status-chip");
  if (chip) chip.textContent = message;
}

/* =========================
   MOBILE DRAW / HAND VISUALS
========================= */

function renderCounts() {
  const draw = document.getElementById("mobile-draw-pile");
  const discard = document.getElementById("mobile-discard-pile");

  if (draw) {
    draw.innerHTML = "";
    const visible = Math.min(6, Math.max(1, Math.ceil(app.state.drawPile.length / 12)));

    for (let i = 0; i < visible; i++) {
      const card = document.createElement("div");
      card.className = "mobile-pile-card draw-back";
      card.style.transform = `translate(${i * 2}px, ${i * -2}px)`;
      draw.appendChild(card);
    }

    const count = document.createElement("div");
    count.className = "mobile-pile-count";
    count.textContent = app.state.drawPile.length;
    draw.appendChild(count);
  }

  if (discard) {
    discard.innerHTML = "";
    const cards = app.state.discardPile.slice(-5);

    cards.forEach((color, i) => {
      const card = document.createElement("div");
      card.className = `mobile-pile-card discard-face ${color}`;
      card.style.transform = `translate(${i * 3}px, ${i * -2}px) rotate(${i * 4 - 8}deg)`;
      card.textContent = color === "rainbow" ? "★" : color;
      discard.appendChild(card);
    });
  }
}

function renderHandInto(container, player) {
  container.innerHTML = "";
  const counts = countCards(player.hand);

  Object.keys(counts).forEach(color => {
    const stack = document.createElement("div");
    stack.className = `mobile-hand-stack ${color}`;

    for (let i = 0; i < Math.min(counts[color], 6); i++) {
      const c = document.createElement("div");
      c.className = `mobile-hand-peek-card ${color}`;
      c.style.transform = `translateY(${i * -6}px)`;
      stack.appendChild(c);
    }

    container.appendChild(stack);
  });
}

/* =========================
   DRAW ANIMATION
========================= */

async function animateMobileDrawToHand(color) {
  const draw = document.getElementById("mobile-draw-pile");
  const target = document.querySelector(`#mobile-hand-peek .${color}`);

  if (!draw || !target) return;

  const d = draw.getBoundingClientRect();
  const t = target.getBoundingClientRect();

  const ghost = document.createElement("div");
  ghost.className = `mobile-flying-card ${color}`;
  ghost.textContent = color === "rainbow" ? "★" : color;

  document.body.appendChild(ghost);

  ghost.style.left = `${d.left}px`;
  ghost.style.top = `${d.top}px`;

  await ghost.animate([
    { transform: "translate(0,0) rotateY(0deg)" },
    { transform: `translate(${(t.left - d.left) / 2}px, -80px) rotateY(90deg)` },
    { transform: `translate(${t.left - d.left}px, ${t.top - d.top}px) rotateY(180deg)` }
  ], {
    duration: 600,
    easing: "ease"
  }).finished;

  ghost.remove();
}

/* =========================
   DRAW ACTION
========================= */

async function drawCardForCurrentPlayer() {
  const p = app.state.players[app.state.currentPlayer];
  const card = drawCard();
  if (!card) return;

  p.hand.push(card);

  await animateMobileDrawToHand(card);

  renderAll();
  endTurn();
}

/* =========================
   CORE RENDER
========================= */

function renderAll() {
  renderCounts();

  const handPeek = document.getElementById("mobile-hand-peek");
  if (handPeek) {
    renderHandInto(handPeek, app.state.players[app.state.currentPlayer]);
  }

  applyBoardTransform();
}

/* =========================
   INIT
========================= */

async function init() {
  const [rules, dest] = await Promise.all([
    loadJson("./data/didcot-dogs-rules.v1.json"),
    loadJson("./data/didcot-dogs-destinations.v1.json")
  ]);

  const svg = await injectBoardSvg();

  app.rulesData = rules;
  app.destinationData = dest;
  app.svg = svg;
  app.state = createInitialLocalState(rules);

  setupBoardPanZoom();
  centerBoardForMobile(true);

  document.getElementById("mobile-open-sheet-btn").onclick = drawCardForCurrentPlayer;

  renderAll();
}

document.addEventListener("DOMContentLoaded", init);
