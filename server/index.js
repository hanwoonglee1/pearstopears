import cors from "cors";
import express from "express";
import { createServer } from "node:http";
import { customAlphabet, nanoid } from "nanoid";
import { Server } from "socket.io";
import { redCards } from "../data/redCards.js";
import { greenCards } from "../data/greenCards.js";

const PORT = Number(process.env.PORT || 3000);
const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const makeRoomCode = customAlphabet(ROOM_CODE_ALPHABET, 6);
const HAND_SIZE = 7;
const WIN_SCORE = 10;

const RED_CARD_POOL = redCards.map((card, index) => ({
  id: `r-${index}`,
  text: card.text,
  tags: card.tags || []
}));

const GREEN_CARD_POOL = greenCards.map((card, index) => ({
  id: `g-${index}`,
  text: card.text,
  tags: card.tags || []
}));

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
 * @property {"lobby"|"submit"|"judge_pick"|"score"|"next_round"|"game_over"} phase
 * @property {number} round
 * @property {number} judgeIndex
 * @property {Map<string, SubmissionState>} submissions
 * @property {string|null} lastWinnerId
 * @property {string|null} winningSubmissionId
 * @property {PlayerState[]} players
 * @property {Map<string, CardState[]>} privateHands
 * @property {CardState[]} redDeck
 * @property {CardState[]} redDiscard
 * @property {CardState[]} greenDeck
 * @property {CardState[]} greenDiscard
 * @property {CardState|null} currentGreenCard
 */

/**
 * @typedef {Object} CardState
 * @property {string} id
 * @property {string} text
 * @property {string[]} tags
 */

/**
 * @typedef {Object} SubmissionState
 * @property {string} id
 * @property {string} playerId
 * @property {CardState} card
 */

function sanitizeName(input) {
  const trimmed = String(input || "").trim();
  if (!trimmed) {
    return "Player";
  }
  return trimmed.slice(0, 24);
}

function shuffle(cards) {
  const next = [...cards];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    const temp = next[index];
    next[index] = next[swapIndex];
    next[swapIndex] = temp;
  }
  return next;
}

function refillDeckFromDiscard(deck, discard) {
  if (deck.length > 0 || discard.length === 0) {
    return;
  }
  const recycled = shuffle(discard);
  discard.length = 0;
  deck.push(...recycled);
}

function drawCard(deck, discard) {
  refillDeckFromDiscard(deck, discard);
  return deck.pop() || null;
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
    winningSubmissionId: null,
    players: [],
    // Private per-player hand storage for later phases. Never emitted to room snapshots.
    privateHands: new Map(),
    redDeck: [],
    redDiscard: [],
    greenDeck: [],
    greenDiscard: [],
    currentGreenCard: null
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

function initDecks(room) {
  room.redDeck = shuffle(RED_CARD_POOL);
  room.redDiscard = [];
  room.greenDeck = shuffle(GREEN_CARD_POOL);
  room.greenDiscard = [];
  room.currentGreenCard = null;
}

function ensurePlayerHand(room, playerId) {
  if (!room.privateHands.has(playerId)) {
    room.privateHands.set(playerId, []);
  }
  return room.privateHands.get(playerId);
}

function dealToHandSize(room) {
  room.players.forEach((player) => {
    const hand = ensurePlayerHand(room, player.id);
    while (hand.length < HAND_SIZE) {
      const card = drawCard(room.redDeck, room.redDiscard);
      if (!card) {
        break;
      }
      hand.push(card);
    }
  });
}

function removeCardFromHand(room, playerId, cardId) {
  const hand = ensurePlayerHand(room, playerId);
  const cardIndex = hand.findIndex((entry) => entry.id === cardId);
  if (cardIndex < 0) {
    return null;
  }
  const [card] = hand.splice(cardIndex, 1);
  return card || null;
}

function drawGreenForRound(room) {
  room.currentGreenCard = drawCard(room.greenDeck, room.greenDiscard);
}

function resolveSubmitPhaseCompletion(room) {
  if (room.phase !== "submit") {
    return;
  }
  const judge = getJudge(room);
  if (!judge) {
    return;
  }
  const expected = getConnectedPlayers(room).filter((entry) => entry.id !== judge.id).length;
  if (expected > 0 && room.submissions.size >= expected) {
    room.phase = "judge_pick";
  }
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
    winningSubmissionId: room.winningSubmissionId,
    greenCard: room.currentGreenCard ? { id: room.currentGreenCard.id, text: room.currentGreenCard.text } : null,
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
    winnerId: room.phase === "game_over" ? toLeaderboard(room.players)[0]?.id || null : null,
    submissions:
      room.phase === "judge_pick" || room.phase === "score" || room.phase === "game_over"
        ? [...room.submissions.values()].map((submission) => ({
            id: submission.id,
            cardId: submission.card.id,
            cardText: submission.card.text
          }))
        : []
  };
}

