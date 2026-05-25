import type {
  Award,
  CampaignContractResult,
  CampaignPlan,
  CampaignResult,
  Contract,
  ContractPoolEntry,
  ContractType,
  Depot,
  FinalScore,
  GameConfig,
  PlayerState,
  RoleCard,
  RoundChoices,
  RoundResult,
  ManualBattleState,
  ManualBattleConfirmResult,
  ManualCampaignState,
  TroopCounts,
  TroopType,
} from "./types";

const DEFAULT_AWARDS: Award[] = [
  { type: "DEVASTATE", renown: 3, threshold: 3 },
  { type: "ELIMINATE", renown: 3, threshold: 3 },
  { type: "GUARD", renown: 3, threshold: 3 },
  { type: "HUNT", renown: 3, threshold: 3 },
  { type: "PLUNDER", renown: 3, threshold: 3 },
  { type: "SUPPLY", renown: 3, threshold: 3 },
];

const BASE_ROLE_SET: RoleCard[] = [
  "NEGOTIATOR",
  "SURGEON",
  "ARMOURER",
  "FORAGER",
  "PAYMASTER",
  "RECRUITER",
  "BATTLE_MASTER",
  "RETURN_ALL_ROLES",
];

interface BattleRolls {
  melee: number[];
  ranged: number[];
  mounted: number[];
}

interface BattleClassification {
  successes: TroopCounts;
  wildcard: number;
  wounded: TroopCounts;
  dead: TroopCounts;
}

interface BattlePreview {
  dead: TroopCounts;
  wounded: TroopCounts;
  willSucceed: boolean;
}

interface FinalizedBattle {
  success: boolean;
  dead: TroopCounts;
  wounded: TroopCounts;
  sacrifices: TroopCounts;
}

interface RuntimePlayerState extends PlayerState {
  roundRoleEffects: {
    surgeon: boolean;
    forager: boolean;
    paymaster: boolean;
    battlemaster: boolean;
    negotiator: boolean;
  };
}

interface ManualBattleRuntime {
  playerId: string;
  contractId: string;
  rolls: BattleRolls;
  sacrifices: {
    melee: number[];
    ranged: number[];
    mounted: number[];
  };
  effects: RuntimePlayerState["roundRoleEffects"];
  equipmentSpent: number;
}

interface ManualCampaignRuntime {
  playerId: string;
  contractIds: string[];
  currentIndex: number;
  activeTroops: TroopCounts;
  campaignCostPaid: number;
  losses: TroopCounts;
  wounded: TroopCounts;
  sacrifices: TroopCounts;
  successfulContractIds: string[];
  failedContractIds: string[];
  completed: boolean;
}

export class FieldOfHonourEngine {
  private readonly random: () => number;

  private readonly contractsByTier: Record<"A" | "B" | "C", Contract[]>;

  private readonly selectedAwards: Award[];

  private readonly contractWinThreshold: number;

  private readonly players: RuntimePlayerState[];

  private bag: TroopType[];

  private readonly discardedContracts: Contract[] = [];

  private readonly availableContractsThisRound: ContractPoolEntry[] = [];

  private readonly awardOwners = new Map<ContractType, string>();

  private startPlayerIndex = 0;

  private roundNumber = 1;

  private manualBattle: ManualBattleRuntime | null = null;

  private manualCampaign: ManualCampaignRuntime | null = null;

  constructor(config: GameConfig) {
    if (config.playerIds.length < 2) {
      throw new Error("Field of Honour requires at least 2 players");
    }

    if (config.playerIds.length > 6) {
      throw new Error("Field of Honour supports up to 6 players");
    }

    this.random = config.random ?? Math.random;
    this.contractWinThreshold = config.contractWinThreshold ?? 10;

    this.contractsByTier = {
      A: this.shuffle(config.contracts.filter((c) => c.tier === "A")),
      B: this.shuffle(config.contracts.filter((c) => c.tier === "B")),
      C: this.shuffle(config.contracts.filter((c) => c.tier === "C")),
    };

    this.selectedAwards = this.pickRandomAwards(
      config.awards ?? DEFAULT_AWARDS,
      config.selectedAwardCount ?? 3,
    );

    this.bag = this.createInitialBag();

    this.players = config.playerIds.map((id) => ({
      id,
      crowns: config.startCrowns ?? 0,
      debt: 0,
      renownFromAwards: 0,
      equipment: 0,
      company: { melee: 0, ranged: 0, mounted: 0 },
      queue: [],
      completed: [],
      discarded: [],
      availableRoles: [...BASE_ROLE_SET],
      usedRoles: [],
      selectedRole: null,
      roundRoleEffects: {
        surgeon: false,
        forager: false,
        paymaster: false,
        battlemaster: false,
        negotiator: false,
      },
    }));

    this.setupInitialContracts();
    this.setupInitialDepots();
  }

  getState(): {
    roundNumber: number;
    startPlayerId: string;
    selectedAwards: Award[];
    players: PlayerState[];
  } {
    return {
      roundNumber: this.roundNumber,
      startPlayerId: this.turnOrder()[0].id,
      selectedAwards: this.selectedAwards,
      players: this.players.map((player) => ({ ...player })),
    };
  }

  playRound(choices: RoundChoices): RoundResult {
    this.resetRoundRoleEffects();
    this.selectRoles(choices.roles);
    this.musterAndEnlist(choices.depotChoiceOrder, choices.depotIndexByPlayer);
    this.addContractsAndDraft(choices);
    const campaignResults = this.runCampaigns(choices.campaignPlanByPlayer);
    const awardedThisRound = this.applyAwards();
    this.runPayday(choices.payrollLoanCounts ?? {}, choices.payrollDisband ?? {});

    this.startPlayerIndex = (this.startPlayerIndex + 1) % this.players.length;
    const gameEnded = this.players.some((player) => player.completed.length >= this.contractWinThreshold);
    const result: RoundResult = {
      roundNumber: this.roundNumber,
      campaignResults,
      awardedThisRound,
      startPlayerForNextRound: this.turnOrder()[0].id,
      gameEnded,
    };
    this.roundNumber += 1;

    return result;
  }

