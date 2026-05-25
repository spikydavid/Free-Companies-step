import type { Contract } from "./types";
import type { TroopDie } from "./bag";
import type { StartGameResult } from "./start-game";
import { computeFinalScores } from "./scoring";
import { runPaymentPhase } from "./payment";

export interface CampaignPhaseOptions {
  random?: () => number;
  humanCampaignSelectionsByPlayer?: Record<string, string[]>;
}

type TroopType = TroopDie["troopType"];

interface BattleDie extends TroopDie {
  roll: number;
}

type RequirementByType = Contract["requirements"];

const TROOP_TYPES: TroopType[] = ["melee", "ranged", "mounted"];

function zeroByType(): Record<TroopType, number> {
  return {
    melee: 0,
    ranged: 0,
    mounted: 0,
  };
}

function countDiceByType(dice: TroopDie[]): Record<TroopType, number> {
  const counts = zeroByType();
  for (const die of dice) {
    counts[die.troopType] += 1;
  }
  return counts;
}

function rollBattleDie(random: () => number, sides: number, battleMaster: boolean): number {
  const base = Math.floor(random() * sides) + 1;
  return battleMaster ? Math.min(6, base + 1) : base;
}

function sortContractsForCampaign(contracts: Contract[], dice: TroopDie[]): Contract[] {
  const available = countDiceByType(dice);

  const scoreContract = (contract: Contract): number => {
    const requirements = contract.requirements;
    const unmetPenalty = TROOP_TYPES.reduce((sum, type) => {
      const unmet = Math.max(0, requirements[type] - available[type]);
      return sum + unmet * 25;
    }, 0);
    const totalRequirement = requirements.melee + requirements.ranged + requirements.mounted;
    return contract.rewardRenown * 100 + contract.rewardCrowns * 10 - unmetPenalty - totalRequirement;
  };

  return [...contracts].sort((left, right) => {
    const scoreDiff = scoreContract(right) - scoreContract(left);
    if (scoreDiff !== 0) {
      return scoreDiff;
    }
    if (right.rewardRenown !== left.rewardRenown) {
      return right.rewardRenown - left.rewardRenown;
    }
    if (right.rewardCrowns !== left.rewardCrowns) {
      return right.rewardCrowns - left.rewardCrowns;
    }
    if (left.cardNumber !== right.cardNumber) {
      return left.cardNumber - right.cardNumber;
    }
    return left.id.localeCompare(right.id);
  });
}

function computeCampaignCost(contracts: Contract[], forager: boolean): number {
  if (forager) {
    return 0;
  }

  if (contracts.length <= 1) {
    return 0;
  }

  let cost = contracts.length === 2 ? 2 : 5;
  for (let i = 1; i < contracts.length; i += 1) {
    if (contracts[i - 1]?.region !== contracts[i]?.region) {
      cost += 3;
    }
  }

  return cost;
}

function chooseAffordableCampaignContracts(
  sortedContracts: Contract[],
  crowns: number,
  forager: boolean,
): Contract[] {
  const maxCount = Math.min(3, sortedContracts.length);
  for (let count = maxCount; count >= 1; count -= 1) {
    const bundle = sortedContracts.slice(0, count);
    if (computeCampaignCost(bundle, forager) <= crowns) {
      return bundle;
    }
  }
  return [];
}

function chooseDiceToSendHome(
  activeDice: TroopDie[],
  requirements: RequirementByType,
): { campaignDice: TroopDie[]; sentHomeDice: TroopDie[] } {
  const counts = countDiceByType(activeDice);
  const keepTargets: Record<TroopType, number> = {
    melee: Math.min(counts.melee, requirements.melee + 2),
    ranged: Math.min(counts.ranged, requirements.ranged + 2),
    mounted: Math.min(counts.mounted, requirements.mounted + 2),
  };

  const extrasToSend: Record<TroopType, number> = {
    melee: counts.melee - keepTargets.melee,
    ranged: counts.ranged - keepTargets.ranged,
    mounted: counts.mounted - keepTargets.mounted,
  };

  const campaignDice: TroopDie[] = [];
  const sentHomeDice: TroopDie[] = [];

  for (const die of activeDice) {
    const type = die.troopType;
    if (extrasToSend[type] > 0) {
      sentHomeDice.push(die);
      extrasToSend[type] -= 1;
    } else {
      campaignDice.push(die);
    }
  }

  return {
    campaignDice,
    sentHomeDice,
  };
}

function computeSuccessByType(
  rolled: BattleDie[],
): Record<TroopType, number> {
  const success = zeroByType();
  for (const die of rolled) {
    if (die.roll >= 4 && die.roll <= 5) {
      success[die.troopType] += 1;
    }
  }
  return success;
}

