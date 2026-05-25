export { loadContractsFromSheet1Csv, parseContractsCsv } from "./contracts";
export { buildTroopDiceBag } from "./bag";
export { createAwardsSet, DEFAULT_AWARDS, pickAwardsInPlay } from "./awards";
export { populateDepots } from "./depots";
export { runDepotPhase } from "./depot-phase";
export {
  createEquipmentResource,
  giveEquipmentToPlayer,
  returnEquipmentToArmoury,
} from "./equipment";
export { runContractSelectionPhase } from "./contract-selection";
export { runMusterPhase } from "./muster";
export { runCampaignPhase } from "./campaign";
export { runPaymentPhase } from "./payment";
export { createDefaultPlayerKinds, startGame } from "./start-game";
export { beginRoundRoleSelection, resolveRoundRoleSelections } from "./round";
export type { TroopDie } from "./bag";
export type { PopulatedDepotsResult } from "./depots";
export type { DepotPhaseOptions } from "./depot-phase";
export type { EquipmentResource } from "./equipment";
export type { ContractSelectionOptions } from "./contract-selection";
export type { MusterPhaseOptions } from "./muster";
export type { CampaignPhaseOptions } from "./campaign";
export type {
  PlayerKind,
  StartGameOptions,
  StartGamePlayer,
  StartGameResult,
} from "./start-game";
export { BASE_ROLE_SET, ROLE_PRIORITY, rolePriorityOrder } from "./priorities";
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