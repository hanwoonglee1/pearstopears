import { redCards } from "../data/redCards.js";
import { greenCards } from "../data/greenCards.js";

const HAND_SIZE = 7;
const WIN_SCORE = 10;

const state = {
  players: [],
  round: 0,
  judgeIndex: 0,
  greenDeck: [],
  greenDiscard: [],
  redDeck: [],
  redDiscard: [],
  currentGreen: null,
  submissions: [],
  winnerId: null,
  gameOver: false,
  phase: "idle",
  message: "Press Start Game to begin.",
  revealOwners: false
};

const ui = {
  players: document.getElementById("players"),
  roundInfo: document.getElementById("round-info"),
  greenCard: document.getElementById("green-card"),
  submissions: document.getElementById("submissions"),
  hand: document.getElementById("hand"),
  message: document.getElementById("message"),
  actionButton: document.getElementById("action-button"),
  log: document.getElementById("round-log")
};

function shuffle(list) {
  for (let i = list.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

function cloneCards(cards) {
  return cards.map((card) => ({ ...card, id: crypto.randomUUID() }));
}

function initPlayers() {
  state.players = [
    { id: "p0", name: "You", isHuman: true, score: 0, hand: [] },
    { id: "p1", name: "Nova", isHuman: false, score: 0, hand: [] },
    { id: "p2", name: "Blaze", isHuman: false, score: 0, hand: [] },
    { id: "p3", name: "Echo", isHuman: false, score: 0, hand: [] },
    { id: "p4", name: "Pixel", isHuman: false, score: 0, hand: [] }
  ];
}

function resetDecks() {
  state.redDeck = shuffle(cloneCards(redCards));
  state.redDiscard = [];
  state.greenDeck = shuffle(cloneCards(greenCards));
  state.greenDiscard = [];
}

function drawRed() {
  if (state.redDeck.length === 0) {
    state.redDeck = shuffle(state.redDiscard);
    state.redDiscard = [];
  }
  return state.redDeck.pop() || null;
}

function drawGreen() {
  if (state.greenDeck.length === 0) {
    state.greenDeck = shuffle(state.greenDiscard);
    state.greenDiscard = [];
  }
  return state.greenDeck.pop() || null;
}

function refillHands() {
  state.players.forEach((player) => {
    while (player.hand.length < HAND_SIZE) {
      const card = drawRed();
      if (!card) {
        break;
      }
      player.hand.push(card);
    }
  });
}

function getJudge() {
  return state.players[state.judgeIndex];
}

function normalizeWords(text) {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, "")
      .split(/\s+/)
      .filter((word) => word.length > 2)
  );
}

function scoreCardAgainstGreen(redCard, greenCard) {
  const redTags = new Set(redCard.tags.map((tag) => tag.toLowerCase()));
  const greenTags = new Set(greenCard.tags.map((tag) => tag.toLowerCase()));
  const redWords = normalizeWords(redCard.text);
  const greenWords = normalizeWords(greenCard.text);

  let score = 0;

  greenTags.forEach((tag) => {
    if (redTags.has(tag)) {
      score += 3;
    }
  });

  greenWords.forEach((word) => {
    if (redWords.has(word)) {
      score += 2;
    }
  });

  if (greenTags.has("funny") && redTags.has("awkward")) {
    score += 1.5;
  }
  if (greenTags.has("spooky") && redTags.has("mystery")) {
    score += 1.5;
  }
  if (greenTags.has("smart") && redTags.has("science")) {
    score += 1.5;
  }

  return score + Math.random() * 1.4;
}

function aiPickCard(player) {
  if (player.hand.length === 0) {
    return null;
  }

  const randomPickChance = 0.18;
  if (Math.random() < randomPickChance) {
    return player.hand[Math.floor(Math.random() * player.hand.length)];
  }

  return player.hand
    .map((card) => ({
      card,
      score: scoreCardAgainstGreen(card, state.currentGreen)
    }))
    .sort((a, b) => b.score - a.score)[0].card;
}

function removeCardFromHand(playerId, cardId) {
  const player = state.players.find((entry) => entry.id === playerId);
  if (!player) {
    return null;
  }
  const index = player.hand.findIndex((card) => card.id === cardId);
  if (index < 0) {
    return null;
  }
  return player.hand.splice(index, 1)[0];
}