  playAutoRound(): RoundResult {
    const order = this.turnOrder().map((player) => player.id);
    const state = this.getState();

    const roles: Record<string, RoleCard> = {};
    for (const player of state.players) {
      roles[player.id] = this.pickAutoRole(player.availableRoles);
    }

    const depotIndexByPlayer: Record<string, number> = {};
    order.forEach((playerId, index) => {
      depotIndexByPlayer[playerId] = index;
    });

    const contractsAddedByPlayer: Record<string, [string, string]> = {};
    const addableIds = this.peekNextAddableContractIds(order.length * 2);
    for (const playerId of order) {
      const first = addableIds.shift();
      const second = addableIds.shift();
      if (!first || !second) {
        throw new Error("Unable to build auto add-contract choices");
      }
      contractsAddedByPlayer[playerId] = [first, second];
    }

    const availableForDraft = order.flatMap((playerId) => contractsAddedByPlayer[playerId]);
    const contractDraftChoices: Record<string, [{ contractId: string }, { contractId: string }]> =
      {};
    for (const playerId of order) {
      const first = availableForDraft.shift();
      const second = availableForDraft.shift();
      if (!first || !second) {
        throw new Error("Unable to build auto draft choices");
      }
      contractDraftChoices[playerId] = [{ contractId: first }, { contractId: second }];
    }

    const campaignPlanByPlayer: Record<string, CampaignPlan> = {};
    for (const player of this.turnOrder()) {
      const selected = this.pickAutoCampaignContracts(player);
      campaignPlanByPlayer[player.id] = { contractIds: selected.map((c) => c.id) };
    }

    const payrollLoanCounts: Record<string, number> = {};
    for (const playerId of order) {
      payrollLoanCounts[playerId] = 0;
    }

    return this.playRound({
      roles,
      depotChoiceOrder: order,
      depotIndexByPlayer,
      contractsAddedByPlayer,
      contractDraftChoices,
      campaignPlanByPlayer,
      payrollLoanCounts,
      payrollDisband: {},
    });
  }

  scoreGame(): FinalScore[] {
    const scores = this.players.map((player) => {
      const renownFromContracts = player.completed.reduce(
        (sum, contract) => sum + contract.rewardRenown,
        0,
      );
      const renownFromSets = this.computeSetRenown(player.completed);
      const debtPenalty = player.debt * 6;
      const totalRenown =
        renownFromContracts +
        renownFromSets +
        player.renownFromAwards -
        debtPenalty;

      return {
        playerId: player.id,
        totalRenown,
        renownFromContracts,
        renownFromSets,
        renownFromAwards: player.renownFromAwards,
        debtPenalty,
        completedContracts: player.completed.length,
        crowns: player.crowns,
      } satisfies FinalScore;
    });

    return scores.sort((a, b) => {
      if (b.totalRenown !== a.totalRenown) {
        return b.totalRenown - a.totalRenown;
      }
      if (b.completedContracts !== a.completedContracts) {
        return b.completedContracts - a.completedContracts;
      }
      return b.crowns - a.crowns;
    });
  }

  repayDebt(playerId: string, debtCards = 1): void {
    const player = this.requirePlayer(playerId);
    if (debtCards <= 0) {
      return;
    }
    const repayable = Math.min(debtCards, player.debt);
    const cost = repayable * 12;
    if (player.crowns < cost) {
      throw new Error(`${playerId} cannot repay ${repayable} debt cards`);
    }

    player.crowns -= cost;
    player.debt -= repayable;
  }

  startManualBattle(
    playerId: string,
    contractId: string,
    effects?: Partial<RuntimePlayerState["roundRoleEffects"]>,
  ): ManualBattleState {
    const player = this.requirePlayer(playerId);
    const contract = this.findQueuedContract(player, contractId);
    if (!contract) {
      throw new Error(`${playerId} cannot start battle for unknown queued contract ${contractId}`);
    }

    if (!this.hasAtLeast(player.company, contract.requirements)) {
      throw new Error(`${playerId} does not meet contract eligibility`);
    }

    this.initializeManualBattle(player.id, contract.id, player.company, effects);

    return this.getManualBattleState();
  }

  startManualCampaign(playerId: string, contractIds: string[]): ManualCampaignState {
    const player = this.requirePlayer(playerId);
    if (contractIds.length < 1 || contractIds.length > 3) {
      throw new Error("Manual campaign must include 1 to 3 contracts");
    }

    const selectedContracts = this.resolveQueuedContractsForSelection(player, contractIds);
    if (selectedContracts.length === 0) {
      throw new Error(`${playerId} has no valid queued contracts for manual campaign`);
    }

    const campaignCost = this.computeCampaignCost(selectedContracts, false);
    if (player.crowns < campaignCost) {
      throw new Error(`${playerId} cannot pay campaign cost ${campaignCost}`);
    }

    const cumulativeReq = this.sumRequirements(selectedContracts);
    if (!this.hasAtLeast(player.company, cumulativeReq)) {
      throw new Error(`${playerId} does not meet campaign eligibility requirements`);
    }

    player.crowns -= campaignCost;

    this.manualCampaign = {
      playerId,
      contractIds: selectedContracts.map((contract) => contract.id),
      currentIndex: 0,
      activeTroops: { ...player.company },
      campaignCostPaid: campaignCost,
      losses: { melee: 0, ranged: 0, mounted: 0 },
      wounded: { melee: 0, ranged: 0, mounted: 0 },
      sacrifices: { melee: 0, ranged: 0, mounted: 0 },
      successfulContractIds: [],
      failedContractIds: [],
      completed: false,
    };

    this.manualBattle = null;
    return this.getManualCampaignState();
  }

  getManualCampaignState(): ManualCampaignState {
    if (!this.manualCampaign) {
      throw new Error("No manual campaign is active");
    }

    return {
      playerId: this.manualCampaign.playerId,
      contractIds: [...this.manualCampaign.contractIds],
      currentIndex: this.manualCampaign.currentIndex,
      campaignCostPaid: this.manualCampaign.campaignCostPaid,
      activeTroops: { ...this.manualCampaign.activeTroops },
      losses: { ...this.manualCampaign.losses },
      wounded: { ...this.manualCampaign.wounded },
      sacrifices: { ...this.manualCampaign.sacrifices },
      successfulContractIds: [...this.manualCampaign.successfulContractIds],
      failedContractIds: [...this.manualCampaign.failedContractIds],
      completed: this.manualCampaign.completed,
    };
  }

  startManualCampaignBattle(
    effects?: Partial<RuntimePlayerState["roundRoleEffects"]>,
    sendHome?: TroopCounts,
  ): ManualBattleState {
    if (!this.manualCampaign || this.manualCampaign.completed) {
      throw new Error("No active manual campaign to start battle from");
    }

    const player = this.requirePlayer(this.manualCampaign.playerId);
    const contractId = this.manualCampaign.contractIds[this.manualCampaign.currentIndex];
    const contract = this.findQueuedContract(player, contractId);
    if (!contract) {
      throw new Error("Current campaign contract is no longer in player queue");
    }

    const toSendHome = sendHome ?? { melee: 0, ranged: 0, mounted: 0 };
    this.assertValidCounts(toSendHome, "manual campaign send-home counts");
    if (!this.hasAtLeast(this.manualCampaign.activeTroops, toSendHome)) {
      throw new Error("Cannot send home more troops than currently campaigning");
    }

    this.manualCampaign.activeTroops = this.subtractCounts(this.manualCampaign.activeTroops, toSendHome);

    return this.startManualBattleWithTroops(
      player.id,
      contract.id,
      this.manualCampaign.activeTroops,
      effects,
    );
  }