function isWoundedRoll(roll: number, hasSurgeon: boolean): boolean {
  return roll === 3 || (hasSurgeon && roll === 2);
}

function assignWildcardsToDeficits(
  successByType: Record<TroopType, number>,
  requirements: RequirementByType,
  wildcardCount: number,
): number {
  let wildcardRemaining = wildcardCount;

  while (wildcardRemaining > 0) {
    const deficitByType: Record<TroopType, number> = {
      melee: Math.max(0, requirements.melee - successByType.melee),
      ranged: Math.max(0, requirements.ranged - successByType.ranged),
      mounted: Math.max(0, requirements.mounted - successByType.mounted),
    };

    const targetType = TROOP_TYPES.reduce<TroopType | null>((best, type) => {
      if (deficitByType[type] <= 0) {
        return best;
      }
      if (!best) {
        return type;
      }
      if (deficitByType[type] > deficitByType[best]) {
        return type;
      }
      return best;
    }, null);

    if (!targetType) {
      break;
    }

    successByType[targetType] += 1;
    wildcardRemaining -= 1;
  }

  return wildcardRemaining;
}

function computeDeficitByType(
  successByType: Record<TroopType, number>,
  requirements: RequirementByType,
): Record<TroopType, number> {
  return {
    melee: Math.max(0, requirements.melee - successByType.melee),
    ranged: Math.max(0, requirements.ranged - successByType.ranged),
    mounted: Math.max(0, requirements.mounted - successByType.mounted),
  };
}

function chooseDeadDieIndexForReroll(
  rolled: BattleDie[],
  contract: Contract,
  deadThreshold: number,
): number {
  const deadIndices = rolled
    .map((die, index) => ({ die, index }))
    .filter(({ die }) => die.roll <= deadThreshold);

  if (deadIndices.length === 0) {
    return -1;
  }

  const projectedSuccess = computeSuccessByType(rolled);
  const wildcardCount = rolled.filter((die) => die.roll === 6).length;
  assignWildcardsToDeficits(projectedSuccess, contract.requirements, wildcardCount);
  const deficits = computeDeficitByType(projectedSuccess, contract.requirements);

  deadIndices.sort((left, right) => {
    const deficitDiff = deficits[right.die.troopType] - deficits[left.die.troopType];
    if (deficitDiff !== 0) {
      return deficitDiff;
    }
    if (left.die.roll !== right.die.roll) {
      return left.die.roll - right.die.roll;
    }
    return left.index - right.index;
  });

  return deadIndices[0]?.index ?? -1;
}

function resolveContractOutcome(
  contract: Contract,
  rolled: BattleDie[],
  deadThreshold: number,
  hasSurgeon: boolean,
): {
  success: boolean;
  deadDice: BattleDie[];
  woundedDice: BattleDie[];
  sacrificedDice: Set<BattleDie>;
  activeDiceForNextBattle: TroopDie[];
  homeDiceAfterBattle: TroopDie[];
  deadOrSacrificedForBag: TroopDie[];
} {
  const deadDice = rolled.filter((die) => die.roll <= deadThreshold);
  const woundedDice = rolled.filter((die) => isWoundedRoll(die.roll, hasSurgeon));
  const wildcardCount = rolled.filter((die) => die.roll === 6).length;

  const successByType = computeSuccessByType(rolled);
  assignWildcardsToDeficits(successByType, contract.requirements, wildcardCount);

  const sacrificedDice = new Set<BattleDie>();
  const sacrificeCandidatesByType: Record<TroopType, BattleDie[]> = {
    melee: rolled
      .filter((die) => die.roll > deadThreshold && die.roll <= 5 && die.troopType === "melee")
      .sort((a, b) => a.roll - b.roll),
    ranged: rolled
      .filter((die) => die.roll > deadThreshold && die.roll <= 5 && die.troopType === "ranged")
      .sort((a, b) => a.roll - b.roll),
    mounted: rolled
      .filter((die) => die.roll > deadThreshold && die.roll <= 5 && die.troopType === "mounted")
      .sort((a, b) => a.roll - b.roll),
  };

  for (const type of TROOP_TYPES) {
    while (successByType[type] < contract.requirements[type]) {
      const candidate = sacrificeCandidatesByType[type].find((die) => !sacrificedDice.has(die));
      if (!candidate) {
        break;
      }
      sacrificedDice.add(candidate);
      successByType[type] += 1;
    }
  }

  const success = TROOP_TYPES.every(
    (type) => successByType[type] >= contract.requirements[type],
  );

  const deadOrSacrificedForBag = rolled
    .filter((die) => die.roll <= deadThreshold || sacrificedDice.has(die))
    .map(toTroopDie);

  const homeDiceAfterBattle = woundedDice
    .filter((die) => !sacrificedDice.has(die))
    .map(toTroopDie);

  const activeDiceForNextBattle = rolled
    .filter((die) => die.roll >= 4 && !sacrificedDice.has(die))
    .map(toTroopDie);

  return {
    success,
    deadDice,
    woundedDice,
    sacrificedDice,
    activeDiceForNextBattle,
    homeDiceAfterBattle,
    deadOrSacrificedForBag,
  };
}

