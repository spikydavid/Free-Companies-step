export type TroopType = "melee" | "ranged" | "mounted";

export type Region = "East" | "North" | "South" | "West" | "Any";

export type ContractTier = "A" | "B" | "C" | "R";

export type ContractType =
  | "DEVASTATE"
  | "ELIMINATE"
  | "GUARD"
  | "HUNT"
  | "PLUNDER"
  | "SUPPLY";

export type RoleCard =
  | "NEGOTIATOR"
  | "SURGEON"
  | "ARMOURER"
  | "FORAGER"
  | "PAYMASTER"
  | "RECRUITER"
  | "BATTLE_MASTER"
  | "RETURN_ALL_ROLES";

export type AwardType = ContractType;

export interface TroopCounts {
  melee: number;
  ranged: number;
  mounted: number;
}

export interface Contract {
  id: string;
  cardNumber: number;
  title: string;
  type: ContractType;
  region: Region;
  tier: ContractTier;
  rewardCrowns: number;
  rewardRenown: number;
  requirements: TroopCounts;
  copies: number;
  musterText?: string;
}

export interface Award {
  type: AwardType;
  renown: number;
  threshold: number;
}

export interface PlayerState {
  id: string;
  crowns: number;
  debt: number;
  renownFromAwards: number;
  equipment: number;
  company: TroopCounts;
  queue: Contract[];
  completed: Contract[];
  discarded: Contract[];
  availableRoles: RoleCard[];
  usedRoles: RoleCard[];
  selectedRole: RoleCard | null;
}

export interface GameConfig {
  playerIds: string[];
  contracts: Contract[];
  random?: () => number;
  startCrowns?: number;
  awards?: Award[];
  selectedAwardCount?: number;
  contractWinThreshold?: number;
}

export interface Depot {
  dice: TroopType[];
  equipment: number;
}

export interface ContractPoolEntry {
  contract: Contract;
  restrictedToPlayerId?: string;
}

export interface ContractDraftChoice {
  contractId: string;
}

export interface CampaignPlan {
  contractIds: string[];
  sendHomeByContract?: TroopCounts[];
  rerollsByContract?: number[];
}

export interface RoundChoices {
  roles: Record<string, RoleCard>;
  depotChoiceOrder: string[];
  depotIndexByPlayer: Record<string, number>;
  contractsAddedByPlayer: Record<string, [string, string]>;
  contractDraftChoices: Record<string, [ContractDraftChoice, ContractDraftChoice]>;
  campaignPlanByPlayer: Record<string, CampaignPlan>;
  payrollLoanCounts?: Record<string, number>;
  payrollDisband?: Record<string, TroopCounts>;
}

export interface CampaignContractResult {
  contractId: string;
  succeeded: boolean;
  rewardCrowns: number;
  rewardRenown: number;
}

export interface CampaignResult {
  playerId: string;
  contractResults: CampaignContractResult[];
  campaignCostPaid: number;
  equipmentSpent: number;
  equipmentEarned: number;
  losses: TroopCounts;
  wounded: TroopCounts;
  sacrifices: TroopCounts;
}

export interface RoundResult {
  roundNumber: number;
  campaignResults: CampaignResult[];
  awardedThisRound: Award[];
  startPlayerForNextRound: string;
  gameEnded: boolean;
}

export interface FinalScore {
  playerId: string;
  totalRenown: number;
  renownFromContracts: number;
  renownFromSets: number;
  renownFromAwards: number;
  debtPenalty: number;
  completedContracts: number;
  crowns: number;
}