  getManualBattleState(): ManualBattleState {
    if (!this.manualBattle) {
      throw new Error("No manual battle is active");
    }

    const player = this.requirePlayer(this.manualBattle.playerId);
    const contract = this.findQueuedContract(player, this.manualBattle.contractId);
    if (!contract) {
      throw new Error("Manual battle contract is no longer in player queue");
    }

    const preview = this.previewBattleOutcomeWithSacrifices(
      contract,
      this.manualBattle.rolls,
      this.manualBattle.sacrifices,
      this.manualBattle.effects,
    );

    return {
      playerId: player.id,
      contractId: contract.id,
      contractTitle: contract.title,
      requirements: { ...contract.requirements },
      rolls: {
        melee: [...this.manualBattle.rolls.melee],
        ranged: [...this.manualBattle.rolls.ranged],
        mounted: [...this.manualBattle.rolls.mounted],
      },
      sacrifices: {
        melee: [...this.manualBattle.sacrifices.melee],
        ranged: [...this.manualBattle.sacrifices.ranged],
        mounted: [...this.manualBattle.sacrifices.mounted],
      },
      equipmentSpent: this.manualBattle.equipmentSpent,
      equipmentRemaining: player.equipment,
      preview,
    };
  }

  rerollManualBattleDie(type: TroopType, index: number): ManualBattleState {
    if (!this.manualBattle) {
      throw new Error("No manual battle is active");
    }

    const player = this.requirePlayer(this.manualBattle.playerId);
    if (player.equipment <= 0) {
      throw new Error(`${player.id} has no equipment left`);
    }

    const typedRolls = this.manualBattle.rolls[type];
    if (index < 0 || index >= typedRolls.length) {
      throw new Error("Invalid die index");
    }

    let value = this.rollDie();
    if (this.manualBattle.effects.battlemaster) {
      value = Math.min(6, value + 1);
    }

    typedRolls[index] = value;
    player.equipment -= 1;
    this.manualBattle.equipmentSpent += 1;
    this.manualBattle.sacrifices[type] = this.manualBattle.sacrifices[type].filter((n) => n !== index);

    return this.getManualBattleState();
  }

  toggleManualBattleSacrifice(type: TroopType, index: number): ManualBattleState {
    if (!this.manualBattle) {
      throw new Error("No manual battle is active");
    }

    const typedRolls = this.manualBattle.rolls[type];
    if (index < 0 || index >= typedRolls.length) {
      throw new Error("Invalid die index");
    }

    const roll = typedRolls[index];
    if (!this.isSacrificeEligibleRoll(roll, this.manualBattle.effects)) {
      throw new Error("Die is not eligible for sacrifice");
    }

    const list = this.manualBattle.sacrifices[type];
    const pos = list.indexOf(index);
    if (pos >= 0) {
      list.splice(pos, 1);
    } else {
      list.push(index);
      list.sort((a, b) => a - b);
    }

    return this.getManualBattleState();
  }

  confirmManualBattle(): ManualBattleConfirmResult {
    if (!this.manualBattle) {
      throw new Error("No manual battle is active");
    }

    const battle = this.manualBattle;
    const player = this.requirePlayer(battle.playerId);
    const contractIdx = this.findQueuedContractIndex(player, battle.contractId);
    if (contractIdx < 0) {
      throw new Error("Manual battle contract is no longer in player queue");
    }
    const contract = player.queue[contractIdx];

    const finalized = this.finalizeBattleWithSacrifices(
      contract,
      battle.rolls,
      battle.sacrifices,
      battle.effects,
    );

    this.removeFromCompany(player, finalized.dead);
    this.removeFromCompany(player, finalized.sacrifices);
    this.returnToBag(finalized.dead);
    this.returnToBag(finalized.sacrifices);

    player.queue.splice(contractIdx, 1);

    let rewardCrowns = 0;
    let rewardRenown = 0;
    if (finalized.success) {
      rewardCrowns = contract.rewardCrowns;
      rewardRenown = contract.rewardRenown;
      player.crowns += rewardCrowns;
      player.completed.push(contract);
    } else {
      player.discarded.push(contract);
      this.discardedContracts.push(contract);
    }

    let campaignInfo: ManualBattleConfirmResult["campaign"] | undefined;

    if (this.manualCampaign && this.manualCampaign.playerId === player.id) {
      this.addCounts(this.manualCampaign.losses, finalized.dead);
      this.addCounts(this.manualCampaign.wounded, finalized.wounded);
      this.addCounts(this.manualCampaign.sacrifices, finalized.sacrifices);

      this.manualCampaign.activeTroops = this.subtractCounts(
        this.subtractCounts(this.manualCampaign.activeTroops, finalized.dead),
        this.addTwoCounts(finalized.wounded, finalized.sacrifices),
      );

      if (finalized.success) {
        this.manualCampaign.successfulContractIds.push(contract.id);
      } else {
        this.manualCampaign.failedContractIds.push(contract.id);
      }

      this.manualCampaign.currentIndex += 1;
      const completed = this.manualCampaign.currentIndex >= this.manualCampaign.contractIds.length;

      if (completed) {
        this.manualCampaign.completed = true;
        const equipmentEarnedAtEnd = this.totalTroops(this.manualCampaign.activeTroops);
        player.equipment += equipmentEarnedAtEnd;
        campaignInfo = {
          active: false,
          completed: true,
          currentIndex: this.manualCampaign.currentIndex,
          totalContracts: this.manualCampaign.contractIds.length,
          equipmentEarnedAtEnd,
        };
        this.manualCampaign = null;
      } else {
        const nextContractId = this.manualCampaign.contractIds[this.manualCampaign.currentIndex];
        campaignInfo = {
          active: true,
          completed: false,
          currentIndex: this.manualCampaign.currentIndex,
          totalContracts: this.manualCampaign.contractIds.length,
          nextContractId,
        };
      }
    }

    this.manualBattle = null;

    return {
      success: finalized.success,
      contractId: contract.id,
      playerId: player.id,
      rewardCrowns,
      rewardRenown,
      dead: finalized.dead,
      wounded: finalized.wounded,
      sacrifices: finalized.sacrifices,
      campaign: campaignInfo,
    };
  }

  private startManualBattleWithTroops(
    playerId: string,
    contractId: string,
    troopsForBattle: TroopCounts,
    effects?: Partial<RuntimePlayerState["roundRoleEffects"]>,
  ): ManualBattleState {
    const player = this.requirePlayer(playerId);
    const contract = this.findQueuedContract(player, contractId);
    if (!contract) {
      throw new Error(`${playerId} cannot start battle for unknown queued contract ${contractId}`);
    }

    if (!this.hasAtLeast(troopsForBattle, contract.requirements)) {
      throw new Error(`${playerId} does not meet contract eligibility with available campaign troops`);
    }

    this.initializeManualBattle(player.id, contract.id, troopsForBattle, effects);

    return this.getManualBattleState();
  }

  private createManualBattleEffects(
    effects?: Partial<RuntimePlayerState["roundRoleEffects"]>,
  ): RuntimePlayerState["roundRoleEffects"] {
    return {
      surgeon: effects?.surgeon ?? false,
      forager: false,
      paymaster: false,
      battlemaster: effects?.battlemaster ?? false,
      negotiator: false,
    };
  }

