import cors from "cors";
import express from "express";
import { createServer } from "node:http";
import { customAlphabet, nanoid } from "nanoid";
import { Server } from "socket.io";

const PORT = Number(process.env.PORT || 3000);
const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const makeRoomCode = customAlphabet(ROOM_CODE_ALPHABET, 6);

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "pearstopears-multiplayer", timestamp: new Date().toISOString() });
});

const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: true,
    credentials: true
  }
});

/** @type {Map<string, RoomState>} */
const rooms = new Map();

/**
 * @typedef {Object} PlayerState
 * @property {string} id
 * @property {string} name
 * @property {number} score
 * @property {boolean} ready
 * @property {boolean} connected
 * @property {string|null} socketId
 */

/**
 * @typedef {Object} RoomState
 * @property {string} code
 * @property {string} hostPlayerId
 * @property {"lobby"|"submit"|"judge_pick"|"score"|"next_round"} phase
 * @property {number} round
 * @property {number} judgeIndex
 * @property {Map<string, { cardText: string }>} submissions
 * @property {string|null} lastWinnerId
 * @property {PlayerState[]} players
 * @property {Map<string, string[]>} privateHands
 */

function sanitizeName(input) {
  const trimmed = String(input || "").trim();
  if (!trimmed) {
    return "Player";
  }
  return trimmed.slice(0, 24);
}

function sanitizeCardText(input) {
  const trimmed = String(input || "").trim();
  return trimmed.slice(0, 80);
}

function createEmptyRoom(hostName, socketId) {
  const room = {
    code: makeRoomCode(),
    hostPlayerId: nanoid(12),
    phase: "lobby",
    round: 0,
    judgeIndex: 0,
    submissions: new Map(),
    lastWinnerId: null,
    players: [],
    // Private per-player hand storage for later phases. Never emitted to room snapshots.
    privateHands: new Map()
  };

  room.players.push({
    id: room.hostPlayerId,
    name: sanitizeName(hostName),
    score: 0,
    ready: false,
    connected: true,
    socketId
  });

  return room;
}

function getPlayerBySocket(room, socketId) {
  return room.players.find((player) => player.socketId === socketId) || null;
}

function getPlayerById(room, playerId) {
  return room.players.find((player) => player.id === playerId) || null;
}

function getConnectedPlayers(room) {
  return room.players.filter((player) => player.connected);
}

function getJudge(room) {
  if (room.players.length === 0) {
    return null;
  }

  for (let offset = 0; offset < room.players.length; offset += 1) {
    const index = (room.judgeIndex + offset) % room.players.length;
    const candidate = room.players[index];
    if (candidate.connected) {
      room.judgeIndex = index;
      return candidate;
    }
  }

  return null;
}

function getNextJudgeIndex(room) {
  if (room.players.length === 0) {
    return 0;
  }

  for (let step = 1; step <= room.players.length; step += 1) {
    const index = (room.judgeIndex + step) % room.players.length;
    if (room.players[index].connected) {
      return index;
    }
  }

  return room.judgeIndex;
}

function toLeaderboard(players) {
  return [...players]
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      return a.name.localeCompare(b.name);
    })
    .map((player) => ({ id: player.id, name: player.name, score: player.score }));
}

function toPublicRoomState(room) {
  const judge = getJudge(room);
  const connectedPlayers = getConnectedPlayers(room);
  const nonJudgeCount = judge
    ? connectedPlayers.filter((player) => player.id !== judge.id).length
    : 0;

  return {
    roomCode: room.code,
    phase: room.phase,
    round: room.round,
    hostPlayerId: room.hostPlayerId,
    judgePlayerId: judge ? judge.id : null,
    lastWinnerId: room.lastWinnerId,
    submissionCount: room.submissions.size,
    expectedSubmissionCount: nonJudgeCount,
    players: room.players.map((player) => ({
      id: player.id,
      name: player.name,
      score: player.score,
      ready: player.ready,
      connected: player.connected,
      isHost: player.id === room.hostPlayerId
    })),
    leaderboard: toLeaderboard(room.players),
    submissions:
      room.phase === "judge_pick" || room.phase === "score"
        ? [...room.submissions.entries()].map(([playerId, submission]) => ({
            playerId,
            cardText: submission.cardText
          }))
        : []
  };
}

