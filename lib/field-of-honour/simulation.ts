import { loadContractsFromSheet1Csv } from "./contracts";
import {
  beginRoundRoleSelection,
  resolveRoundRoleSelections,
} from "./round";
import {
  createDefaultPlayerKinds,
  startGame,
  type StartGameResult,
} from "./start-game";
import { runCampaignPhase } from "./campaign";
import { runContractSelectionPhase } from "./contract-selection";
import { runDepotPhase } from "./depot-phase";
import { runMusterPhase } from "./muster";
import { runPaymentPhase } from "./payment";

const RANKS = ["1st", "2nd", "3rd", "4th"] as const;

type Rank = (typeof RANKS)[number];

interface AggregateRow {
  count: number;
  totalRenown: number;
  renownFromContracts: number;
  renownFromSets: number;
  renownFromAwards: number;
  renownFromTroops: number;
  completedContracts: number;
  crowns: number;
  equipment: number;
}

interface TurnAggregateRow {
  samples: number;
  troops: number;
  crowns: number;
  equipment: number;
  completedContracts: number;
}

interface TurnSnapshotPlayer {
  playerId: string;
  troops: number;
  crowns: number;
  equipment: number;
  completedContracts: number;
}

interface TurnSnapshot {
  turn: number;
  players: TurnSnapshotPlayer[];
}

interface GameSimulationResult {
  finalState: StartGameResult;
  turnSnapshots: TurnSnapshot[];
}

export interface FinishingPositionResult {
  rank: Rank;
  samples: number;
  avgTotalRenown: number;
  avgRenownFromContracts: number;
  avgRenownFromSets: number;
  avgRenownFromAwards: number;
  avgRenownFromTroops: number;
  avgCompletedContracts: number;
  avgCrowns: number;
  avgEquipment: number;
}

export interface PlayerTurnTrackerPoint {
  turn: number;
  samples: number;
  avgTroops: number;
  avgCrowns: number;
  avgEquipment: number;
  avgCompletedContracts: number;
}

export interface PlayerTurnTracker {
  playerId: string;
  turns: PlayerTurnTrackerPoint[];
}

export interface SimulationReport {
  successfulSimulations: number;
  totalAttempts: number;
  averageRounds: number | null;
  byFinishingPosition: FinishingPositionResult[];
  perPlayerTurnTracking: PlayerTurnTracker[];
  failureMessages: Record<string, number>;
}

export interface RunSimulationsOptions {
  sims?: number;
  maxAttempts?: number;
  guardLimit?: number;
  playerCount?: number;
}

function createAggregate(): Record<Rank, AggregateRow> {
  return {
    "1st": {
      count: 0,
      totalRenown: 0,
      renownFromContracts: 0,
      renownFromSets: 0,
      renownFromAwards: 0,
      renownFromTroops: 0,
      completedContracts: 0,
      crowns: 0,
      equipment: 0,
    },
    "2nd": {
      count: 0,
      totalRenown: 0,
      renownFromContracts: 0,
      renownFromSets: 0,
      renownFromAwards: 0,
      renownFromTroops: 0,
      completedContracts: 0,
      crowns: 0,
      equipment: 0,
    },
    "3rd": {
      count: 0,
      totalRenown: 0,
      renownFromContracts: 0,
      renownFromSets: 0,
      renownFromAwards: 0,
      renownFromTroops: 0,
      completedContracts: 0,
      crowns: 0,
      equipment: 0,
    },
    "4th": {
      count: 0,
      totalRenown: 0,
      renownFromContracts: 0,
      renownFromSets: 0,
      renownFromAwards: 0,
      renownFromTroops: 0,
      completedContracts: 0,
      crowns: 0,
      equipment: 0,
    },
  };
}

function captureTurnSnapshot(state: StartGameResult, turn: number): TurnSnapshot {
  return {
    turn,
    players: state.players.map((player) => ({
      playerId: player.id,
      troops: player.dice.length,
      crowns: player.crowns,
      equipment: state.equipment.byPlayer[player.id] ?? 0,
      completedContracts: player.completedContracts.length,
    })),
  };
}

function playGame(
  contracts = loadContractsFromSheet1Csv("data/contracts-sheet1.csv"),
  playerCount = 4,
  guardLimit = 1000,
): GameSimulationResult {
  let state = startGame({
    playerCount,
    playerKinds: createDefaultPlayerKinds(playerCount),
    contracts,
  });

  const turnSnapshots: TurnSnapshot[] = [];

  let guard = 0;
  while (!state.gameEnded && guard < guardLimit) {
    const previousRoundNumber = state.roundNumber;

    if (state.currentRoundActionOrder.length === 0) {
      if (state.depots.length < state.players.length) {
        state = runDepotPhase(state);
      } else {
        const roles = resolveRoundRoleSelections(state, {});
        state = beginRoundRoleSelection(state, roles);
      }
    } else if (Object.keys(state.currentRoundContractsDraftedByPlayer).length === 0) {
      state = runContractSelectionPhase(state);
    } else if (Object.keys(state.currentRoundMusterDiceByPlayer).length === 0) {
      state = runMusterPhase(state);
    } else if (Object.keys(state.currentRoundCampaignResolutionByPlayer).length === 0) {
      state = runCampaignPhase(state);
    } else {
      state = runPaymentPhase(state);
    }

    if (state.roundNumber > previousRoundNumber) {
      turnSnapshots.push(captureTurnSnapshot(state, previousRoundNumber));
    } else if (state.gameEnded) {
      turnSnapshots.push(captureTurnSnapshot(state, state.roundNumber));
    }

    guard += 1;
  }

  if (!state.gameEnded) {
    throw new Error(`Simulation exceeded guard limit in round ${state.roundNumber}`);
  }

  return {
    finalState: state,
    turnSnapshots,
  };
}

