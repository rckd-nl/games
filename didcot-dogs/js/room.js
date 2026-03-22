/*
 * room.js — Didcot Dogs
 *
 * CHANGELOG
 * v2.0.0 — complete rewrite for reliability
 *   - Simplified subscription: no echo-skipping, Firebase is always truth
 *   - Creator waits on waiting screen; startGame fires when Tango joins
 *   - Joiner uses Firebase state directly, never re-randomises
 *   - Refresh: fetches fresh state from Firebase, resumes cleanly
 *   - Room code + player identity always visible in HUD after game starts
 *   - Clear sessionStorage on game end / reset
 */

import {
  createRoom,
  joinRoom,
  subscribeToRoom,
  subscribeToPresence,
  registerDisconnect,
  pushState
} from "./firebase.js";

export { pushState };

// ─── Screen helpers ───────────────────────────────────────────────────────────

function showScreen(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add("active");
}

function hideScreen(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove("active");
}

export function showRoomScreen()    { showScreen("room-screen"); }
export function hideRoomScreen()    { hideScreen("room-screen"); }
export function showWaitingScreen(code) {
  const el = document.getElementById("waiting-code");
  if (el) el.textContent = code;
  hideScreen("room-screen");
  showScreen("waiting-screen");
}
export function hideWaitingScreen() { hideScreen("waiting-screen"); }
export function showResumingScreen() { showScreen("resuming-screen"); }
export function hideResumingScreen() { hideScreen("resuming-screen"); }

// ─── Main entry point — called from app.v2.js init() ─────────────────────────

export async function initRoomFlow(appRef) {
  const savedCode = sessionStorage.getItem("dd_room_code");
  const savedHero = sessionStorage.getItem("dd_hero");

  if (savedCode && savedHero) {
    // Attempt to resume
    showResumingScreen();
    try {
      const snapshot = await joinRoom(savedCode);
      if (!snapshot.state || !snapshot.state.players) throw new Error("No state");

      appRef.roomCode  = savedCode;
      appRef.localHero = savedHero;

      hideResumingScreen();
      launchGame(appRef, savedCode, savedHero, snapshot.state);
      return;
    } catch (e) {
      console.warn("Resume failed:", e.message);
      sessionStorage.removeItem("dd_room_code");
      sessionStorage.removeItem("dd_hero");
      hideResumingScreen();
    }
  }

  // Fresh start — show room screen
  showRoomScreen();
  wireRoomButtons(appRef);
}

// ─── Room screen buttons ──────────────────────────────────────────────────────

function wireRoomButtons(appRef) {
  const createBtn  = document.getElementById("room-create-btn");
  const joinBtn    = document.getElementById("room-join-btn");
  const joinInput  = document.getElementById("room-join-input");
  const errorEl    = document.getElementById("room-error");

  createBtn.addEventListener("click", async () => {
    createBtn.disabled = true;
    createBtn.textContent = "Creating…";
    errorEl.textContent = "";
    try {
      // Build canonical state — route colours set once here, synced to both
      const state = appRef.buildInitialState("Eric");
      state.controlledHero = null; // device-specific, not stored in Firebase
      state.currentPlayer  = "Eric";

      const code = await createRoom(state);

      appRef.roomCode  = code;
      appRef.localHero = "Eric";

      sessionStorage.setItem("dd_room_code", code);
      sessionStorage.setItem("dd_hero", "Eric");

      registerDisconnect(code, "Eric");
      showWaitingScreen(code);

      // Watch for Tango joining
      let started = false;
      subscribeToPresence(code, presence => {
        if (presence?.Tango?.connected && !started) {
          started = true;
          hideWaitingScreen();
          launchGame(appRef, code, "Eric", state);
        }
      });

    } catch (err) {
      errorEl.textContent = err.message;
      createBtn.disabled  = false;
      createBtn.textContent = "Create game";
    }
  });

  joinBtn.addEventListener("click", async () => {
    const code = (joinInput.value || "").toUpperCase().trim();
    if (code.length !== 4) {
      errorEl.textContent = "Enter the 4-character code.";
      return;
    }
    joinBtn.disabled = true;
    joinBtn.textContent = "Joining…";
    errorEl.textContent = "";
    try {
      const { state } = await joinRoom(code);

      appRef.roomCode  = code;
      appRef.localHero = "Tango";

      sessionStorage.setItem("dd_room_code", code);
      sessionStorage.setItem("dd_hero", "Tango");

      registerDisconnect(code, "Tango");
      hideRoomScreen();
      launchGame(appRef, code, "Tango", state);

    } catch (err) {
      errorEl.textContent = err.message;
      joinBtn.disabled  = false;
      joinBtn.textContent = "Join";
    }
  });

  joinInput.addEventListener("keydown", e => { if (e.key === "Enter") joinBtn.click(); });
  joinInput.addEventListener("input",   () => { joinInput.value = joinInput.value.toUpperCase(); });
}

// ─── Launch game — used by create, join, and resume ──────────────────────────

function launchGame(appRef, code, hero, state) {
  // Set app state from Firebase — never re-randomise
  appRef.state = state;
  appRef.state.controlledHero = hero; // device-local only

  // Show identity card + board
  appRef.startMultiplayer(hero);

  // Subscribe to all future remote changes.
  // Skip the first callback — it fires immediately with current value
  // which is the state we just set, not a remote change.
  let skipFirst = true;
  subscribeToRoom(code, remoteState => {
    if (!remoteState || !remoteState.players) return;
    if (skipFirst) { skipFirst = false; return; }

    // Apply remote state — Firebase is source of truth.
    // Restore controlledHero which is device-local only.
    appRef.state = remoteState;
    appRef.state.controlledHero = hero;
    appRef.renderAll();
    updateRoomHud(appRef);
  });
}

// ─── Room HUD — persistent code + player identity strip ──────────────────────

export function updateRoomHud(appRef) {
  const hud = document.getElementById("room-hud");
  if (!hud || !appRef.roomCode) return;

  const isMine = appRef.state.currentPlayer === appRef.localHero;
  hud.innerHTML = `
    <span class="room-hud-code">Room: <strong>${appRef.roomCode}</strong></span>
    <span class="room-hud-player">You: <strong>${appRef.localHero}</strong></span>
    <span class="room-hud-turn ${isMine ? "room-hud-turn-mine" : "room-hud-turn-theirs"}">
      ${isMine ? "YOUR TURN" : `${appRef.state.currentPlayer}'s turn`}
    </span>
  `;
  hud.style.display = "flex";
}

// ─── Clear session on game reset ─────────────────────────────────────────────

export function clearRoomSession() {
  sessionStorage.removeItem("dd_room_code");
  sessionStorage.removeItem("dd_hero");
}
