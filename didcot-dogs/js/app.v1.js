console.log("Didcot Dogs app.v1.js loaded");

const APP_VERSION = "v1.3";

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

  const padding = 22;
  const x = contentBox.x - padding;
  const y = contentBox.y - padding;
  const width = contentBox.width + padding * 2;
  const height = contentBox.height + padding * 2;

  svg.setAttribute("viewBox", `${x} ${y} ${width} ${height}`);
}

function getSvgAudit(svg, rulesData) {
  const routesGroup = svg.querySelector("#Routes");
  const nodesGroup = svg.querySelector("#Nodes");

  const routeElements = routesGroup
    ? Array.from(routesGroup.querySelectorAll("[id]"))
    : [];

  const nodeElements = nodesGroup
    ? Array.from(nodesGroup.querySelectorAll("[id]"))
    : [];

  const routeIds = routeElements
    .map(el => el.id)
    .filter(Boolean);

  const nodeIds = nodeElements
    .map(el => el.id)
    .filter(Boolean);

  const missingRuleRoutes = Object.keys(rulesData.routes || {}).filter(
    routeId => !routeIds.includes(routeId)
  );

  const missingRuleNodes = (rulesData.nodes || []).filter(
    nodeId => !nodeIds.includes(nodeId)
  );

  const extraSvgRoutes = routeIds.filter(
    routeId => !(routeId in (rulesData.routes || {}))
  );

  const extraSvgNodes = nodeIds.filter(
    nodeId => !(rulesData.nodes || []).includes(nodeId)
  );

  return {
    routeIds,
    nodeIds,
    routeCount: routeIds.length,
    nodeCount: nodeIds.length,
    missingRuleRoutes,
    missingRuleNodes,
    extraSvgRoutes,
    extraSvgNodes
  };
}

function populateSidePanels(rulesData, destinationData, audit) {
  const leftDebug = document.getElementById("left-debug");
  const rightDestinations = document.getElementById("right-destinations");

  leftDebug.innerHTML = `
    <div class="debug-list">
      <div><strong>Version:</strong> ${APP_VERSION}</div>
      <div><strong>Start node:</strong> ${rulesData.startNode}</div>
      <div><strong>Total SVG nodes:</strong> ${audit.nodeCount}</div>
      <div><strong>Total SVG routes:</strong> ${audit.routeCount}</div>
      <div><strong>Rules nodes:</strong> ${(rulesData.nodes || []).length}</div>
      <div><strong>Rules routes:</strong> ${Object.keys(rulesData.routes || {}).length}</div>
      <div><strong>Destinations:</strong> ${(rulesData.destinationPool || []).length}</div>
      <div><strong>Missing rule nodes:</strong> ${audit.missingRuleNodes.length}</div>
      <div><strong>Missing rule routes:</strong> ${audit.missingRuleRoutes.length}</div>
    </div>
  `;

  rightDestinations.innerHTML = "";

  (rulesData.destinationPool || []).forEach(id => {
    const destination = destinationData.destinations[id];
    const card = document.createElement("div");
    card.className = "placeholder-card";
    card.textContent = destination ? `? — ${destination.title}` : `? — ${id}`;
    rightDestinations.appendChild(card);
  });
}

function wireSvgDebug(svg, rulesData) {
  const statusChip = document.getElementById("status-chip");
  const routeIds = Object.keys(rulesData.routes || {});

  routeIds.forEach(routeId => {
    const routeEl = svg.querySelector(`#${CSS.escape(routeId)}`);
    if (!routeEl) return;

    routeEl.style.cursor = "pointer";

    routeEl.addEventListener("mouseenter", () => {
      const length = rulesData.routes[routeId]?.length ?? "?";
      statusChip.textContent = `${routeId} · cost ${length}`;
    });

    routeEl.addEventListener("mouseleave", () => {
      statusChip.textContent = "Board loaded from SVG and rules JSON.";
    });
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
    populateSidePanels(rulesData, destinationData, audit);
    wireSvgDebug(svg, rulesData);

    document.getElementById("status-chip").textContent =
      "Board loaded from SVG and rules JSON.";

    window.__DIDCOT_DOGS__ = {
      rulesData,
      destinationData,
      svg,
      audit
    };
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
