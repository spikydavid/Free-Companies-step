import { BASE_ROLE_SET, ROLE_PRIORITY } from "./priorities";
import type { RoleCard } from "./types";
import type { StartGameResult } from "./start-game";

type TroopType = "melee" | "ranged" | "mounted";

type AiRoleChoiceStrategy = "random" | "heuristic";

export interface ResolveRoundRoleSelectionOptions {
  random?: () => number;
  aiRoleChoiceStrategy?: AiRoleChoiceStrategy;
}

function countDiceByType(dice: StartGameResult["players"][number]["dice"]): Record<TroopType, number> {
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

function estimatePlayerContractDeficits(player: StartGameResult["players"][number]): {
  minDeficit: number;
  averageDeficit: number;
} {
  if (player.contracts.length === 0) {
    return {
      minDeficit: 0,
      averageDeficit: 0,
    };
  }

  const available = countDiceByType(player.dice);
  const deficits = player.contracts.map((contract) => {
    return (
      Math.max(0, contract.requirements.melee - available.melee) +
      Math.max(0, contract.requirements.ranged - available.ranged) +
      Math.max(0, contract.requirements.mounted - available.mounted)
    );
  });

  const totalDeficit = deficits.reduce((sum, deficit) => sum + deficit, 0);

  return {
    minDeficit: Math.min(...deficits),
    averageDeficit: totalDeficit / deficits.length,
  };
}

function scoreRoleHeuristic(
  game: StartGameResult,
  player: StartGameResult["players"][number],
  role: RoleCard,
): number {
  const playerEquipment = game.equipment.byPlayer[player.id] ?? 0;
  const crowns = player.crowns;
  const troopCount = player.dice.length;
  const contractCount = player.contracts.length;
  const payrollPressure = troopCount * 2 - crowns;
  const { minDeficit, averageDeficit } = estimatePlayerContractDeficits(player);

  switch (role) {
    case "FORAGER":
      return (
        (contractCount >= 2 ? 18 : 0) +
        (contractCount >= 3 ? 10 : 0) +
        (crowns <= 2 ? 20 : 0) +
        (payrollPressure > 0 ? 8 : 0)
      );

    case "PAYMASTER":
      return (
        (payrollPressure > 0 ? 30 : 0) +
        (troopCount >= 8 ? 12 : 0) +
        (player.debt > 0 ? 4 : 0)
      );

    case "RECRUITER":
      return (
        (troopCount <= 6 ? 24 : 0) +
        (minDeficit > 0 ? 14 : 0) +
        (averageDeficit > 1 ? 8 : 0)
      );

    case "ARMOURER":
      return (
        (game.equipment.armoury > 0 ? 10 : -12) +
        (playerEquipment <= 1 ? 16 : 0) +
        (averageDeficit <= 1 ? 6 : 0)
      );

    case "NEGOTIATOR":
      return (
        (contractCount <= 2 ? 16 : 0) +
        (averageDeficit >= 1.5 ? 10 : 0)
      );

    case "BATTLE_MASTER":
      return (
        (troopCount >= 7 ? 10 : 0) +
        (minDeficit <= 1 ? 8 : 0)
      );

    case "SURGEON":
      return (
        (troopCount >= 7 ? 8 : 0) +
        (contractCount >= 2 ? 6 : 0) +
        (playerEquipment === 0 ? 4 : 0)
      );

    case "RETURN_ALL_ROLES":
      return (
        (player.availableRoles.length <= 2 ? 14 : -20) +
        (player.usedRoles.length >= BASE_ROLE_SET.length - 2 ? 8 : 0)
      );

    default:
      return 0;
  }
}

function chooseAiRoleHeuristic(
  game: StartGameResult,
  player: StartGameResult["players"][number],
  random: () => number,
): RoleCard {
  const scored = player.availableRoles.map((role) => ({
    role,
    score: scoreRoleHeuristic(game, player, role),
    tieBreaker: random(),
  }));

  scored.sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }
    return right.tieBreaker - left.tieBreaker;
  });

  const selected = scored[0]?.role;
  if (!selected) {
    throw new Error(`Failed to resolve AI heuristic role selection for ${player.id}`);
  }

  return selected;
}

