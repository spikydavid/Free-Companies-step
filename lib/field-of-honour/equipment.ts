export interface EquipmentResource {
  armouryCapacity: number;
  armoury: number;
  byPlayer: Record<string, number>;
}

function assertNonNegativeInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
}

export function createEquipmentResource(playerIds: string[]): EquipmentResource {
  if (playerIds.length === 0) {
    throw new Error("playerIds must contain at least one player");
  }

  const armouryCapacity = playerIds.length * 8;
  const byPlayer = Object.fromEntries(playerIds.map((id) => [id, 0]));

  return {
    armouryCapacity,
    armoury: armouryCapacity,
    byPlayer,
  };
}

export function giveEquipmentToPlayer(
  resource: EquipmentResource,
  playerId: string,
  amount = 1,
): EquipmentResource {
  assertNonNegativeInteger(amount, "amount");
  if (!(playerId in resource.byPlayer)) {
    throw new Error(`Unknown player ${playerId}`);
  }
  if (resource.armoury < amount) {
    throw new Error("Not enough equipment in armoury");
  }

  return {
    ...resource,
    armoury: resource.armoury - amount,
    byPlayer: {
      ...resource.byPlayer,
      [playerId]: resource.byPlayer[playerId] + amount,
    },
  };
}

export function returnEquipmentToArmoury(
  resource: EquipmentResource,
  playerId: string,
  amount = 1,
): EquipmentResource {
  assertNonNegativeInteger(amount, "amount");
  if (!(playerId in resource.byPlayer)) {
    throw new Error(`Unknown player ${playerId}`);
  }
  if (resource.byPlayer[playerId] < amount) {
    throw new Error(`${playerId} does not have enough equipment to return`);
  }

  const nextArmoury = resource.armoury + amount;
  if (nextArmoury > resource.armouryCapacity) {
    throw new Error("Armoury cannot exceed capacity");
  }

  return {
    ...resource,
    armoury: nextArmoury,
    byPlayer: {
      ...resource.byPlayer,
      [playerId]: resource.byPlayer[playerId] - amount,
    },
  };
}
