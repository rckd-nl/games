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
  const availableColors = ["red", "orange", "blue", "green", "black", "pink", "yellow"]
    .filter(color => (counts[color] || 0) + (counts.rainbow || 0) >= length);

  const coloursToCheck = chosenColour ? [chosenColour] : (route.colour === "grey" ? availableColors : [route.colour]);
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
  if (!isAdjacent) return { playable: false, reason: "Route is not adjacent to your current stop." };

  const destinationTarget = getCurrentTargetForPlayer(player);
  if (destinationTarget && player.currentNode === destinationTarget) return { playable: false, reason: "Reveal your next destination first." };

  const payment = getPaymentOptionsForColor(routeId, playerName);
  if (route.colour === "grey") {
    if (!payment.availableColors.length) return { playable: false, reason: "Not enough matching cards for this wild route." };
    return { playable: true, reason: "Eligible" };
  }

  if (!payment.options.length) return { playable: false, reason: `Need ${route.length} ${route.colour} card(s), with rainbows as wild.` };
  return { playable: true, reason: "Eligible" };
}

function removeSpecificCardsFromHand(hand, colour, useColourCount, useRainbowCount) {
  const spent = [];
  const nextHand = [];
  let colourNeeded = useColourCount;
  let rainbowNeeded = useRainbowCount;

  hand.forEach(card => {
    if (card === colour && colourNeeded > 0) {
      spent.push(card);
      colourNeeded -= 1;
      return;
    }
    if (card === "rainbow" && rainbowNeeded > 0) {
      spent.push(card);
      rainbowNeeded -= 1;
      return;
    }
    nextHand.push(card);
  });

  return { spent, nextHand };
}

function rerollSpecificRouteColours(routeIds) {
  const colours = shuffle(createRouteColourPool());
  routeIds.forEach((routeId, index) => {
    if (!app.state.routes[routeId]) return;
    const original = app.rulesData.routes[routeId]?.colour;
    app.state.routes[routeId].colour = original === "grey" ? "grey" : (colours[index % colours.length] || "grey");
  });
}

function updateStatus(message) {
  const chip = document.getElementById("status-chip");
  if (chip) chip.textContent = message;
}

function renderTurnBadge() {
  const turnBadge = document.getElementById("turn-badge");
  if (!turnBadge) return;
  turnBadge.textContent = `${app.state.currentPlayer} turn`;
  turnBadge.className = `turn-badge ${PLAYER_CONFIG[app.state.currentPlayer]?.badgeClass || ""}`;
}

function renderCounts() {
  const drawCount = document.getElementById("draw-count");
  const discardCount = document.getElementById("discard-count");
  if (drawCount) drawCount.textContent = app.state.drawPile.length;
  if (discardCount) discardCount.textContent = app.state.discardPile.length;

  const mobileDrawPile = document.getElementById("mobile-draw-pile");
  const mobileDiscardPile = document.getElementById("mobile-discard-pile");

  if (mobileDrawPile) {
    mobileDrawPile.innerHTML = "";
    const visible = Math.min(6, Math.max(1, Math.ceil(app.state.drawPile.length / 12)));
    for (let i = 0; i < visible; i += 1) {
      const card = document.createElement("div");
      card.className = "mobile-pile-card draw-back";
      card.style.transform = `translate(${i * 2}px, ${i * -2}px)`;
      mobileDrawPile.appendChild(card);
    }
    const count = document.createElement("div");
    count.className = "mobile-pile-count";
    count.textContent = app.state.drawPile.length;
    mobileDrawPile.appendChild(count);
  }

  if (mobileDiscardPile) {
    mobileDiscardPile.innerHTML = "";
    const topCards = app.state.discardPile.slice(-5);
    topCards.forEach((color, index) => {
      const card = document.createElement("div");
      card.className = `mobile-pile-card discard-face ${color}`;
      const rotation = -8 + index * 4;
      card.style.transform = `translate(${index * 3}px, ${index * -2}px) rotate(${rotation}deg)`;
      card.textContent = color === "rainbow" ? "★" : color;
      mobileDiscardPile.appendChild(card);
    });
    const count = document.createElement("div");
    count.className = "mobile-pile-count";
    count.textContent = app.state.discardPile.length;
    mobileDiscardPile.appendChild(count);
  }
}

