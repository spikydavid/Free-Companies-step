import type { Award } from "./types";

export const DEFAULT_AWARDS: Award[] = [
  { type: "DEVASTATE", renown: 3, threshold: 3 },
  { type: "ELIMINATE", renown: 3, threshold: 3 },
  { type: "GUARD", renown: 3, threshold: 3 },
  { type: "HUNT", renown: 3, threshold: 3 },
  { type: "PLUNDER", renown: 3, threshold: 3 },
  { type: "SUPPLY", renown: 3, threshold: 3 },
];

export function createAwardsSet(): Award[] {
  return DEFAULT_AWARDS.map((award) => ({ ...award }));
}

export function pickAwardsInPlay(
  allAwards: Award[],
  count: number,
  random: () => number = Math.random,
): Award[] {
  if (!Number.isInteger(count) || count < 0 || count > allAwards.length) {
    throw new Error("count must be an integer between 0 and total awards");
  }

  const pool = allAwards.map((award) => ({ ...award }));
  const selected: Award[] = [];

  while (selected.length < count) {
    const idx = Math.floor(random() * pool.length);
    const [award] = pool.splice(idx, 1);
    if (!award) {
      throw new Error("Failed to select award");
    }
    selected.push(award);
  }

  return selected;
}
