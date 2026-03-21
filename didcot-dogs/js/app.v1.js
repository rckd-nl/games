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
    if (!