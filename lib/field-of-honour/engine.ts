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

interface BattleRollSummary {
  dead: TroopCounts;
  wounded: TroopCounts;
  strong: TroopCounts;
  sixes: TroopCounts;
  totalWild: number;
  sacrifiable: TroopCounts;
}

interface SuccessPlan {
  success: boolean;
  wildAssigned: TroopCounts;
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
      crowns: config.startCrowns ?? 20,
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

  private setupInitialContracts(): void {
    for (const player of this.players) {
      const card = this.drawContractFromTier("A");
      player.queue.push(card);
    }
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
    }

    for (const pickNumber of [0, 1] as const) {
      for (const player of this.turnOrder()) {
        const draftChoice = choices.contractDraftChoices[player.id]?.[pickNumber];
        if (!draftChoice) {
          throw new Error(`Missing contract draft choice #${pickNumber + 1} for ${player.id}`);
        }

        const idx = this.availableContractsThisRound.findIndex(
          (entry) =>
            entry.contract.id === draftChoice.contractId &&
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

    const activeContracts: Contract[] = [];
    for (const id of plan.contractIds) {
      const idx = player.queue.findIndex((c) => c.id === id);
      if (idx < 0) {
        throw new Error(`${player.id} cannot campaign unknown queued contract ${id}`);
      }
      activeContracts.push(player.queue[idx]);
      player.queue.splice(idx, 1);
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

      const battleRoll = this.rollBattle(activeTroops, player.roundRoleEffects);

      const rerolls = Math.max(0, plan.rerollsByContract?.[idx] ?? 0);
      if (rerolls > 0) {
        if (player.equipment < rerolls) {
          throw new Error(`${player.id} does not have enough equipment for rerolls`);
        }
        player.equipment -= rerolls;
        result.equipmentSpent += rerolls;
      }

      const successPlan = this.buildSuccessPlan(contract.requirements, battleRoll);
      const contractSucceeded = successPlan.success;

      this.addCounts(result.losses, battleRoll.dead);
      this.addCounts(result.wounded, battleRoll.wounded);
      this.addCounts(result.sacrifices, successPlan.sacrifices);

      this.removeFromCompany(player, battleRoll.dead);
      this.removeFromCompany(player, successPlan.sacrifices);
      this.returnToBag(battleRoll.dead);
      this.returnToBag(successPlan.sacrifices);

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
        this.subtractCounts(activeTroops, battleRoll.dead),
        this.addTwoCounts(battleRoll.wounded, successPlan.sacrifices),
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
  ): BattleRollSummary {
    const summary: BattleRollSummary = {
      dead: { melee: 0, ranged: 0, mounted: 0 },
      wounded: { melee: 0, ranged: 0, mounted: 0 },
      strong: { melee: 0, ranged: 0, mounted: 0 },
      sixes: { melee: 0, ranged: 0, mounted: 0 },
      totalWild: 0,
      sacrifiable: { melee: 0, ranged: 0, mounted: 0 },
    };

    for (const type of this.troopTypes()) {
      const count = troops[type];
      for (let i = 0; i < count; i += 1) {
        let roll = this.rollDie();
        if (effects.battlemaster) {
          roll = Math.min(6, roll + 1);
        }

        const deadThreshold = effects.surgeon ? 1 : 2;
        const woundedThreshold = effects.surgeon ? 2 : 3;

        if (roll <= deadThreshold) {
          summary.dead[type] += 1;
          continue;
        }

        summary.sacrifiable[type] += 1;

        if (roll <= woundedThreshold) {
          summary.wounded[type] += 1;
        } else if (roll === 6) {
          summary.sixes[type] += 1;
          summary.totalWild += 1;
        } else {
          summary.strong[type] += 1;
        }
      }
    }

    return summary;
  }

  private buildSuccessPlan(
    requirements: TroopCounts,
    battle: BattleRollSummary,
  ): SuccessPlan {
    const typeList = this.troopTypes();
    let best: SuccessPlan | null = null;
    const totalWild = battle.totalWild;

    for (let meleeWild = 0; meleeWild <= totalWild; meleeWild += 1) {
      for (let rangedWild = 0; rangedWild <= totalWild - meleeWild; rangedWild += 1) {
        const mountedWild = totalWild - meleeWild - rangedWild;
        const wildAssigned: TroopCounts = {
          melee: meleeWild,
          ranged: rangedWild,
          mounted: mountedWild,
        };

        const sacrifices: TroopCounts = { melee: 0, ranged: 0, mounted: 0 };
        let feasible = true;

        for (const type of typeList) {
          const base = battle.strong[type] + wildAssigned[type];
          const deficit = Math.max(0, requirements[type] - base);
          if (deficit > battle.sacrifiable[type]) {
            feasible = false;
            break;
          }
          sacrifices[type] = deficit;
        }

        if (!feasible) {
          continue;
        }

        const candidate: SuccessPlan = {
          success: true,
          wildAssigned,
          sacrifices,
        };

        if (!best || this.totalTroops(candidate.sacrifices) < this.totalTroops(best.sacrifices)) {
          best = candidate;
        }
      }
    }

    if (!best) {
      return {
        success: false,
        wildAssigned: { melee: 0, ranged: 0, mounted: 0 },
        sacrifices: { melee: 0, ranged: 0, mounted: 0 },
      };
    }

    return best;
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
    const numeric = Number.parseInt(contractId.replace(/^C/, ""), 10);
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
    const idx = deck.findIndex((contract) => contract.id === contractId);
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