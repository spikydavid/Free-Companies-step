import { BASE_ROLE_SET, ROLE_PRIORITY } from "./priorities";
import type { RoleCard } from "./types";
import type { StartGameResult } from "./start-game";

export function resolveRoundRoleSelections(
  game: StartGameResult,
  humanSelectedRolesByPlayer: Record<string, RoleCard>,
  random: () => number = Math.random,
): Record<string, RoleCard> {
  const resolved: Record<string, RoleCard> = {};

  for (const player of game.players) {
    if (player.kind === "ai") {
      if (player.availableRoles.length === 0) {
        throw new Error(`${player.id} has no available roles`);
      }
      const idx = Math.floor(random() * player.availableRoles.length);
      const selected = player.availableRoles[idx];
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