function buildRoutePreview(routeId) {
  const route = app.state.routes[routeId];
  const baseRoute = app.rulesData.routes[routeId];
  if (!route || !baseRoute) return null;

  const card = document.createElement("div");
  card.className = "selected-route-card-inner";
  card.innerHTML = `
    <div class="selected-route-title">${formatRouteName(routeId)}</div>
    <div class="selected-route-meta">
      Colour: ${getDisplayRouteColor(route.colour)}<br>
      Length: ${baseRoute.length}<br>
      Claimed: ${route.claimedBy || "No"}
    </div>
  `;
  return card;
}

function renderSelectedRouteCard() {
  const slot = document.getElementById("selected-route-card");
  if (!slot) return;
  slot.innerHTML = "";

  if (!app.state.selectedRouteId) {
    slot.innerHTML = `<div class="selected-route-card-inner empty">Tap a route to inspect it.</div>`;
    return;
  }

  const preview = buildRoutePreview(app.state.selectedRouteId);
  if (preview) slot.appendChild(preview);
}

function buildHandCard(color, extraClass = "") {
  const card = document.createElement("div");
  card.className = `hand-card ${color} ${extraClass}`.trim();
  card.textContent = color === "rainbow" ? "★" : color;
  return card;
}

function renderHandInto(container, player, cardClass = "") {
  const counts = countCards(player.hand);
  const order = ["red", "orange", "blue", "green", "black", "pink", "yellow", "rainbow"];

  order.forEach(color => {
    const count = counts[color] || 0;
    const stack = document.createElement("div");
    stack.className = `mobile-hand-stack ${color}`;
    stack.dataset.color = color;

    const visible = Math.min(Math.max(count, 1), 6);
    for (let i = 0; i < visible; i += 1) {
      const card = document.createElement("div");
      card.className = `mobile-hand-peek-card ${color} ${cardClass}`.trim();
      card.style.transform = `translateY(${i * -7}px)`;
      stack.appendChild(card);
    }

    const label = document.createElement("div");
    label.className = "mobile-hand-stack-label";
    label.textContent = `${color === "rainbow" ? "★" : color} ${count}`;
    stack.appendChild(label);

    container.appendChild(stack);
  });
}

function renderActiveHand() {
  const wrap = document.getElementById("active-hand");
  if (!wrap) return;
  wrap.innerHTML = "";

  const player = app.state.players[app.state.currentPlayer];
  player.hand.forEach(color => {
    wrap.appendChild(buildHandCard(color));
  });
}

function buildPlayerSummaryCard(playerName) {
  const player = app.state.players[playerName];
  const currentTargetId = getCurrentTargetForPlayer(player);
  const destinationTitle = currentTargetId
    ? (app.destinationData.destinations[currentTargetId]?.title || formatNodeName(currentTargetId))
    : "Return to Didcot Parkway";

  const card = document.createElement("div");
  card.className = `player-summary-card${app.state.currentPlayer === playerName ? " active" : ""}`;
  card.innerHTML = `
    <div class="player-summary-name">${playerName}</div>
    <div class="player-summary-meta">
      Current: ${formatNodeName(player.currentNode)}<br>
      Previous: ${player.previousNode ? formatNodeName(player.previousNode) : "—"}<br>
      Target: ${destinationTitle}<br>
      Completed: ${Math.min(player.completedCount, 5)}/5
    </div>
  `;
  return card;
}

function renderPlayerSummary() {
  const wrap = document.getElementById("player-summary");
  if (!wrap) return;
  wrap.innerHTML = "";
  wrap.appendChild(buildPlayerSummaryCard("Eric"));
  wrap.appendChild(buildPlayerSummaryCard("Tango"));
}

