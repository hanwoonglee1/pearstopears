import { redCards } from "../data/redCards.js";
import { greenCards } from "../data/greenCards.js";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function duplicateTexts(cards) {
  const seen = new Set();
  const duplicates = new Set();

  cards.forEach((card) => {
    const normalized = card.text.trim().toLowerCase();
    if (seen.has(normalized)) {
      duplicates.add(card.text);
    }
    seen.add(normalized);
  });

  return [...duplicates];
}

function validateCardShape(cards, label) {
  cards.forEach((card, index) => {
    assert(typeof card.text === "string" && card.text.trim().length > 0, `${label}[${index}] is missing text`);
    assert(Array.isArray(card.tags) && card.tags.length > 0, `${label}[${index}] needs tags`);
  });
}

validateCardShape(redCards, "redCards");
validateCardShape(greenCards, "greenCards");

assert(redCards.length >= 120, `Expected at least 120 red cards, found ${redCards.length}`);
assert(greenCards.length >= 60, `Expected at least 60 green cards, found ${greenCards.length}`);

const redDuplicates = duplicateTexts(redCards);
const greenDuplicates = duplicateTexts(greenCards);

assert(redDuplicates.length === 0, `Duplicate red card texts: ${redDuplicates.join(", ")}`);
assert(greenDuplicates.length === 0, `Duplicate green card texts: ${greenDuplicates.join(", ")}`);

console.log(`OK: ${redCards.length} red cards, ${greenCards.length} green cards.`);
