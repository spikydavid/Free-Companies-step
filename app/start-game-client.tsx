"use client";

import { useMemo, useState } from "react";

import { ROLE_PRIORITY } from "@/lib/field-of-honour/priorities";
import {
  beginRoundRoleSelection,
  resolveRoundRoleSelections,
} from "@/lib/field-of-honour/round";
import { runContractSelectionPhase } from "@/lib/field-of-honour/contract-selection";
import { runMusterPhase } from "@/lib/field-of-honour/muster";
import { runCampaignPhase } from "@/lib/field-of-honour/campaign";
import { runPaymentPhase } from "@/lib/field-of-honour/payment";
import {
  createDefaultPlayerKinds,
  startGame,
  type PlayerKind,
  type StartGameResult,
} from "@/lib/field-of-honour/start-game";
import type { Contract, RoleCard } from "@/lib/field-of-honour/types";

interface StartGameClientProps {
  contracts: Contract[];
}

export function StartGameClient({ contracts }: StartGameClientProps) {
  const [playerCount, setPlayerCount] = useState(4);
  const [playerKinds, setPlayerKinds] = useState<PlayerKind[]>(createDefaultPlayerKinds(4));
  const [started, setStarted] = useState<StartGameResult | null>(null);
  const [roundRoleChoices, setRoundRoleChoices] = useState<Record<string, RoleCard>>({});
  const [error, setError] = useState<string | null>(null);

  const roleEntries = useMemo(
    () => Object.entries(ROLE_PRIORITY).sort((a, b) => a[1] - b[1]),
    [],
  );

  function updatePlayerCount(nextCount: number) {
    const clamped = Math.max(2, Math.min(6, nextCount));
    setPlayerCount(clamped);
    setPlayerKinds((prev) => {
      if (prev.length === clamped) {
        return prev;
      }
      if (prev.length > clamped) {
        return prev.slice(0, clamped);
      }
      return [...prev, ...createDefaultPlayerKinds(clamped - prev.length)];
    });
  }

  function setPlayerKind(index: number, kind: PlayerKind) {
    setPlayerKinds((prev) => {
      const next = [...prev];
      next[index] = kind;
      return next;
    });
  }

  function onStartGame() {
    setError(null);
    try {
      const result = startGame({
        playerCount,
        playerKinds,
        contracts,
      });
      setStarted(result);
      setRoundRoleChoices(
        Object.fromEntries(
          result.players.map((player) => [player.id, player.availableRoles[0] as RoleCard]),
        ) as Record<string, RoleCard>,
      );
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : "Failed to start game");
    }
  }

  function setRoundRoleChoice(playerId: string, role: RoleCard) {
    setRoundRoleChoices((prev) => ({
      ...prev,
      [playerId]: role,
    }));
  }

  function onBeginRound() {
    if (!started) {
      return;
    }

    setError(null);
    try {
      const selectedRolesByPlayer = resolveRoundRoleSelections(started, roundRoleChoices);
      const next = beginRoundRoleSelection(started, selectedRolesByPlayer);
      setStarted(next);
      setRoundRoleChoices(
        Object.fromEntries(
          next.players.map((player) => [player.id, player.availableRoles[0] as RoleCard]),
        ) as Record<string, RoleCard>,
      );
    } catch (roundError) {
      setError(roundError instanceof Error ? roundError.message : "Failed to begin round");
    }
  }

  function onRunContractSelectionPhase() {
    if (!started) {
      return;
    }

    setError(null);
    try {
      const next = runContractSelectionPhase(started);
      setStarted(next);
    } catch (phaseError) {
      setError(
        phaseError instanceof Error ? phaseError.message : "Failed contract selection phase",
      );
    }
  }

  function onRunMusterPhase() {
    if (!started) {
      return;
    }

    setError(null);
    try {
      const next = runMusterPhase(started);
      setStarted(next);
    } catch (phaseError) {
      setError(phaseError instanceof Error ? phaseError.message : "Failed muster phase");
    }
  }

  function onRunCampaignPhase() {
    if (!started) {
      return;
    }

    setError(null);
    try {
      const next = runCampaignPhase(started);
      setStarted(next);
    } catch (phaseError) {
      setError(phaseError instanceof Error ? phaseError.message : "Failed campaign phase");
    }
  }

  function onRunPaymentPhase() {
    if (!started) {
      return;
    }

    setError(null);
    try {
      const next = runPaymentPhase(started);
      setStarted(next);
    } catch (phaseError) {
      setError(phaseError instanceof Error ? phaseError.message : "Failed payment phase");
    }
  }

  function summarizeDice(playerDice: StartGameResult["players"][number]["dice"]): string {
    const counts = { melee: 0, ranged: 0, mounted: 0 };
    for (const die of playerDice) {
      counts[die.troopType] += 1;
    }
    return `M:${counts.melee} R:${counts.ranged} H:${counts.mounted}`;
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-6 px-6 py-10">
      <section className="rounded-2xl border border-zinc-300 bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-semibold">Free Companies - Start Game</h1>
        <p className="mt-2 text-sm text-zinc-700">
          Set players and human/AI types, then initialize game resources.
        </p>

        <div className="mt-4 flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm">
            Players
            <input
              type="number"
              min={2}
              max={6}
              value={playerCount}
              onChange={(e) => updatePlayerCount(Number(e.target.value))}
              className="w-24 rounded-lg border border-zinc-400 px-3 py-2"
            />
          </label>
          <button
            onClick={onStartGame}
            className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-zinc-50 hover:bg-zinc-700"
          >
            Start Game
          </button>
        </div>

        <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: playerCount }, (_, index) => (
            <div
              key={`player-kind-${index}`}
              className="flex items-center justify-between rounded-lg border border-zinc-300 bg-zinc-50 px-3 py-2"
            >
              <span className="text-sm font-medium">Player {index + 1}</span>
              <select
                value={playerKinds[index] ?? "ai"}
                onChange={(e) => setPlayerKind(index, e.target.value as PlayerKind)}
                className="rounded-md border border-zinc-400 bg-white px-2 py-1 text-sm"
              >
                <option value="ai">AI</option>
                <option value="human">Human</option>
              </select>
            </div>
          ))}
        </div>

        {error ? (
          <p className="mt-3 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        ) : null}
      </section>

      {started ? (
        <section className="rounded-2xl border border-zinc-300 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold">Game Started</h2>
          <p className="mt-2 text-sm text-zinc-700">
            Round: {started.roundNumber} | SwordBearer: {started.swordBearerId}
          </p>
          <p className="mt-2 text-sm text-zinc-700">
            Players: {started.players.length} | Depots created: {started.depots.length} | Dice left in bag: {started.bag.length}
          </p>
          <p className="mt-1 text-sm text-zinc-700">
            Start player: {started.startPlayerId}
          </p>
          <p className="mt-1 text-sm text-zinc-700">
            Seating order: {started.seatingOrder.join(" -> ")}
          </p>
          <p className="mt-1 text-sm text-zinc-700">
            Armoury: {started.equipment.armoury}/{started.equipment.armouryCapacity}
          </p>
          <ul className="mt-3 list-inside list-disc space-y-1 text-sm text-zinc-700">
            {started.players.map((player) => (
              <li key={player.id}>
                {player.id} ({player.kind}) contract: {player.contracts[0]?.id ?? "-"} | dice {summarizeDice(player.dice)} | equipment {started.equipment.byPlayer[player.id] ?? 0}
              </li>
            ))}
          </ul>

          <div className="mt-5 rounded-xl border border-zinc-300 bg-zinc-50 p-4">
            <h3 className="text-sm font-semibold">Round {started.roundNumber}: Role Selection</h3>
            <p className="mt-1 text-xs text-zinc-700">
              Human players select roles; AI players choose random available roles. Action order is by role priority with SwordBearer proximity tie-break.
            </p>

            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {started.players.filter((player) => player.kind === "human").map((player) => (
                <label
                  key={`round-role-${player.id}`}
                  className="flex items-center justify-between rounded-md border border-zinc-300 bg-white px-3 py-2"
                >
                  <span className="text-sm font-medium">{player.id}</span>
                  <select
                    value={roundRoleChoices[player.id] ?? player.availableRoles[0] ?? "RETURN_ALL_ROLES"}
                    onChange={(e) => setRoundRoleChoice(player.id, e.target.value as RoleCard)}
                    className="rounded-md border border-zinc-400 bg-white px-2 py-1 text-sm"
                  >
                    {player.availableRoles.map((role) => (
                      <option key={`${player.id}-${role}`} value={role}>
                        {role}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>

            <button
              onClick={onBeginRound}
              className="mt-3 rounded-lg bg-zinc-900 px-3 py-2 text-xs font-medium text-zinc-50 hover:bg-zinc-700"
            >
              Begin Round With Selected Roles
            </button>

            {started.currentRoundActionOrder.length > 0 ? (
              <>
                <p className="mt-3 text-sm text-zinc-700">
                  Action order: {started.currentRoundActionOrder.join(" -> ")}
                </p>
                <button
                  onClick={onRunContractSelectionPhase}
                  className="mt-3 rounded-lg bg-zinc-900 px-3 py-2 text-xs font-medium text-zinc-50 hover:bg-zinc-700"
                >
                  Run Contract Selection Phase
                </button>
              </>
            ) : null}

            {Object.keys(started.currentRoundContractsDraftedByPlayer).length > 0 ? (
              <div className="mt-3 rounded-md border border-zinc-300 bg-white p-3">
                <p className="text-xs font-semibold text-zinc-700">Drafted This Round</p>
                <ul className="mt-1 list-inside list-disc space-y-1 text-xs text-zinc-700">
                  {started.currentRoundActionOrder.map((playerId) => {
                    const drafted = started.currentRoundContractsDraftedByPlayer[playerId] ?? [];
                    return (
                      <li key={`drafted-${playerId}`}>
                        {playerId}: {drafted.map((contract) => contract.id).join(", ") || "-"}
                      </li>
                    );
                  })}
                </ul>

                <button
                  onClick={onRunMusterPhase}
                  className="mt-3 rounded-lg bg-zinc-900 px-3 py-2 text-xs font-medium text-zinc-50 hover:bg-zinc-700"
                >
                  Run Muster Phase
                </button>
              </div>
            ) : null}

            {Object.keys(started.currentRoundMusterDiceByPlayer).length > 0 ? (
              <div className="mt-3 rounded-md border border-zinc-300 bg-white p-3">
                <p className="text-xs font-semibold text-zinc-700">Muster This Round</p>
                <p className="mt-1 text-xs text-zinc-700">
                  Includes Recruiter bonus dice (+4 from bag) and Armourer bonus equipment (+3 from armoury) when those roles are selected.
                </p>
                <ul className="mt-1 list-inside list-disc space-y-1 text-xs text-zinc-700">
                  {started.currentRoundActionOrder.map((playerId) => {
                    const depotDice = started.currentRoundMusterDiceByPlayer[playerId] ?? [];
                    const equipmentGained = started.currentRoundMusterEquipmentByPlayer[playerId] ?? 0;
                    const summary = {
                      melee: depotDice.filter((die) => die.troopType === "melee").length,
                      ranged: depotDice.filter((die) => die.troopType === "ranged").length,
                      mounted: depotDice.filter((die) => die.troopType === "mounted").length,
                    };

                    return (
                      <li key={`muster-${playerId}`}>
                        {playerId}: dice M:{summary.melee} R:{summary.ranged} H:{summary.mounted} | equipment +{equipmentGained}
                      </li>
                    );
                  })}
                </ul>

                <button
                  onClick={onRunCampaignPhase}
                  className="mt-3 rounded-lg bg-zinc-900 px-3 py-2 text-xs font-medium text-zinc-50 hover:bg-zinc-700"
                >
                  Run Campaign Phase
                </button>
              </div>
            ) : null}

            {Object.keys(started.currentRoundCampaignContractsByPlayer).length > 0 ? (
              <div className="mt-3 rounded-md border border-zinc-300 bg-white p-3">
                <p className="text-xs font-semibold text-zinc-700">Campaigning This Round</p>
                <p className="mt-1 text-xs text-zinc-700">
                  After muster, players move to campaigning in action order.
                </p>
                <ul className="mt-1 list-inside list-disc space-y-1 text-xs text-zinc-700">
                  {started.currentRoundActionOrder.map((playerId) => {
                    const selected = started.currentRoundCampaignContractsByPlayer[playerId] ?? [];
                    const resolution = started.currentRoundCampaignResolutionByPlayer[playerId];
                    return (
                      <li key={`campaign-${playerId}`}>
                        {playerId}: selected {selected.map((contract) => contract.id).join(", ") || "-"}
                        {resolution ? ` | cost ${resolution.campaignCostPaid}` : ""}
                        {resolution?.resolvedContracts.length ? (
                          <span>
                            {" "}
                            | resolved{" "}
                            {resolution.resolvedContracts
                              .map(
                                (entry) =>
                                  `${entry.contractId}:${entry.success ? "success" : "fail"}(dead ${entry.dead}, wounded ${entry.wounded}, sacrificed ${entry.sacrificed}, eq ${entry.equipmentSpent}, +${entry.rewardCrowns}c/+${entry.rewardRenown}r)`,
                              )
                              .join("; ")}
                          </span>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>

                {Object.keys(started.currentRoundCampaignResolutionByPlayer).length > 0 ? (
                  started.gameEnded ? (
                    <p className="mt-3 text-xs font-semibold text-zinc-800">
                      Game ended after campaigning. Skipping payment and round setup.
                    </p>
                  ) : (
                    <button
                      onClick={onRunPaymentPhase}
                      className="mt-3 rounded-lg bg-zinc-900 px-3 py-2 text-xs font-medium text-zinc-50 hover:bg-zinc-700"
                    >
                      Run Payment Phase
                    </button>
                  )
                ) : null}
              </div>
            ) : null}

            {started.gameEnded ? (
              <div className="mt-3 rounded-md border border-zinc-300 bg-white p-3">
                <p className="text-xs font-semibold text-zinc-700">Game End</p>
                <p className="mt-1 text-xs text-zinc-700">
                  Winner(s): {started.winningPlayerIds.join(", ") || "-"}
                </p>
                <ul className="mt-1 list-inside list-disc space-y-1 text-xs text-zinc-700">
                  {started.finalScores.map((score) => (
                    <li key={`score-${score.playerId}`}>
                      {score.playerId}: total {score.totalRenown} (contracts {score.renownFromContracts}, sets {score.renownFromSets}, awards {score.renownFromAwards})
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {Object.keys(started.currentRoundPaymentResolutionByPlayer).length > 0 ? (
              <div className="mt-3 rounded-md border border-zinc-300 bg-white p-3">
                <p className="text-xs font-semibold text-zinc-700">Payment This Round</p>
                <p className="mt-1 text-xs text-zinc-700">
                  In priority order, each player pays 3 crowns per troop remaining in company.
                </p>
                <ul className="mt-1 list-inside list-disc space-y-1 text-xs text-zinc-700">
                  {started.currentRoundActionOrder.map((playerId) => {
                    const payment = started.currentRoundPaymentResolutionByPlayer[playerId];
                    if (!payment) {
                      return (
                        <li key={`payment-${playerId}`}>
                          {playerId}: -
                        </li>
                      );
                    }

                    return (
                      <li key={`payment-${playerId}`}>
                        {playerId}: {payment.troopCount} troops x 3 = {payment.cost} crowns ({payment.crownsBefore} -&gt; {payment.crownsAfter})
                      </li>
                    );
                  })}
                </ul>

                <p className="mt-2 text-xs text-zinc-700">
                  Next round contract pool (2 blind contracts per player):{" "}
                  {started.nextRoundContractPool.map((contract) => contract.id).join(", ") || "-"}
                </p>
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      <section className="rounded-2xl border border-zinc-300 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold">Role Priority</h2>
        <ol className="mt-3 list-inside list-decimal space-y-1 text-sm text-zinc-800">
          {roleEntries.map(([role, priority]) => (
            <li key={role}>
              {priority}. {role}
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}
