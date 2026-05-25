import { populateDepots } from "./depots";
import type { StartGameResult } from "./start-game";

export interface DepotPhaseOptions {
  random?: () => number;
}

export function runDepotPhase(
  game: StartGameResult,
  options: DepotPhaseOptions = {},
): StartGameResult {
  if (game.gameEnded) {
    throw new Error("Game has ended; cannot run depot phase");
  }

  if (game.currentRoundActionOrder.length > 0) {
    throw new Error("Depot phase must run before role selection");
  }

  const random = options.random ?? Math.random;
  const populated = populateDepots(game.players.length, game.bag, random);
  if (populated.depots.length < game.players.length) {
    throw new Error("Not enough dice in bag to create one depot per player");
  }

  return {
    ...game,
    bag: populated.remainingBag,
    depots: populated.depots,
  };
}
