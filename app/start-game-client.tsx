"use client";

import { useEffect, useMemo, useState } from "react";

import { ROLE_PRIORITY } from "@/lib/field-of-honour/priorities";
import {
  beginRoundRoleSelection,
  resolveRoundRoleSelections,
} from "@/lib/field-of-honour/round";
import { runContractSelectionPhase } from "@/lib/field-of-honour/contract-selection";
import { runMusterPhase } from "@/lib/field-of-honour/muster";
import { runCampaignPhase } from "@/lib/field-of-honour/campaign";
import { runPaymentPhase } from "@/lib/field-of-honour/payment";
import { runDepotPhase } from "@/lib/field-of-honour/depot-phase";
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

interface SimulationPositionRow {
  rank: "1st" | "2nd" | "3rd" | "4th";
  samples: number;
  avgTotalRenown: number;
  avgRenownFromContracts: number;
  avgRenownFromSets: number;
  avgRenownFromAwards: number;
  avgRenownFromTroops: number;
  avgCompletedContracts: number;
  avgCrowns: number;
  avgEquipment: number;
}

interface SimulationPlayerTurnRow {
  turn: number;
  samples: number;
  avgTroops: number;
  avgCrowns: number;
  avgEquipment: number;
  avgCompletedContracts: number;
}

interface SimulationPlayerTurnTracking {
  playerId: string;
  turns: SimulationPlayerTurnRow[];
}

type TrackerMetricKey =
  | "avgTroops"
  | "avgCrowns"
  | "avgEquipment"
  | "avgCompletedContracts";

interface TrackerMetricConfig {
  key: TrackerMetricKey;
  label: string;
  colorClassName: string;
}

const TRACKER_METRICS: TrackerMetricConfig[] = [
  {
    key: "avgTroops",
    label: "Troops",
    colorClassName: "text-blue-600",
  },
  {
    key: "avgCrowns",
    label: "Crowns",
    colorClassName: "text-amber-600",
  },
  {
    key: "avgEquipment",
    label: "Equipment",
    colorClassName: "text-emerald-600",
  },
  {
    key: "avgCompletedContracts",
    label: "Completed Contracts",
    colorClassName: "text-rose-600",
  },
];

const CHART_WIDTH = 640;
const CHART_HEIGHT = 100;
const CHART_Y_TICKS = 4;

interface CombinedTurnAverageRow {
  turn: number;
  samples: number;
  avgTroops: number;
  avgCrowns: number;
  avgEquipment: number;
  avgCompletedContracts: number;
}