function submitCard(player, card) {
  if (!card) {
    return;
  }
  removeCardFromHand(player.id, card.id);
  state.submissions.push({ playerId: player.id, card });
}

function everyoneSubmitted() {
  return state.submissions.length === state.players.length - 1;
}

function resolveAiJudge() {
  const scored = state.submissions.map((submission) => ({
    ...submission,
    score: scoreCardAgainstGreen(submission.card, state.currentGreen) + Math.random() * 1.2
  }));
  scored.sort((a, b) => b.score - a.score);
  const winningSubmission = scored[0];
  completeRound(winningSubmission.playerId);
}

function completeRound(winnerId) {
  state.winnerId = winnerId;
  state.revealOwners = true;
  const winner = state.players.find((player) => player.id === winnerId);
  winner.score += 1;

  state.submissions.forEach((submission) => state.redDiscard.push(submission.card));
  if (state.currentGreen) {
    state.greenDiscard.push(state.currentGreen);
  }

  refillHands();

  if (winner.score >= WIN_SCORE) {
    state.gameOver = true;
    state.phase = "game-over";
    state.message = `${winner.name} wins the game with ${winner.score} points!`;
    ui.actionButton.textContent = "Restart Game";
  } else {
    state.phase = "round-end";
    state.message = `${winner.name} wins the round with \"${state.submissions.find((entry) => entry.playerId === winnerId).card.text}\".`;
    ui.actionButton.textContent = "Next Round";
  }

  logRoundResult(winner);
  render();
}

function logRoundResult(winner) {
  const judge = getJudge();
  const played = state.submissions
    .map((entry) => {
      const player = state.players.find((p) => p.id === entry.playerId);
      return `${player.name}: ${entry.card.text}`;
    })
    .join(" | ");

  const item = document.createElement("li");
  item.textContent = `Round ${state.round}: Judge ${judge.name} | Green: ${state.currentGreen.text} | Winner: ${winner.name} | ${played}`;
  ui.log.prepend(item);
}

function triggerAiSubmissions(excludingJudge = true) {
  const judgeId = excludingJudge ? getJudge().id : null;
  const aiPlayers = state.players.filter(
    (player) => !player.isHuman && (judgeId ? player.id !== judgeId : true)
  );

  aiPlayers.forEach((player, index) => {
    setTimeout(() => {
      if (state.phase === "game-over") {
        return;
      }
      if (state.submissions.some((entry) => entry.playerId === player.id)) {
        return;
      }
      const card = aiPickCard(player);
      submitCard(player, card);
      state.message = `${player.name} has submitted a card.`;
      render();

      if (everyoneSubmitted()) {
        handleJudgingPhase();
      }
    }, 400 + index * 400);
  });
}

function handleJudgingPhase() {
  const judge = getJudge();
  if (judge.isHuman) {
    state.phase = "human-judge";
    state.message = "You are the judge. Pick the winning red card.";
    ui.actionButton.textContent = "Waiting for Judge";
    render();
    return;
  }

  state.phase = "ai-judge";
  state.message = `${judge.name} is judging the submissions...`;
  render();

  setTimeout(() => {
    if (state.phase === "ai-judge") {
      resolveAiJudge();
    }
  }, 900);
}

function startRound() {
  state.round += 1;
  state.judgeIndex = (state.round - 1) % state.players.length;
  state.currentGreen = drawGreen();
  state.submissions = [];
  state.winnerId = null;
  state.revealOwners = false;

  const judge = getJudge();
  if (!state.currentGreen) {
    state.gameOver = true;
    state.phase = "game-over";
    state.message = "No more green cards. Restart to play again.";
    ui.actionButton.textContent = "Restart Game";
    render();
    return;
  }

  if (judge.isHuman) {
    state.phase = "waiting-ai";
    state.message = `Round ${state.round}: You are the judge.`;
    ui.actionButton.textContent = "Waiting for Players";
    render();
    triggerAiSubmissions(true);
  } else {
    state.phase = "human-play";
    state.message = `Round ${state.round}: ${judge.name} is judge. Choose your best red card.`;
    ui.actionButton.textContent = "Choose a Card";
    render();
    triggerAiSubmissions(true);
  }
}

function handleHumanCardSelection(cardId) {
  if (state.phase !== "human-play") {
    return;
  }

  const human = state.players[0];
  const card = human.hand.find((entry) => entry.id === cardId);
  if (!card) {
    return;
  }

  submitCard(human, card);
  state.message = `You submitted \"${card.text}\".`;
  render();

  if (everyoneSubmitted()) {
    handleJudgingPhase();
  }
}