function emitPlayerState(room, player) {
  if (!player.connected || !player.socketId) {
    return;
  }
  const hand = ensurePlayerHand(room, player.id).map((card) => ({ id: card.id, text: card.text }));
  io.to(player.socketId).emit("player:state", {
    roomCode: room.code,
    playerId: player.id,
    hand,
    submitted: [...room.submissions.values()].some((entry) => entry.playerId === player.id)
  });
}

function emitAllPlayerStates(room) {
  room.players.forEach((player) => emitPlayerState(room, player));
}

function emitRoomUpdate(room) {
  io.to(room.code).emit("room:update", toPublicRoomState(room));
  emitAllPlayerStates(room);
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
  room.winningSubmissionId = null;
  if (room.currentGreenCard) {
    room.greenDiscard.push(room.currentGreenCard);
  }
  drawGreenForRound(room);
  dealToHandSize(room);
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
    if (connectedPlayers.length < 2) {
      emitError(socket, "At least 2 connected players are required to start.");
      return;
    }

    room.round = 1;
    room.phase = "next_round";
    room.judgeIndex = 0;
    room.submissions.clear();
    room.lastWinnerId = null;
    room.winningSubmissionId = null;
    room.privateHands.clear();
    room.players.forEach((entry) => {
      entry.score = 0;
      entry.ready = false;
      ensurePlayerHand(room, entry.id);
    });
    initDecks(room);
    dealToHandSize(room);

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

    const cardId = String(payload.cardId || "").trim();
    if (!cardId) {
      emitError(socket, "Card id is required.");
      return;
    }

    const card = removeCardFromHand(room, player.id, cardId);
    if (!card) {
      emitError(socket, "Card must be in your hand.");
      return;
    }

    const submissionId = nanoid(10);
    room.submissions.set(submissionId, { id: submissionId, playerId: player.id, card });

    resolveSubmitPhaseCompletion(room);

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

    const submissionId = String(payload.submissionId || "").trim();
    const winningSubmission = room.submissions.get(submissionId) || null;
    if (!winningSubmission) {
      emitError(socket, "Winner must be one of the submitted cards.");
      return;
    }

    const winnerPlayerId = winningSubmission.playerId;
    const winner = getPlayerById(room, winnerPlayerId);
    if (!winner) {
      emitError(socket, "Winner not found.");
      return;
    }

    room.submissions.forEach((submission) => {
      room.redDiscard.push(submission.card);
    });
    room.winningSubmissionId = submissionId;
    winner.score += 1;
    room.lastWinnerId = winner.id;

    if (winner.score >= WIN_SCORE) {
      room.phase = "game_over";
      room.submissions.clear();
      room.winningSubmissionId = null;
      room.currentGreenCard = null;
      emitRoomUpdate(room);
      return;
    }

    room.phase = "score";
    dealToHandSize(room);

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

  socket.on("game:rematch", (payload = {}) => {
    const roomCode = String(payload.roomCode || socket.data.roomCode || "").toUpperCase();
    const room = rooms.get(roomCode);
    if (!room) {
      emitError(socket, "Room not found.");
      return;
    }

    if (room.phase !== "game_over") {
      emitError(socket, "Rematch is only available after game over.");
      return;
    }

    const actingPlayer = getPlayerBySocket(room, socket.id);
    if (!actingPlayer || actingPlayer.id !== room.hostPlayerId) {
      emitError(socket, "Only the host can start a rematch.");
      return;
    }

    const connectedPlayers = getConnectedPlayers(room);
    if (connectedPlayers.length < 2) {
      emitError(socket, "At least 2 connected players are required to rematch.");
      return;
    }

    room.round = 1;
    room.phase = "next_round";
    room.judgeIndex = 0;
    room.submissions.clear();
    room.lastWinnerId = null;
    room.winningSubmissionId = null;
    room.privateHands.clear();
    room.players.forEach((entry) => {
      entry.score = 0;
      entry.ready = false;
      ensurePlayerHand(room, entry.id);
    });
    initDecks(room);
    dealToHandSize(room);

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

    resolveSubmitPhaseCompletion(room);
    emitRoomUpdate(room);
    ensureHostRoomNotEmpty(room.code);
  });
});

server.listen(PORT, () => {
  console.log(`Multiplayer server listening on http://localhost:${PORT}`);
});