function toChartPoints(values: number[], maxValue: number): string {
  if (values.length === 0) {
    return "";
  }

  if (values.length === 1) {
    const y = CHART_HEIGHT - CHART_HEIGHT / 2;
    return `0,${y}`;
  }

  const safeMaxValue = Math.max(1, maxValue);
  const stepX = CHART_WIDTH / (values.length - 1);

  return values
    .map((value, index) => {
      const x = stepX * index;
      const normalized = value / safeMaxValue;
      const y = CHART_HEIGHT - normalized * CHART_HEIGHT;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
}

function buildCombinedTurnAverages(
  tracking: SimulationPlayerTurnTracking[],
): CombinedTurnAverageRow[] {
  const byTurn = new Map<
    number,
    {
      sampleWeight: number;
      troopsTotal: number;
      crownsTotal: number;
      equipmentTotal: number;
      completedContractsTotal: number;
    }
  >();

  for (const playerTracking of tracking) {
    for (const row of playerTracking.turns) {
      const sampleWeight = Math.max(1, row.samples);
      const existing = byTurn.get(row.turn) ?? {
        sampleWeight: 0,
        troopsTotal: 0,
        crownsTotal: 0,
        equipmentTotal: 0,
        completedContractsTotal: 0,
      };

      existing.sampleWeight += sampleWeight;
      existing.troopsTotal += row.avgTroops * sampleWeight;
      existing.crownsTotal += row.avgCrowns * sampleWeight;
      existing.equipmentTotal += row.avgEquipment * sampleWeight;
      existing.completedContractsTotal += row.avgCompletedContracts * sampleWeight;

      byTurn.set(row.turn, existing);
    }
  }

  return Array.from(byTurn.entries())
    .sort(([turnA], [turnB]) => turnA - turnB)
    .map(([turn, totals]) => {
      const divisor = Math.max(1, totals.sampleWeight);
      return {
        turn,
        samples: totals.sampleWeight,
        avgTroops: totals.troopsTotal / divisor,
        avgCrowns: totals.crownsTotal / divisor,
        avgEquipment: totals.equipmentTotal / divisor,
        avgCompletedContracts: totals.completedContractsTotal / divisor,
      };
    });
}

interface SimulationReport {
  successfulSimulations: number;
  totalAttempts: number;
  averageRounds: number | null;
  byFinishingPosition: SimulationPositionRow[];
  perPlayerTurnTracking: SimulationPlayerTurnTracking[];
  failureMessages: Record<string, number>;
}

interface SimulationBenchmarkRow {
  label: string;
  draftStrategy: SimulationDraftAiStrategy;
  report: SimulationReport;
}

type SimulationDepotAiStrategy = "random" | "one-turn-rollout";
type SimulationDraftAiStrategy = "random" | "heuristic" | "one-round-rollout";

export function StartGameClient({ contracts }: StartGameClientProps) {
  const [playerCount, setPlayerCount] = useState(4);
  const [playerKinds, setPlayerKinds] = useState<PlayerKind[]>(createDefaultPlayerKinds(4));
  const [started, setStarted] = useState<StartGameResult | null>(null);
  const [roundRoleChoices, setRoundRoleChoices] = useState<Record<string, RoleCard>>({});
  const [error, setError] = useState<string | null>(null);
  const [simulationReport, setSimulationReport] = useState<SimulationReport | null>(null);
  const [simulationLoading, setSimulationLoading] = useState(false);
  const [benchmarkLoading, setBenchmarkLoading] = useState(false);
  const [simulationUseRolloutDepotAi, setSimulationUseRolloutDepotAi] = useState(true);
  const [simulationRolloutTrials, setSimulationRolloutTrials] = useState(24);
  const [simulationDraftAiStrategy, setSimulationDraftAiStrategy] =
    useState<SimulationDraftAiStrategy>("heuristic");
  const [simulationDraftRolloutTrials, setSimulationDraftRolloutTrials] = useState(24);
  const [simulationBenchmarkRows, setSimulationBenchmarkRows] =
    useState<SimulationBenchmarkRow[] | null>(null);

  const roleEntries = useMemo(
    () => Object.entries(ROLE_PRIORITY).sort((a, b) => a[1] - b[1]),
    [],
  );

  const combinedTurnAverages = useMemo(
    () =>
      simulationReport
        ? buildCombinedTurnAverages(simulationReport.perPlayerTurnTracking)
        : [],
    [simulationReport],
  );

  const combinedMaxValue = useMemo(() => {
    if (combinedTurnAverages.length === 0) {
      return 1;
    }

    let maxValue = 1;
    for (const row of combinedTurnAverages) {
      maxValue = Math.max(
        maxValue,
        row.avgTroops,
        row.avgCrowns,
        row.avgEquipment,
        row.avgCompletedContracts,
      );
    }
    return maxValue;
  }, [combinedTurnAverages]);

  useEffect(() => {
    if (!started) {
      return;
    }

    const allAi = started.players.every((player) => player.kind === "ai");
    if (!allAi || started.gameEnded) {
      return;
    }

    try {
      let next: StartGameResult | null = null;

      if (started.currentRoundActionOrder.length === 0) {
        if (started.depots.length < started.players.length) {
          next = runDepotPhase(started);
        } else {
          const selectedRolesByPlayer = resolveRoundRoleSelections(started, roundRoleChoices);
          next = beginRoundRoleSelection(started, selectedRolesByPlayer);
        }
      } else if (Object.keys(started.currentRoundContractsDraftedByPlayer).length === 0) {
        next = runContractSelectionPhase(started);
      } else if (Object.keys(started.currentRoundMusterDiceByPlayer).length === 0) {
        next = runMusterPhase(started);
      } else if (Object.keys(started.currentRoundCampaignResolutionByPlayer).length === 0) {
        next = runCampaignPhase(started);
      } else if (!started.gameEnded) {
        next = runPaymentPhase(started);
      }

      if (!next) {
        return;
      }

      const timer = window.setTimeout(() => {
        setError(null);
        setStarted(next);
        setRoundRoleChoices(
          Object.fromEntries(
            next.players.map((player) => [player.id, player.availableRoles[0] as RoleCard]),
          ) as Record<string, RoleCard>,
        );
      }, 0);

      return () => {
        window.clearTimeout(timer);
      };
    } catch (phaseError) {
      const timer = window.setTimeout(() => {
        setError(
          phaseError instanceof Error ? phaseError.message : "Failed auto phase progression",
        );
      }, 0);
      return () => {
        window.clearTimeout(timer);
      };
    }
  }, [started, roundRoleChoices]);

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

  async function onRunSimulations() {
    setError(null);
    setSimulationLoading(true);
    try {
      const strategy: SimulationDepotAiStrategy = simulationUseRolloutDepotAi
        ? "one-turn-rollout"
        : "random";

      const response = await fetch("/api/simulations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sims: 1000,
          playerCount: 4,
          aiDepotChoiceStrategy: strategy,
          aiDepotRolloutTrials: simulationRolloutTrials,
          aiDraftStrategy: simulationDraftAiStrategy,
          aiDraftRolloutTrials: simulationDraftRolloutTrials,
        }),
      });

      const payload = (await response.json()) as SimulationReport | { error?: string };
      if (!response.ok || !("successfulSimulations" in payload)) {
        throw new Error((payload as { error?: string }).error ?? "Simulation request failed");
      }

      setSimulationReport(payload);
      setSimulationBenchmarkRows(null);
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : "Failed to run simulations");
    } finally {
      setSimulationLoading(false);
    }
  }

  async function runSimulationRequest(
    draftStrategy: SimulationDraftAiStrategy,
  ): Promise<SimulationReport> {
    const depotStrategy: SimulationDepotAiStrategy = simulationUseRolloutDepotAi
      ? "one-turn-rollout"
      : "random";

    const response = await fetch("/api/simulations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sims: 1000,
        playerCount: 4,
        aiDepotChoiceStrategy: depotStrategy,
        aiDepotRolloutTrials: simulationRolloutTrials,
        aiDraftStrategy: draftStrategy,
        aiDraftRolloutTrials: simulationDraftRolloutTrials,
      }),
    });

    const payload = (await response.json()) as SimulationReport | { error?: string };
    if (!response.ok || !("successfulSimulations" in payload)) {
      throw new Error((payload as { error?: string }).error ?? "Simulation request failed");
    }

    return payload;
  }

  async function onRunBenchmark() {
    setError(null);
    setBenchmarkLoading(true);
    try {
      const [randomReport, heuristicReport, rolloutReport] = await Promise.all([
        runSimulationRequest("random"),
        runSimulationRequest("heuristic"),
        runSimulationRequest("one-round-rollout"),
      ]);

      const rows: SimulationBenchmarkRow[] = [
        {
          label: "Random",
          draftStrategy: "random",
          report: randomReport,
        },
        {
          label: "Heuristic",
          draftStrategy: "heuristic",
          report: heuristicReport,
        },
        {
          label: "One-round rollout",
          draftStrategy: "one-round-rollout",
          report: rolloutReport,
        },
      ];

      setSimulationBenchmarkRows(rows);
    } catch (benchmarkError) {
      setError(
        benchmarkError instanceof Error
          ? benchmarkError.message
          : "Failed to run strategy benchmark",
      );
    } finally {
      setBenchmarkLoading(false);
    }
  }

  function onBeginRound() {
    if (!started) {
      return;
    }

    setError(null);
    try {
      const withDepots =
        started.depots.length < started.players.length ? runDepotPhase(started) : started;

      const selectedRolesByPlayer = resolveRoundRoleSelections(withDepots, roundRoleChoices);
      const next = beginRoundRoleSelection(withDepots, selectedRolesByPlayer);
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

  function onRunDepotPhase() {
    if (!started) {
      return;
    }

    setError(null);
    try {
      const next = runDepotPhase(started);
      setStarted(next);
    } catch (phaseError) {
      setError(phaseError instanceof Error ? phaseError.message : "Failed depot phase");
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
              Round order: Depot phase first, then role selection. Human players select roles; AI players choose random available roles. Action order is by role priority with SwordBearer proximity tie-break.
            </p>

            <button
              onClick={onRunDepotPhase}
              className="mt-3 rounded-lg bg-zinc-900 px-3 py-2 text-xs font-medium text-zinc-50 hover:bg-zinc-700"
            >
              Run Depot Phase
            </button>
            <p className="mt-2 text-xs text-zinc-700">
              Current round depots available: {started.depots.length}
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
              disabled={started.depots.length < started.players.length}
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
                      {score.playerId}: total {score.totalRenown} (contracts {score.renownFromContracts}, sets {score.renownFromSets}, awards {score.renownFromAwards}, troops {score.renownFromTroops}) | completed {score.completedContracts}, crowns {score.crowns}, equipment {score.equipment}
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

      <section className="rounded-2xl border border-zinc-300 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold">Simulation Runner</h2>
        <p className="mt-2 text-sm text-zinc-700">
          Run 1,000 AI-only games and aggregate averages by finishing position.
        </p>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="flex items-center gap-2 text-sm text-zinc-700">
            <input
              type="checkbox"
              checked={simulationUseRolloutDepotAi}
              onChange={(e) => setSimulationUseRolloutDepotAi(e.target.checked)}
              className="h-4 w-4 rounded border-zinc-400"
            />
            Use one-turn rollout for AI depot choice
          </label>

          <label className="flex flex-col gap-1 text-xs text-zinc-700">
            Depot rollout trials
            <input
              type="number"
              min={1}
              max={200}
              value={simulationRolloutTrials}
              onChange={(e) => {
                const next = Math.max(1, Math.min(200, Number(e.target.value) || 1));
                setSimulationRolloutTrials(next);
              }}
              className="w-24 rounded-md border border-zinc-400 bg-white px-2 py-1 text-sm"
            />
          </label>

          <label className="flex flex-col gap-1 text-xs text-zinc-700">
            Draft AI strategy
            <select
              value={simulationDraftAiStrategy}
              onChange={(e) => setSimulationDraftAiStrategy(e.target.value as SimulationDraftAiStrategy)}
              className="rounded-md border border-zinc-400 bg-white px-2 py-1 text-sm"
            >
              <option value="heuristic">Heuristic</option>
              <option value="one-round-rollout">One-round rollout</option>
              <option value="random">Random</option>
            </select>
          </label>

          <label className="flex flex-col gap-1 text-xs text-zinc-700">
            Draft rollout trials
            <input
              type="number"
              min={1}
              max={200}
              value={simulationDraftRolloutTrials}
              disabled={simulationDraftAiStrategy !== "one-round-rollout"}
              onChange={(e) => {
                const next = Math.max(1, Math.min(200, Number(e.target.value) || 1));
                setSimulationDraftRolloutTrials(next);
              }}
              className="w-24 rounded-md border border-zinc-400 bg-white px-2 py-1 text-sm disabled:opacity-50"
            />
          </label>
        </div>
        <button
          onClick={onRunSimulations}
          disabled={simulationLoading || benchmarkLoading}
          className="mt-3 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-zinc-50 hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {simulationLoading ? "Running Simulations..." : "Run 1000 Simulations"}
        </button>
        <button
          onClick={onRunBenchmark}
          disabled={simulationLoading || benchmarkLoading}
          className="mt-3 ml-2 rounded-lg border border-zinc-400 bg-white px-4 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {benchmarkLoading
            ? "Running Benchmark..."
            : "Benchmark Draft AI (Random vs Heuristic vs Rollout)"}
        </button>

        {simulationBenchmarkRows ? (
          <div className="mt-4 rounded-md border border-zinc-300 bg-zinc-50 p-3 text-xs text-zinc-800">
            <p className="font-semibold">Draft AI Benchmark (1,000 sims each)</p>
            <div className="mt-2 overflow-x-auto">
              <table className="min-w-full border-collapse">
                <thead>
                  <tr className="border-b border-zinc-300 text-left">
                    <th className="px-2 py-1">Strategy</th>
                    <th className="px-2 py-1">Completed</th>
                    <th className="px-2 py-1">Avg Rounds</th>
                    <th className="px-2 py-1">Avg 1st Place Renown</th>
                    <th className="px-2 py-1">Failures</th>
                  </tr>
                </thead>
                <tbody>
                  {simulationBenchmarkRows.map((row) => {
                    const firstPlace = row.report.byFinishingPosition.find(
                      (entry) => entry.rank === "1st",
                    );
                    return (
                      <tr key={`benchmark-${row.draftStrategy}`} className="border-b border-zinc-200">
                        <td className="px-2 py-1">{row.label}</td>
                        <td className="px-2 py-1">
                          {row.report.successfulSimulations}/{row.report.totalAttempts}
                        </td>
                        <td className="px-2 py-1">
                          {row.report.averageRounds?.toFixed(3) ?? "-"}
                        </td>
                        <td className="px-2 py-1">
                          {firstPlace?.avgTotalRenown.toFixed(3) ?? "-"}
                        </td>
                        <td className="px-2 py-1">
                          {Object.keys(row.report.failureMessages).length}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        {simulationReport ? (
          <div className="mt-4 rounded-md border border-zinc-300 bg-zinc-50 p-3 text-xs text-zinc-800">
            <p>
              Completed: {simulationReport.successfulSimulations} / Attempts: {simulationReport.totalAttempts} / Average rounds: {simulationReport.averageRounds?.toFixed(3) ?? "-"}
            </p>
            <ul className="mt-2 list-inside list-disc space-y-1">
              {simulationReport.byFinishingPosition.map((row) => (
                <li key={`sim-${row.rank}`}>
                  {row.rank}: total {row.avgTotalRenown.toFixed(3)} (contracts {row.avgRenownFromContracts.toFixed(3)}, sets {row.avgRenownFromSets.toFixed(3)}, awards {row.avgRenownFromAwards.toFixed(3)}, troops {row.avgRenownFromTroops.toFixed(3)}) | completed {row.avgCompletedContracts.toFixed(3)}, crowns {row.avgCrowns.toFixed(3)}, equipment {row.avgEquipment.toFixed(3)}
                </li>
              ))}
            </ul>

            <div className="mt-3 rounded-md border border-zinc-300 bg-white p-3">
              <p className="text-xs font-semibold text-zinc-700">
                Combined turn tracking (average of all players by round)
              </p>
              <p className="mt-1 text-[11px] text-zinc-600">
                Each point is the round-level average across all players that reached that round.
              </p>

              <svg
                viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
                className="mt-2 h-28 w-full rounded border border-zinc-200 bg-zinc-50"
                aria-label="Combined all-player round trends"
              >
                {Array.from({ length: CHART_Y_TICKS + 1 }, (_, index) => {
                  const ratio = index / CHART_Y_TICKS;
                  const y = CHART_HEIGHT - CHART_HEIGHT * ratio;
                  return (
                    <line
                      key={`sim-y-grid-${index}`}
                      x1="0"
                      y1={y}
                      x2={CHART_WIDTH}
                      y2={y}
                      stroke="currentColor"
                      className="text-zinc-200"
                    />
                  );
                })}

                {combinedTurnAverages.map((turnRow, index) => {
                  if (combinedTurnAverages.length <= 1) {
                    return null;
                  }

                  const x = (CHART_WIDTH / (combinedTurnAverages.length - 1)) * index;
                  return (
                    <line
                      key={`sim-x-grid-${turnRow.turn}`}
                      x1={x}
                      y1="0"
                      x2={x}
                      y2={CHART_HEIGHT}
                      stroke="currentColor"
                      className="text-zinc-200"
                    />
                  );
                })}

                <line
                  x1="0"
                  y1={CHART_HEIGHT}
                  x2={CHART_WIDTH}
                  y2={CHART_HEIGHT}
                  stroke="currentColor"
                  className="text-zinc-300"
                />
                {TRACKER_METRICS.map((metric) => {
                  const values = combinedTurnAverages.map((turnRow) => turnRow[metric.key]);
                  const points = toChartPoints(values, combinedMaxValue);

                  return (
                    <polyline
                      key={`sim-combined-chart-${metric.key}`}
                      fill="none"
                      points={points}
                      stroke="currentColor"
                      strokeWidth="2"
                      className={metric.colorClassName}
                    />
                  );
                })}

                {Array.from({ length: CHART_Y_TICKS + 1 }, (_, index) => {
                  const ratio = index / CHART_Y_TICKS;
                  const y = CHART_HEIGHT - CHART_HEIGHT * ratio;
                  const valueLabel = (combinedMaxValue * ratio).toFixed(1);
                  return (
                    <text
                      key={`sim-y-label-${index}`}
                      x="4"
                      y={Math.max(10, y - 2)}
                      className="fill-zinc-500 text-[8px]"
                    >
                      {valueLabel}
                    </text>
                  );
                })}
              </svg>

              <div className="mt-1 flex items-center justify-between text-[10px] text-zinc-600">
                <span>Round 1</span>
                <span>Round {combinedTurnAverages[combinedTurnAverages.length - 1]?.turn ?? 1}</span>
              </div>

              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
                {TRACKER_METRICS.map((metric) => (
                  <span key={`sim-legend-${metric.key}`} className={metric.colorClassName}>
                    {metric.label}
                  </span>
                ))}
              </div>

              <details className="mt-2 rounded border border-zinc-200 bg-zinc-50 px-2 py-1">
                <summary className="cursor-pointer text-[11px] text-zinc-700">
                  View combined round table
                </summary>
                <ul className="mt-1 list-inside list-disc space-y-1 text-[11px] text-zinc-700">
                  {combinedTurnAverages.map((turnRow) => (
                    <li key={`sim-combined-turn-row-${turnRow.turn}`}>
                      Round {turnRow.turn} ({turnRow.samples} weighted samples): troops {turnRow.avgTroops.toFixed(3)}, crowns {turnRow.avgCrowns.toFixed(3)}, equipment {turnRow.avgEquipment.toFixed(3)}, completed contracts {turnRow.avgCompletedContracts.toFixed(3)}
                    </li>
                  ))}
                </ul>
              </details>
            </div>

            {Object.keys(simulationReport.failureMessages).length > 0 ? (
              <div className="mt-2">
                <p>Failures:</p>
                <ul className="list-inside list-disc">
                  {Object.entries(simulationReport.failureMessages).map(([message, count]) => (
                    <li key={`sim-fail-${message}`}>
                      {message}: {count}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}
      </section>
    </main>
  );
}
