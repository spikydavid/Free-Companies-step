import { populateDepots } from "./depots";
import { giveEquipmentToPlayer } from "./equipment";
import type { TroopDie } from "./bag";
import type { StartGameResult } from "./start-game";

export interface MusterPhaseOptions {
  random?: () => number;
  humanDepotChoicesByPlayer?: Record<string, number>;
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
  const populated = populateDepots(game.players.length, game.bag, random);
  if (populated.depots.length < game.players.length) {
    throw new Error("Not enough dice in bag to create one depot per player");
  }

  let equipment = game.equipment;
  const workingBag = [...populated.remainingBag];
  const availableDepotIndices = new Set<number>(
    populated.depots.map((_, index) => index),
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
      selectedDepotIndex =
        openDepotIndices[Math.floor(random() * openDepotIndices.length)] as number;
    }

    const selectedDepot = populated.depots[selectedDepotIndex];
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
    depots: populated.depots,
    currentRoundMusterDiceByPlayer: chosenDepotByPlayer,
    currentRoundMusterEquipmentByPlayer: gainedEquipmentByPlayer,
  };
}
