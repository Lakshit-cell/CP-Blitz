const rooms = new Map();

function generateRoomCode(length = 6) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // avoid confusing chars
  let code = "";
  for (let i = 0; i < length; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)];
  return code;
}

function generatePlayerToken() {
  // Short random token; stored client-side for refresh reconnect.
  return `${Math.random().toString(36).slice(2, 10)}${Math.random().toString(36).slice(2, 10)}`;
}

function createRoom(socketId) {
  let code = generateRoomCode();
  while (rooms.has(code)) code = generateRoomCode();

  const token = generatePlayerToken();
  const room = {
    code,
    status: "waiting", // waiting | in_progress | finished
    createdAt: Date.now(),
    players: [{ id: socketId, token, handle: null, disconnectedAt: null }],
    problems: null, // [{rating, contestId, index, name}]
    conquered: {}, // key -> { byPlayerId, byHandle, atCreationTimeSeconds }
    pollInterval: null,
    startTime: null,
    endTime: null,
    timerTimeout: null,
    lastManualCheckAt: 0, // timestamp of last manual check (room-wide cooldown)
  };

  rooms.set(code, room);
  return { room, token };
}

function getRoom(code) {
  return rooms.get((code || "").toUpperCase());
}

function joinRoom(code, socketId) {
  const room = getRoom(code);
  if (!room) return { ok: false, error: "Room not found." };
  if (room.players.length >= 2) return { ok: false, error: "Room is full (max 2 players)." };
  if (room.players.some((p) => p.id === socketId)) return { ok: true, room };

  const token = generatePlayerToken();
  room.players.push({ id: socketId, token, handle: null, disconnectedAt: null });
  return { ok: true, room, token };
}

function markDisconnectedForSocket(socketId) {
  const touched = new Set();
  for (const room of rooms.values()) {
    const idx = room.players.findIndex((p) => p.id === socketId);
    if (idx !== -1) {
      room.players[idx].disconnectedAt = Date.now();
      touched.add(room.code);
    }
  }
  return Array.from(touched);
}

function leaveAllRoomsForSocket(socketId) {
  const touched = new Set();
  for (const room of rooms.values()) {
    const idx = room.players.findIndex((p) => p.id === socketId);
    if (idx !== -1) {
      room.players.splice(idx, 1);
      if (room.players.length === 0) {
        if (room.pollInterval) clearInterval(room.pollInterval);
        if (room.timerTimeout) clearTimeout(room.timerTimeout);
        rooms.delete(room.code);
      } else {
        // If a player leaves mid-game, end the game.
        if (room.status === "in_progress") {
          room.status = "finished";
          if (room.pollInterval) clearInterval(room.pollInterval);
          room.pollInterval = null;
          if (room.timerTimeout) clearTimeout(room.timerTimeout);
          room.timerTimeout = null;
        }
        touched.add(room.code);
      }
    }
  }
  return Array.from(touched);
}

function setHandle(code, socketId, handleRaw) {
  const room = getRoom(code);
  if (!room) return { ok: false, error: "Room not found." };

  const handle = (handleRaw || "").trim();
  if (!handle) return { ok: false, error: "Handle cannot be empty." };

  const player = room.players.find((p) => p.id === socketId);
  if (!player) return { ok: false, error: "You are not in this room." };

  player.handle = handle;
  return { ok: true, room };
}

function reconnectPlayer(code, token, newSocketId, handleRaw) {
  const room = getRoom(code);
  if (!room) return { ok: false, error: "Room not found." };
  const t = (token || "").trim();
  if (!t) return { ok: false, error: "Missing reconnect token." };

  const player = room.players.find((p) => p.token === t);
  if (!player) return { ok: false, error: "Reconnect token not recognized for this room." };

  const oldSocketId = player.id;
  player.id = newSocketId;
  player.disconnectedAt = null;
  const handle = (handleRaw || "").trim();
  if (handle) player.handle = handle;

  if (oldSocketId && room.conquered) {
    for (const conquest of Object.values(room.conquered)) {
      if (conquest && conquest.byPlayerId === oldSocketId) {
        conquest.byPlayerId = newSocketId;
      }
    }
  }

  return { ok: true, room, player };
}

function roomToPublicState(room) {
  const problems = room.problems
    ? room.problems.map((p) => ({
        rating: p.rating,
        contestId: p.contestId,
        index: p.index,
        name: p.name,
        url: `https://codeforces.com/problemset/problem/${p.contestId}/${p.index}`,
        key: `${p.contestId}-${p.index}`,
      }))
    : null;

  return {
    code: room.code,
    status: room.status,
    players: room.players.map((p) => ({ id: p.id, handle: p.handle, disconnected: Boolean(p.disconnectedAt) })),
    problems,
    conquered: room.conquered,
    endTime: room.endTime,
  };
}

module.exports = {
  rooms,
  createRoom,
  getRoom,
  joinRoom,
  reconnectPlayer,
  markDisconnectedForSocket,
  setHandle,
  leaveAllRoomsForSocket,
  roomToPublicState,
};
