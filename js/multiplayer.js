const STORAGE_KEY = "pearstopears:multiplayerIdentity";

const state = {
  socket: null,
  roomCode: "",
  playerId: "",
  playerName: "",
  room: null,
  playerState: { hand: [], submitted: false },
  isHost: false,
  connected: false
};

const ui = {
  panel: document.getElementById("multiplayer-panel"),
  status: document.getElementById("mp-status"),
  serverUrl: document.getElementById("mp-server-url"),
  roomCode: document.getElementById("mp-room-code"),
  playerName: document.getElementById("mp-player-name"),
  createBtn: document.getElementById("mp-create-room"),
  joinBtn: document.getElementById("mp-join-room"),
  readyBtn: document.getElementById("mp-toggle-ready"),
  startBtn: document.getElementById("mp-start-game"),
  nextBtn: document.getElementById("mp-next-round"),
  handSelect: document.getElementById("mp-hand-select"),
  submitBtn: document.getElementById("mp-submit-card"),
  judgeTarget: document.getElementById("mp-judge-target"),
  judgeBtn: document.getElementById("mp-judge-pick"),
  phase: document.getElementById("mp-phase"),
  players: document.getElementById("mp-players"),
  leaderboard: document.getElementById("mp-leaderboard")
};

function loadIdentity() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveIdentity() {
  const payload = {
    roomCode: state.roomCode,
    playerId: state.playerId,
    playerName: state.playerName
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

function setStatus(message) {
  ui.status.textContent = message;
}

function defaultServerUrl() {
  const protocol = window.location.protocol === "https:" ? "https:" : "http:";
  const host = window.location.hostname || "localhost";
  return `${protocol}//${host}:3000`;
}

function ensureSocket(serverUrl) {
  if (state.socket && state.socket.connected) {
    return;
  }

  state.socket = window.io(serverUrl, {
    transports: ["websocket", "polling"],
    autoConnect: true,
    reconnection: true
  });

  state.socket.on("connect", () => {
    state.connected = true;
    setStatus(`Connected to ${serverUrl}`);

    const saved = loadIdentity();
    if (saved?.roomCode && saved?.playerId) {
      state.socket.emit("room:join", {
        roomCode: saved.roomCode,
        playerId: saved.playerId,
        playerName: saved.playerName || ui.playerName.value.trim() || "Player"
      });
    }
  });

  state.socket.on("disconnect", () => {
    state.connected = false;
    setStatus("Disconnected from multiplayer server.");
  });

  state.socket.on("room:joined", (payload) => {
    state.roomCode = payload.roomCode;
    state.playerId = payload.playerId;
    state.isHost = Boolean(payload.isHost);
    state.playerState = { hand: [], submitted: false };

    ui.roomCode.value = payload.roomCode;
    if (state.playerName) {
      ui.playerName.value = state.playerName;
    }

    saveIdentity();
    setStatus(payload.rejoined ? `Rejoined room ${payload.roomCode}` : `Joined room ${payload.roomCode}`);
    render();
  });

  state.socket.on("room:update", (roomState) => {
    state.room = roomState;
    render();
  });

  state.socket.on("player:state", (playerState) => {
    if (playerState?.playerId !== state.playerId) {
      return;
    }
    state.playerState = {
      hand: Array.isArray(playerState.hand) ? playerState.hand : [],
      submitted: Boolean(playerState.submitted)
    };
    render();
  });

  state.socket.on("server:error", (payload) => {
    setStatus(payload?.message || "Server error");
  });
}

function renderList(container, lines) {
  container.innerHTML = "";
  if (lines.length === 0) {
    const li = document.createElement("li");
    li.textContent = "-";
    container.append(li);
    return;
  }

  lines.forEach((text) => {
    const li = document.createElement("li");
    li.textContent = text;
    container.append(li);
  });
}

function renderJudgeOptions() {
  ui.judgeTarget.innerHTML = "";

  if (!state.room || !Array.isArray(state.room.submissions)) {
    return;
  }

  state.room.submissions.forEach((submission) => {
    const option = document.createElement("option");
    option.value = submission.id;
    option.textContent = submission.cardText;
    ui.judgeTarget.append(option);
  });
}

function renderHandOptions() {
  ui.handSelect.innerHTML = "";
  const hand = state.playerState?.hand || [];
  hand.forEach((card) => {
    const option = document.createElement("option");
    option.value = card.id;
    option.textContent = card.text;
    ui.handSelect.append(option);
  });
}

function render() {
  const room = state.room;
  const phase = room?.phase || "lobby";
  const judgeId = room?.judgePlayerId || "";
  const judge = room?.players?.find((player) => player.id === judgeId);
  const me = room?.players?.find((player) => player.id === state.playerId);
  const canReady = Boolean(room && phase === "lobby" && me);
  const canStart = Boolean(room && phase === "lobby" && state.isHost && room.players.length >= 3);
  const canSubmit = Boolean(
    room && phase === "submit" && me && me.id !== judgeId && !state.playerState.submitted && state.playerState.hand.length > 0
  );
  const canJudge = Boolean(room && phase === "judge_pick" && me && me.id === judgeId);
  const canNext = Boolean(room && phase === "score" && state.isHost);

  ui.phase.textContent = `Room: ${state.roomCode || "-"} | Phase: ${phase} | Round: ${room?.round || 0} | Judge: ${
    judge?.name || "-"
  } | Green: ${room?.greenCard?.text || "-"} | Hand: ${state.playerState.hand.length}`;

  const playerLines = room
    ? room.players.map(
        (player) =>
          `${player.name} | score ${player.score} | ${player.ready ? "ready" : "not ready"} | ${
            player.connected ? "online" : "offline"
          }${player.isHost ? " | host" : ""}`
      )
    : [];
  renderList(ui.players, playerLines);

  const leaderboardLines = room
    ? room.leaderboard.map((entry, idx) => `${idx + 1}. ${entry.name}: ${entry.score}`)
    : [];
  renderList(ui.leaderboard, leaderboardLines);

  ui.readyBtn.disabled = !canReady;
  ui.startBtn.disabled = !canStart;
  ui.handSelect.disabled = !canSubmit;
  ui.submitBtn.disabled = !canSubmit;
  ui.judgeTarget.disabled = !canJudge;
  ui.judgeBtn.disabled = !canJudge;
  ui.nextBtn.disabled = !canNext;

  renderHandOptions();
  renderJudgeOptions();
}

function createRoom() {
  state.playerName = ui.playerName.value.trim() || "Player";
  const serverUrl = ui.serverUrl.value.trim() || defaultServerUrl();
  ensureSocket(serverUrl);
  state.socket.emit("room:create", { playerName: state.playerName });
}

function joinRoom() {
  state.playerName = ui.playerName.value.trim() || "Player";
  const roomCode = ui.roomCode.value.trim().toUpperCase();
  if (!roomCode) {
    setStatus("Room code is required.");
    return;
  }

  const serverUrl = ui.serverUrl.value.trim() || defaultServerUrl();
  ensureSocket(serverUrl);

  const saved = loadIdentity();
  state.socket.emit("room:join", {
    roomCode,
    playerName: state.playerName,
    playerId: saved?.roomCode === roomCode ? saved.playerId : undefined
  });
}

function toggleReady() {
  if (!state.socket || !state.roomCode) {
    return;
  }
  state.socket.emit("room:ready", { roomCode: state.roomCode });
}

function startGame() {
  if (!state.socket || !state.roomCode) {
    return;
  }
  state.socket.emit("game:start", { roomCode: state.roomCode });
}

function submitCard() {
  const cardId = ui.handSelect.value;
  if (!cardId || !state.socket || !state.roomCode) {
    return;
  }

  state.socket.emit("round:submit", { roomCode: state.roomCode, cardId });
}

function judgePick() {
  const submissionId = ui.judgeTarget.value;
  if (!submissionId || !state.socket || !state.roomCode) {
    return;
  }

  state.socket.emit("round:judge_pick", { roomCode: state.roomCode, submissionId });
}

function nextRound() {
  if (!state.socket || !state.roomCode) {
    return;
  }
  state.socket.emit("round:next", { roomCode: state.roomCode });
}

function init() {
  if (!ui.panel) {
    return;
  }

  if (typeof window.io !== "function") {
    setStatus("Socket.IO client unavailable.");
    return;
  }

  ui.serverUrl.value = defaultServerUrl();

  const saved = loadIdentity();
  if (saved?.roomCode) {
    ui.roomCode.value = saved.roomCode;
  }
  if (saved?.playerName) {
    ui.playerName.value = saved.playerName;
    state.playerName = saved.playerName;
  }

  ui.createBtn.addEventListener("click", createRoom);
  ui.joinBtn.addEventListener("click", joinRoom);
  ui.readyBtn.addEventListener("click", toggleReady);
  ui.startBtn.addEventListener("click", startGame);
  ui.submitBtn.addEventListener("click", submitCard);
  ui.judgeBtn.addEventListener("click", judgePick);
  ui.nextBtn.addEventListener("click", nextRound);

  render();
}

init();