export function resolveRoundRoleSelections(
  game: StartGameResult,
  humanSelectedRolesByPlayer: Record<string, RoleCard>,
  randomOrOptions: (() => number) | ResolveRoundRoleSelectionOptions = {},
): Record<string, RoleCard> {
  const random =
    typeof randomOrOptions === "function"
      ? randomOrOptions
      : randomOrOptions.random ?? Math.random;

  const aiRoleChoiceStrategy: AiRoleChoiceStrategy =
    typeof randomOrOptions === "function"
      ? "heuristic"
      : randomOrOptions.aiRoleChoiceStrategy ?? "heuristic";

  const resolved: Record<string, RoleCard> = {};

  for (const player of game.players) {
    if (player.kind === "ai") {
      if (player.availableRoles.length === 0) {
        throw new Error(`${player.id} has no available roles`);
      }

      const selected =
        aiRoleChoiceStrategy === "random"
          ? player.availableRoles[Math.floor(random() * player.availableRoles.length)]
          : chooseAiRoleHeuristic(game, player, random);

      if (!selected) {
        throw new Error(`Failed to resolve AI role selection for ${player.id}`);
      }
      resolved[player.id] = selected;
      continue;
    }

    const selected = humanSelectedRolesByPlayer[player.id];
    if (!selected) {
      throw new Error(`Missing role selection for ${player.id}`);
    }
    resolved[player.id] = selected;
  }

  return resolved;
}

function seatingOrderFromSwordBearer(
  seatingOrder: string[],
  swordBearerId: string,
): string[] {
  const startIdx = seatingOrder.indexOf(swordBearerId);
  if (startIdx < 0) {
    throw new Error(`SwordBearer ${swordBearerId} is not seated`);
  }
  return [...seatingOrder.slice(startIdx), ...seatingOrder.slice(0, startIdx)];
}

export function beginRoundRoleSelection(
  game: StartGameResult,
  selectedRolesByPlayer: Record<string, RoleCard>,
): StartGameResult {
  if (game.depots.length < game.players.length) {
    throw new Error("Depot phase must complete before role selection");
  }

  const playersById = new Map(game.players.map((player) => [player.id, player]));

  for (const player of game.players) {
    const selectedRole = selectedRolesByPlayer[player.id];
    if (!selectedRole) {
      throw new Error(`Missing role selection for ${player.id}`);
    }
    if (!player.availableRoles.includes(selectedRole)) {
      throw new Error(`${player.id} cannot select unavailable role ${selectedRole}`);
    }
  }

  const updatedPlayers = game.players.map((player) => {
    const selectedRole = selectedRolesByPlayer[player.id];
    if (selectedRole === "RETURN_ALL_ROLES") {
      return {
        ...player,
        selectedRole,
        availableRoles: [...BASE_ROLE_SET],
        usedRoles: [],
      };
    }

    return {
      ...player,
      selectedRole,
      availableRoles: player.availableRoles.filter((role) => role !== selectedRole),
      usedRoles: [...player.usedRoles, selectedRole],
    };
  });

  const proximityOrder = seatingOrderFromSwordBearer(game.seatingOrder, game.swordBearerId);
  const proximityByPlayerId = new Map(
    proximityOrder.map((playerId, index) => [playerId, index]),
  );

  const actionOrder = [...updatedPlayers]
    .sort((left, right) => {
      const leftRole = selectedRolesByPlayer[left.id];
      const rightRole = selectedRolesByPlayer[right.id];
      const priorityDiff = ROLE_PRIORITY[leftRole] - ROLE_PRIORITY[rightRole];
      if (priorityDiff !== 0) {
        return priorityDiff;
      }

      const leftProximity = proximityByPlayerId.get(left.id);
      const rightProximity = proximityByPlayerId.get(right.id);
      if (leftProximity === undefined || rightProximity === undefined) {
        throw new Error("Failed to determine proximity to SwordBearer");
      }
      return leftProximity - rightProximity;
    })
    .map((player) => player.id);

  const players = game.players.map((player) => {
    const updated = playersById.get(player.id);
    const fromUpdated = updatedPlayers.find((item) => item.id === player.id);
    return fromUpdated ?? updated ?? player;
  });

  return {
    ...game,
    players,
    currentRoundRolesSelectedByPlayer: { ...selectedRolesByPlayer },
    currentRoundActionOrder: actionOrder,
  };
}