export function runFinishingPositionSimulations(
  options: RunSimulationsOptions = {},
): SimulationReport {
  const sims = Math.max(1, Math.floor(options.sims ?? 1000));
  const maxAttempts = Math.max(sims, Math.floor(options.maxAttempts ?? sims * 3));
  const guardLimit = Math.max(1, Math.floor(options.guardLimit ?? 1000));
  const playerCount = Math.max(2, Math.min(6, Math.floor(options.playerCount ?? 4)));

  if (playerCount !== 4) {
    throw new Error("Finishing-position simulation currently supports playerCount=4");
  }

  const contracts = loadContractsFromSheet1Csv("data/contracts-sheet1.csv");
  const aggregate = createAggregate();
  const turnAggregateByPlayer = new Map<string, Map<number, TurnAggregateRow>>();
  const failures = new Map<string, number>();

  let totalRounds = 0;
  let successful = 0;
  let attempts = 0;

  while (successful < sims && attempts < maxAttempts) {
    attempts += 1;
    try {
      const { finalState, turnSnapshots } = playGame(contracts, playerCount, guardLimit);
      successful += 1;
      totalRounds += finalState.roundNumber;

      finalState.finalScores.forEach((score, index) => {
        const rank = RANKS[index] as Rank;
        const row = aggregate[rank];
        row.count += 1;
        row.totalRenown += score.totalRenown;
        row.renownFromContracts += score.renownFromContracts;
        row.renownFromSets += score.renownFromSets;
        row.renownFromAwards += score.renownFromAwards;
        row.renownFromTroops += score.renownFromTroops;
        row.completedContracts += score.completedContracts;
        row.crowns += score.crowns;
        row.equipment += score.equipment;
      });

      for (const snapshot of turnSnapshots) {
        for (const player of snapshot.players) {
          let turnsByNumber = turnAggregateByPlayer.get(player.playerId);
          if (!turnsByNumber) {
            turnsByNumber = new Map<number, TurnAggregateRow>();
            turnAggregateByPlayer.set(player.playerId, turnsByNumber);
          }

          let row = turnsByNumber.get(snapshot.turn);
          if (!row) {
            row = {
              samples: 0,
              troops: 0,
              crowns: 0,
              equipment: 0,
              completedContracts: 0,
            };
            turnsByNumber.set(snapshot.turn, row);
          }

          row.samples += 1;
          row.troops += player.troops;
          row.crowns += player.crowns;
          row.equipment += player.equipment;
          row.completedContracts += player.completedContracts;
        }
      }
    } catch (error) {
      const key = error instanceof Error ? error.message : String(error);
      failures.set(key, (failures.get(key) ?? 0) + 1);
    }
  }

  const byFinishingPosition: FinishingPositionResult[] = RANKS.map((rank) => {
    const row = aggregate[rank];
    const divisor = Math.max(1, row.count);
    return {
      rank,
      samples: row.count,
      avgTotalRenown: row.totalRenown / divisor,
      avgRenownFromContracts: row.renownFromContracts / divisor,
      avgRenownFromSets: row.renownFromSets / divisor,
      avgRenownFromAwards: row.renownFromAwards / divisor,
      avgRenownFromTroops: row.renownFromTroops / divisor,
      avgCompletedContracts: row.completedContracts / divisor,
      avgCrowns: row.crowns / divisor,
      avgEquipment: row.equipment / divisor,
    };
  });

  const perPlayerTurnTracking: PlayerTurnTracker[] = Array.from(
    turnAggregateByPlayer.entries(),
  )
    .sort(([playerA], [playerB]) => playerA.localeCompare(playerB))
    .map(([playerId, turnsByNumber]) => {
      const turns: PlayerTurnTrackerPoint[] = Array.from(turnsByNumber.entries())
        .sort(([turnA], [turnB]) => turnA - turnB)
        .map(([turn, row]) => {
          const divisor = Math.max(1, row.samples);
          return {
            turn,
            samples: row.samples,
            avgTroops: row.troops / divisor,
            avgCrowns: row.crowns / divisor,
            avgEquipment: row.equipment / divisor,
            avgCompletedContracts: row.completedContracts / divisor,
          };
        });

      return {
        playerId,
        turns,
      };
    });

  return {
    successfulSimulations: successful,
    totalAttempts: attempts,
    averageRounds: successful > 0 ? totalRounds / successful : null,
    byFinishingPosition,
    perPlayerTurnTracking,
    failureMessages: Object.fromEntries(failures),
  };
}
