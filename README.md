# Pears to Pears

A browser-playable, Apples to Apples inspired party card game built with pure HTML, CSS, and JavaScript.

## Features

- Static web app (no backend required)
- 5 total players: 1 human local player + 4 AI players
- Rotating judge each round
- Green adjective prompt cards + red noun cards
- AI card selection and judging with simple heuristic (tag/word affinity) plus randomness
- Score tracking to 10 points and game restart
- Responsive UI with animated card interactions
- Data validation script for card deck constraints

## Project Structure

- `index.html`: app shell and UI sections
- `css/styles.css`: responsive styling and animations
- `js/game.js`: game state, turn loop, AI logic, rendering
- `data/redCards.js`: red card deck data (120+ cards)
- `data/greenCards.js`: green card deck data (60+ cards)
- `scripts/validate-data.js`: basic validation checks for deck size/shape/duplicates

## Run Locally

1. From the repository root, run validation:

```bash
npm run validate
```

2. Serve the folder with any static server (recommended because ES modules are used):

```bash
python3 -m http.server 8000
```

3. Open:

```text
http://localhost:8000
```

## How To Play

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