function buildDestinationSequenceElement(playerName, compact = false) {
  const player = app.state.players[playerName];
  const wrap = document.createElement("div");
  wrap.className = `destination-sequence${compact ? " compact" : ""}`;

  player.destinationSequence.forEach((destinationId, index) => {
    const item = document.createElement("div");
    const completed = index < player.completedCount;
    const current = index === player.completedCount;
    item.className = `destination-pill${completed ? " completed" : ""}${current ? " current" : ""}`;
    item.textContent = `${index + 1}. ${app.destinationData.destinations[destinationId]?.title || formatNodeName(destinationId)}`;
    wrap.appendChild(item);
  });

  return wrap;
}

function renderDestinationSequences() {
  const eric = document.getElementById("eric-destinations");
  const tango = document.getElementById("tango-destinations");
  if (eric) {
    eric.innerHTML = "";
    eric.appendChild(buildDestinationSequenceElement("Eric"));
  }
  if (tango) {
    tango.innerHTML = "";
    tango.appendChild(buildDestinationSequenceElement("Tango"));
  }
}

function clearRouteClasses(routeEl) {
  routeEl.classList.remove(
    "route-claimed-eric",
    "route-claimed-tango",
    "route-hover-playable",
    "route-hover-blocked",
    "route-selected"
  );
  routeEl.style.stroke = "";
  routeEl.style.strokeWidth = "";
  routeEl.style.filter = "";
}

function renderRoutes() {
  Object.keys(app.rulesData.routes || {}).forEach(routeId => {
    const routeEl = app.svg.querySelector(`#${CSS.escape(routeId)}`);
    if (!routeEl) return;

    clearRouteClasses(routeEl);

    const routeState = app.state.routes[routeId];
    routeEl.dataset.routeId = routeId;
    routeEl.style.cursor = "pointer";

    if (routeState.claimedBy) {
      const config = PLAYER_CONFIG[routeState.claimedBy];
      if (config?.routeClass) routeEl.classList.add(config.routeClass);
      routeEl.style.stroke = `url(#claim-gradient)`;
      routeEl.style.strokeWidth = "12";
      routeEl.style.filter = "drop-shadow(0 0 6px rgba(255,255,255,0.55))";
    } else {
      routeEl.style.stroke = ROUTE_COLOUR_HEX[routeState.colour] || ROUTE_COLOUR_HEX.grey;
      routeEl.style.strokeWidth = "10";
      routeEl.style.filter = "drop-shadow(0 0 3px rgba(0,0,0,0.25))";
    }

    if (app.state.selectedRouteId === routeId) {
      routeEl.classList.add("route-selected");
    }
  });
}

function findRouteMidpoint(routeEl) {
  try {
    const length = routeEl.getTotalLength();
    return routeEl.getPointAtLength(length / 2);
  } catch (error) {
    const bbox = routeEl.getBBox();
    return { x: bbox.x + bbox.width / 2, y: bbox.y + bbox.height / 2 };
  }
}

function ensureTokenLayer() {
  let layer = app.svg.querySelector("#token-layer");
  if (!layer) {
    layer = createSvgEl("g", { id: "token-layer" });
    app.svg.appendChild(layer);
  }
  return layer;
}

function buildToken(playerName) {
  const player = PLAYER_CONFIG[playerName];
  const token = createSvgEl("g", { class: `map-token ${player.tokenClass}` });

  const circle = createSvgEl("circle", { cx: "0", cy: "0", r: "15" });
  token.appendChild(circle);

  const image = createSvgEl("image", {
    x: "-12",
    y: "-12",
    width: "24",
    height: "24",
    preserveAspectRatio: "xMidYMid slice"
  });
  image.setAttributeNS(XLINK_NS, "href", player.image);
  token.appendChild(image);

  return token;
}

function getNodeCenter(nodeEl) {
  try {
    const bbox = nodeEl.getBBox();
    return {
      x: bbox.x + bbox.width / 2,
      y: bbox.y + bbox.height / 2
    };
  } catch (error) {
    return { x: 0, y: 0 };
  }
}

function renderTokens() {
  const layer = ensureTokenLayer();
  layer.innerHTML = "";

  ["Eric", "Tango"].forEach(playerName => {
    const player = app.state.players[playerName];
    const nodeEl = getNodeElement(app.svg, player.currentNode);
    if (!nodeEl) return;

    const token = buildToken(playerName);
    const point = getNodeCenter(nodeEl);
    token.setAttribute("transform", `translate(${point.x}, ${point.y})`);
    layer.appendChild(token);
  });
}

