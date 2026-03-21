console.log("Didcot Dogs app.v1.js loaded");

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

function wireSvgDebug(svg) {
  const statusChip = document.getElementById("status-chip");
  const routeCandidates = svg.querySelectorAll('[id*="_to_"], [id*="to"]');

  routeCandidates.forEach(el => {
    el.style.cursor = "pointer";

    el.addEventListener("mouseenter", () => {
      statusChip.textContent = `Hovering: ${el.id || "unnamed route"}`;
    });

    el.addEventListener("mouseleave", () => {
      statusChip.textContent = "Board loaded from SVG.";
    });
  });
}

async function init() {
  try {
    const [mapData, destinationData] = await Promise.all([
      loadJson("./data/didcot-dogs-map.v1.json"),
      loadJson("./data/didcot-dogs-destinations.v1.json")
    ]);

    const svg = await injectBoardSvg();
    populateSidePanels(mapData, destinationData);
    wireSvgDebug(svg);

    document.getElementById("status-chip").textContent = "Board loaded from SVG.";

    window.__DIDCOT_DOGS__ = { mapData, destinationData, svg };
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
