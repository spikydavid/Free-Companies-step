import type { Award, ContractType } from "./types";
import type { FinalScore, StartGameResult } from "./start-game";

const CONTRACT_TYPES: ContractType[] = [
  "DEVASTATE",
  "ELIMINATE",
  "GUARD",
  "HUNT",
  "PLUNDER",
  "SUPPLY",
];

const SET_RENOWN_BY_SIZE = [0, 0, 1, 3, 6, 10, 15];

function computeSetRenownForCompleted(
  completedByType: Record<ContractType, number>,
): number {
  const remaining = { ...completedByType };
  let setRenown = 0;

  while (true) {
    let setSize = 0;
    for (const type of CONTRACT_TYPES) {
      if (remaining[type] > 0) {
        remaining[type] -= 1;
        setSize += 1;
      }
    }

    if (setSize === 0) {
      break;
    }

    setRenown += SET_RENOWN_BY_SIZE[setSize] ?? 0;
  }

  return setRenown;
}

function completedCountByType(
  player: StartGameResult["players"][number],
): Record<ContractType, number> {
  const counts: Record<ContractType, number> = {
    DEVASTATE: 0,
    ELIMINATE: 0,
    GUARD: 0,
    HUNT: 0,
    PLUNDER: 0,
    SUPPLY: 0,
  };

  for (const contract of player.completedContracts) {
    counts[contract.type] += 1;
  }

  return counts;
}

export function computeFinalScores(game: StartGameResult): {
  awardsWonByPlayer: Record<string, Award[]>;
  finalScores: FinalScore[];
} {
  const awardsWonByPlayer = game.awardsWonByPlayer;

  const finalScores = game.players
    .map((player) => {
      const byType = completedCountByType(player);
      const renownFromContracts = player.completedContracts.reduce(
        (sum, contract) => sum + contract.rewardRenown,
        0,
      );
      const renownFromSets = computeSetRenownForCompleted(byType);
      const renownFromAwards = (awardsWonByPlayer[player.id] ?? []).reduce(
        (sum, award) => sum + award.renown,
        0,
      );
      const totalRenown = renownFromContracts + renownFromSets + renownFromAwards;

      return {
        playerId: player.id,
        totalRenown,
        renownFromContracts,
        renownFromSets,
        renownFromAwards,
        completedContracts: player.completedContracts.length,
        crowns: player.crowns,
      } satisfies FinalScore;
    })
    .sort((left, right) => {
      if (right.totalRenown !== left.totalRenown) {
        return right.totalRenown - left.totalRenown;
      }
      if (right.completedContracts !== left.completedContracts) {
        return right.completedContracts - left.completedContracts;
      }
      return right.crowns - left.crowns;
    });

  return {
    awardsWonByPlayer,
    finalScores,
  };
}
