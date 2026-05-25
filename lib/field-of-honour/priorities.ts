import type { RoleCard } from "./types";

export const BASE_ROLE_SET: RoleCard[] = [
  "NEGOTIATOR",
  "SURGEON",
  "ARMOURER",
  "FORAGER",
  "PAYMASTER",
  "RECRUITER",
  "BATTLE_MASTER",
  "RETURN_ALL_ROLES",
];

export const ROLE_PRIORITY: Record<RoleCard, number> = {
  RETURN_ALL_ROLES: 1,
  NEGOTIATOR: 2,
  SURGEON: 3,
  ARMOURER: 4,
  FORAGER: 5,
  PAYMASTER: 6,
  RECRUITER: 7,
  BATTLE_MASTER: 8,
};

export function rolePriorityOrder(roles: RoleCard[]): RoleCard[] {
  return [...roles].sort((left, right) => ROLE_PRIORITY[left] - ROLE_PRIORITY[right]);
}
