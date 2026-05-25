import type { PlayerState, RoleCard, RoundResult } from "./types";

export interface PlayerRoundMetrics {
  playerId: string;
  crowns: number;
  melee: number;
  ranged: number;
  mounted: number;
  equipment: number;
  contracts: number;
}

export interface RoundMetricsPoint {
  roundNumber: number;
  players: PlayerRoundMetrics[];
}

export type RoleSelectionCounts = Record<RoleCard, number>;

export interface RoleSelectionPoint {
  roundNumber: number;
  counts: RoleSelectionCounts;
}

export const ROLE_CARDS: RoleCard[] = [
  "NEGOTIATOR",
  "SURGEON",
  "ARMOURER",
  "FORAGER",
  "PAYMASTER",
  "RECRUITER",
  "BATTLE_MASTER",
  "RETURN_ALL_ROLES",
];

export function toRoundMetricsPoint(players: PlayerState[], roundNumber: number): RoundMetricsPoint {
  return {
    roundNumber,
    players: players.map((player) => ({
      playerId: player.id,
      crowns: player.crowns,
      melee: player.company.melee,
      ranged: player.company.ranged,
      mounted: player.company.mounted,
      equipment: player.equipment,
      contracts: player.completed.length,
    })),
  };
}

function createEmptyRoleSelectionCounts(): RoleSelectionCounts {
  return {
    NEGOTIATOR: 0,
    SURGEON: 0,
    ARMOURER: 0,
    FORAGER: 0,
    PAYMASTER: 0,
    RECRUITER: 0,
    BATTLE_MASTER: 0,
    RETURN_ALL_ROLES: 0,
  };
}

export function buildRoleSelectionHistory(roundHistory: RoundResult[]): RoleSelectionPoint[] {
  const running = createEmptyRoleSelectionCounts();
  const points: RoleSelectionPoint[] = [{ roundNumber: 0, counts: { ...running } }];

  for (const round of roundHistory) {
    for (const role of ROLE_CARDS) {
      const selectedCount = Object.values(round.rolesSelectedByPlayer).filter(
        (selectedRole) => selectedRole === role,
      ).length;
      running[role] += selectedCount;
    }

    points.push({
      roundNumber: round.roundNumber,
      counts: { ...running },
    });
  }

  return points;
}