function emitRoomUpdate(room) {
  io.to(room.code).emit("room:update", toPublicRoomState(room));
}

function emitError(socket, message) {
  socket.emit("server:error", { message });
}

function ensureHostRoomNotEmpty(roomCode) {
  const room = rooms.get(roomCode);
  if (!room) {
    return;
  }
  if (room.players.some((player) => player.connected)) {
    return;
  }
  rooms.delete(roomCode);
}

function beginSubmitPhase(room) {
  room.phase = "submit";
  room.submissions.clear();
  room.lastWinnerId = null;
  emitRoomUpdate(room);
}

io.on("connection", (socket) => {
  socket.on("room:create", (payload = {}) => {
    const playerName = sanitizeName(payload.playerName);
    const room = createEmptyRoom(playerName, socket.id);

    rooms.set(room.code, room);
    socket.join(room.code);
    socket.data.roomCode = room.code;
    socket.data.playerId = room.hostPlayerId;

    socket.emit("room:joined", {
      roomCode: room.code,
      playerId: room.hostPlayerId,
      isHost: true
    });

    emitRoomUpdate(room);
  });

  socket.on("room:join", (payload = {}) => {
    const roomCode = String(payload.roomCode || "").toUpperCase();
    const room = rooms.get(roomCode);

    if (!room) {
      emitError(socket, "Room not found.");
      return;
    }

    const requestedPlayerId = typeof payload.playerId === "string" ? payload.playerId : null;
    const playerName = sanitizeName(payload.playerName);

    if (requestedPlayerId) {
      const existingPlayer = getPlayerById(room, requestedPlayerId);
      if (existingPlayer) {
        existingPlayer.connected = true;
        existingPlayer.socketId = socket.id;
        if (playerName && playerName !== "Player") {
          existingPlayer.name = playerName;
        }

        socket.join(room.code);
        socket.data.roomCode = room.code;
        socket.data.playerId = existingPlayer.id;

        socket.emit("room:joined", {
          roomCode: room.code,
          playerId: existingPlayer.id,
          isHost: existingPlayer.id === room.hostPlayerId,
          rejoined: true
        });

        emitRoomUpdate(room);
        return;
      }
    }

    if (room.phase !== "lobby") {
      emitError(socket, "Game already started. New joins are limited to the lobby.");
      return;
    }

    const playerId = nanoid(12);
    room.players.push({
      id: playerId,
      name: playerName,
      score: 0,
      ready: false,
      connected: true,
      socketId: socket.id
    });

    socket.join(room.code);
    socket.data.roomCode = room.code;
    socket.data.playerId = playerId;

    socket.emit("room:joined", {
      roomCode: room.code,
      playerId,
      isHost: playerId === room.hostPlayerId
    });

    emitRoomUpdate(room);
  });

  socket.on("room:ready", (payload = {}) => {
    const roomCode = String(payload.roomCode || socket.data.roomCode || "").toUpperCase();
    const room = rooms.get(roomCode);
    if (!room) {
      emitError(socket, "Room not found.");
      return;
    }

    const player = getPlayerBySocket(room, socket.id);
    if (!player) {
      emitError(socket, "You are not joined to this room.");
      return;
    }

    player.ready = !player.ready;
    emitRoomUpdate(room);
  });

  socket.on("game:start", (payload = {}) => {
    const roomCode = String(payload.roomCode || socket.data.roomCode || "").toUpperCase();
    const room = rooms.get(roomCode);
    if (!room) {
      emitError(socket, "Room not found.");
      return;
    }

    const player = getPlayerBySocket(room, socket.id);
    if (!player) {
      emitError(socket, "You are not joined to this room.");
      return;
    }
    if (player.id !== room.hostPlayerId) {
      emitError(socket, "Only the host can start the game.");
      return;
    }

    const connectedPlayers = getConnectedPlayers(room);
    if (connectedPlayers.length < 3) {
      emitError(socket, "At least 3 connected players are required to start.");
      return;
    }

    room.round = 1;
    room.phase = "next_round";
    room.judgeIndex = 0;
    room.players.forEach((entry) => {
      entry.score = 0;
      entry.ready = false;
    });

    emitRoomUpdate(room);
    beginSubmitPhase(room);
  });

  socket.on("round:submit", (payload = {}) => {
    const roomCode = String(payload.roomCode || socket.data.roomCode || "").toUpperCase();
    const room = rooms.get(roomCode);
    if (!room) {
      emitError(socket, "Room not found.");
      return;
    }

    if (room.phase !== "submit") {
      emitError(socket, "Submissions are not open.");
      return;
    }

    const player = getPlayerBySocket(room, socket.id);
    if (!player || !player.connected) {
      emitError(socket, "You are not an active player in this room.");
      return;
    }

    const judge = getJudge(room);
    if (!judge) {
      emitError(socket, "No active judge available.");
      return;
    }

    if (player.id === judge.id) {
      emitError(socket, "The judge cannot submit a card.");
      return;
    }

    if (room.submissions.has(player.id)) {
      emitError(socket, "You already submitted this round.");
      return;
    }

    const cardText = sanitizeCardText(payload.cardText);
    if (!cardText) {
      emitError(socket, "Card text is required.");
      return;
    }

    room.submissions.set(player.id, { cardText });

    const expected = getConnectedPlayers(room).filter((entry) => entry.id !== judge.id).length;
    if (room.submissions.size >= expected && expected > 0) {
      room.phase = "judge_pick";
    }

    emitRoomUpdate(room);
  });

  socket.on("round:judge_pick", (payload = {}) => {
    const roomCode = String(payload.roomCode || socket.data.roomCode || "").toUpperCase();
    const room = rooms.get(roomCode);
    if (!room) {
      emitError(socket, "Room not found.");
      return;
    }

    if (room.phase !== "judge_pick") {
      emitError(socket, "The room is not in judge pick phase.");
      return;
    }

    const judge = getJudge(room);
    const actingPlayer = getPlayerBySocket(room, socket.id);
    if (!judge || !actingPlayer || judge.id !== actingPlayer.id) {
      emitError(socket, "Only the active judge can pick the winner.");
      return;
    }

    const winnerPlayerId = String(payload.winnerPlayerId || "");
    if (!room.submissions.has(winnerPlayerId)) {
      emitError(socket, "Winner must be one of the submitted players.");
      return;
    }

    const winner = getPlayerById(room, winnerPlayerId);
    if (!winner) {
      emitError(socket, "Winner not found.");
      return;
    }

    winner.score += 1;
    room.lastWinnerId = winner.id;
    room.phase = "score";

    emitRoomUpdate(room);
  });

  socket.on("round:next", (payload = {}) => {
    const roomCode = String(payload.roomCode || socket.data.roomCode || "").toUpperCase();
    const room = rooms.get(roomCode);
    if (!room) {
      emitError(socket, "Room not found.");
      return;
    }

    if (room.phase !== "score") {
      emitError(socket, "The room is not ready for the next round.");
      return;
    }

    const actingPlayer = getPlayerBySocket(room, socket.id);
    if (!actingPlayer || actingPlayer.id !== room.hostPlayerId) {
      emitError(socket, "Only the host can advance to the next round.");
      return;
    }

    room.judgeIndex = getNextJudgeIndex(room);
    room.round += 1;
    room.phase = "next_round";
    emitRoomUpdate(room);

    beginSubmitPhase(room);
  });

  socket.on("disconnect", () => {
    const roomCode = socket.data.roomCode;
    const playerId = socket.data.playerId;
    if (!roomCode || !playerId) {
      return;
    }

    const room = rooms.get(String(roomCode).toUpperCase());
    if (!room) {
      return;
    }

    const player = getPlayerById(room, playerId);
    if (!player) {
      return;
    }

    player.connected = false;
    player.socketId = null;
    player.ready = false;

    if (room.hostPlayerId === player.id) {
      const nextHost = room.players.find((entry) => entry.connected) || room.players[0] || null;
      if (nextHost) {
        room.hostPlayerId = nextHost.id;
      }
    }

    emitRoomUpdate(room);
    ensureHostRoomNotEmpty(room.code);
  });
});

server.listen(PORT, () => {
  console.log(`Multiplayer server listening on http://localhost:${PORT}`);
});