  private initializeManualBattle(
    playerId: string,
    contractId: string,
    troopsForBattle: TroopCounts,
    effects?: Partial<RuntimePlayerState["roundRoleEffects"]>,
  ): void {
    const mergedEffects = this.createManualBattleEffects(effects);
    this.manualBattle = {
      playerId,
      contractId,
      rolls: this.rollBattle(troopsForBattle, mergedEffects),
      sacrifices: { melee: [], ranged: [], mounted: [] },
      effects: mergedEffects,
      equipmentSpent: 0,
    };
  }

  private setupInitialContracts(): void {
    for (const player of this.players) {
      const card = this.drawContractFromTier("A");
      player.queue.push(card);
    }
  }

  private pickAutoRole(availableRoles: RoleCard[]): RoleCard {
    const priority: RoleCard[] = [
      "FORAGER",
      "PAYMASTER",
      "SURGEON",
      "BATTLE_MASTER",
      "ARMOURER",
      "RECRUITER",
      "NEGOTIATOR",
      "RETURN_ALL_ROLES",
    ];

    for (const role of priority) {
      if (availableRoles.includes(role)) {
        return role;
      }
    }

    return "RETURN_ALL_ROLES";
  }

  private peekNextAddableContractIds(count: number): string[] {
    const ids: string[] = [];
    const pointers = { A: 0, B: 0, C: 0 };
    const tiers: Array<"A" | "B" | "C"> = ["A", "B", "C"];

    while (ids.length < count) {
      let progressed = false;
      for (const tier of tiers) {
        const deck = this.contractsByTier[tier];
        const pointer = pointers[tier];
        if (pointer < deck.length) {
          ids.push(deck[pointer].id);
          pointers[tier] += 1;
          progressed = true;
          if (ids.length >= count) {
            break;
          }
        }
      }

      if (!progressed) {
        break;
      }
    }

    if (ids.length < count) {
      throw new Error("Not enough contracts left in decks to fill auto add-contract choices");
    }

    return ids;
  }

  private pickAutoCampaignContracts(player: RuntimePlayerState): Contract[] {
    const candidates = player.queue;
    if (candidates.length === 0) {
      throw new Error(`Player ${player.id} has no queued contracts to campaign`);
    }

    const forager = player.roundRoleEffects.forager;
    let best: Contract[] = [];
    let bestValue = Number.NEGATIVE_INFINITY;

    const evaluate = (bundle: Contract[]) => {
      if (bundle.length === 0 || bundle.length > 3) {
        return;
      }
      const req = this.sumRequirements(bundle);
      if (!this.hasAtLeast(player.company, req)) {
        return;
      }

      const cost = this.computeCampaignCost(bundle, forager);
      if (cost > player.crowns) {
        return;
      }

      const value = bundle.reduce((sum, contract) => {
        return sum + contract.rewardCrowns + contract.rewardRenown * 3;
      }, 0);

      if (
        value > bestValue ||
        (value === bestValue && bundle.length > best.length)
      ) {
        best = bundle;
        bestValue = value;
      }
    };

    const n = candidates.length;
    for (let i = 0; i < n; i += 1) {
      evaluate([candidates[i]]);
      for (let j = i + 1; j < n; j += 1) {
        evaluate([candidates[i], candidates[j]]);
        for (let k = j + 1; k < n; k += 1) {
          evaluate([candidates[i], candidates[j], candidates[k]]);
        }
      }
    }

    if (best.length > 0) {
      return best;
    }

    return [candidates[0]];
  }

  private setupInitialDepots(): void {
    const depots = this.createDepots(this.players.length);
    const reverseOrder = [...this.turnOrder()].reverse();

    reverseOrder.forEach((player, index) => {
      const depot = depots[index];
      this.addDepotToCompany(player, depot);
    });
  }

  private selectRoles(roles: Record<string, RoleCard>): void {
    for (const player of this.turnOrder()) {
      const chosen = roles[player.id];
      if (!chosen) {
        throw new Error(`Missing role choice for ${player.id}`);
      }

      if (!player.availableRoles.includes(chosen)) {
        throw new Error(`${player.id} cannot choose unavailable role ${chosen}`);
      }

      player.selectedRole = chosen;

      if (chosen === "RETURN_ALL_ROLES") {
        player.availableRoles = [...BASE_ROLE_SET];
        player.usedRoles = [];
      } else {
        player.availableRoles = player.availableRoles.filter((role) => role !== chosen);
        player.usedRoles.push(chosen);
      }

      this.applyImmediateRoleEffect(player, chosen);
    }
  }

  private applyImmediateRoleEffect(player: RuntimePlayerState, role: RoleCard): void {
    switch (role) {
      case "ARMOURER":
        player.equipment += 3;
        break;
      case "SURGEON":
        player.roundRoleEffects.surgeon = true;
        break;
      case "FORAGER":
        player.roundRoleEffects.forager = true;
        break;
      case "PAYMASTER":
        player.roundRoleEffects.paymaster = true;
        break;
      case "BATTLE_MASTER":
        player.roundRoleEffects.battlemaster = true;
        break;
      case "NEGOTIATOR":
        player.roundRoleEffects.negotiator = true;
        break;
      case "RECRUITER":
      case "RETURN_ALL_ROLES":
        break;
      default:
        break;
    }
  }

  private musterAndEnlist(
    depotChoiceOrder: string[],
    depotIndexByPlayer: Record<string, number>,
  ): void {
    const depots = this.createDepots(this.players.length);
    const chosen = new Set<number>();

    for (const playerId of depotChoiceOrder) {
      const player = this.requirePlayer(playerId);
      const depotIndex = depotIndexByPlayer[player.id];
      if (depotIndex === undefined) {
        throw new Error(`Missing depot choice for ${player.id}`);
      }
      if (chosen.has(depotIndex)) {
        throw new Error(`Depot ${depotIndex} already chosen`);
      }
      const depot = depots[depotIndex];
      if (!depot) {
        throw new Error(`Invalid depot index ${depotIndex} for ${player.id}`);
      }

      this.addDepotToCompany(player, depot);
      chosen.add(depotIndex);

      if (player.selectedRole === "RECRUITER") {
        const bonus = this.drawDiceFromBag(3);
        this.applyDiceToCompany(player, bonus);
      }
    }
  }

