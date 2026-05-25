export { loadContractsFromSheet1Csv, parseContractsCsv } from "./contracts";
export { buildTroopDiceBag } from "./bag";
export { createAwardsSet, DEFAULT_AWARDS, pickAwardsInPlay } from "./awards";
export { populateDepots } from "./depots";
export {
  createEquipmentResource,
  giveEquipmentToPlayer,
  returnEquipmentToArmoury,
} from "./equipment";
export { createDefaultPlayerKinds, startGame } from "./start-game";
export type { TroopDie } from "./bag";
export type { PopulatedDepotsResult } from "./depots";
export type { EquipmentResource } from "./equipment";
export type {
  PlayerKind,
  StartGameOptions,
  StartGamePlayer,
  StartGameResult,
} from "./start-game";
export { ROLE_PRIORITY, rolePriorityOrder } from "./priorities";
export {
  buildRoleSelectionHistory,
  toRoundMetricsPoint,
} from "./tracking";
export type {
  Award,
  Contract,
  ContractTier,
  ContractType,
  RoleCard,
  Region,
  TroopType,
  PlayerState,
  RoundResult,
} from "./types";