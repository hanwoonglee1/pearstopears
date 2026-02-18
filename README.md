# Pears to Pears

A browser-playable, Apples to Apples inspired party card game built with pure HTML, CSS, and JavaScript.

## Features

- Existing static single-player mode (1 human + 4 AI) remains playable
- New multiplayer phase-1 architecture with Node.js + Express + Socket.IO
- Room lifecycle: create, join, ready toggle, host start
- Authoritative server phases: `lobby -> submit -> judge_pick -> score -> next_round`
- Judge rotation each round + score leaderboard
- Basic reconnect via `playerId` token stored in browser `localStorage`
- Data validation script for card deck constraints

## Project Structure

- `index.html`: app shell, single-player UI, and multiplayer lobby panel
- `css/styles.css`: responsive styling and animations
- `js/game.js`: single-player game state, turn loop, AI logic, rendering
- `js/multiplayer.js`: minimal Socket.IO multiplayer lobby client
- `server/index.js`: multiplayer server (rooms, phases, scoring, reconnect)
- `data/redCards.js`: red card deck data (120+ cards)
- `data/greenCards.js`: green card deck data (60+ cards)
- `scripts/validate-data.js`: basic validation checks for deck size/shape/duplicates

## Run Locally

1. Install dependencies:

```bash
npm install
```

2. Run validation:

```bash
npm run validate
```

3. Start the multiplayer server:

```bash
npm run dev:server
```

4. Serve static frontend in a separate terminal:

```bash
python3 -m http.server 8000
```

5. Open:

```text
http://localhost:8000
```

Single-player mode is still controlled by **Start Game**. Multiplayer phase-1 controls are in the **Multiplayer Lobby (Phase 1)** panel.

## Multiplayer Event Contract (Phase 1)

All events are Socket.IO events.

### Client -> Server

- `room:create`
  - payload: `{ playerName: string }`
  - creates room and host player
- `room:join`
  - payload: `{ roomCode: string, playerName: string, playerId?: string }`
  - joins lobby or reconnects existing player when `playerId` matches
- `room:ready`
  - payload: `{ roomCode: string }`
  - toggles caller's ready state in lobby
- `game:start`
  - payload: `{ roomCode: string }`
  - host-only; requires at least 3 connected players
- `round:submit`
  - payload: `{ roomCode: string, cardText: string }`
  - non-judge players submit one placeholder card text in `submit` phase
- `round:judge_pick`
  - payload: `{ roomCode: string, winnerPlayerId: string }`
  - judge-only winner selection in `judge_pick` phase
- `round:next`
  - payload: `{ roomCode: string }`
  - host-only transition from `score` to next round

### Server -> Client

- `room:joined`
  - payload:
    - `{ roomCode: string, playerId: string, isHost: boolean, rejoined?: boolean }`
- `room:update`
  - authoritative snapshot payload:
    - `{`
    - `  roomCode: string,`
    - `  phase: "lobby"|"submit"|"judge_pick"|"score"|"next_round",`
    - `  round: number,`
    - `  hostPlayerId: string,`
    - `  judgePlayerId: string|null,`
    - `  lastWinnerId: string|null,`
    - `  submissionCount: number,`
    - `  expectedSubmissionCount: number,`
    - `  players: Array<{ id, name, score, ready, connected, isHost }>,`
    - `  leaderboard: Array<{ id, name, score }>,`
    - `  submissions: Array<{ playerId, cardText }>`
    - `}`
- `server:error`
  - payload: `{ message: string }`

## Server Authority / Privacy Notes

- Multiplayer room state is server authoritative.
- The server owns phase transitions, judge selection, round progression, and scoring.
- Private hand structures are server-side only placeholders in phase 1 and are not emitted in `room:update` snapshots.

## Single-Player How To Play

1. Click **Start Game**.
2. Each round, one player is the judge (rotates through all 5 players).
3. The green adjective card is revealed.
4. Non-judge players submit one red noun card:
   - If you are not the judge, click a card from your hand.
   - AI players submit automatically.
5. The judge selects the winner:
   - Human judge: click one submitted red card.
   - AI judge: picks automatically.
6. Round winner gains 1 point.
7. First player to 10 points wins.
8. Click **Restart Game** to play again.

## Rules Notes

- Submissions are anonymous while the human is judging.
- Cards are re-dealt to maintain hand size.
- Decks reshuffle from discard piles when exhausted.
