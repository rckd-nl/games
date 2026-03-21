console.log("Didcot Dogs app.v1.js loaded");

const APP_VERSION = "v1.5";

const PLAYER_CONFIG = {
  Eric: {
    tokenLabel: "E",
    routeClass: "route-claimed-eric",
    badgeClass: "eric",
    tokenOffset: { x: -18, y: -18 }
  },
  Tango: {
    tokenLabel: "T",
    routeClass: "route-claimed-tango",
    badgeClass: "tango",
    tokenOffset: { x: 18, y: 18 }
  }
};

const ROUTE_COLOUR_HEX = {
  red: "#cb3636",
  orange: "#d77721",
  blue: "#2e73c8",
  green: "#2f9b55",
  white: "#dbdbdb",
  black: "#2f2f2f",
  pink: "#c94d8f",
  yellow: "#c8a11b",
  grey: "#8f8f8f"
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

function setupHeroButtons() {
  document.querySelectorAll(".hero-pick-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      selectHero(btn.dataset.hero);
    });
  });
}

function selectHero(heroName) {
  const overlay = document.getElementById("hero-overlay");
  const confirmation = document.getElementById("hero-confirmation");

  app.state.localHero = heroName;
  confirmation.textContent = `YOU ARE ${heroName.toUpperCase()}!`;

  updateStatus(`YOU ARE ${heroName.toUpperCase()}! Prototype mode: both turns are still playable locally.`);
  renderAll();

  setTimeout(() => {
    overlay.classList.remove("is-visible");
  }, 650);
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

  const padding = 10;
  const x = contentBox.x - padding;
  const y = contentBox.y - padding;
  const width = contentBox.width + padding * 2;
  const height = contentBox.height + padding * 2;

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
  return nodeId.replaceAll("_", " ");
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

function createDestinationSequences(rulesData) {
  const pool = shuffle(rulesData.destinationPool || []);
  return {
    Eric: pool.slice(0, 5),
    Tango: pool.slice(5, 10)
  };
}

function createInitialLocalState(rulesData) {
  const routeIds = Object.keys(rulesData.routes || {});
  const routeColours = assignRouteColours(routeIds, rulesData.routeColours || []);
  const routes = {};

  routeIds.forEach(routeId => {
    routes[routeId] = {
      colour: routeColours[routeId],
      claimedBy: null
    };
  });

  const destinationSequences = createDestinationSequences(rulesData);

  return {
    currentPlayer: "Eric",
    localHero: null,
    selectedRouteId: null,
    drawPile: buildDeck(rulesData),
    discardPile: [],
    lastDrawCard: null,
    winner: null,
    routes,
    players: {
      Eric: {
        currentNode: rulesData.startNode,
        previousNode: null,
        hand: [],
        journeyRouteIds: [],
        destinationSequence: destinationSequences.Eric,
        currentDestinationIndex: 0,
        completedJourneys: 0,
        returnToDidcot: false
      },
      Tango: {
        currentNode: rulesData.startNode,
        previousNode: null,
        hand: [],
        journeyRouteIds: [],
        destinationSequence: destinationSequences.Tango,
        currentDestinationIndex: 0,
        completedJourneys: 0,
        returnToDidcot: false
      }
    }
  };
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

function ensureTokenLayer(svg) {
  let layer = svg.querySelector("#token-layer");
  if (layer) return layer;

  layer = document.createElementNS("http://www.w3.org/2000/svg", "g");
  layer.setAttribute("id", "token-layer");
  svg.appendChild(layer);
  return layer;
}

function ensureBadgeLayer(svg) {
  let layer = svg.querySelector("#route-cost-layer");
  if (layer) return layer;

  layer = document.createElementNS("http://www.w3.org/2000/svg", "g");
  layer.setAttribute("id", "route-cost-layer");
  svg.appendChild(layer);
  return layer;
}

function ensurePlayerToken(svg, playerName) {
  const layer = ensureTokenLayer(svg);
  let group = svg.querySelector(`#token-${CSS.escape(playerName)}`);
  if (group) return group;

  group = document.createElementNS("http://www.w3.org/2000/svg", "g");
  group.setAttribute("id", `token-${playerName}`);

  const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  circle.setAttribute("class", "token-circle");
  circle.setAttribute("r", "24");

  const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
  text.setAttribute("class", "token-label");
  text.textContent = PLAYER_CONFIG[playerName].tokenLabel;

  group.appendChild(circle);
  group.appendChild(text);
  layer.appendChild(group);

  return group;
}

function setTokenPosition(svg, playerName, x, y) {
  const token = ensurePlayerToken(svg, playerName);
  const circle = token.querySelector("circle");
  const text = token.querySelector("text");

  circle.setAttribute("cx", x);
  circle.setAttribute("cy", y);

  text.setAttribute("x", x);
  text.setAttribute("y", y + 1);
}

function getPlayerTokenAnchor(playerName, nodeId) {
  const center = getNodeCenter(app.svg, nodeId);
  const offset = PLAYER_CONFIG[playerName].tokenOffset;
  return {
    x: center.x + offset.x,
    y: center.y + offset.y
  };
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

function getCurrentTargetDestination(playerName) {
  const player = app.state.players[playerName];
  if (player.returnToDidcot) return "Didcot";
  return player.destinationSequence[player.currentDestinationIndex] || null;
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

function pickNonAdjacentColour(routeId) {
  const palette = app.rulesData.routeColours || [];
  const blocked = Object.entries(app.state.routes)
    .filter(([otherId]) => otherId !== routeId && routesShareNode(routeId, otherId))
    .map(([, routeState]) => routeState.colour);

  const options = shuffle(palette.filter(color => !blocked.includes(color)));
  return options[0] || shuffle(palette)[0];
}

function rerollReleasedRoutes(routeIds) {
  routeIds.forEach(routeId => {
    const routeState = app.state.routes[routeId];
    routeState.claimedBy = null;
    routeState.colour = pickNonAdjacentColour(routeId);
  });
}

function releaseJourneyRoutes(playerName) {
  const player = app.state.players[playerName];
  const released = [...player.journeyRouteIds];
  rerollReleasedRoutes(released);
  player.journeyRouteIds = [];
  return released;
}

function completeDestinationIfNeeded(playerName) {
  const player = app.state.players[playerName];
  const target = getCurrentTargetDestination(playerName);
  if (!target) return null;
  if (player.currentNode !== target) return null;

  if (player.returnToDidcot && target === "Didcot") {
    app.state.winner = playerName;
    releaseJourneyRoutes(playerName);
    return {
      type: "win",
      target
    };
  }

  player.completedJourneys += 1;
  const releasedRoutes = releaseJourneyRoutes(playerName);

  if (player.completedJourneys >= (app.rulesData.winCondition?.targetJourneysBeforeReturn ?? 5)) {
    player.returnToDidcot = true;
  } else {
    player.currentDestinationIndex += 1;
  }

  return {
    type: "destination-complete",
    target,
    releasedRoutes
  };
}

function endTurn() {
  app.state.selectedRouteId = null;
  app.state.lastDrawCard = null;
  app.state.currentPlayer = app.state.currentPlayer === "Eric" ? "Tango" : "Eric";
  renderAll();
}

function easeInOutCubic(t) {
  return t < 0.5
    ? 4 * t * t * t
    : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function animateTokenAlongRoute(playerName, routeId, fromNode) {
  return new Promise(resolve => {
    const routeEl = app.svg.querySelector(`#${CSS.escape(routeId)}`);
    if (!routeEl || typeof routeEl.getTotalLength !== "function") {
      renderTokens();
      resolve();
      return;
    }

    const token = ensurePlayerToken(app.svg, playerName);
    const circle = token.querySelector("circle");
    const text = token.querySelector("text");

    const total = routeEl.getTotalLength();
    const duration = 880;
    const { a } = parseRouteId(routeId);
    const forward = fromNode === a;
    const offset = PLAYER_CONFIG[playerName].tokenOffset;
    const start = performance.now();

    function step(now) {
      const elapsed = now - start;
      const linear = Math.min(1, elapsed / duration);
      const progress = easeInOutCubic(linear);
      const routeProgress = forward ? progress : 1 - progress;
      const point = routeEl.getPointAtLength(total * routeProgress);

      const x = point.x + offset.x;
      const y = point.y + offset.y;

      circle.setAttribute("cx", x);
      circle.setAttribute("cy", y);
      text.setAttribute("x", x);
      text.setAttribute("y", y + 1);

      if (linear < 1) {
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

function ensureRouteBaseStrokes() {
  Object.keys(app.rulesData.routes || {}).forEach(routeId => {
    const routeEl = app.svg.querySelector(`#${CSS.escape(routeId)}`);
    if (!routeEl) return;

    if (!routeEl.dataset.baseStrokeWidth) {
      const existing = parseFloat(routeEl.getAttribute("stroke-width")) ||
        parseFloat(window.getComputedStyle(routeEl).strokeWidth) ||
        4;
      routeEl.dataset.baseStrokeWidth = String(existing);
    }
  });
}

function getBadgeColourHex(routeColour) {
  if (routeColour === "white") return "#8a8a8a";
  return ROUTE_COLOUR_HEX[routeColour] || "#666666";
}

function renderRouteBadges() {
  const layer = ensureBadgeLayer(app.svg);
  layer.innerHTML = "";

  Object.keys(app.rulesData.routes || {}).forEach(routeId => {
    const routeEl = app.svg.querySelector(`#${CSS.escape(routeId)}`);
    if (!routeEl || typeof routeEl.getTotalLength !== "function") return;

    const routeState = app.state.routes[routeId];
    if (routeState.claimedBy) return;

    const total = routeEl.getTotalLength();
    const point = routeEl.getPointAtLength(total / 2);
    const colourHex = getBadgeColourHex(routeState.colour);
    const cost = app.rulesData.routes[routeId].length;

    const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
    group.setAttribute("id", `badge-${routeId}`);

    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.setAttribute("class", "route-cost-badge-circle");
    circle.setAttribute("cx", point.x);
    circle.setAttribute("cy", point.y);
    circle.setAttribute("r", "14");
    circle.setAttribute("stroke", colourHex);

    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.setAttribute("class", "route-cost-badge-text");
    text.setAttribute("x", point.x);
    text.setAttribute("y", point.y + 1);
    text.setAttribute("fill", colourHex);
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
    const baseColour = ROUTE_COLOUR_HEX[routeState.colour] || "#8f8f8f";
    const baseStroke = parseFloat(routeEl.dataset.baseStrokeWidth || "4");

    routeEl.style.stroke = baseColour;
    routeEl.style.cursor = "pointer";
    routeEl.style.strokeWidth = String(baseStroke);

    if (routeState.colour === "white") {
      routeEl.style.filter = "drop-shadow(0 0 1px rgba(0,0,0,0.35))";
    } else {
      routeEl.style.filter = "";
    }

    if (routeState.claimedBy) {
      routeEl.classList.add(PLAYER_CONFIG[routeState.claimedBy].routeClass);
      routeEl.style.strokeWidth = String(baseStroke * 1.9);
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
      routeEl.style.strokeWidth = String(baseStroke * 1.15);
    }
  });

  renderRouteBadges();
}

function renderTurnBadge() {
  const badge = document.getElementById("turn-player-badge");
  badge.className = `player-badge ${PLAYER_CONFIG[app.state.currentPlayer].badgeClass}`;
  badge.textContent = `${app.state.currentPlayer} to play`;

  const instruction = document.getElementById("turn-instruction");
  if (app.state.winner) {
    instruction.textContent = `${app.state.winner} has won the local prototype.`;
  } else if (!app.state.localHero) {
    instruction.textContent = "Pick your hero to begin.";
  } else {
    instruction.textContent = "Choose one action: draw a card or play a selected eligible route.";
  }
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

function renderActiveHand() {
  const wrap = document.getElementById("active-hand");
  const hand = app.state.players[app.state.currentPlayer].hand;
  const counts = countCards(hand);
  const order = ["red", "orange", "blue", "green", "white", "black", "pink", "yellow", "rainbow"];

  wrap.innerHTML = "";

  const presentColours = order.filter(color => (counts[color] || 0) > 0);

  if (!presentColours.length) {
    const empty = document.createElement("div");
    empty.className = "hand-empty";
    empty.textContent = "No cards yet.";
    wrap.appendChild(empty);
    return;
  }

  presentColours.forEach(color => {
    const card = document.createElement("div");
    const animateClass = app.state.lastDrawCard === color ? " animate-dealt" : "";
    card.className = `hand-card-physical ${color}${animateClass}`;

    card.innerHTML = `
      <div class="hand-card-top">
        <div class="hand-card-name">${color}</div>
        <div class="hand-card-count">${counts[color]}</div>
      </div>
      <div class="hand-card-footer">Travel card</div>
    `;

    wrap.appendChild(card);
  });
}

function renderDestinations() {
  const wrap = document.getElementById("destination-columns");
  wrap.innerHTML = "";

  ["Eric", "Tango"].forEach(playerName => {
    const player = app.state.players[playerName];
    const block = document.createElement("div");
    block.className = "destination-player-block";

    const title = document.createElement("div");
    title.className = "destination-player-title";
    title.textContent = `${playerName}`;
    block.appendChild(title);

    const meta = document.createElement("div");
    meta.className = "player-summary-meta";
    meta.innerHTML = `
      Current node: ${formatNodeName(player.currentNode)}<br>
      Completed journeys: ${player.completedJourneys}<br>
      Current target: ${formatNodeName(getCurrentTargetDestination(playerName) || "—")}
    `;
    block.appendChild(meta);

    const stack = document.createElement("div");
    stack.className = "destination-stack";

    player.destinationSequence.forEach((destId, index) => {
      const isComplete = index < player.currentDestinationIndex;
      const isCurrent = !player.returnToDidcot && index === player.currentDestinationIndex;
      const dest = app.destinationData.destinations[destId];

      const card = document.createElement("div");
      card.className = "destination-card";
      if (isComplete) card.classList.add("complete", "revealed");
      if (isCurrent) card.classList.add("active", "revealed");

      if (isComplete || isCurrent) {
        card.innerHTML = `
          <div class="destination-title">${dest ? dest.title : formatNodeName(destId)}</div>
          <div class="destination-copy">${dest ? dest.description : ""}</div>
        `;
      } else {
        card.innerHTML = `<div class="destination-mystery">?</div>`;
      }

      stack.appendChild(card);
    });

    const finalCard = document.createElement("div");
    finalCard.className = "destination-card destination-final";
    if (player.returnToDidcot) {
      finalCard.classList.add("active", "revealed");
      finalCard.innerHTML = `
        <div class="destination-title">Didcot</div>
        <div class="destination-copy">Return to Didcot to win.</div>
      `;
    } else if (player.completedJourneys >= 5) {
      finalCard.classList.add("revealed");
      finalCard.innerHTML = `
        <div class="destination-title">Didcot</div>
        <div class="destination-copy">Final run unlocked.</div>
      `;
    } else {
      finalCard.innerHTML = `<div class="destination-mystery">?</div>`;
    }

    stack.appendChild(finalCard);
    block.appendChild(stack);
    wrap.appendChild(block);
  });
}

function renderDebug(audit) {
  const leftDebug = document.getElementById("left-debug");
  leftDebug.innerHTML = `
    <div class="debug-list">
      <div><strong>Version:</strong> ${APP_VERSION}</div>
      <div><strong>Local hero:</strong> ${app.state.localHero || "—"}</div>
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
  const drawBtn = document.getElementById("draw-card-btn");
  const resetBtn = document.getElementById("reset-local-btn");
  const heroChosen = Boolean(app.state.localHero);
  const winnerExists = Boolean(app.state.winner);
  const selected = app.state.selectedRouteId;

  playBtn.disabled = !heroChosen || winnerExists || !selected || !getRoutePlayability(selected).playable;
  drawBtn.disabled = !heroChosen || winnerExists;
  resetBtn.disabled = false;
}

function renderAll() {
  renderTurnBadge();
  renderCounts();
  renderSelectedRouteCard();
  renderActiveHand();
  renderDestinations();
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

async function playSelectedRoute() {
  if (!app.state.localHero) {
    updateStatus("Pick your hero first.");
    return;
  }

  if (app.state.winner) {
    updateStatus(`${app.state.winner} has already won.`);
    return;
  }

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

  await animateTokenAlongRoute(currentPlayerName, routeId, fromNode);

  const completion = completeDestinationIfNeeded(currentPlayerName);
  if (completion?.type === "destination-complete") {
    const nextTarget = getCurrentTargetDestination(currentPlayerName);
    renderAll();
    updateStatus(
      `${currentPlayerName} reached ${formatNodeName(completion.target)}. Routes released. Next target: ${formatNodeName(nextTarget || "Didcot")}.`
    );
  } else if (completion?.type === "win") {
    renderAll();
    updateStatus(`${currentPlayerName} returned to Didcot and wins!`);
    return;
  }

  endTurn();
}

function drawCardForCurrentPlayer() {
  if (!app.state.localHero) {
    updateStatus("Pick your hero first.");
    return;
  }

  if (app.state.winner) {
    updateStatus(`${app.state.winner} has already won.`);
    return;
  }

  const card = drawCard();

  if (!card) {
    updateStatus("No cards available to draw.");
    renderAll();
    return;
  }

  app.state.players[app.state.currentPlayer].hand.push(card);
  app.state.lastDrawCard = card;
  renderAll();
  updateStatus(`${app.state.currentPlayer} drew ${card}.`);
  setTimeout(() => {
    app.state.lastDrawCard = null;
    renderAll();
  }, 650);

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
      if (app.state.winner) {
        updateStatus(`${app.state.winner} has won the local prototype.`);
      } else {
        updateStatus("Choose one action: draw a card or play a selected eligible route.");
      }
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
    app.state = createInitialLocalState(app.rulesData);
    document.getElementById("hero-overlay").classList.add("is-visible");
    document.getElementById("hero-confirmation").textContent = "";
    renderAll();
    updateStatus("Local game reset.");
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

    ensureRouteBaseStrokes();
    renderAll();
    wireRouteInteractions();
    wireControlButtons();
    setupHeroButtons();

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