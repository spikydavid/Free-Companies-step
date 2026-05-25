import type { Contract, ContractPoolEntry } from "./types";
import type { StartGameResult } from "./start-game";

type ContractTierKey = "A" | "B" | "C";

export interface ContractSelectionOptions {
  random?: () => number;
  humanPoolSelectionsByPlayer?: Record<string, [string, string]>;
  humanDraftSelectionsByPlayer?: Record<string, [string, string]>;
}

function shuffleContracts(contracts: Contract[], random: () => number): Contract[] {
  const deck = [...contracts];
  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const temp = deck[i];
    deck[i] = deck[j] as Contract;
    deck[j] = temp as Contract;
  }
  return deck;
}

function toTierKey(contract: Contract): ContractTierKey {
  if (contract.tier === "A" || contract.tier === "B" || contract.tier === "C") {
    return contract.tier;
  }
  throw new Error(`Unsupported contract tier for deck operations: ${contract.tier}`);
}

function refillTierDeckIfNeeded(
  contractDecks: StartGameResult["contractDecks"],
  discardedContractsByTier: StartGameResult["discardedContractsByTier"],
  tier: ContractTierKey,
  random: () => number,
): void {
  if (contractDecks[tier].length > 0) {
    return;
  }

  if (discardedContractsByTier[tier].length === 0) {
    return;
  }

  contractDecks[tier] = shuffleContracts(discardedContractsByTier[tier], random);
  discardedContractsByTier[tier] = [];
}

function drawFromTier(
  contractDecks: StartGameResult["contractDecks"],
  discardedContractsByTier: StartGameResult["discardedContractsByTier"],
  tier: ContractTierKey,
  random: () => number,
): Contract {
  refillTierDeckIfNeeded(contractDecks, discardedContractsByTier, tier, random);

  const drawn = contractDecks[tier].shift();
  if (!drawn) {
    throw new Error(`No contracts available in Tier ${tier}`);
  }
  return drawn;
}

function drawFromAnyTier(
  contractDecks: StartGameResult["contractDecks"],
  discardedContractsByTier: StartGameResult["discardedContractsByTier"],
  random: () => number,
): Contract {
  const availableTiers: ContractTierKey[] = ["A", "B", "C"].filter((tier) => {
    const key = tier as ContractTierKey;
    return contractDecks[key].length > 0 || discardedContractsByTier[key].length > 0;
  }) as ContractTierKey[];

  if (availableTiers.length === 0) {
    throw new Error("No contracts available in any tier deck");
  }

  const selectedTier = availableTiers[Math.floor(random() * availableTiers.length)] as ContractTierKey;
  return drawFromTier(contractDecks, discardedContractsByTier, selectedTier, random);
}

function drawSpecificContractFromDecks(
  contractDecks: StartGameResult["contractDecks"],
  contractId: string,
): Contract | null {
  for (const tier of ["A", "B", "C"] as const) {
    const idx = contractDecks[tier].findIndex((contract) => contract.id === contractId);
    if (idx >= 0) {
      const [selected] = contractDecks[tier].splice(idx, 1);
      return selected ?? null;
    }
  }
  return null;
}