  private addContractsAndDraft(choices: RoundChoices): void {
    this.availableContractsThisRound.length = 0;
    const negotiatorPlayers: RuntimePlayerState[] = [];

    for (const player of this.turnOrder()) {
      const addChoices = choices.contractsAddedByPlayer[player.id];
      if (!addChoices) {
        throw new Error(`Missing contracts-to-pool choice for ${player.id}`);
      }

      for (const contractId of addChoices) {
        const contract = this.drawContractById(contractId);
        this.availableContractsThisRound.push({ contract });
      }

      if (player.selectedRole === "NEGOTIATOR") {
        negotiatorPlayers.push(player);
      }
    }

    for (const player of negotiatorPlayers) {
      const restrictedA = this.drawContractFromTier("A");
      const restrictedB = this.drawContractFromTier("B");
      this.availableContractsThisRound.push({
        contract: restrictedA,
        restrictedToPlayerId: player.id,
      });
      this.availableContractsThisRound.push({
        contract: restrictedB,
        restrictedToPlayerId: player.id,
      });
    }

    for (const pickNumber of [0, 1] as const) {
      for (const player of this.turnOrder()) {
        const draftChoice = choices.contractDraftChoices[player.id]?.[pickNumber];
        if (!draftChoice) {
          throw new Error(`Missing contract draft choice #${pickNumber + 1} for ${player.id}`);
        }

        const idx = this.availableContractsThisRound.findIndex(
          (entry) =>
            this.contractIdMatches(entry.contract.id, draftChoice.contractId) &&
            (!entry.restrictedToPlayerId || entry.restrictedToPlayerId === player.id),
        );

        if (idx < 0) {
          throw new Error(
            `${player.id} tried to draft unavailable contract ${draftChoice.contractId}`,
          );
        }

        const [selected] = this.availableContractsThisRound.splice(idx, 1);
        player.queue.push(selected.contract);
      }
    }

    for (const player of this.players) {
      while (player.queue.length > 3) {
        const discarded = player.queue.shift();
        if (discarded) {
          player.discarded.push(discarded);
          this.discardedContracts.push(discarded);
        }
      }
    }
  }

  private runCampaigns(campaignPlanByPlayer: Record<string, CampaignPlan>): CampaignResult[] {
    const results: CampaignResult[] = [];

    for (const player of this.turnOrder()) {
      const plan = campaignPlanByPlayer[player.id];
      if (!plan) {
        throw new Error(`Missing campaign plan for ${player.id}`);
      }

      results.push(this.resolveCampaign(player, plan));
    }

    return results;
  }

  private resolveCampaign(player: RuntimePlayerState, plan: CampaignPlan): CampaignResult {
    if (plan.contractIds.length < 1 || plan.contractIds.length > 3) {
      throw new Error(`${player.id} must campaign 1 to 3 contracts`);
    }

    const selectedContracts = this.resolveQueuedContractsForSelection(player, plan.contractIds);
    const activeContracts: Contract[] = [];

    for (const contract of selectedContracts) {
      const idx = this.findQueuedContractIndex(player, contract.id);
      if (idx >= 0) {
        activeContracts.push(player.queue[idx]);
        player.queue.splice(idx, 1);
      }
    }

    if (activeContracts.length === 0) {
      const fallback = player.queue.shift();
      if (!fallback) {
        throw new Error(`${player.id} has no queued contracts to campaign`);
      }
      activeContracts.push(fallback);
    }

    const campaignCost = this.computeCampaignCost(activeContracts, player.roundRoleEffects.forager);
    if (player.crowns < campaignCost) {
      throw new Error(`${player.id} cannot pay campaign cost ${campaignCost}`);
    }
    player.crowns -= campaignCost;

    const cumulativeRequirement = this.sumRequirements(activeContracts);
    if (!this.hasAtLeast(player.company, cumulativeRequirement)) {
      throw new Error(`${player.id} does not meet campaign eligibility requirements`);
    }

    const result: CampaignResult = {
      playerId: player.id,
      contractResults: [],
      campaignCostPaid: campaignCost,
      equipmentSpent: 0,
      equipmentEarned: 0,
      losses: { melee: 0, ranged: 0, mounted: 0 },
      wounded: { melee: 0, ranged: 0, mounted: 0 },
      sacrifices: { melee: 0, ranged: 0, mounted: 0 },
    };

    let activeTroops: TroopCounts = { ...player.company };

    activeContracts.forEach((contract, idx) => {
      const sendHome = plan.sendHomeByContract?.[idx] ?? { melee: 0, ranged: 0, mounted: 0 };
      this.assertValidCounts(sendHome, `${player.id} send-home counts`);
      if (!this.hasAtLeast(activeTroops, sendHome)) {
        throw new Error(`${player.id} cannot send home more troops than currently campaigning`);
      }

      activeTroops = this.subtractCounts(activeTroops, sendHome);

      const rolls = this.rollBattle(activeTroops, player.roundRoleEffects);

      let rerollsSpent = 0;
      const forcedRerolls = Math.max(0, plan.rerollsByContract?.[idx] ?? 0);
      if (forcedRerolls > 0) {
        if (player.equipment < forcedRerolls) {
          throw new Error(`${player.id} does not have enough equipment for rerolls`);
        }
        rerollsSpent += this.applyFixedRerolls(
          rolls,
          forcedRerolls,
          player.roundRoleEffects,
        );
      }

      // FoH_v2 AI-style reroll logic: spend equipment while projected to fail,
      // rerolling lowest-value faces first (1, then 2, then 3).
      rerollsSpent += this.applyAutoRerollsUntilStable(
        rolls,
        player,
        contract,
      );
      player.equipment -= rerollsSpent;
      result.equipmentSpent += rerollsSpent;

      const battleResult = this.finalizeBattle(
        contract,
        rolls,
        activeTroops,
        player.roundRoleEffects,
      );
      const contractSucceeded = battleResult.success;

      this.addCounts(result.losses, battleResult.dead);
      this.addCounts(result.wounded, battleResult.wounded);
      this.addCounts(result.sacrifices, battleResult.sacrifices);

      this.removeFromCompany(player, battleResult.dead);
      this.removeFromCompany(player, battleResult.sacrifices);
      this.returnToBag(battleResult.dead);
      this.returnToBag(battleResult.sacrifices);

      const contractResult: CampaignContractResult = {
        contractId: contract.id,
        succeeded: contractSucceeded,
        rewardCrowns: 0,
        rewardRenown: 0,
      };

      if (contractSucceeded) {
        player.crowns += contract.rewardCrowns;
        contractResult.rewardCrowns = contract.rewardCrowns;
        contractResult.rewardRenown = contract.rewardRenown;
        player.completed.push(contract);
      } else {
        player.discarded.push(contract);
        this.discardedContracts.push(contract);
      }

      result.contractResults.push(contractResult);

      const remainingAfterBattle = this.subtractCounts(
        this.subtractCounts(activeTroops, battleResult.dead),
        this.addTwoCounts(battleResult.wounded, battleResult.sacrifices),
      );

      activeTroops = remainingAfterBattle;
    });

    const survivors = activeTroops.melee + activeTroops.ranged + activeTroops.mounted;
    player.equipment += survivors;
    result.equipmentEarned += survivors;

    return result;
  }