async function animateTokenAlongRoute(playerName, routeId, fromNode, toNode) {
  const layer = ensureTokenLayer();
  const routeEl = app.svg.querySelector(`#${CSS.escape(routeId)}`);
  const token = [...layer.querySelectorAll(".map-token")].find(el => el.classList.contains(PLAYER_CONFIG[playerName].tokenClass));
  const fromEl = getNodeElement(app.svg, fromNode);
  const toEl = getNodeElement(app.svg, toNode);

  if (!routeEl || !token || !fromEl || !toEl) {
    renderTokens();
    return;
  }

  const start = getNodeCenter(fromEl);
  const end = getNodeCenter(toEl);

  let pathStartAtEnd = false;
  try {
    const pointAtStart = routeEl.getPointAtLength(0);
    const pointAtEnd = routeEl.getPointAtLength(routeEl.getTotalLength());
    const distStart = Math.hypot(pointAtStart.x - start.x, pointAtStart.y - start.y);
    const distEnd = Math.hypot(pointAtEnd.x - start.x, pointAtEnd.y - start.y);
    pathStartAtEnd = distEnd < distStart;
  } catch (error) {
    pathStartAtEnd = false;
  }

  const animation = token.animate([
    { offsetDistance: pathStartAtEnd ? "100%" : "0%" },
    { offsetDistance: pathStartAtEnd ? "0%" : "100%" }
  ], {
    duration: 900,
    easing: "cubic-bezier(0.22, 1, 0.36, 1)",
    fill: "forwards"
  });

  token.style.offsetPath = `path('${routeEl.getAttribute("d") || ""}')`;
  token.style.offsetRotate = "0deg";

  await animation.finished.catch(() => null);
  token.style.offsetPath = "none";
  token.style.transform = `translate(${end.x}px, ${end.y}px)`;
  renderTokens();
}

function handleRouteSelection(routeId) {
  app.state.selectedRouteId = routeId;
  renderSelectedRouteCard();
  renderRoutes();
  handleRouteHover(routeId);

  if (getRoutePlayability(routeId).playable) {
    openRouteModal(routeId);
  }
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
  if (sheet) sheet.classList.add("expanded");
}

function closeMobileSheet() {
  const sheet = document.getElementById("mobile-sheet");
  if (sheet) sheet.classList.remove("expanded");
}

function toggleMobileSheet() {
  const sheet = document.getElementById("mobile-sheet");
  if (!sheet) return;
  sheet.classList.toggle("expanded");
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

  hudTurn.textContent = `${currentPlayerName} to play`;
  hudDraw.textContent = `Draw: ${app.state.drawPile.length}`;
  hudDestination.textContent = `Target: ${currentTargetTitle}`;

  drawBtn.textContent = "Draw card";
  routesBtn.textContent = "Routes";

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
  applyBoardTransform();
  app.state.players[app.state.currentPlayer].lastDrawColor = null;
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
    updateStatus(playability.reason);
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

  const routeColor = app.state.routes[routeId].colour;

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
  updateStatus(`${currentPlayerName} claimed ${formatRouteName(routeId)} and moved to ${formatNodeName(toNode)}.`);

  await animateTokenAlongRoute(currentPlayerName, routeId, fromNode, toNode);
  completeDestinationIfNeeded(currentPlayerName);
  renderAll();
  endTurn();
}

function showStartToast(playerName) {
  const toast = document.getElementById("start-toast");
  toast.textContent = `YOU ARE ${playerName.toUpperCase()}!`;
  toast.classList.add("show");
  window.setTimeout(() => {
    toast.classList.remove("show");
  }, 2200);
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
  showStartToast(playerName);
  centerBoardForMobile(true);
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
    updateStatus(`${playerName} returned to Didcot and wins the local prototype.`);
  } else {
    const nextTarget = getCurrentTargetForPlayer(player);
    if (player.completedCount >= 5) {
      updateStatus(`${playerName} completed five destinations. Final target: ${formatNodeName(nextTarget)}.`);
    } else {
      const nextDestination = app.destinationData.destinations[nextTarget];
      updateStatus(`${playerName} reached ${formatNodeName(target)}. Next target revealed: ${formatNodeName(nextTarget)}.`);
      openDestinationReveal(
        nextDestination?.title || formatNodeName(nextTarget),
        nextDestination?.description || "",
        player.completedCount + 1
      );
    }
  }

  return true;
}

