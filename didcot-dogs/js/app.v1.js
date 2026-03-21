const BOARD_VIEWBOX = { width: 1920, height: 1080 };

async function loadJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Failed to load ${url} (${response.status})`);
  }
  return response.json();
}

function getNodeById(mapData, id) {
  return mapData.nodes.find(node => node.id === id);
}

function makeRoutePath(aNode, bNode) {
  const x1 = aNode.x;
  const y1 = aNode.y;
  const x2 = bNode.x;
  const y2 = bNode.y;

  const dx = x2 - x1;
  const dy = y2 - y1;
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;

  const distance = Math.hypot(dx, dy) || 1;
  const nx = -dy / distance;
  const ny = dx / distance;

  const curveStrength = Math.min(90, Math.max(24, distance * 0.16));
  const cx = mx + nx * curveStrength;
  const cy = my + ny * curveStrength;

  return `M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`;
}

function createSvgEl(tag, attrs = {}) {
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [key, value] of Object.entries(attrs)) {
    el.setAttribute(key, value);
  }
  return el;
}

function renderBoard(mapData) {
  const svg = document.getElementById("board-svg");
  svg.innerHTML = "";

  const routeGroup = createSvgEl("g", { id: "routes-layer" });
  const nodeGroup = createSvgEl("g", { id: "nodes-layer" });
  const labelGroup = createSvgEl("g", { id: "labels-layer" });

  mapData.routes.forEach(route => {
    const aNode = getNodeById(mapData, route.a);
    const bNode = getNodeById(mapData, route.b);
    if (!aNode || !bNode) return;

    const d = makeRoutePath(aNode, bNode);
    const thickness = 8 + (route.length - 1) * 3;

    const basePath = createSvgEl("path", {
      d,
      class: "route-base",
      "data-route-id": route.id,
      "stroke-width": thickness
    });

    const hitPath = createSvgEl("path", {
      d,
      class: "route-hit",
      "data-route-id": route.id,
      "stroke-width": Math.max(thickness + 18, 28)
    });

    hitPath.addEventListener("mouseenter", () => {
      document.getElementById("status-chip").textContent =
        `${route.id}: ${aNode.label} → ${bNode.label} (length ${route.length})`;
    });

    hitPath.addEventListener("mouseleave", () => {
      document.getElementById("status-chip").textContent =
        "Board loaded. Routes and nodes are rendering from JSON.";
    });

    routeGroup.appendChild(basePath);
    routeGroup.appendChild(hitPath);
  });

  mapData.nodes.forEach(node => {
    const circle = createSvgEl("circle", {
      cx: node.x,
      cy: node.y,
      r: node.id === mapData.startNode ? 15 : 12,
      class: `node-circle${node.destination ? " destination-node" : ""}`,
      "data-node-id": node.id
    });

    const label = createSvgEl("text", {
      x: node.x + 16,
      y: node.y - 14,
      class: "node-label",
      "data-node-label-id": node.id
    });
    label.textContent = node.label;

    nodeGroup.appendChild(circle);
    labelGroup.appendChild(label);
  });

  svg.appendChild(routeGroup);
  svg.appendChild(nodeGroup);
  svg.appendChild(labelGroup);
}

function populateSidePanels(mapData, destinationData) {
  const leftDebug = document.getElementById("left-debug");
  const rightDestinations = document.getElementById("right-destinations");

  leftDebug.innerHTML = `
    <div class="debug-list">
      <div><strong>Start node:</strong> ${mapData.startNode}</div>
      <div><strong>Total nodes:</strong> ${mapData.nodes.length}</div>
      <div><strong>Total routes:</strong> ${mapData.routes.length}</div>
      <div><strong>Route colours:</strong> ${mapData.routeColours.join(", ")}</div>
    </div>
  `;

  rightDestinations.innerHTML = "";

  mapData.destinationPool.forEach(id => {
    const destination = destinationData.destinations[id];
    const card = document.createElement("div");
    card.className = "placeholder-card";
    card.textContent = destination ? `? — ${destination.title}` : `? — ${id}`;
    rightDestinations.appendChild(card);
  });
}

async function init() {
  try {
    const [mapData, destinationData] = await Promise.all([
      loadJson("./data/didcot-dogs-map.v1.json"),
      loadJson("./data/didcot-dogs-destinations.v1.json")
    ]);

    renderBoard(mapData);
    populateSidePanels(mapData, destinationData);

    document.getElementById("status-chip").textContent =
      "Board loaded. Routes and nodes are rendering from JSON.";

    window.__DIDCOT_DOGS__ = { mapData, destinationData };
  } catch (error) {
    console.error(error);
    document.getElementById("status-chip").textContent =
      `Error loading board: ${error.message}`;
  }
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

document.addEventListener("DOMContentLoaded", () => {
  setupFullscreenButton();
  init();
});