  private runPayday(
    payrollLoanCounts: Record<string, number>,
    payrollDisband: Record<string, TroopCounts>,
  ): void {
    for (const player of this.turnOrder()) {
      if (player.roundRoleEffects.paymaster) {
        continue;
      }

      const payroll = this.totalTroops(player.company) * 2;
      const requestedLoans = Math.max(0, payrollLoanCounts[player.id] ?? 0);
      for (let i = 0; i < requestedLoans; i += 1) {
        this.takeLoan(player);
      }

      if (player.crowns < payroll) {
        const disband = payrollDisband[player.id] ?? { melee: 0, ranged: 0, mounted: 0 };
        this.assertValidCounts(disband, `${player.id} payday disband`);
        if (!this.hasAtLeast(player.company, disband)) {
          throw new Error(`${player.id} cannot disband more troops than in company`);
        }

        this.removeFromCompany(player, disband);
        this.returnToBag(disband);
      }

      const adjustedPayroll = this.totalTroops(player.company) * 2;
      while (player.crowns < adjustedPayroll) {
        this.takeLoan(player);
      }

      player.crowns -= adjustedPayroll;
    }
  }

  private applyAwards(): Award[] {
    const awarded: Award[] = [];

    for (const award of this.selectedAwards) {
      if (this.awardOwners.has(award.type)) {
        continue;
      }

      const owner = this.turnOrder().find((player) =>
        player.completed.filter((contract) => contract.type === award.type).length >= award.threshold,
      );

      if (!owner) {
        continue;
      }

      owner.renownFromAwards += award.renown;
      this.awardOwners.set(award.type, owner.id);
      awarded.push(award);
    }

    return awarded;
  }

  private rollBattle(
    troops: TroopCounts,
    effects: RuntimePlayerState["roundRoleEffects"],
  ): BattleRolls {
    const rolls: BattleRolls = { melee: [], ranged: [], mounted: [] };

    for (const type of this.troopTypes()) {
      const count = troops[type];
      for (let i = 0; i < count; i += 1) {
        let roll = this.rollDie();
        if (effects.battlemaster) {
          roll = Math.min(6, roll + 1);
        }
        rolls[type].push(roll);
      }
    }

    return rolls;
  }

  private classifyRolls(
    rolls: BattleRolls,
    effects: RuntimePlayerState["roundRoleEffects"],
  ): BattleClassification {
    const successes: TroopCounts = { melee: 0, ranged: 0, mounted: 0 };
    const wounded: TroopCounts = { melee: 0, ranged: 0, mounted: 0 };
    const dead: TroopCounts = { melee: 0, ranged: 0, mounted: 0 };
    let wildcard = 0;

    const deadThreshold = effects.surgeon ? 1 : 2;
    const woundedFace = effects.surgeon ? 2 : 3;

    for (const type of this.troopTypes()) {
      for (const roll of rolls[type]) {
        if (roll <= deadThreshold) {
          dead[type] += 1;
        } else if (roll === woundedFace) {
          wounded[type] += 1;
        } else if (roll <= 5) {
          successes[type] += 1;
        } else {
          wildcard += 1;
        }
      }
    }

    return { successes, wildcard, wounded, dead };
  }

  private previewBattleOutcome(
    contract: Contract,
    rolls: BattleRolls,
    effects: RuntimePlayerState["roundRoleEffects"],
  ): BattlePreview {
    const { successes, wildcard: wc, wounded, dead } = this.classifyRolls(rolls, effects);
    const req = { ...contract.requirements };
    let remainingWild = wc;

    for (const type of this.troopTypes()) {
      const use = Math.min(successes[type], req[type]);
      req[type] -= use;
    }

    for (const type of this.troopTypes()) {
      if (req[type] === 0) {
        continue;
      }
      const use = Math.min(req[type], remainingWild);
      req[type] -= use;
      remainingWild -= use;
    }

    for (const type of this.troopTypes()) {
      if (req[type] === 0) {
        continue;
      }

      const autoSacrifice = this.getAutoSacrificeCounts(rolls[type], effects);
      const useFromWounded = Math.min(req[type], autoSacrifice.woundedSuccesses);
      const remainingNeed = req[type] - useFromWounded;
      const useFromHealthy = Math.min(remainingNeed, autoSacrifice.healthySuccesses);
      const use = useFromWounded + useFromHealthy;

      req[type] -= use;
      wounded[type] = Math.max(0, wounded[type] - useFromWounded);
      dead[type] += use;
    }

    return {
      dead,
      wounded,
      willSucceed: req.melee + req.ranged + req.mounted === 0,
    };
  }

  private finalizeBattle(
    contract: Contract,
    rolls: BattleRolls,
    _availableTroops: TroopCounts,
    effects: RuntimePlayerState["roundRoleEffects"],
  ): FinalizedBattle {
    const req = { ...contract.requirements };
    const { successes, wildcard, wounded, dead } = this.classifyRolls(rolls, effects);
    let remainingWild = wildcard;

    for (const type of this.troopTypes()) {
      const use = Math.min(successes[type], req[type]);
      req[type] -= use;
    }

    for (const type of this.troopTypes()) {
      if (req[type] === 0) {
        continue;
      }
      const use = Math.min(req[type], remainingWild);
      req[type] -= use;
      remainingWild -= use;
    }

    const sacrifices: TroopCounts = { melee: 0, ranged: 0, mounted: 0 };
    for (const type of this.troopTypes()) {
      if (req[type] === 0) {
        continue;
      }

      const autoSacrifice = this.getAutoSacrificeCounts(rolls[type], effects);
      const useFromWounded = Math.min(req[type], autoSacrifice.woundedSuccesses);
      const remainingNeed = req[type] - useFromWounded;
      const useFromHealthy = Math.min(remainingNeed, autoSacrifice.healthySuccesses);
      const use = useFromWounded + useFromHealthy;

      req[type] -= use;
      sacrifices[type] += use;
      wounded[type] = Math.max(0, wounded[type] - useFromWounded);
    }

    return {
      success: req.melee + req.ranged + req.mounted === 0,
      dead,
      wounded,
      sacrifices,
    };
  }

  private previewBattleOutcomeWithSacrifices(
    contract: Contract,
    rolls: BattleRolls,
    sacrifices: { melee: number[]; ranged: number[]; mounted: number[] },
    effects: RuntimePlayerState["roundRoleEffects"],
  ): { willSucceed: boolean; dead: TroopCounts; wounded: TroopCounts } {
    const req = { ...contract.requirements };
    const { successes, wildcard, wounded, dead } = this.classifyRolls(rolls, effects);
    let remainingWild = wildcard;

    this.applyExplicitSacrifices(successes, wounded, dead, rolls, sacrifices, effects);

    for (const type of this.troopTypes()) {
      const use = Math.min(successes[type], req[type]);
      req[type] -= use;
    }

    for (const type of this.troopTypes()) {
      if (req[type] === 0) {
        continue;
      }

      const use = Math.min(req[type], remainingWild);
      req[type] -= use;
      remainingWild -= use;
    }

    return {
      willSucceed: req.melee + req.ranged + req.mounted === 0,
      dead,
      wounded,
    };
  }

