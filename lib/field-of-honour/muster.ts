import { giveEquipmentToPlayer } from "./equipment";
import type { TroopDie } from "./bag";
import type { StartGameResult } from "./start-game";
import type { Contract } from "./types";

export interface MusterPhaseOptions {
  random?: () => number;
  humanDepotChoicesByPlayer?: Record<string, number>;
  aiDepotChoiceStrategy?: "random" | "one-turn-rollout";
  aiDepotRolloutTrials?: number;
}

type TroopType = TroopDie["troopType"];

const TROOP_TYPES: TroopType[] = ["melee", "ranged", "mounted"];

function countDiceByType(dice: TroopDie[]): Record<TroopType, number> {
  return dice.reduce(
    (acc, die) => {
      acc[die.troopType] += 1;
      return acc;
    },
    {
      melee: 0,
      ranged: 0,
      mounted: 0,
    } as Record<TroopType, number>,
  );
}

function computeCampaignCost(contracts: Contract[], forager: boolean): number {
  if (forager || contracts.length <= 1) {
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

function drawRandomDiceFromPool(pool: TroopDie[], count: number, random: () => number): TroopDie[] {
  const working = [...pool];
  const drawn: TroopDie[] = [];
  for (let i = 0; i < count && working.length > 0; i += 1) {
    const idx = Math.floor(random() * working.length);
    const [die] = working.splice(idx, 1);
    if (die) {
      drawn.push(die);
    }
  }
  return drawn;
}

function simulateCampaignRolloutScore(
  player: StartGameResult["players"][number],
  selectedRole: StartGameResult["players"][number]["selectedRole"],
  candidateDepotDice: TroopDie[],
  workingBag: TroopDie[],
  random: () => number,
): number {
  const hasForager = selectedRole === "FORAGER";
  const hasBattleMaster = selectedRole === "BATTLE_MASTER";
  const hasPaymaster = selectedRole === "PAYMASTER";

  const recruiterDice =
    selectedRole === "RECRUITER" ? drawRandomDiceFromPool(workingBag, 4, random) : [];

  const musterDice = [...player.dice, ...candidateDepotDice, ...recruiterDice];
  const sortedContracts = sortContractsForCampaign(player.contracts, musterDice);
  const selectedContracts = chooseAffordableCampaignContracts(
    sortedContracts,
    player.crowns,
    hasForager,
  );

  const campaignCost = computeCampaignCost(selectedContracts, hasForager);
  let crowns = player.crowns - campaignCost;
  let renown = 0;
  let activeDice = [...musterDice];

  for (const contract of selectedContracts) {
    const battleDice = activeDice.map((die) => {
      const base = Math.floor(random() * die.sides) + 1;
      const roll = hasBattleMaster ? Math.min(6, base + 1) : base;
      return {
        troopType: die.troopType,
        sides: die.sides,
        roll,
      };
    });

    const successesByType: Record<TroopType, number> = {
      melee: 0,
      ranged: 0,
      mounted: 0,
    };
    let wildcards = 0;

    for (const die of battleDice) {
      if (die.roll === 6) {
        wildcards += 1;
      } else if (die.roll >= 4 && die.roll <= 5) {
        successesByType[die.troopType] += 1;
      }
    }

    while (wildcards > 0) {
      let targetType: TroopType | null = null;
      let targetDeficit = 0;

      for (const type of TROOP_TYPES) {
        const deficit = Math.max(0, contract.requirements[type] - successesByType[type]);
        if (deficit > targetDeficit) {
          targetType = type;
          targetDeficit = deficit;
        }
      }

      if (!targetType) {
        break;
      }

      successesByType[targetType] += 1;
      wildcards -= 1;
    }

    const success = TROOP_TYPES.every(
      (type) => successesByType[type] >= contract.requirements[type],
    );

    if (success) {
      crowns += contract.rewardCrowns;
      renown += contract.rewardRenown;
    }

    activeDice = battleDice
      .filter((die) => die.roll >= 4)
      .map((die) => ({ troopType: die.troopType, sides: die.sides }));
  }

  const payrollCost = hasPaymaster ? 0 : activeDice.length * 2;
  return renown * 120 + crowns * 4 - payrollCost;
}

function chooseAiDepotIndexByOneTurnRollout(
  player: StartGameResult["players"][number],
  selectedRole: StartGameResult["players"][number]["selectedRole"],
  openDepotIndices: number[],
  depots: StartGameResult["depots"],
  workingBag: TroopDie[],
  random: () => number,
  trials: number,
): number {
  const rolloutTrials = Math.max(1, Math.floor(trials));

  let bestDepotIndex = openDepotIndices[0] as number;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const depotIndex of openDepotIndices) {
    const depotDice = depots[depotIndex] ?? [];
    let totalScore = 0;

    for (let i = 0; i < rolloutTrials; i += 1) {
      totalScore += simulateCampaignRolloutScore(
        player,
        selectedRole,
        depotDice,
        workingBag,
        random,
      );
    }

    const avgScore = totalScore / rolloutTrials;
    if (avgScore > bestScore) {
      bestScore = avgScore;
      bestDepotIndex = depotIndex;
    }
  }

  return bestDepotIndex;
}

export function runMusterPhase(
  game: StartGameResult,
  options: MusterPhaseOptions = {},
): StartGameResult {
  if (game.currentRoundActionOrder.length !== game.players.length) {
    throw new Error("Role selection must complete before muster phase");
  }

  const hasContractDraftResults =
    Object.keys(game.currentRoundContractsDraftedByPlayer).length > 0;
  if (!hasContractDraftResults) {
    throw new Error("Contract selection must complete before muster phase");
  }

  const random = options.random ?? Math.random;
  const aiDepotChoiceStrategy = options.aiDepotChoiceStrategy ?? "random";
  const aiDepotRolloutTrials = Math.max(1, Math.floor(options.aiDepotRolloutTrials ?? 24));
  if (game.depots.length < game.players.length) {
    throw new Error("Depot phase must complete before muster phase");
  }

  let equipment = game.equipment;
  const workingBag = [...game.bag];
  const availableDepotIndices = new Set<number>(
    game.depots.map((_, index) => index),
  );

  const chosenDepotByPlayer: Record<string, TroopDie[]> = {};
  const gainedEquipmentByPlayer: Record<string, number> = {};

  const drawRandomDice = (count: number): TroopDie[] => {
    const drawn: TroopDie[] = [];
    for (let i = 0; i < count && workingBag.length > 0; i += 1) {
      const idx = Math.floor(random() * workingBag.length);
      const [die] = workingBag.splice(idx, 1);
      if (die) {
        drawn.push(die);
      }
    }
    return drawn;
  };

  const playersById = new Map(game.players.map((player) => [player.id, player]));

  for (const playerId of game.currentRoundActionOrder) {
    const player = playersById.get(playerId);
    if (!player) {
      throw new Error(`Unknown player in action order: ${playerId}`);
    }

    const requestedDepot = options.humanDepotChoicesByPlayer?.[playerId];
    let selectedDepotIndex = -1;

    if (
      player.kind === "human" &&
      requestedDepot !== undefined &&
      availableDepotIndices.has(requestedDepot)
    ) {
      selectedDepotIndex = requestedDepot;
    } else {
      const openDepotIndices = [...availableDepotIndices];
      if (openDepotIndices.length === 0) {
        throw new Error("No depots left to assign during muster");
      }

      if (player.kind === "ai" && aiDepotChoiceStrategy === "one-turn-rollout") {
        selectedDepotIndex = chooseAiDepotIndexByOneTurnRollout(
          player,
          game.currentRoundRolesSelectedByPlayer[playerId],
          openDepotIndices,
          game.depots,
          workingBag,
          random,
          aiDepotRolloutTrials,
        );
      } else {
        selectedDepotIndex =
          openDepotIndices[Math.floor(random() * openDepotIndices.length)] as number;
      }
    }

    const selectedDepot = game.depots[selectedDepotIndex];
    if (!selectedDepot) {
      throw new Error(`Invalid depot index ${selectedDepotIndex} for ${playerId}`);
    }

    availableDepotIndices.delete(selectedDepotIndex);

    const gainedDice: TroopDie[] = [...selectedDepot];
    let gainedEquipment = 1;
    equipment = giveEquipmentToPlayer(equipment, playerId, gainedEquipment);

    const selectedRole = game.currentRoundRolesSelectedByPlayer[playerId];
    if (selectedRole === "RECRUITER") {
      gainedDice.push(...drawRandomDice(4));
    }

    if (selectedRole === "ARMOURER" && equipment.armoury > 0) {
      const bonusEquipment = Math.min(3, equipment.armoury);
      if (bonusEquipment > 0) {
        equipment = giveEquipmentToPlayer(equipment, playerId, bonusEquipment);
        gainedEquipment += bonusEquipment;
      }
    }

    chosenDepotByPlayer[playerId] = gainedDice;
    gainedEquipmentByPlayer[playerId] = gainedEquipment;
  }

  const updatedPlayers = game.players.map((player) => ({
    ...player,
    dice: [...player.dice, ...(chosenDepotByPlayer[player.id] ?? [])],
  }));

  return {
    ...game,
    players: updatedPlayers,
    equipment,
    bag: workingBag,
    depots: [],
    currentRoundMusterDiceByPlayer: chosenDepotByPlayer,
    currentRoundMusterEquipmentByPlayer: gainedEquipmentByPlayer,
  };
}
