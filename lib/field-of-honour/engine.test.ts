import test from "node:test";
import assert from "node:assert/strict";

import { loadContractsFromSheet1Csv } from "./contracts";
import { FieldOfHonourEngine } from "./engine";
import type { RoleCard, RoundChoices } from "./types";

function seededRandom(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (1664525 * s + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

test("engine can initialize and play one legal round", () => {
  const contracts = loadContractsFromSheet1Csv("data/contracts-sheet1.csv");
  const engine = new FieldOfHonourEngine({
    playerIds: ["P1", "P2"],
    contracts,
    random: seededRandom(7),
  });

  const before = engine.getState();
  const order = [before.startPlayerId, ...before.players.map((p) => p.id).filter((id) => id !== before.startPlayerId)];
  const roleChoices: Record<string, RoleCard> = {
    [order[0]]: "FORAGER",
    [order[1]]: "PAYMASTER",
  };

  const choices: RoundChoices = {
    roles: roleChoices,
    depotChoiceOrder: order,
    depotIndexByPlayer: {
      [order[0]]: 0,
      [order[1]]: 1,
    },
    contractsAddedByPlayer: {
      [order[0]]: ["C1", "C2"],
      [order[1]]: ["C3", "C4"],
    },
    contractDraftChoices: {
      [order[0]]: [{ contractId: "C1" }, { contractId: "C3" }],
      [order[1]]: [{ contractId: "C2" }, { contractId: "C4" }],
    },
    campaignPlanByPlayer: {
      [order[0]]: { contractIds: ["C1"] },
      [order[1]]: { contractIds: ["C2"] },
    },
    payrollLoanCounts: {
      [order[0]]: 3,
      [order[1]]: 0,
    },
    payrollDisband: {
      [order[0]]: { melee: 0, ranged: 0, mounted: 0 },
      [order[1]]: { melee: 0, ranged: 0, mounted: 0 },
    },
  };

  const result = engine.playRound(choices);
  assert.equal(result.roundNumber, 1);

  const after = engine.getState();
  assert.equal(after.roundNumber, 2);
  assert.equal(after.players.length, 2);
  assert.ok(after.players.every((p) => p.queue.length <= 3));
});