function handleHumanJudgePick(playerId) {
  if (state.phase !== "human-judge") {
    return;
  }
  completeRound(playerId);
}

function startGame() {
  initPlayers();
  resetDecks();
  refillHands();
  state.round = 0;
  state.gameOver = false;
  state.phase = "setup";
  ui.log.innerHTML = "";
  startRound();
}

function renderPlayers() {
  const judge = getJudge();
  ui.players.innerHTML = "";
  state.players.forEach((player) => {
    const panel = document.createElement("div");
    panel.className = "player-pill";
    if (player.id === judge.id) {
      panel.classList.add("judge");
    }
    if (player.id === state.winnerId) {
      panel.classList.add("winner");
    }
    panel.innerHTML = `<span class="name">${player.name}</span><span class="score">${player.score}</span>`;
    ui.players.append(panel);
  });
}

function renderGreenCard() {
  if (!state.currentGreen) {
    ui.greenCard.innerHTML = "";
    return;
  }
  const tags = state.currentGreen.tags.map((tag) => `<span>${tag}</span>`).join("");
  ui.greenCard.innerHTML = `
    <div class="card card-green fade-in">
      <div class="card-label">Green Card</div>
      <div class="card-title">${state.currentGreen.text}</div>
      <div class="card-tags">${tags}</div>
    </div>
  `;
}

function renderSubmissions() {
  ui.submissions.innerHTML = "";
  const judge = getJudge();

  if (state.submissions.length === 0) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "Waiting for red cards...";
    ui.submissions.append(empty);
    return;
  }

  const displayCards = shuffle([...state.submissions]);
  displayCards.forEach((submission) => {
    const cardButton = document.createElement("button");
    cardButton.className = "card card-red fade-in";
    cardButton.type = "button";

    const owner = state.players.find((player) => player.id === submission.playerId);
    const showOwner = state.revealOwners || !judge.isHuman;

    cardButton.innerHTML = `
      <div class="card-label">Red Card</div>
      <div class="card-title">${submission.card.text}</div>
      <div class="card-tags">${submission.card.tags.map((tag) => `<span>${tag}</span>`).join("")}</div>
      <div class="card-owner">${showOwner ? owner.name : "Anonymous"}</div>
    `;

    if (state.phase === "human-judge") {
      cardButton.classList.add("selectable");
      cardButton.addEventListener("click", () => handleHumanJudgePick(submission.playerId));
    } else {
      cardButton.disabled = true;
    }

    if (state.winnerId && submission.playerId === state.winnerId) {
      cardButton.classList.add("winner");
    }

    ui.submissions.append(cardButton);
  });
}

function renderHand() {
  const human = state.players[0];
  ui.hand.innerHTML = "";
  const isSelectable = state.phase === "human-play";
  const judge = getJudge();

  if (judge.isHuman) {
    const label = document.createElement("p");
    label.className = "muted";
    label.textContent = "You are judging this round.";
    ui.hand.append(label);
    return;
  }

  human.hand.forEach((card) => {
    const cardBtn = document.createElement("button");
    cardBtn.type = "button";
    cardBtn.className = "card card-red hand-card";
    if (isSelectable) {
      cardBtn.classList.add("selectable");
    }
    cardBtn.innerHTML = `
      <div class="card-label">Your Card</div>
      <div class="card-title">${card.text}</div>
      <div class="card-tags">${card.tags.map((tag) => `<span>${tag}</span>`).join("")}</div>
    `;
    cardBtn.disabled = !isSelectable;
    cardBtn.addEventListener("click", () => handleHumanCardSelection(card.id));
    ui.hand.append(cardBtn);
  });
}

function renderRoundInfo() {
  const judge = getJudge();
  ui.roundInfo.textContent = `Round ${state.round} | Judge: ${judge.name} | First to ${WIN_SCORE}`;
}

function render() {
  renderPlayers();
  renderRoundInfo();
  renderGreenCard();
  renderSubmissions();
  renderHand();
  ui.message.textContent = state.message;
}

ui.actionButton.addEventListener("click", () => {
  if (state.phase === "idle" || state.gameOver) {
    startGame();
    return;
  }

  if (state.phase === "round-end") {
    startRound();
  }
});

render();
