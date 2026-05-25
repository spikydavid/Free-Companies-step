import type { TroopDie } from "./bag";

const DICE_PER_DEPOT = 4;

export interface PopulatedDepotsResult {
  depots: TroopDie[][];
  remainingBag: TroopDie[];
}

export function populateDepots(
  playerCount: number,
  bag: TroopDie[],
  random: () => number = Math.random,
): PopulatedDepotsResult {
  if (!Number.isInteger(playerCount) || playerCount < 0) {
    throw new Error("playerCount must be a non-negative integer");
  }

  const workingBag = [...bag];
  const depots: TroopDie[][] = [];

  const drawRandomDie = (): TroopDie => {
    const idx = Math.floor(random() * workingBag.length);
    const [die] = workingBag.splice(idx, 1);
    if (!die) {
      throw new Error("Cannot draw from an empty bag");
    }
    return die;
  };

  while (depots.length < playerCount && workingBag.length >= DICE_PER_DEPOT) {
    const depot: TroopDie[] = [];
    for (let i = 0; i < DICE_PER_DEPOT; i += 1) {
      depot.push(drawRandomDie());
    }
    depots.push(depot);
  }

  if (depots.length < playerCount && workingBag.length > 0) {
    const finalDepot: TroopDie[] = [];
    while (workingBag.length > 0) {
      finalDepot.push(drawRandomDie());
    }
    depots.push(finalDepot);
  }

  return {
    depots,
    remainingBag: workingBag,
  };
}