  private finalizeBattleWithSacrifices(
    contract: Contract,
    rolls: BattleRolls,
    sacrifices: { melee: number[]; ranged: number[]; mounted: number[] },
    effects: RuntimePlayerState["roundRoleEffects"],
  ): FinalizedBattle {
    const req = { ...contract.requirements };
    const { successes, wildcard, wounded, dead } = this.classifyRolls(rolls, effects);
    let remainingWild = wildcard;

    const sacrificeCounts: TroopCounts = { melee: 0, ranged: 0, mounted: 0 };
    this.applyExplicitSacrifices(successes, wounded, dead, rolls, sacrifices, effects, sacrificeCounts);

    for (const type of this.troopTypes()) {
      const use = Math.min(successes[type], req[type]);
      req[type] -= use;
    }

    for (const type of this.troopTypes()) {
      if (req[type] === 0) {
        continue;
      }

      const use = Math.min(req[type], remainingWild);
      req[type] -= use;
      remainingWild -= use;
    }

    return {
      success: req.melee + req.ranged + req.mounted === 0,
      dead,
      wounded,
      sacrifices: sacrificeCounts,
    };
  }

  private applyExplicitSacrifices(
    successes: TroopCounts,
    wounded: TroopCounts,
    dead: TroopCounts,
    rolls: BattleRolls,
    sacrifices: { melee: number[]; ranged: number[]; mounted: number[] },
    effects: RuntimePlayerState["roundRoleEffects"],
    sacrificeCounts: TroopCounts = { melee: 0, ranged: 0, mounted: 0 },
  ): void {
    for (const type of this.troopTypes()) {
      for (const idx of sacrifices[type]) {
        const roll = rolls[type][idx];
        if (roll === undefined || !this.isSacrificeEligibleRoll(roll, effects)) {
          continue;
        }

        successes[type] += 1;
        if (roll === (effects.surgeon ? 2 : 3)) {
          wounded[type] = Math.max(0, wounded[type] - 1);
        }
        dead[type] += 1;
        sacrificeCounts[type] += 1;
      }
    }
  }

  private isSacrificeEligibleRoll(
    roll: number,
    effects: RuntimePlayerState["roundRoleEffects"],
  ): boolean {
    const woundedFace = effects.surgeon ? 2 : 3;
    return roll === woundedFace || (roll >= 4 && roll <= 6);
  }

  private getAutoSacrificeCounts(
    typeRolls: number[],
    effects: RuntimePlayerState["roundRoleEffects"],
  ): {
    woundedSuccesses: number;
    healthySuccesses: number;
  } {
    let woundedSuccesses = 0;
    let healthySuccesses = 0;
    const woundedFace = effects.surgeon ? 2 : 3;

    for (const roll of typeRolls) {
      if (roll === woundedFace) {
        woundedSuccesses += 1;
      } else if (roll > woundedFace && roll <= 6) {
        healthySuccesses += 1;
      }
    }

    return { woundedSuccesses, healthySuccesses };
  }

  private applyFixedRerolls(
    rolls: BattleRolls,
    rerolls: number,
    effects: RuntimePlayerState["roundRoleEffects"],
  ): number {
    let spent = 0;
    const types = this.troopTypes();

    for (let i = 0; i < rerolls; i += 1) {
      let rerolled = false;
      for (const face of [1, 2, 3]) {
        for (const type of types) {
          const idx = rolls[type].indexOf(face);
          if (idx === -1) {
            continue;
          }

          let value = this.rollDie();
          if (effects.battlemaster) {
            value = Math.min(6, value + 1);
          }
          rolls[type][idx] = value;
          spent += 1;
          rerolled = true;
          break;
        }
        if (rerolled) {
          break;
        }
      }

      if (!rerolled) {
        break;
      }
    }

    return spent;
  }

  private applyAutoRerollsUntilStable(
    rolls: BattleRolls,
    player: RuntimePlayerState,
    contract: Contract,
  ): number {
    const types = this.troopTypes();
    let spent = 0;

    while (player.equipment - spent > 0) {
      const preview = this.previewBattleOutcome(
        contract,
        rolls,
        player.roundRoleEffects,
      );
      if (preview.willSucceed) {
        break;
      }

      let rerolled = false;
      for (const face of [1, 2, 3]) {
        for (const type of types) {
          const idx = rolls[type].indexOf(face);
          if (idx === -1) {
            continue;
          }

          let value = this.rollDie();
          if (player.roundRoleEffects.battlemaster) {
            value = Math.min(6, value + 1);
          }
          rolls[type][idx] = value;
          spent += 1;
          rerolled = true;
          break;
        }

        if (rerolled) {
          break;
        }
      }

      if (!rerolled) {
        break;
      }
    }

    return spent;
  }

  private computeCampaignCost(contracts: Contract[], forager: boolean): number {
    if (forager) {
      return 0;
    }

    if (contracts.length === 1) {
      return 0;
    }

    let cost = contracts.length === 2 ? 2 : 5;

    for (let i = 1; i < contracts.length; i += 1) {
      if (contracts[i - 1].region !== contracts[i].region) {
        cost += 3;
      }
    }

    return cost;
  }

  private computeSetRenown(completed: Contract[]): number {
    const counts = new Map<ContractType, number>();
    for (const contract of completed) {
      counts.set(contract.type, (counts.get(contract.type) ?? 0) + 1);
    }

    const types: ContractType[] = [
      "DEVASTATE",
      "ELIMINATE",
      "GUARD",
      "HUNT",
      "PLUNDER",
      "SUPPLY",
    ];

    let total = 0;
    while (true) {
      const setSize = types.reduce((sum, type) => sum + ((counts.get(type) ?? 0) > 0 ? 1 : 0), 0);
      if (setSize < 2) {
        break;
      }

      total += this.scoreSetSize(setSize);

      for (const type of types) {
        const current = counts.get(type) ?? 0;
        if (current > 0) {
          counts.set(type, current - 1);
        }
      }
    }

    return total;
  }

  private scoreSetSize(setSize: number): number {
    switch (setSize) {
      case 2:
        return 1;
      case 3:
        return 3;
      case 4:
        return 6;
      case 5:
        return 10;
      case 6:
        return 15;
      default:
        return 0;
    }
  }

  private createInitialBag(): TroopType[] {
    return this.shuffle([
      ...Array(36).fill("melee"),
      ...Array(18).fill("ranged"),
      ...Array(12).fill("mounted"),
    ]) as TroopType[];
  }

  private createDepots(count: number): Depot[] {
    return Array.from({ length: count }, () => ({
      dice: this.drawDiceFromBag(4),
      equipment: 1,
    }));
  }

  private drawDiceFromBag(count: number): TroopType[] {
    if (this.bag.length < count) {
      throw new Error("Not enough dice in bag");
    }

    return Array.from({ length: count }, () => {
      const die = this.bag.shift();
      if (!die) {
        throw new Error("Dice bag underflow");
      }
      return die;
    });
  }

  private addDepotToCompany(player: RuntimePlayerState, depot: Depot): void {
    this.applyDiceToCompany(player, depot.dice);
    player.equipment += depot.equipment;
  }

