import { buildTroopDiceBag, type TroopDie } from "./bag";
import { createAwardsSet, pickAwardsInPlay } from "./awards";
import { populateDepots, type PopulatedDepotsResult } from "./depots";
import {
  createEquipmentResource,
  giveEquipmentToPlayer,
  type EquipmentResource,
} from "./equipment";
import type { Award, Contract } from "./types";

export type PlayerKind = "human" | "ai";

export interface StartGamePlayer {
  id: string;
  kind: PlayerKind;
  contracts: Contract[];
  dice: TroopDie[];
}

export interface StartGameOptions {
  playerCount?: number;
  playerKinds?: PlayerKind[];
  contracts?: Contract[];
  random?: () => number;
}

export interface StartGameResult {
  players: StartGamePlayer[];
  seatingOrder: string[];
  startPlayerId: string;
  awards: Award[];
  bag: TroopDie[];
  depots: PopulatedDepotsResult["depots"];
  equipment: EquipmentResource;
}

export function createDefaultPlayerKinds(playerCount: number): PlayerKind[] {
  return Array.from({ length: playerCount }, () => "ai");
}

export function startGame(options: StartGameOptions = {}): StartGameResult {
  const playerCount = options.playerCount ?? 4;
  if (!Number.isInteger(playerCount) || playerCount < 2) {
    throw new Error("playerCount must be an integer of at least 2");
  }

  const playerKinds = options.playerKinds ?? createDefaultPlayerKinds(playerCount);
  if (playerKinds.length !== playerCount) {
    throw new Error("playerKinds length must match playerCount");
  }

  if (!options.contracts || options.contracts.length === 0) {
    throw new Error("contracts are required to start game");
  }

  const random = options.random ?? Math.random;
  const availableContracts = [...options.contracts];

  const drawTierAContract = (): Contract => {
    const tierAIndices = availableContracts
      .map((contract, index) => ({ contract, index }))
      .filter((entry) => entry.contract.tier === "A")
      .map((entry) => entry.index);

    if (tierAIndices.length === 0) {
      throw new Error("Not enough Tier A contracts to assign one per player");
    }

    const selectedTierAIndex = tierAIndices[Math.floor(random() * tierAIndices.length)];
    const [selected] = availableContracts.splice(selectedTierAIndex, 1);
    if (!selected) {
      throw new Error("Failed to draw Tier A contract");
    }
    return selected;
  };

  const playerIds = playerKinds.map((_, index) => `Player ${index + 1}`);

  const bag = buildTroopDiceBag();
  const populated = populateDepots(playerCount, bag, options.random);
  if (populated.depots.length < playerCount) {
    throw new Error("Not enough dice to deal 4 to each player");
  }

  const players: StartGamePlayer[] = playerKinds.map((kind, index) => {
    const dealtDice = populated.depots[index];
    if (!dealtDice || dealtDice.length < 4) {
      throw new Error("Not enough dice to deal 4 to each player");
    }

    return {
      id: playerIds[index],
      kind,
      contracts: [drawTierAContract()],
      dice: [...dealtDice],
    };
  });
  const seatingOrder = players.map((player) => player.id);
  const startPlayerId = seatingOrder[0];

  let equipment = createEquipmentResource(playerIds);
  for (const playerId of playerIds) {
    equipment = giveEquipmentToPlayer(equipment, playerId, 1);
  }
  const awards = pickAwardsInPlay(createAwardsSet(), 3, random);

  return {
    players,
    seatingOrder,
    startPlayerId,
    awards,
    bag: populated.remainingBag,
    depots: populated.depots,
    equipment,
  };
}
