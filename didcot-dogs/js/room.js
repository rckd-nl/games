/*
 * room.js — Didcot Dogs
 *
 * CHANGELOG
 * v1.0.0
 *   - Room screen: create or join a game before hero pick.
 *   - Waiting screen: animated holding screen shown to creator while
 *     waiting for the second player.
 *   - On join: game state synced from Firebase, correct hero assigned,
 *     game starts immediately.
 *   - On rejoin: room code restored from sessionStorage, game resumes.
 */

import {
  createRoom,
  joinRoom,
  subscribeToRoom,
  subscribeToPresence,
  registerDisconnect,
  pushState
} from "./firebase.js";

// Exposed so app.v2.js can call pushState after mutations
export { pushState };

// ── Room screen UI ────────────────────────────────────────────────────────────


export function showResumingScreen() {
  let el = document.getElementById("resuming-screen");
  if (!el) {
    el = document.createElement("div");
    el.id = "resuming-screen";
    el.className = "resuming-screen active";
    el.innerHTML = `
      <div class="resuming-inner">
        <div class="resuming-title">Resuming game…</div>
        <div class="waiting-dots">
          <div class="waiting-dot"></div>
          <div class="waiting-dot"></div>
          <div class="waiting-dot"></div>
        </div>
      </div>
    `;
    document.getElementById("game-shell").appendChild(el);
  }
  el.classList.add("active");
}

export function hideResumingScreen() {
  const el = document.getElementById("resuming-screen");
  if (el) el.classList.remove("active");
}

export function showRoomScreen() {
  const screen = document.getElementById("room-screen");
  if (screen) screen.classList.add("active");
}

export function hideRoomScreen() {
  const screen = document.getElementById("room-screen");
  if (screen) screen.classList.remove("active");
}

export function showWaitingScreen(code) {
  hideRoomScreen();
  const waiting = document.getElementById("waiting-screen");
  if (!waiting) return;
  const codeEl = document.getElementById("waiting-code");
  if (codeEl) codeEl.textContent = code;
  waiting.classList.add("active");
}

export function hideWaitingScreen() {
  const waiting = document.getElementById("waiting-screen");
  if (waiting) waiting.classList.remove("active");
}

// ── Initialise room flow ──────────────────────────────────────────────────────
// Called from app.v2.js init() instead of going straight to hero pick.

export async function initRoomFlow(appRef) {
  // Check sessionStorage for an existing room (resume support)
  const savedCode = sessionStorage.getItem("dd_room_code");
  const savedHero = sessionStorage.getItem("dd_hero");

  if (savedCode && savedHero) {
    try {
      // Show a brief "Resuming…" state while we fetch
      showResumingScreen();

      const { state } = await joinRoom(savedCode);

      if (!state || !state.players) {
        throw new Error("State missing from Firebase");
      }

      appRef.roomCode = savedCode;
      appRef.localHero = savedHero;
      appRef.state = state;
      appRef.state.controlledHero = savedHero;
      registerDisconnect(savedCode, savedHero);
      hideResumingScreen();
      hideRoomScreen();
      hideWaitingScreen();
      document.getElementById("hero-overlay").classList.remove("active");
      appRef.startAs(savedHero);
      startGameSubscription(appRef, savedCode);
      return;
    } catch (e) {
      console.warn("Failed to resume session:", e.message);
      // Clear stale session and fall through to room screen
      sessionStorage.removeItem("dd_room_code");
      sessionStorage.removeItem("dd_hero");
      hideResumingScreen();
    }
  }

  showRoomScreen();
  wireRoomButtons(appRef);
}

// ── Wire room screen buttons ──────────────────────────────────────────────────

function wireRoomButtons(appRef) {
  const createBtn = document.getElementById("room-create-btn");
  const joinBtn   = document.getElementById("room-join-btn");
  const joinInput = document.getElementById("room-join-input");
  const errorEl   = document.getElementById("room-error");

  createBtn.addEventListener("click", async () => {
    createBtn.disabled = true;
    createBtn.textContent = "Creating…";
    errorEl.textContent = "";

    try {
      // Build initial state using app's rulesData
      // Build canonical state — route colours live here, must match on both devices
      const initialState = appRef.buildInitialState("Eric");

      // Remove controlledHero from Firebase state — it's device-specific
      const stateForFirebase = { ...initialState, controlledHero: null };
      const code = await createRoom(stateForFirebase);

      appRef.roomCode = code;
      appRef.localHero = "Eric";
      appRef.state = stateForFirebase;

      sessionStorage.setItem("dd_room_code", code);
      sessionStorage.setItem("dd_hero", "Eric");

      registerDisconnect(code, "Eric");
      showWaitingScreen(code);

      let gameStarted = false;
      // Wait for Tango to join
      subscribeToPresence(code, presence => {
        if (presence?.Tango?.connected && !gameStarted) {
          gameStarted = true;
          hideWaitingScreen();
          startGame(appRef, code, "Eric", stateForFirebase);
        }
      });

    } catch (err) {
      errorEl.textContent = err.message;
      createBtn.disabled = false;
      createBtn.textContent = "Create game";
    }
  });

  joinBtn.addEventListener("click", async () => {
    const code = (joinInput.value || "").toUpperCase().trim();
    if (code.length !== 4) {
      errorEl.textContent = "Enter a 4-character room code.";
      return;
    }

    joinBtn.disabled = true;
    joinBtn.textContent = "Joining…";
    errorEl.textContent = "";

    try {
      const { state, hero } = await joinRoom(code);

      appRef.roomCode = code;
      appRef.localHero = hero;
      appRef.state = state;
      // Don't set controlledHero here — startMultiplayer sets it

      sessionStorage.setItem("dd_room_code", code);
      sessionStorage.setItem("dd_hero", hero);

      registerDisconnect(code, hero);
      hideRoomScreen();
      startGame(appRef, code, hero, state);

    } catch (err) {
      errorEl.textContent = err.message;
      joinBtn.disabled = false;
      joinBtn.textContent = "Join game";
    }
  });

  // Allow Enter key in code input
  joinInput.addEventListener("keydown", e => {
    if (e.key === "Enter") joinBtn.click();
  });

  // Auto-uppercase input
  joinInput.addEventListener("input", () => {
    joinInput.value = joinInput.value.toUpperCase();
  });
}

// ── Start game after both players present ─────────────────────────────────────

function startGame(appRef, code, hero, state) {
  // Use startMultiplayer — does NOT re-randomise state, uses Firebase state.
  // startAs() would call createInitialLocalState() which re-randomises
  // route colours, breaking sync between devices.
  appRef.startMultiplayer(hero);
  startGameSubscription(appRef, code);
}

// ── Subscribe to Firebase state changes ───────────────────────────────────────

function startGameSubscription(appRef, code) {
  let localVersion = 0;  // incremented on every local push to detect echo

  // Expose increment so app.v2.js can call it before pushState
  appRef.__incrementLocalVersion = () => { localVersion++; };

  subscribeToRoom(code, remoteState => {
    if (!remoteState) return;

    // If this update was triggered by our own push, localVersion > 0 — skip it
    if (localVersion > 0) {
      localVersion--;
      return;
    }

    // Apply remote state — always trust Firebase as source of truth
    // Preserve localHero since it is device-specific
    const hero = appRef.localHero;
    appRef.state = remoteState;
    appRef.state.controlledHero = hero;
    appRef.renderAll();
  });
}
