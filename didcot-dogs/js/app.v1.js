console.log("Didcot Dogs app.v1.js loaded");

const APP_VERSION = "v1.4";

const PLAYER_CONFIG = {
  Eric: {
    color: "#f2c94c",
    tokenLabel: "E",
    routeClass: "route-claimed-eric",
    badgeClass: "eric",
    tokenOffset: { x: -12, y: -12 }
  },
  Tango: {
    color: "#223b7c",
    tokenLabel: "T",
    routeClass: "route-claimed-tango",
    badgeClass: "tango",
    tokenOffset: { x: 12, y: 12 }
  }
};

const ROUTE_COLOUR_HEX = {
  red: "#efb2b2",
  orange: "#f3c89e",
  blue: "#b9d5f2",
  green: "#bde4c6",
  white: "#e4e4e4",
  black: "#3e3e3e",
  pink: "#efc0d7",
  yellow: "#efe2a3",
  grey: "#bdbdbd"
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

  return {
    currentPlayer: "Eric",
    selectedRouteId: null,
    drawPile: buildDeck(rulesData),
    discardPile: [],
    routes,
    players: {
      Eric: {
        currentNode: rulesData.startNode,
        previousNode: null,
        hand: [],
        journeyRouteIds: []
      },
      Tango: {
        currentNode: rulesData.startNode,
        previousNode: null,
        hand: [],
        journeyRouteIds: []
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

function ensurePlayerToken(svg, playerName) {
  const layer = ensureTokenLayer(svg);
  let group = svg.querySelector(`#token-${CSS.escape(playerName)}`);
  if (group) return group;

  group = document.createElementNS("http://www.w3.org/2000/svg", "g");
  group.setAttribute("id", `token-${playerName}`);

  const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  circle.setAttribute("class", "token-circle");
  circle.setAttribute("r", "18");
  circle.setAttribute("fill", PLAYER_CONFIG[playerName].color);

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

function animateTokenAlongRoute(playerName, routeId, fromNode, toNode) {
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
    const duration = 700;
    const { a } = parseRouteId(routeId);
    const forward = fromNode === a;
    const offset = PLAYER_CONFIG[playerName].tokenOffset;
    const start = performance.now();

    function step(now) {
      const elapsed = now - start;
      const progress = Math.min(1, elapsed / duration);
      const routeProgress = forward ? progress : 1 - progress;
      const point = routeEl.getPointAtLength(total * routeProgress);

      const x = point.x + offset.x;
      const y = point.y + offset.y;

      circle.setAttribute("cx", x);
      circle.setAttribute("cy", y);
      text.setAttribute("x", x);
      text.setAttribute("y", y + 1);

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

function renderRoutes() {
  const routeIds = Object.keys(app.rulesData.routes || {});
  const selectedRouteId = app.state.selectedRouteId;

  routeIds.forEach(routeId => {
    const routeEl = app.svg.querySelector(`#${CSS.escape(routeId)}`);
    if (!routeEl) return;

    routeEl.classList.remove("route-claimed-eric", "route-claimed-tango", "route-eligible", "route-selected", "route-blocked");

    const routeState = app.state.routes[routeId];
    const baseColour = ROUTE_COLOUR_HEX[routeState.colour] || "#bdbdbd";
    routeEl.style.stroke = baseColour;
    routeEl.style.cursor = "pointer";

    if (routeState.colour === "white") {
      routeEl.style.filter = "drop-shadow(0 0 1px rgba(0,0,0,0.35))";
    } else {
      routeEl.style.filter = "";
    }

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

  const { a, b } = parseRouteId(routeId);
  const routeColour = app.state.routes[routeId].colour;
  const cost = app.rulesData.routes[routeId].length;
  const playability = getRoutePlayability(routeId);

  if (playability.playable) {
    card.classList.add("valid");
    card.innerHTML = `
      <strong>${a} → ${b}</strong><br>
      Colour: ${routeColour}<br>
      Cost: ${cost}<br>
      Destination node if played: ${playability.targetNode}
    `;
  } else {
    card.classList.add("invalid");
    card.innerHTML = `
      <strong>${a} → ${b}</strong><br>
      Colour: ${routeColour}<br>
      Cost: ${cost}<br>
      ${playability.reason}
    `;
  }
}

function renderActiveHand() {
  const wrap = document.getElementById("active-hand");
  const hand = app.state.players[app.state.currentPlayer].hand;

  wrap.innerHTML = "";

  if (!hand.length) {
    const empty = document.createElement("div");
    empty.className = "panel-copy";
    empty.textContent = "No cards yet.";
    wrap.appendChild(empty);
    return;
  }

  hand.forEach(card => {
    const el = document.createElement("div");
    el.className = `hand-card ${card}`;
    el.textContent = card;
    wrap.appendChild(el);
  });
}

function renderPlayerSummary() {
  const wrap = document.getElementById("player-summary-wrap");
  wrap.innerHTML = "";

  ["Eric", "Tango"].forEach(playerName => {
    const player = app.state.players[playerName];
    const card = document.createElement("div");
    card.className = `player-summary-card${app.state.currentPlayer === playerName ? " active" : ""}`;

    card.innerHTML = `
      <div class="player-summary-name">${playerName}</div>
      <div class="player-summary-meta">
        Current node: ${player.currentNode}<br>
        Previous node: ${player.previousNode || "—"}<br>
        Hand size: ${player.hand.length}<br>
        Claimed this journey: ${player.journeyRouteIds.length}
      </div>
    `;

    wrap.appendChild(card);
  });
}

function renderDestinations(destinationData, rulesData) {
  const rightDestinations = document.getElementById("right-destinations");
  rightDestinations.innerHTML = "";

  (rulesData.destinationPool || []).forEach(id => {
    const destination = destinationData.destinations[id];
    const card = document.createElement("div");
    card.className = "placeholder-card";
    card.textContent = destination ? `? — ${destination.title}` : `? — ${id}`;
    rightDestinations.appendChild(card);
  });
}

function renderDebug(audit) {
  const leftDebug = document.getElementById("left-debug");
  leftDebug.innerHTML = `
    <div class="debug-list">
      <div><strong>Version:</strong> ${APP_VERSION}</div>
      <div><strong>Start node:</strong> ${app.rulesData.startNode}</div>
      <div><strong>Total SVG nodes:</strong> ${audit.nodeCount}</div>
      <div><strong>Total SVG routes:</strong> ${audit.routeCount}</div>
      <div><strong>Rules routes:</strong> ${Object.keys(app.rulesData.routes || {}).length}</div>
      <div><strong>Current player:</strong> ${app.state.currentPlayer}</div>
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

  const confirmed = window.confirm(`Confirm playing ${routeId}?`);
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
  updateStatus(`${currentPlayerName} claimed ${routeId} and moved to ${toNode}.`);

  await animateTokenAlongRoute(currentPlayerName, routeId, fromNode, toNode);
  endTurn();
}

function drawCardForCurrentPlayer() {
  const card = drawCard();

  if (!card) {
    updateStatus("No cards available to draw.");
    renderAll();
    return;
  }

  app.state.players[app.state.currentPlayer].hand.push(card);
  updateStatus(`${app.state.currentPlayer} drew ${card}.`);
  endTurn();
}

function handleRouteHover(routeId) {
  const playability = getRoutePlayability(routeId);
  const routeColour = app.state.routes[routeId].colour;
  const cost = app.rulesData.routes[routeId].length;

  if (playability.playable) {
    updateStatus(`${routeId} · ${routeColour} · cost ${cost} · eligible`);
  } else {
    updateStatus(`${routeId} · ${routeColour} · cost ${cost} · ${playability.reason}`);
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
    app.state = createInitialLocalState(app.rulesData);
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

    renderDestinations(destinationData, rulesData);
    renderAll();
    wireRouteInteractions();
    wireControlButtons();

    updateStatus("Choose one action: draw a card or play a selected eligible route.");
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