export function runContractSelectionPhase(
  game: StartGameResult,
  options: ContractSelectionOptions = {},
): StartGameResult {
  if (game.currentRoundActionOrder.length !== game.players.length) {
    throw new Error("Role selection must complete before contract selection phase");
  }

  const random = options.random ?? Math.random;
  const contractDecks = {
    A: [...game.contractDecks.A],
    B: [...game.contractDecks.B],
    C: [...game.contractDecks.C],
  };
  const discardedContractsByTier = {
    A: [...game.discardedContractsByTier.A],
    B: [...game.discardedContractsByTier.B],
    C: [...game.discardedContractsByTier.C],
  };

  const draftPool: ContractPoolEntry[] = game.nextRoundContractPool.map((contract) => ({
    contract,
  }));
  const hasPreparedPool = draftPool.length > 0;

  if (!hasPreparedPool) {
    for (const playerId of game.currentRoundActionOrder) {
      const player = game.players.find((item) => item.id === playerId);
      if (!player) {
        throw new Error(`Unknown player in action order: ${playerId}`);
      }

      const maybeHumanPoolPicks = options.humanPoolSelectionsByPlayer?.[playerId];
      if (player.kind === "human" && maybeHumanPoolPicks) {
        const [firstId, secondId] = maybeHumanPoolPicks;
        const first = drawSpecificContractFromDecks(contractDecks, firstId);
        const second = drawSpecificContractFromDecks(contractDecks, secondId);
        if (!first || !second) {
          throw new Error(`${playerId} selected unavailable contract(s) for draft pool`);
        }
        draftPool.push({ contract: first }, { contract: second });
        continue;
      }

      const first = drawFromAnyTier(contractDecks, discardedContractsByTier, random);
      const second = drawFromAnyTier(contractDecks, discardedContractsByTier, random);
      draftPool.push({ contract: first }, { contract: second });
    }
  }

  for (const playerId of game.currentRoundActionOrder) {
    if (game.currentRoundRolesSelectedByPlayer[playerId] !== "NEGOTIATOR") {
      continue;
    }

    const restrictedA = drawFromTier(contractDecks, discardedContractsByTier, "A", random);
    const restrictedB = drawFromTier(contractDecks, discardedContractsByTier, "B", random);
    draftPool.push(
      { contract: restrictedA, restrictedToPlayerId: playerId },
      { contract: restrictedB, restrictedToPlayerId: playerId },
    );
  }

  const draftedByPlayer: Record<string, Contract[]> = Object.fromEntries(
    game.players.map((player) => [player.id, [] as Contract[]]),
  ) as Record<string, Contract[]>;

  for (const pickNumber of [0, 1] as const) {
    for (const playerId of game.currentRoundActionOrder) {
      const player = game.players.find((item) => item.id === playerId);
      if (!player) {
        throw new Error(`Unknown player in action order: ${playerId}`);
      }

      const eligibleIndices = draftPool
        .map((entry, idx) => ({ entry, idx }))
        .filter(
          ({ entry }) => !entry.restrictedToPlayerId || entry.restrictedToPlayerId === playerId,
        )
        .map(({ idx }) => idx);

      if (eligibleIndices.length === 0) {
        throw new Error(`${playerId} has no eligible contracts to draft`);
      }

      const maybeHumanDraftPicks = options.humanDraftSelectionsByPlayer?.[playerId];
      let pickedIdx = -1;

      if (player.kind === "human" && maybeHumanDraftPicks) {
        const preferredId = maybeHumanDraftPicks[pickNumber];
        const chosen = eligibleIndices.find((idx) => draftPool[idx]?.contract.id === preferredId);
        if (chosen === undefined) {
          throw new Error(`${playerId} selected unavailable draft contract ${preferredId}`);
        }
        pickedIdx = chosen;
      } else {
        pickedIdx = eligibleIndices[Math.floor(random() * eligibleIndices.length)] as number;
      }

      const [picked] = draftPool.splice(pickedIdx, 1);
      if (!picked) {
        throw new Error(`Failed to draft contract for ${playerId}`);
      }

      draftedByPlayer[playerId].push(picked.contract);
    }
  }

  for (const entry of draftPool) {
    const tier = toTierKey(entry.contract);
    discardedContractsByTier[tier].push(entry.contract);
  }

  const updatedPlayers = game.players.map((player) => ({
    ...player,
    contracts: [...player.contracts, ...draftedByPlayer[player.id]],
  }));

  return {
    ...game,
    players: updatedPlayers,
    contractDecks,
    discardedContractsByTier,
    currentRoundContractDraftPool: [],
    currentRoundContractsDraftedByPlayer: draftedByPlayer,
    nextRoundContractPool: [],
  };
}
