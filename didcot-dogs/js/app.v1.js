console.log("Didcot Dogs app.v1.js loaded");

const APP_VERSION = "v1.9.1";
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

  const wobble = createSvgEl("g", {
    class: "token-wobble"
  });

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
  app.state.currentPlayer = app.state.currentPlayer === "Eric" ? "Tango" : "Eric";
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

function updateStatus(text) {
  const chip = document.getElementById("status-chip");
  if (chip) chip.textContent = text;
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

    group.addEventListener("click", (evt) => {
      evt.stopPropagation();
      handleRouteSelection(routeId);
    });

    group.addEventListener("mouseenter", (evt) => {
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

function renderActiveHand() {
  const wrap = document.getElementById("active-hand");
  if (!wrap) return;

  const player = app.state.players[app.state.currentPlayer];
  const stacks = getHandStacks(player.hand);

  wrap.innerHTML = "";

  if (!stacks.length) {
    const empty = document.createElement("div");
    empty.className = "panel-copy";
    empty.textContent = "No cards yet.";
    wrap.appendChild(empty);
    return;
  }

  stacks.forEach(stack => {
    const el = document.createElement("div");
    el.className = `hand-card ${stack.color}`;
    if (player.lastDrawColor === stack.color) el.classList.add("draw-in");
    el.innerHTML = `
      <div class="card-name">${stack.color}</div>
      <div class="card-count">${stack.count}</div>
    `;
    wrap.appendChild(el);
  });

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

function renderDestinationSequences() {
  const wrap = document.getElementById("destination-sequences");
  if (!wrap) return;

  wrap.innerHTML = "";

  const shownPlayerName = app.state.currentPlayer;
  const player = app.state.players[shownPlayerName];

  const sequence = document.createElement("div");
  sequence.className = "destination-sequence";

  const title = document.createElement("div");
  title.className = "sequence-title";
  title.textContent = `${shownPlayerName} journey cards`;

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
      const shouldFlip = app.state.justCompleted?.playerName === shownPlayerName;
      grid.appendChild(createDestinationActiveCard(label, body, shouldFlip));
    } else {
      grid.appendChild(createDestinationQuestionCard());
    }
  }

  sequence.appendChild(title);
  sequence.appendChild(grid);
  wrap.appendChild(sequence);
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

function renderMobileUi() {
  const hudTurn = document.getElementById("mobile-hud-turn");
  const hudDraw = document.getElementById("mobile-hud-draw");
  const hudDestination = document.getElementById("mobile-hud-destination");
  const sheetSummary = document.getElementById("mobile-sheet-summary");
  const sheetSelectedRoute = document.getElementById("mobile-sheet-selected-route");
  const sheetActions = document.getElementById("mobile-sheet-actions");
  const sheetHand = document.getElementById("mobile-sheet-hand");
  const sheetDestination = document.getElementById("mobile-sheet-destination");

  if (!hudTurn || !hudDraw || !hudDestination || !sheetSummary || !sheetSelectedRoute || !sheetActions || !sheetHand || !sheetDestination) {
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

  sheetSummary.innerHTML = `
    <div class="player-summary-card active">
      <div class="player-summary-name">${currentPlayerName}</div>
      <div class="player-summary-meta">
        Current node: ${formatNodeName(currentPlayer.currentNode)}<br>
        Previous node: ${currentPlayer.previousNode ? formatNodeName(currentPlayer.previousNode) : "—"}<br>
        Hand size: ${currentPlayer.hand.length}<br>
        Completed: ${Math.min(currentPlayer.completedCount, 5)}/5<br>
        Draw pile: ${app.state.drawPile.length}<br>
        Discard pile: ${app.state.discardPile.length}
      </div>
    </div>
  `;

  if (!app.state.selectedRouteId) {
    sheetSelectedRoute.innerHTML = `
      <div class="mini-heading">Selected route</div>
      <div class="selected-route-card">No route selected.</div>
    `;
  } else {
    const routeId = app.state.selectedRouteId;
    const routeColour = getDisplayRouteColor(app.state.routes[routeId].colour);
    const cost = app.rulesData.routes[routeId].length;
    const playability = getRoutePlayability(routeId);

    sheetSelectedRoute.innerHTML = `
      <div class="mini-heading">Selected route</div>
      <div class="selected-route-card ${playability.playable ? "valid" : "invalid"}">
        <strong>${formatRouteName(routeId)}</strong><br>
        Colour: ${routeColour}<br>
        Cost: ${cost}<br>
        ${playability.playable ? `Destination node if played: ${formatNodeName(playability.targetNode)}` : playability.reason}
      </div>
    `;
  }

  sheetActions.innerHTML = `
    <div class="mini-heading">Actions</div>
    <div class="controls-grid">
      <button id="mobile-draw-card-btn" class="action-btn primary" type="button">Pick random card</button>
      <button id="mobile-reset-local-btn" class="action-btn subtle" type="button">Reset local game</button>
    </div>
  `;

  const stacks = getHandStacks(currentPlayer.hand);
  sheetHand.innerHTML = `<div class="mini-heading">Active hand</div>`;
  const handWrap = document.createElement("div");
  handWrap.className = "hand-grid";

  if (!stacks.length) {
    const empty = document.createElement("div");
    empty.className = "panel-copy";
    empty.textContent = "No cards yet.";
    handWrap.appendChild(empty);
  } else {
    stacks.forEach(stack => {
      const el = document.createElement("div");
      el.className = `hand-card ${stack.color}`;
      el.innerHTML = `
        <div class="card-name">${stack.color}</div>
        <div class="card-count">${stack.count}</div>
      `;
      handWrap.appendChild(el);
    });
  }

  sheetHand.appendChild(handWrap);

  const destinationSequence = document.createElement("div");
  destinationSequence.className = "destination-sequence";
  const sequenceTitle = document.createElement("div");
  sequenceTitle.className = "sequence-title";
  sequenceTitle.textContent = `${currentPlayerName} journey cards`;
  const grid = document.createElement("div");
  grid.className = "destination-card-grid";

  for (let i = 0; i < 5; i += 1) {
    const destinationId = currentPlayer.destinationQueue[i];
    const destination = app.destinationData.destinations[destinationId];
    const label = destination ? destination.title : formatNodeName(destinationId);
    const body = destination?.description || "";

    if (i < currentPlayer.completedCount) {
      grid.appendChild(createDestinationCompletedCard(label));
    } else if (i === currentPlayer.completedCount && currentPlayer.completedCount < 5) {
      grid.appendChild(createDestinationActiveCard(label, body, false));
    } else {
      grid.appendChild(createDestinationQuestionCard());
    }
  }

  destinationSequence.appendChild(sequenceTitle);
  destinationSequence.appendChild(grid);
  sheetDestination.innerHTML = "";
  sheetDestination.appendChild(destinationSequence);

  const mobileDrawBtn = document.getElementById("mobile-draw-card-btn");
  const mobileResetBtn = document.getElementById("mobile-reset-local-btn");

  if (mobileDrawBtn) {
    mobileDrawBtn.addEventListener("click", () => {
      drawCardForCurrentPlayer();
    });
  }

  if (mobileResetBtn) {
    mobileResetBtn.addEventListener("click", () => {
      app.state = createInitialLocalState(app.rulesData, app.state.controlledHero || "Eric");
      closeRouteModal();
      closeDestinationReveal();
      renderAll();
      if (app.state.controlledHero) showCurrentDestinationReveal(app.state.controlledHero);
      updateStatus("Local game reset.");
    });
  }
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
  renderMobileUi();
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

function drawCardForCurrentPlayer() {
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

function wireControlButtons() {
  document.getElementById("draw-card-btn").addEventListener("click", () => {
    drawCardForCurrentPlayer();
  });

  document.getElementById("reset-local-btn").addEventListener("click", () => {
    app.state = createInitialLocalState(app.rulesData, app.state.controlledHero || "Eric");
    closeRouteModal();
    closeDestinationReveal();
    renderAll();
    if (app.state.controlledHero) showCurrentDestinationReveal(app.state.controlledHero);
    updateStatus("Local game reset.");
  });

  document.getElementById("pick-eric-btn").addEventListener("click", () => {
    startGameAs("Eric");
  });

  document.getElementById("pick-tango-btn").addEventListener("click", () => {
    startGameAs("Tango");
  });

  document.getElementById("mobile-open-sheet-btn").addEventListener("click", () => {
    document.getElementById("mobile-sheet").classList.add("expanded");
  });

  document.getElementById("mobile-sheet-handle").addEventListener("click", () => {
    document.getElementById("mobile-sheet").classList.toggle("expanded");
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
      }
    };

    wireRouteInteractions();
    wireControlButtons();
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