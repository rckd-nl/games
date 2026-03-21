console.log("Didcot Dogs app.v1.js loaded");

const APP_VERSION = "v1.7";

const PLAYER_CONFIG = {
  Eric: {
    color: "#8d1218",
    tokenLabel: "E",
    routeClass: "route-claimed-eric",
    badgeClass: "eric",
    image: "./assets/eric.png"
  },
  Tango: {
    color: "#8d1218",
    tokenLabel: "T",
    routeClass: "route-claimed-tango",
    badgeClass: "tango",
    image: "./assets/tango.png"
  }
};

const ROUTE_COLOUR_HEX = {
  red: "#d74b4b",
  orange: "#db7f2f",
  blue: "#2f6edb",
  green: "#1e8b4c",
  white: "#f2f2f2",
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
  state: null
};

async function loadJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Failed to load ${url} (${response.status})`);
  }
  return response.json();
}

async function loadText(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Failed to load ${url} (${response.status})`);
  }
  return response.text();
}

async function injectBoardSvg() {
  const host = document.getElementById("board-svg-host");
  const svgText = await loadText("./assets/didcot-dogs-board.v1.svg");
  host.innerHTML = svgText;

  const svg = host.querySelector("svg");
  if (!svg) {
    throw new Error("Injected SVG markup did not contain an <svg> element.");
  }

  svg.removeAttribute("width");
  svg.removeAttribute("height");
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  svg.style.background = "#ffffff";

  return svg;
}

function setupFullscreenButton() {
  const btn = document.getElementById("fullscreen-btn");
  btn.addEventListener("click", async () => {
    const el = document.documentElement;
    if (!document.fullscreenElement) {
      await el.requestFullscreen();
    } else {
      await document.exitFullscreen();
    }
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

function getGroupBBox(group) {
  if (!group || typeof group.getBBox !== "function") {
    return null;
  }

  const bbox = group.getBBox();

  if (
    !Number.isFinite(bbox.x) ||
    !Number.isFinite(bbox.y) ||
    !Number.isFinite(bbox.width) ||
    !Number.isFinite(bbox.height)
  ) {
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

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY
  };
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

  const missingRuleRoutes = Object.keys(rulesData.routes || {}).filter(
    routeId => !routeIds.includes(routeId)
  );

  const missingRuleNodes = (rulesData.nodes || []).filter(
    nodeId => !nodeIds.includes(nodeId)
  );

  return {
    routeIds,
    nodeIds,
    routeCount: routeIds.length,
    nodeCount: nodeIds.length,
    missingRuleRoutes,
    missingRuleNodes
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
  if (parts.length !== 2) {
    throw new Error(`Could not parse route ID: ${routeId}`);
  }
  return { a: parts[0], b: parts[1] };
}

function formatNodeName(nodeId) {
  return String(nodeId).replaceAll("_", " ");
}

function formatRouteName(routeId) {
  const { a, b } = parseRouteId(routeId);
  return `${formatNodeName(a)} <> ${formatNodeName(b)}`;
}

function routesShareNode(routeIdA, routeIdB) {
  const a = parseRouteId(routeIdA);
  const b = parseRouteId(routeIdB);

  return (
    a.a === b.a ||
    a.a === b.b ||
    a.b === b.a ||
    a.b === b.b
  );
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
    for (let i = 0; i < copiesPerColour; i += 1) {
      deck.push(color);
    }
  });

  for (let i = 0; i < rainbowCount; i += 1) {
    deck.push("rainbow");
  }

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
    routes[routeId] = {
      colour: routeColours[routeId],
      claimedBy: null
    };
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
      Eric: {
        ...createPlayerState(rulesData.startNode),
        destinationQueue: ericQueue
      },
      Tango: {
        ...createPlayerState(rulesData.startNode),
        destinationQueue: tangoQueue
      }
    }
  };
}

function getCurrentTargetForPlayer(player) {
  if (player.completedCount < 5) {
    return player.destinationQueue[player.completedCount] || null;
  }
  return app.rulesData.winCondition?.finalDestinationAfterFive || "Didcot";
}

function getNodeElement(svg, nodeId) {
  return svg.querySelector(`#${CSS.escape(nodeId)}`);
}

function getNodeCenter(svg, nodeId) {
  const el = getNodeElement(svg, nodeId);
  if (!el) {
    throw new Error(`Node not found in SVG: ${nodeId}`);
  }

  if (el.tagName.toLowerCase() === "circle") {
    return {
      x: Number(el.getAttribute("cx")),
      y: Number(el.getAttribute("cy"))
    };
  }

  const box = el.getBBox();
  return {
    x: box.x + box.width / 2,
    y: box.y + box.height / 2
  };
}