function toTroopDie(die: BattleDie): TroopDie {
  return {
    troopType: die.troopType,
    sides: die.sides,
  };
}

function claimAwardsAfterCampaign(
  game: StartGameResult,
  updatedPlayers: StartGameResult["players"],
): Record<string, StartGameResult["awards"]> {
  const awardsWonByPlayer = Object.fromEntries(
    updatedPlayers.map((player) => [player.id, [...(game.awardsWonByPlayer[player.id] ?? [])]]),
  ) as Record<string, StartGameResult["awards"]>;

  const claimedAwardTypes = new Set(
    Object.values(awardsWonByPlayer)
      .flat()
      .map((award) => award.type),
  );

  for (const playerId of game.currentRoundActionOrder) {
    const player = updatedPlayers.find((entry) => entry.id === playerId);
    if (!player) {
      continue;
    }

    for (const award of game.awards) {
      if (claimedAwardTypes.has(award.type)) {
        continue;
      }

      const completedOfType = player.completedContracts.filter(
        (contract) => contract.type === award.type,
      ).length;

      if (completedOfType >= award.threshold) {
        awardsWonByPlayer[playerId].push(award);
        claimedAwardTypes.add(award.type);
      }
    }
  }

  return awardsWonByPlayer;
}

export function runCampaignPhase(
  game: StartGameResult,
  options: CampaignPhaseOptions = {},
): StartGameResult {
  if (game.currentRoundActionOrder.length !== game.players.length) {
    throw new Error("Role selection must complete before campaigning");
  }

  const hasMusterResults = Object.keys(game.currentRoundMusterDiceByPlayer).length > 0;
  if (!hasMusterResults) {
    throw new Error("Muster must complete before campaigning");
  }

  const random = options.random ?? Math.random;
  const campaignContractsByPlayer: Record<string, Contract[]> = {};

  for (const playerId of game.currentRoundActionOrder) {
    const player = game.players.find((entry) => entry.id === playerId);
    if (!player) {
      throw new Error(`Unknown player in action order: ${playerId}`);
    }

    const maybeHumanSelection = options.humanCampaignSelectionsByPlayer?.[playerId];

    if (player.kind === "human" && maybeHumanSelection && maybeHumanSelection.length > 0) {
      const resolved = maybeHumanSelection.map((contractId) => {
        const contract = player.contracts.find((entry) => entry.id === contractId);
        if (!contract) {
          throw new Error(`${playerId} selected unavailable contract ${contractId} for campaign`);
        }
        return contract;
      });

      const selectedRole = game.currentRoundRolesSelectedByPlayer[playerId];
      const hasForager = selectedRole === "FORAGER";
      const capped = resolved.slice(0, 3);
      const campaignCost = computeCampaignCost(capped, hasForager);
      if (campaignCost > player.crowns) {
        throw new Error(`${playerId} cannot afford campaign cost ${campaignCost}`);
      }

      campaignContractsByPlayer[playerId] = capped;
      continue;
    }

    const selectedRole = game.currentRoundRolesSelectedByPlayer[playerId];
    const hasForager = selectedRole === "FORAGER";
    const sorted = sortContractsForCampaign(player.contracts, player.dice);
    campaignContractsByPlayer[playerId] = chooseAffordableCampaignContracts(
      sorted,
      player.crowns,
      hasForager,
    );
  }

  let equipment = game.equipment;
  const bag = [...game.bag];

  const updatedPlayers = game.players.map((player) => ({
    ...player,
    contracts: [...player.contracts],
    completedContracts: [...player.completedContracts],
    discardedContracts: [...player.discardedContracts],
    dice: [...player.dice],
  }));
  const playerById = new Map(updatedPlayers.map((player) => [player.id, player]));

  const campaignResolutionByPlayer: StartGameResult["currentRoundCampaignResolutionByPlayer"] =
    {};

  for (const playerId of game.currentRoundActionOrder) {
    const player = playerById.get(playerId);
    if (!player) {
      throw new Error(`Unknown player in action order: ${playerId}`);
    }

    const selectedContracts = campaignContractsByPlayer[playerId] ?? [];
    const selectedRole = game.currentRoundRolesSelectedByPlayer[playerId];
    const hasForager = selectedRole === "FORAGER";
    const hasBattleMaster = selectedRole === "BATTLE_MASTER";
    const hasSurgeon = selectedRole === "SURGEON";
    const deadThreshold = hasSurgeon ? 1 : 2;
    const selectedContractIds = selectedContracts.map((contract) => contract.id);
    const campaignCostPaid = computeCampaignCost(selectedContracts, hasForager);
    if (campaignCostPaid > player.crowns) {
      throw new Error(`${playerId} cannot afford campaign cost ${campaignCostPaid}`);
    }
    player.crowns -= campaignCostPaid;
    const resolvedContracts: StartGameResult["currentRoundCampaignResolutionByPlayer"][string]["resolvedContracts"] =
      [];

    const homeDice: StartGameResult["players"][number]["dice"] = [];
    let activeDice = [...player.dice];

    for (const contract of selectedContracts) {
      const queuedIdx = player.contracts.findIndex((entry) => entry.id === contract.id);
      if (queuedIdx < 0) {
        throw new Error(`${playerId} selected unavailable contract ${contract.id} for campaign`);
      }

      const sendHomePlan = chooseDiceToSendHome(activeDice, contract.requirements);
      activeDice = sendHomePlan.campaignDice;
      const sentHomeDice = sendHomePlan.sentHomeDice;
      homeDice.push(...sentHomeDice);

      const rolled: BattleDie[] = activeDice.map((die) => ({
        ...die,
        roll: rollBattleDie(random, die.sides, hasBattleMaster),
      }));

      let equipmentSpent = 0;
      const availableEquipment = equipment.byPlayer[playerId] ?? 0;
      for (let i = 0; i < availableEquipment; i += 1) {
        const preview = resolveContractOutcome(contract, rolled, deadThreshold, hasSurgeon);
        if (preview.success) {
          break;
        }

        const rerollIdx = chooseDeadDieIndexForReroll(
          rolled,
          contract,
          deadThreshold,
        );
        if (rerollIdx < 0) {
          break;
        }
        const die = rolled[rerollIdx];
        if (!die) {
          break;
        }
        die.roll = rollBattleDie(random, die.sides, hasBattleMaster);
        equipmentSpent += 1;
      }

      if (equipmentSpent > 0) {
        equipment = {
          ...equipment,
          armoury: equipment.armoury + equipmentSpent,
          byPlayer: {
            ...equipment.byPlayer,
            [playerId]: (equipment.byPlayer[playerId] ?? 0) - equipmentSpent,
          },
        };
      }

      const outcome = resolveContractOutcome(contract, rolled, deadThreshold, hasSurgeon);
      bag.push(...outcome.deadOrSacrificedForBag);
      homeDice.push(...outcome.homeDiceAfterBattle);
      activeDice = outcome.activeDiceForNextBattle;

      player.contracts.splice(queuedIdx, 1);
      if (outcome.success) {
        player.completedContracts.push(contract);
        player.crowns += contract.rewardCrowns;
        player.renown += contract.rewardRenown;
      } else {
        player.discardedContracts.push(contract);
      }

      resolvedContracts.push({
        contractId: contract.id,
        success: outcome.success,
        sentHome: sentHomeDice.length,
        dead: outcome.deadDice.length,
        wounded: outcome.woundedDice.length,
        sacrificed: outcome.sacrificedDice.size,
        equipmentSpent,
        rewardCrowns: outcome.success ? contract.rewardCrowns : 0,
        rewardRenown: outcome.success ? contract.rewardRenown : 0,
      });
    }

    player.dice = [...homeDice, ...activeDice];

    campaignResolutionByPlayer[playerId] = {
      selectedContractIds,
      campaignCostPaid,
      resolvedContracts,
    };
  }

  const winningPlayers = updatedPlayers
    .filter((player) => player.completedContracts.length >= 10)
    .map((player) => player.id);
  const gameEnded = winningPlayers.length > 0;

  const awardsWonByPlayer = claimAwardsAfterCampaign(game, updatedPlayers);

  const campaignCompletedState: StartGameResult = {
    ...game,
    gameEnded,
    winningPlayerIds: winningPlayers,
    players: updatedPlayers,
    equipment,
    bag,
    currentRoundCampaignContractsByPlayer: campaignContractsByPlayer,
    currentRoundCampaignResolutionByPlayer: campaignResolutionByPlayer,
    awardsWonByPlayer,
  };

  const afterCampaignState = gameEnded
    ? runPaymentPhase(campaignCompletedState, {
        allowWhenGameEnded: true,
        populateNextRoundContractPool: false,
      })
    : campaignCompletedState;

  const scoring = gameEnded
    ? computeFinalScores({
        ...afterCampaignState,
      })
    : {
        awardsWonByPlayer: afterCampaignState.awardsWonByPlayer,
        finalScores: game.finalScores,
      };

  return {
    ...afterCampaignState,
    awardsWonByPlayer: scoring.awardsWonByPlayer,
    finalScores: scoring.finalScores,
  };
}
