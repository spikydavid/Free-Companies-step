import { buildTroopDiceBag, type TroopDie } from "./bag";
import { createAwardsSet, pickAwardsInPlay } from "./awards";
import { populateDepots, type PopulatedDepotsResult } from "./depots";
import {
  createEquipmentResource,
  giveEquipmentToPlayer,
  type EquipmentResource,
} from "./equipment";
import { BASE_ROLE_SET } from "./priorities";
import type { Award, Contract, ContractPoolEntry, RoleCard } from "./types";

export type PlayerKind = "human" | "ai";

export interface StartGamePlayer {
  id: string;
  kind: PlayerKind;
  crowns: number;
  debt: number;
  renown: number;
  contracts: Contract[];
  completedContracts: Contract[];
  discardedContracts: Contract[];
  dice: TroopDie[];
  availableRoles: RoleCard[];
  usedRoles: RoleCard[];
  selectedRole: RoleCard | null;
}

export interface CampaignContractResolution {
  contractId: string;
  success: boolean;
  sentHome: number;
  dead: number;
  wounded: number;
  sacrificed: number;
  equipmentSpent: number;
  rewardCrowns: number;
  rewardRenown: number;
}

export interface CampaignResolutionByPlayer {
  selectedContractIds: string[];
  campaignCostPaid: number;
  resolvedContracts: CampaignContractResolution[];
}

export interface PaymentResolutionByPlayer {
  troopCount: number;
  disbanded: number;
  loansTaken: number;
  crownsBefore: number;
  debtBefore: number;
  cost: number;
  crownsAfter: number;
  debtAfter: number;
  skippedByPaymaster: boolean;
}

export interface FinalScore {
  playerId: string;
  totalRenown: number;
  renownFromContracts: number;
  renownFromSets: number;
  renownFromAwards: number;
  completedContracts: number;
  crowns: number;
}

export interface StartGameOptions {
  playerCount?: number;
  playerKinds?: PlayerKind[];
  contracts?: Contract[];
  random?: () => number;
}

export interface StartGameResult {
  roundNumber: number;
  gameEnded: boolean;
  winningPlayerIds: string[];
  players: StartGamePlayer[];
  seatingOrder: string[];
  startPlayerId: string;
  swordBearerId: string;
  currentRoundRolesSelectedByPlayer: Record<string, RoleCard>;
  currentRoundActionOrder: string[];
  currentRoundContractDraftPool: ContractPoolEntry[];
  currentRoundContractsDraftedByPlayer: Record<string, Contract[]>;
  currentRoundMusterDiceByPlayer: Record<string, TroopDie[]>;
  currentRoundMusterEquipmentByPlayer: Record<string, number>;
  currentRoundCampaignContractsByPlayer: Record<string, Contract[]>;
  currentRoundCampaignResolutionByPlayer: Record<string, CampaignResolutionByPlayer>;
  currentRoundPaymentResolutionByPlayer: Record<string, PaymentResolutionByPlayer>;
  nextRoundContractPool: Contract[];
  awards: Award[];
  awardsWonByPlayer: Record<string, Award[]>;
  finalScores: FinalScore[];
  contractDecks: {
    A: Contract[];
    B: Contract[];
    C: Contract[];
  };
  discardedContractsByTier: {
    A: Contract[];
    B: Contract[];
    C: Contract[];
  };
  bag: TroopDie[];
  depots: PopulatedDepotsResult["depots"];
  equipment: EquipmentResource;
}

export function createDefaultPlayerKinds(playerCount: number): PlayerKind[] {
  return Array.from({ length: playerCount }, () => "ai");
}

function shuffleContracts(contracts: Contract[], random: () => number): Contract[] {
  const deck = [...contracts];
  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const tmp = deck[i];
    deck[i] = deck[j] as Contract;
    deck[j] = tmp as Contract;
  }
  return deck;
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
  const contractDecks = {
    A: shuffleContracts(options.contracts.filter((contract) => contract.tier === "A"), random),
    B: shuffleContracts(options.contracts.filter((contract) => contract.tier === "B"), random),
    C: shuffleContracts(options.contracts.filter((contract) => contract.tier === "C"), random),
  };

  const drawTierContract = (tier: "A" | "B" | "C"): Contract => {
    const selected = contractDecks[tier].shift();
    if (!selected) {
      throw new Error(`Not enough Tier ${tier} contracts to assign one per player`);
    }
    return selected;
  };

  const drawTierAContract = (): Contract => {
    return drawTierContract("A");
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
      crowns: 0,
      debt: 0,
      renown: 0,
      contracts: [drawTierAContract()],
      completedContracts: [],
      discardedContracts: [],
      dice: [...dealtDice],
      availableRoles: [...BASE_ROLE_SET],
      usedRoles: [],
      selectedRole: null,
    };
  });
  const seatingOrder = players.map((player) => player.id);
  const startPlayerId = seatingOrder[0];
  const swordBearerId = startPlayerId;

  let equipment = createEquipmentResource(playerIds);
  for (const playerId of playerIds) {
    equipment = giveEquipmentToPlayer(equipment, playerId, 1);
  }
  const awards = pickAwardsInPlay(createAwardsSet(), 3, random);

  return {
    roundNumber: 1,
    gameEnded: false,
    winningPlayerIds: [],
    players,
    seatingOrder,
    startPlayerId,
    swordBearerId,
    currentRoundRolesSelectedByPlayer: {},
    currentRoundActionOrder: [],
    currentRoundContractDraftPool: [],
    currentRoundContractsDraftedByPlayer: {},
    currentRoundMusterDiceByPlayer: {},
    currentRoundMusterEquipmentByPlayer: {},
    currentRoundCampaignContractsByPlayer: {},
    currentRoundCampaignResolutionByPlayer: {},
    currentRoundPaymentResolutionByPlayer: {},
    nextRoundContractPool: [],
    awards,
    awardsWonByPlayer: Object.fromEntries(players.map((player) => [player.id, []])) as Record<
      string,
      Award[]
    >,
    finalScores: [],
    contractDecks,
    discardedContractsByTier: {
      A: [],
      B: [],
      C: [],
    },
    bag: populated.remainingBag,
    depots: [],
    equipment,
  };
}
