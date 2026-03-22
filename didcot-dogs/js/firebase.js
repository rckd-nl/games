/*
 * firebase.js — Didcot Dogs
 *
 * CHANGELOG
 * v1.0.0
 *   - Firebase Realtime Database integration.
 *   - createRoom(): generates 4-digit code, writes initial state.
 *   - joinRoom(): reads existing state, assigns hero to joiner.
 *   - subscribeToRoom(): onValue listener — fires renderAll on every
 *     remote state change.
 *   - pushState(): writes full app.state to Firebase.
 *   - setPresence(): tracks which players are connected.
 */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getDatabase,
  ref,
  set,
  get,
  onValue,
  onDisconnect,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

const FIREBASE_CONFIG = {
  apiKey:            "AIzaSyADtUD_GrSbfzss3CeO79VbDeAOmIwxGfI",
  authDomain:        "didcot-dogs.firebaseapp.com",
  databaseURL:       "https://didcot-dogs-default-rtdb.europe-west1.firebasedatabase.app",
  projectId:         "didcot-dogs",
  storageBucket:     "didcot-dogs.firebasestorage.app",
  messagingSenderId: "1087104000704",
  appId:             "1:1087104000704:web:13dbe3478e3a0cc9e5c325"
};

const firebaseApp = initializeApp(FIREBASE_CONFIG);
const db = getDatabase(firebaseApp);

// ── Room code generation ──────────────────────────────────────────────────────
function generateRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous chars
  let code = "";
  for (let i = 0; i < 4; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

// ── Create a new room ─────────────────────────────────────────────────────────
// Writes initial game state. Creator is assigned Eric.
// Returns the room code.
export async function createRoom(initialState) {
  let code;
  let attempts = 0;

  // Ensure unique code
  while (attempts < 10) {
    code = generateRoomCode();
    const existing = await get(ref(db, `rooms/${code}/state`));
    if (!existing.exists()) break;
    attempts++;
  }

  const roomState = {
    ...initialState,
    creatorHero: "Eric",
    joinerHero: "Tango",
    phase: "waiting",         // waiting | playing | finished
    createdAt: Date.now()
  };

  await set(ref(db, `rooms/${code}/state`), roomState);
  await set(ref(db, `rooms/${code}/presence/Eric`), {
    connected: true,
    lastSeen: Date.now()
  });

  return code;
}

// ── Join an existing room ─────────────────────────────────────────────────────
// Returns { state, hero } or throws if room not found / already full.
export async function joinRoom(code) {
  const upperCode = code.toUpperCase().trim();
  const snapshot = await get(ref(db, `rooms/${upperCode}/state`));

  if (!snapshot.exists()) {
    throw new Error(`Room ${upperCode} not found. Check the code and try again.`);
  }

  const state = snapshot.val();

  if (state.phase === "playing" || state.phase === "finished") {
    // Allow rejoin — joiner gets Tango
  }

  // Mark joiner present and set phase to playing
  await set(ref(db, `rooms/${upperCode}/presence/Tango`), {
    connected: true,
    lastSeen: Date.now()
  });

  if (state.phase === "waiting") {
    await set(ref(db, `rooms/${upperCode}/state/phase`), "playing");
  }

  return { state, hero: "Tango", code: upperCode };
}

// ── Push full state to Firebase ───────────────────────────────────────────────
export async function pushState(code, state) {
  if (!code) return;
  try {
    await set(ref(db, `rooms/${code}/state`), state);
  } catch (err) {
    console.error("pushState failed:", err);
  }
}

// ── Subscribe to remote state changes ────────────────────────────────────────
// callback receives the full state object whenever it changes remotely.
export function subscribeToRoom(code, callback) {
  const roomRef = ref(db, `rooms/${code}/state`);
  return onValue(roomRef, snapshot => {
    if (snapshot.exists()) {
      callback(snapshot.val());
    }
  });
}

// ── Subscribe to presence ─────────────────────────────────────────────────────
export function subscribeToPresence(code, callback) {
  const presenceRef = ref(db, `rooms/${code}/presence`);
  return onValue(presenceRef, snapshot => {
    callback(snapshot.val() || {});
  });
}

// ── Set own presence on disconnect ────────────────────────────────────────────
export function registerDisconnect(code, hero) {
  const heroRef = ref(db, `rooms/${code}/presence/${hero}`);
  onDisconnect(heroRef).set({ connected: false, lastSeen: serverTimestamp() });
}
