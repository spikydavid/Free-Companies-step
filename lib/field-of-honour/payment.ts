import type { StartGameResult } from "./start-game";
import type { Contract } from "./types";

const PAY_PER_TROOP = 3;
const LOAN_VALUE = 10;

export interface PaymentPhaseOptions {
  allowWhenGameEnded?: boolean;
  populateNextRoundContractPool?: boolean;
}

function disbandOneUnit(player: StartGameResult["players"][number], bag: StartGameResult["bag"]): boolean {
  const die = player.dice.pop();
  if (!die) {
    return false;
  }
  bag.push(die);
  return true;
}

type ContractTierKey = keyof StartGameResult["contractDecks"];

function drawBlindContract(
  contractDecks: StartGameResult["contractDecks"],
  discardedContractsByTier: StartGameResult["discardedContractsByTier"],
): Contract {
  const availableTiers = (Object.keys(contractDecks) as ContractTierKey[]).filter(
    (tier) => contractDecks[tier].length > 0 || discardedContractsByTier[tier].length > 0,
  );

  if (availableTiers.length === 0) {
    throw new Error("No contracts available in tiered decks for next round pool");
  }

  availableTiers.sort((left, right) => {
    const leftTotal = contractDecks[left].length + discardedContractsByTier[left].length;
    const rightTotal = contractDecks[right].length + discardedContractsByTier[right].length;
    if (rightTotal !== leftTotal) {
      return rightTotal - leftTotal;
    }
    return left.localeCompare(right);
  });

  const tier = availableTiers[0] as ContractTierKey;

  if (contractDecks[tier].length === 0 && discardedContractsByTier[tier].length > 0) {
    contractDecks[tier] = [...discardedContractsByTier[tier]];
    discardedContractsByTier[tier] = [];
  }

  const contract = contractDecks[tier].shift();
  if (!contract) {
    throw new Error(`Failed to draw blind contract from Tier ${tier}`);
  }
  return contract;
}

export function runPaymentPhase(
  game: StartGameResult,
  options: PaymentPhaseOptions = {},
): StartGameResult {
  const allowWhenGameEnded = options.allowWhenGameEnded ?? false;
  const populateNextRoundContractPool = options.populateNextRoundContractPool ?? true;

  if (game.gameEnded && !allowWhenGameEnded) {
    throw new Error("Game has ended; skip payment phase");
  }

  if (game.currentRoundActionOrder.length !== game.players.length) {
    throw new Error("Role selection must complete before payment phase");
  }

  const hasCampaignResults =
    Object.keys(game.currentRoundCampaignResolutionByPlayer).length > 0;
  if (!hasCampaignResults) {
    throw new Error("Campaigning must complete before payment phase");
  }

  const updatedPlayers = game.players.map((player) => ({ ...player }));
  const bag = [...game.bag];
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
  const playerById = new Map(updatedPlayers.map((player) => [player.id, player]));

  const paymentResolutionByPlayer: StartGameResult["currentRoundPaymentResolutionByPlayer"] = {};

  for (const playerId of game.currentRoundActionOrder) {
    const player = playerById.get(playerId);
    if (!player) {
      throw new Error(`Unknown player in action order: ${playerId}`);
    }

    const troopCount = player.dice.length;
    const crownsBefore = player.crowns;
    const debtBefore = player.debt;
    const selectedRole = game.currentRoundRolesSelectedByPlayer[playerId];
    const skippedByPaymaster = selectedRole === "PAYMASTER";

    let disbanded = 0;
    let loansTaken = 0;

    if (!skippedByPaymaster) {
      while (player.crowns < player.dice.length * PAY_PER_TROOP && player.dice.length > 0) {
        const disbandedUnit = disbandOneUnit(player, bag);
        if (!disbandedUnit) {
          break;
        }
        disbanded += 1;
      }

      while (player.crowns < player.dice.length * PAY_PER_TROOP) {
        player.crowns += LOAN_VALUE;
        player.debt += 1;
        loansTaken += 1;
      }
    }

    const cost = skippedByPaymaster ? 0 : player.dice.length * PAY_PER_TROOP;
    const crownsAfter = player.crowns - cost;
    const debtAfter = player.debt;

    player.crowns = crownsAfter;

    paymentResolutionByPlayer[playerId] = {
      troopCount,
      disbanded,
      loansTaken,
      crownsBefore,
      debtBefore,
      cost,
      crownsAfter,
      debtAfter,
      skippedByPaymaster,
    };
  }

  const nextRoundContractPool: Contract[] = [];
  if (populateNextRoundContractPool) {
    for (const playerId of game.currentRoundActionOrder) {
      if (!playerById.has(playerId)) {
        throw new Error(`Unknown player in action order: ${playerId}`);
      }

      nextRoundContractPool.push(
        drawBlindContract(contractDecks, discardedContractsByTier),
        drawBlindContract(contractDecks, discardedContractsByTier),
      );
    }
  }

  return {
    ...game,
    players: updatedPlayers,
    bag,
    contractDecks,
    discardedContractsByTier,
    currentRoundPaymentResolutionByPlayer: paymentResolutionByPlayer,
    nextRoundContractPool,
  };
}
