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
      const { state } = await joinRoom(savedCode);
      appRef.roomCode = savedCode;
      appRef.localHero = savedHero;
      appRef.state = state;
      appRef.state.controlledHero = savedHero;
      registerDisconnect(savedCode, savedHero);
      startGameSubscription(appRef, savedCode);
      hideRoomScreen();
      hideWaitingScreen();
      // Show game directly
      document.getElementById("hero-overlay").classList.remove("active");
      return;
    } catch (e) {
      // Saved room gone — clear and show room screen fresh
      sessionStorage.removeItem("dd_room_code");
      sessionStorage.removeItem("dd_hero");
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
      const initialState = appRef.buildInitialState("Eric");
      const code = await createRoom(initialState);

      appRef.roomCode = code;
      appRef.localHero = "Eric";
      appRef.state = initialState;
      appRef.state.controlledHero = "Eric";

      sessionStorage.setItem("dd_room_code", code);
      sessionStorage.setItem("dd_hero", "Eric");

      registerDisconnect(code, "Eric");
      showWaitingScreen(code);

      // Wait for Tango to join
      subscribeToPresence(code, presence => {
        if (presence?.Tango?.connected) {
          hideWaitingScreen();
          startGame(appRef, code, "Eric", initialState);
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
      appRef.state.controlledHero = hero;

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
  // Show hero overlay — but hero is already decided
  const heroOverlay = document.getElementById("hero-overlay");
  heroOverlay.classList.remove("active");

  // Directly call app's startGameAs equivalent
  appRef.startAs(hero);
  startGameSubscription(appRef, code);
}

// ── Subscribe to Firebase state changes ───────────────────────────────────────

function startGameSubscription(appRef, code) {
  let isFirstCall = true;

  subscribeToRoom(code, remoteState => {
    // Skip the first call — it's our own write echoing back
    if (isFirstCall) {
      isFirstCall = false;
      return;
    }

    // Only apply remote state if it's not our own turn
    // (our own writes already updated local state)
    const isMyTurn = remoteState.currentPlayer === appRef.localHero;
    if (!isMyTurn || remoteState.currentPlayer !== appRef.state.currentPlayer) {
      appRef.state = remoteState;
      appRef.state.controlledHero = appRef.localHero;
      appRef.renderAll();
    }
  });
}