function ensureLayer(svg, layerId) {
  let layer = svg.querySelector(`#${CSS.escape(layerId)}`);
  if (layer) return layer;

  layer = document.createElementNS("http://www.w3.org/2000/svg", "g");
  layer.setAttribute("id", layerId);
  svg.appendChild(layer);
  return layer;
}

function ensureTokenDefs(svg) {
  let defs = svg.querySelector("defs");
  if (!defs) {
    defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
    svg.insertBefore(defs, svg.firstChild);
  }

  ["Eric", "Tango"].forEach(playerName => {
    const clipId = `token-clip-${playerName}`;
    if (!svg.querySelector(`#${CSS.escape(clipId)}`)) {
      const clipPath = document.createElementNS("http://www.w3.org/2000/svg", "clipPath");
      clipPath.setAttribute("id", clipId);

      const clipCircle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      clipCircle.setAttribute("cx", "0");
      clipCircle.setAttribute("cy", "0");
      clipCircle.setAttribute("r", "20");

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

  group = document.createElementNS("http://www.w3.org/2000/svg", "g");
  group.setAttribute("id", `token-${playerName}`);
  group.setAttribute("class", "token-group");

  const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  circle.setAttribute("class", "token-circle");
  circle.setAttribute("r", "24");
  circle.setAttribute("fill", "#ffffff");

  const image = document.createElementNS("http://www.w3.org/2000/svg", "image");
  image.setAttribute("href", PLAYER_CONFIG[playerName].image);
  image.setAttribute("x", "-20");
  image.setAttribute("y", "-20");
  image.setAttribute("width", "40");
  image.setAttribute("height", "40");
  image.setAttribute("preserveAspectRatio", "xMidYMid meet");
  image.setAttribute("clip-path", `url(#token-clip-${playerName})`);

  group.appendChild(circle);
  group.appendChild(image);
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

function getRoutePaymentOptions(routeId, playerName) {
  const player = app.state.players[playerName];
  const handCounts = countCards(player.hand);
  const rainbowCount = handCounts.rainbow || 0;
  const routeColour = app.state.routes[routeId].colour;
  const cost = app.rulesData.routes[routeId].length;
  const drawColours = app.rulesData.drawColours || [];

  if (routeColour === "grey") {
    const options = drawColours
      .map(color => {
        const owned = handCounts[color] || 0;
        const total = owned + rainbowCount;
        return total >= cost
          ? {
              colourChoice: color,
              useColourCount: Math.min(owned, cost),
              useRainbowCount: Math.max(0, cost - owned)
            }
          : null;
      })
      .filter(Boolean);

    return {
      affordable: options.length > 0,
      options
    };
  }

  const owned = handCounts[routeColour] || 0;
  const total = owned + rainbowCount;

  if (total < cost) {
    return { affordable: false, options: [] };
  }

  return {
    affordable: true,
    options: [
      {
        colourChoice: routeColour,
        useColourCount: Math.min(owned, cost),
        useRainbowCount: Math.max(0, cost - owned)
      }
    ]
  };
}

function getRoutePlayability(routeId) {
  const currentPlayerName = app.state.currentPlayer;
  const currentPlayer = app.state.players[currentPlayerName];
  const routeState = app.state.routes[routeId];
  const connectedNode = getConnectedNode(routeId, currentPlayer.currentNode);

  if (!connectedNode) {
    return {
      playable: false,
      reason: "Route does not connect to current node."
    };
  }

  if (routeState.claimedBy) {
    return {
      playable: false,
      reason: `Already claimed by ${routeState.claimedBy}.`
    };
  }

  if (currentPlayer.previousNode && connectedNode === currentPlayer.previousNode) {
    return {
      playable: false,
      reason: "Cannot move straight back to previous node."
    };
  }

  const payment = getRoutePaymentOptions(routeId, currentPlayerName);

  if (!payment.affordable) {
    return {
      playable: false,
      reason: "Not enough matching cards.",
      targetNode: connectedNode
    };
  }

  return {
    playable: true,
    targetNode: connectedNode,
    payment
  };
}

function drawCard() {
  if (!app.state.drawPile.length) {
    if (!app.state.discardPile.length) {
      return null;
    }
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

  return {
    nextHand,
    spent
  };
}

function endTurn() {
  app.state.selectedRouteId = null;
  app.state.currentPlayer = app.state.currentPlayer === "Eric" ? "Tango" : "Eric";
  renderAll();
}

function easeInOutCubic(t) {
  return t < 0.5
    ? 4 * t * t * t
    : 1 - Math.pow(-2 * t + 2, 3) / 2;
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
    const { a } = parseRouteId(routeId);
    const forward = fromNode === a && toNode !== a;
    const start = performance.now();

    function step(now) {
      const elapsed = now - start;
      const progress = Math.min(1, elapsed / duration);
      const eased = easeInOutCubic(progress);
      const routeProgress = forward ? eased : 1 - eased;
      const point = routeEl.getPointAtLength(total * routeProgress);

      const ericNode = app.state.players.Eric.currentNode;
      const tangoNode = app.state.players.Tango.currentNode;
      let x = point.x;
      let y = point.y;

      if (ericNode === tangoNode && playerName === "Eric") {
        x -= 18;
      }
      if (ericNode === tangoNode && playerName === "Tango") {
        x += 18;
      }

      token.setAttribute("transform", `translate(${x}, ${y})`);

      if (progress < 1) {
        requestAnimationFrame(step);
      } else {
        resolve();
      }
    }

    requestAnimationFrame(step);
  });
}

function updateStatus(text) {
  document.getElementById("status-chip").textContent = text;
}

function ensureRouteCostLayer() {
  return ensureLayer(app.svg, "route-cost-layer");
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
    const hex = ROUTE_COLOUR_HEX[routeColour] || "#7a7a7a";
    const cost = app.rulesData.routes[routeId].length;

    const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
    group.setAttribute("class", "route-cost-badge");
    group.setAttribute("transform", `translate(${mid.x}, ${mid.y})`);

    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.setAttribute("r", "12");
    circle.setAttribute("fill", "#ffffff");
    circle.setAttribute("stroke", hex);

    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.setAttribute("x", "0");
    text.setAttribute("y", "0");
    text.setAttribute("fill", hex);
    text.setAttribute("dy", "0.35em");
    text.textContent = String(cost);

    group.appendChild(circle);
    group.appendChild(text);
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
    const baseColour = ROUTE_COLOUR_HEX[routeState.colour] || "#7a7a7a";
    routeEl.style.stroke = baseColour;
    routeEl.style.strokeWidth = "8";
    routeEl.style.cursor = "pointer";

    if (routeState.claimedBy) {
      routeEl.classList.add(PLAYER_CONFIG[routeState.claimedBy].routeClass);
      return;
    }

    const playability = getRoutePlayability(routeId);

    if (playability.playable) {
      routeEl.classList.add("route-eligible");
    } else if (playability.reason !== "Route does not connect to current node.") {
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
  badge.className = `player-badge ${PLAYER_CONFIG[app.state.currentPlayer].badgeClass}`;
  badge.textContent = `${app.state.currentPlayer} to play`;
}

function renderCounts() {
  document.getElementById("draw-pile-count").textContent = app.state.drawPile.length;
  document.getElementById("discard-pile-count").textContent = app.state.discardPile.length;
}

function renderSelectedRouteCard() {
  const card = document.getElementById("selected-route-card");
  const routeId = app.state.selectedRouteId;

  card.className = "selected-route-card";

  if (!routeId) {
    card.textContent = "No route selected.";
    return;
  }

  const routeColour = app.state.routes[routeId].colour;
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
  const order = ["red", "orange", "blue", "green", "white", "black", "pink", "yellow", "rainbow"];
  return order
    .filter(color => (counts[color] || 0) > 0)
    .map(color => ({ color, count: counts[color] }));
}

function renderActiveHand() {
  const wrap = document.getElementById("active-hand");
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

    if (player.lastDrawColor === stack.color) {
      el.classList.add("draw-in");
    }

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
  if (flip) {
    el.classList.add("flip-in");
  }
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
  el.innerHTML = `
    <div class="destination-title">✓ ${title}</div>
  `;
  return el;
}

function renderDestinationSequences() {
  const wrap = document.getElementById("destination-sequences");
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

function renderDebug(audit) {
  const leftDebug = document.getElementById("left-debug");
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

function renderButtons() {
  const playBtn = document.getElementById("play-route-btn");
  const selected = app.state.selectedRouteId;
  playBtn.disabled = !selected || !getRoutePlayability(selected).playable;
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
  renderDebug(app.audit);
  renderButtons();
}

function chooseGreyRoutePayment(optionSet) {
  if (optionSet.options.length === 1) {
    return optionSet.options[0];
  }

  const choices = optionSet.options.map(opt => opt.colourChoice);
  const answer = window.prompt(
    `Grey route. Choose a colour: ${choices.join(", ")}`,
    choices[0]
  );

  if (!answer) return null;

  const chosen = optionSet.options.find(
    opt => opt.colourChoice.toLowerCase() === answer.trim().toLowerCase()
  );

  return chosen || null;
}

function showStartToast(playerName) {
  const toast = document.getElementById("start-toast");
  toast.textContent = `YOU ARE ${playerName.toUpperCase()}!`;
  toast.classList.add("show");
  window.setTimeout(() => {
    toast.classList.remove("show");
  }, 2200);
}

function startGameAs(playerName) {
  app.state = createInitialLocalState(app.rulesData, playerName);
  document.getElementById("hero-overlay").classList.remove("active");
  showStartToast(playerName);
  renderAll();
  updateStatus(`${playerName} begins. Choose one action: draw a card or play a selected eligible route.`);
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
      updateStatus(`${playerName} reached ${formatNodeName(target)}. Next target revealed: ${formatNodeName(nextTarget)}.`);
    }
  }

  return true;
}

async function playSelectedRoute() {
  const routeId = app.state.selectedRouteId;
  if (!routeId) {
    updateStatus("Select a route first.");
    return;
  }

  const playability = getRoutePlayability(routeId);
  if (!playability.playable) {
    updateStatus(playability.reason);
    renderAll();
    return;
  }

  const currentPlayerName = app.state.currentPlayer;
  const currentPlayer = app.state.players[currentPlayerName];
  const routeColour = app.state.routes[routeId].colour;
  let chosenPayment = playability.payment.options[0];

  if (routeColour === "grey" && playability.payment.options.length > 1) {
    chosenPayment = chooseGreyRoutePayment(playability.payment);
    if (!chosenPayment) {
      updateStatus("Grey route payment cancelled.");
      return;
    }
  }

  const confirmed = window.confirm(`Confirm playing ${formatRouteName(routeId)}?`);
  if (!confirmed) {
    updateStatus("Route play cancelled.");
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
  const toNode = playability.targetNode;

  app.state.routes[routeId].claimedBy = currentPlayerName;
  currentPlayer.previousNode = fromNode;
  currentPlayer.currentNode = toNode;
  currentPlayer.journeyRouteIds.push(routeId);

  app.state.selectedRouteId = null;
  renderAll();
  updateStatus(`${currentPlayerName} claimed ${formatRouteName(routeId)} and moved to ${formatNodeName(toNode)}.`);

  await animateTokenAlongRoute(currentPlayerName, routeId, fromNode, toNode);
  completeDestinationIfNeeded(currentPlayerName);
  renderAll();
  endTurn();
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
  const routeColour = app.state.routes[routeId].colour;
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
      updateStatus("Choose one action: draw a card or play a selected eligible route.");
    });

    routeEl.addEventListener("click", () => {
      app.state.selectedRouteId = routeId;
      renderAll();
      handleRouteHover(routeId);
    });
  });
}

function wireControlButtons() {
  document.getElementById("draw-card-btn").addEventListener("click", () => {
    drawCardForCurrentPlayer();
  });

  document.getElementById("play-route-btn").addEventListener("click", async () => {
    await playSelectedRoute();
  });

  document.getElementById("reset-local-btn").addEventListener("click", () => {
    app.state = createInitialLocalState(app.rulesData, app.state.controlledHero || "Eric");
    renderAll();
    updateStatus("Local game reset.");
  });

  document.getElementById("pick-eric-btn").addEventListener("click", () => {
    startGameAs("Eric");
  });

  document.getElementById("pick-tango-btn").addEventListener("click", () => {
    startGameAs("Tango");
  });
}

async function init() {
  try {
    const [rulesData, destinationData] = await Promise.all([
      loadJson("./data/didcot-dogs-rules.v1.json"),
      loadJson("./data/didcot-dogs-destinations.v1.json")
    ]);

    const svg = await injectBoardSvg();
    normalizeSvgNodeAliases(svg, rulesData);
    tightenSvgViewBox(svg);

    const audit = getSvgAudit(svg, rulesData);
    const state = createInitialLocalState(rulesData);

    app = {
      rulesData,
      destinationData,
      svg,
      audit,
      state
    };

    wireRouteInteractions();
    wireControlButtons();
    renderAll();
    updateStatus("Pick your hero to begin.");
  } catch (error) {
    console.error(error);
    document.getElementById("status-chip").textContent =
      `Error loading board: ${error.message}`;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  setupFullscreenButton();
  init();
});