  private applyDiceToCompany(player: RuntimePlayerState, dice: TroopType[]): void {
    for (const die of dice) {
      player.company[die] += 1;
    }
  }

  private drawContractById(contractId: string): Contract {
    const matchTier = this.inferTierFromId(contractId);
    return this.drawSpecificContract(matchTier, contractId);
  }

  private inferTierFromId(contractId: string): "A" | "B" | "C" {
    const numeric = this.extractCardNumberFromId(contractId);
    if (!Number.isFinite(numeric)) {
      throw new Error(`Cannot infer tier from contract id ${contractId}`);
    }
    if (numeric <= 24) {
      return "A";
    }
    if (numeric <= 48) {
      return "B";
    }
    return "C";
  }

  private drawSpecificContract(tier: "A" | "B" | "C", contractId: string): Contract {
    const deck = this.contractsByTier[tier];
    let idx = deck.findIndex((contract) => contract.id === contractId);
    if (idx < 0) {
      const requestedCardNumber = this.extractCardNumberFromId(contractId);
      idx = deck.findIndex((contract) => contract.cardNumber === requestedCardNumber);
    }
    if (idx < 0) {
      throw new Error(`Contract ${contractId} not available in tier ${tier}`);
    }

    const [contract] = deck.splice(idx, 1);
    if (!contract) {
      throw new Error(`Failed to draw contract ${contractId}`);
    }
    return contract;
  }

  private drawContractFromTier(tier: "A" | "B" | "C"): Contract {
    const deck = this.contractsByTier[tier];
    if (deck.length === 0) {
      throw new Error(`Contract deck ${tier} is empty`);
    }

    const contract = deck.shift();
    if (!contract) {
      throw new Error(`Failed to draw contract from tier ${tier}`);
    }

    return contract;
  }

  private pickRandomAwards(awards: Award[], selectedCount: number): Award[] {
    if (selectedCount <= 0 || selectedCount > awards.length) {
      throw new Error("Invalid selected award count");
    }

    return this.shuffle([...awards]).slice(0, selectedCount);
  }

  private shuffle<T>(items: T[]): T[] {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = Math.floor(this.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  private turnOrder(): RuntimePlayerState[] {
    const copy = [...this.players];
    return [...copy.slice(this.startPlayerIndex), ...copy.slice(0, this.startPlayerIndex)];
  }

  private requirePlayer(playerId: string): RuntimePlayerState {
    const player = this.players.find((p) => p.id === playerId);
    if (!player) {
      throw new Error(`Unknown player ${playerId}`);
    }
    return player;
  }

  private totalTroops(counts: TroopCounts): number {
    return counts.melee + counts.ranged + counts.mounted;
  }

  private hasAtLeast(left: TroopCounts, right: TroopCounts): boolean {
    return left.melee >= right.melee && left.ranged >= right.ranged && left.mounted >= right.mounted;
  }

  private sumRequirements(contracts: Contract[]): TroopCounts {
    return contracts.reduce(
      (sum, contract) => ({
        melee: sum.melee + contract.requirements.melee,
        ranged: sum.ranged + contract.requirements.ranged,
        mounted: sum.mounted + contract.requirements.mounted,
      }),
      { melee: 0, ranged: 0, mounted: 0 },
    );
  }

  private troopTypes(): TroopType[] {
    return ["melee", "ranged", "mounted"];
  }

  private addCounts(target: TroopCounts, source: TroopCounts): void {
    target.melee += source.melee;
    target.ranged += source.ranged;
    target.mounted += source.mounted;
  }

  private addTwoCounts(a: TroopCounts, b: TroopCounts): TroopCounts {
    return {
      melee: a.melee + b.melee,
      ranged: a.ranged + b.ranged,
      mounted: a.mounted + b.mounted,
    };
  }

  private subtractCounts(from: TroopCounts, what: TroopCounts): TroopCounts {
    return {
      melee: from.melee - what.melee,
      ranged: from.ranged - what.ranged,
      mounted: from.mounted - what.mounted,
    };
  }

  private removeFromCompany(player: RuntimePlayerState, counts: TroopCounts): void {
    if (!this.hasAtLeast(player.company, counts)) {
      throw new Error(`${player.id} company underflow`);
    }

    player.company = this.subtractCounts(player.company, counts);
  }

  private returnToBag(counts: TroopCounts): void {
    for (let i = 0; i < counts.melee; i += 1) {
      this.bag.push("melee");
    }
    for (let i = 0; i < counts.ranged; i += 1) {
      this.bag.push("ranged");
    }
    for (let i = 0; i < counts.mounted; i += 1) {
      this.bag.push("mounted");
    }
  }

  private takeLoan(player: RuntimePlayerState): void {
    player.crowns += 10;
    player.debt += 1;
  }

  private normalizeContractId(contractId: string): string {
    return contractId.trim().toUpperCase();
  }

  private extractCardNumberFromId(contractId: string): number {
    return Number.parseInt(contractId.replace(/^C/i, ""), 10);
  }

  private findQueuedContract(
    player: RuntimePlayerState,
    contractId: string,
  ): Contract | undefined {
    return player.queue.find((contract) => this.contractIdMatches(contract.id, contractId));
  }

  private findQueuedContractIndex(
    player: RuntimePlayerState,
    contractId: string,
  ): number {
    return player.queue.findIndex((contract) => this.contractIdMatches(contract.id, contractId));
  }

  private resolveQueuedContractsForSelection(
    player: RuntimePlayerState,
    requestedContractIds: string[],
  ): Contract[] {
    const used = new Set<string>();
    const selected: Contract[] = [];

    for (const requestedId of requestedContractIds) {
      const found = player.queue.find(
        (contract) =>
          !used.has(contract.id) && this.contractIdMatches(contract.id, requestedId),
      );
      if (!found) {
        continue;
      }

      used.add(found.id);
      selected.push(found);
    }

    return selected;
  }

  private contractIdMatches(availableId: string, requestedId: string): boolean {
    const normalizedAvailableId = this.normalizeContractId(availableId);
    const normalizedRequestedId = this.normalizeContractId(requestedId);
    if (normalizedAvailableId === normalizedRequestedId) {
      return true;
    }

    return (
      this.extractCardNumberFromId(normalizedAvailableId) ===
      this.extractCardNumberFromId(normalizedRequestedId)
    );
  }

  private rollDie(): number {
    return Math.floor(this.random() * 6) + 1;
  }

  private resetRoundRoleEffects(): void {
    for (const player of this.players) {
      player.roundRoleEffects = {
        surgeon: false,
        forager: false,
        paymaster: false,
        battlemaster: false,
        negotiator: false,
      };
      player.selectedRole = null;
    }
  }

  private assertValidCounts(counts: TroopCounts, label: string): void {
    for (const value of [counts.melee, counts.ranged, counts.mounted]) {
      if (!Number.isFinite(value) || value < 0) {
        throw new Error(`${label} must be non-negative finite troop counts`);
      }
    }
  }
}