async function animateMobileDrawToHand(cardColor) {
  const drawPile = document.getElementById("mobile-draw-pile");
  const handStack = document.querySelector(`#mobile-hand-peek .mobile-hand-stack.${cardColor}`) || document.querySelector("#mobile-hand-peek .mobile-hand-stack:last-child");
  const boardWrap = document.getElementById("board-wrap");

  if (!isMobileViewport() || !drawPile || !handStack || !boardWrap) return;

  const boardRect = boardWrap.getBoundingClientRect();
  const drawRect = drawPile.getBoundingClientRect();
  const targetRect = handStack.getBoundingClientRect();
  const ghost = document.createElement("div");
  ghost.className = `mobile-flying-card ${cardColor}`;
  ghost.innerHTML = `<div class="mobile-flying-card-face mobile-flying-card-back"></div><div class="mobile-flying-card-face mobile-flying-card-front">${cardColor === "rainbow" ? "★" : cardColor}</div>`;
  document.body.appendChild(ghost);

  const startX = drawRect.left + drawRect.width / 2;
  const startY = drawRect.top + drawRect.height / 2;
  const endX = targetRect.left + targetRect.width / 2;
  const endY = targetRect.top + Math.max(18, targetRect.height * 0.35);
  const liftY = Math.min(drawRect.top - 60, boardRect.top + 70);

  ghost.style.left = `${startX - 26}px`;
  ghost.style.top = `${startY - 36}px`;

  await ghost.animate([
    { transform: "translate3d(0,0,0) rotateY(0deg) scale(1)", offset: 0 },
    { transform: `translate3d(${(endX - startX) * 0.22}px, ${liftY - startY}px, 0) rotateY(0deg) scale(1.05)`, offset: 0.3 },
    { transform: `translate3d(${(endX - startX) * 0.6}px, ${(endY - startY) * 0.55 + (liftY - startY) * 0.25}px, 0) rotateY(90deg) scale(1.08)`, offset: 0.55 },
    { transform: `translate3d(${endX - startX}px, ${endY - startY}px, 0) rotateY(180deg) scale(0.92)`, offset: 1 }
  ], {
    duration: 760,
    easing: "cubic-bezier(0.22, 1, 0.36, 1)",
    fill: "forwards"
  }).finished.catch(() => null);

  ghost.remove();
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
  player.hand.push(card);
  player.lastDrawColor = card;
  updateStatus(`${currentPlayerName} drew ${card}.`);
  closeMobileSheet();
  endTurn();
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
  centerBoardForMobile(true);
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
  wrap.innerHTML = "";

  gameShell.insertBefore(wrap, statusChip);
}

function wireControlButtons() {
  document.getElementById("draw-card-btn").addEventListener("click", async () => {
    await drawCardForCurrentPlayer();
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

  document.getElementById("mobile-open-sheet-btn").addEventListener("click", async () => {
    await drawCardForCurrentPlayer();
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
    tightenSvgViewBox(svg);

    const audit = getSvgAudit(svg, rulesData);
    const state = createInitialLocalState(rulesData);

    app = {
      rulesData,
      destinationData,
      svg,
      audit,
      state,
      modal: {
        routeId: null,
        chosenColor: null,
        selectedOptionIndex: null,
        options: []
      },
      view: app.view
    };

    wireRouteInteractions();
    wireControlButtons();
    setupBoardPanZoom();
    centerBoardForMobile(true);
    renderAll();
    updateStatus("Pick your hero to begin.");
  } catch (error) {
    console.error(error);
    document.getElementById("status-chip").textContent = `Error loading board: ${error.message}`;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  setupFullscreenButton();
  init();
});
