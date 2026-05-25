"use client";

import { useMemo } from "react";

import type { RoleCard, TroopType } from "@/lib/field-of-honour";

import { useGameSession } from "./hooks/useGameSession";

interface RoundMetricsPlayerPoint {
  playerId: string;
  crowns: number;
  melee: number;
  ranged: number;
  mounted: number;
  equipment: number;
  contracts: number;
}

interface RoundMetricsPoint {
  roundNumber: number;
  players: RoundMetricsPlayerPoint[];
}

type RoleSelectionCounts = Record<RoleCard, number>;

interface RoleSelectionPoint {
  roundNumber: number;
  counts: RoleSelectionCounts;
}

const LINE_COLORS = [
  "#2563eb",
  "#dc2626",
  "#059669",
  "#d97706",
  "#7c3aed",
  "#0f766e",
  "#be185d",
  "#1d4ed8",
];

const ROLE_CARDS: RoleCard[] = [
  "NEGOTIATOR",
  "SURGEON",
  "ARMOURER",
  "FORAGER",
  "PAYMASTER",
  "RECRUITER",
  "BATTLE_MASTER",
  "RETURN_ALL_ROLES",
];

function MetricLineChart({
  title,
  history,
  playerIds,
  metric,
}: {
  title: string;
  history: RoundMetricsPoint[];
  playerIds: string[];
  metric: keyof Pick<RoundMetricsPlayerPoint, "crowns" | "melee" | "ranged" | "mounted" | "equipment" | "contracts">;
}) {
  if (history.length === 0) {
    return null;
  }

  const width = 560;
  const height = 220;
  const padLeft = 42;
  const padRight = 12;
  const padTop = 18;
  const padBottom = 28;
  const plotWidth = width - padLeft - padRight;
  const plotHeight = height - padTop - padBottom;

  const rounds = history.map((point) => point.roundNumber);
  const minRound = Math.min(...rounds);
  const maxRound = Math.max(...rounds);
  const roundSpan = Math.max(1, maxRound - minRound);

  const allValues = history.flatMap((point) =>
    point.players.map((playerPoint) => playerPoint[metric]),
  );
  const maxValue = Math.max(1, ...allValues);

  const xForRound = (round: number) =>
    padLeft + ((round - minRound) / roundSpan) * plotWidth;
  const yForValue = (value: number) =>
    padTop + (1 - value / maxValue) * plotHeight;

  return (
    <div className="rounded-2xl border border-zinc-300 bg-white p-4">
      <p className="mb-2 text-sm font-semibold text-zinc-800">{title}</p>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-56 w-full">
        <line x1={padLeft} y1={padTop} x2={padLeft} y2={height - padBottom} stroke="#94a3b8" strokeWidth="1" />
        <line
          x1={padLeft}
          y1={height - padBottom}
          x2={width - padRight}
          y2={height - padBottom}
          stroke="#94a3b8"
          strokeWidth="1"
        />
        <text x={padLeft - 12} y={padTop + 4} className="fill-zinc-500 text-[10px]">
          {maxValue}
        </text>
        <text x={padLeft - 12} y={height - padBottom + 4} className="fill-zinc-500 text-[10px]">
          0
        </text>
        <text x={padLeft} y={height - 8} className="fill-zinc-500 text-[10px]">
          R{minRound}
        </text>
        <text x={width - padRight - 24} y={height - 8} className="fill-zinc-500 text-[10px]">
          R{maxRound}
        </text>

        {playerIds.map((playerId, idx) => {
          const points = history.map((point) => {
            const value = point.players.find((playerPoint) => playerPoint.playerId === playerId)?.[metric] ?? 0;
            return {
              x: xForRound(point.roundNumber),
              y: yForValue(value),
            };
          });

          const pathD = points
            .map((point, pointIndex) => `${pointIndex === 0 ? "M" : "L"} ${point.x} ${point.y}`)
            .join(" ");

          return (
            <g key={`${metric}-${playerId}`}>
              <path d={pathD} fill="none" stroke={LINE_COLORS[idx % LINE_COLORS.length]} strokeWidth="2" />
              {points.map((point, pointIndex) => (
                <circle
                  key={`${metric}-${playerId}-${pointIndex}`}
                  cx={point.x}
                  cy={point.y}
                  r="2.4"
                  fill={LINE_COLORS[idx % LINE_COLORS.length]}
                />
              ))}
            </g>
          );
        })}
      </svg>
      <div className="mt-2 flex flex-wrap gap-3 text-xs">
        {playerIds.map((playerId, idx) => (
          <span key={`legend-${metric}-${playerId}`} className="inline-flex items-center gap-1">
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ backgroundColor: LINE_COLORS[idx % LINE_COLORS.length] }}
            />
            {playerId}
          </span>
        ))}
      </div>
    </div>
  );
}

function RoleSelectionLineChart({
  title,
  history,
  roles,
}: {
  title: string;
  history: RoleSelectionPoint[];
  roles: RoleCard[];
}) {
  if (history.length === 0) {
    return null;
  }

  const width = 560;
  const height = 220;
  const padLeft = 42;
  const padRight = 12;
  const padTop = 18;
  const padBottom = 28;
  const plotWidth = width - padLeft - padRight;
  const plotHeight = height - padTop - padBottom;

  const rounds = history.map((point) => point.roundNumber);
  const minRound = Math.min(...rounds);
  const maxRound = Math.max(...rounds);
  const roundSpan = Math.max(1, maxRound - minRound);

  const allValues = history.flatMap((point) => roles.map((role) => point.counts[role]));
  const maxValue = Math.max(1, ...allValues);

  const xForRound = (round: number) =>
    padLeft + ((round - minRound) / roundSpan) * plotWidth;
  const yForValue = (value: number) =>
    padTop + (1 - value / maxValue) * plotHeight;

  return (
    <div className="rounded-2xl border border-zinc-300 bg-white p-4 lg:col-span-2">
      <p className="mb-2 text-sm font-semibold text-zinc-800">{title}</p>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-56 w-full">
        <line x1={padLeft} y1={padTop} x2={padLeft} y2={height - padBottom} stroke="#94a3b8" strokeWidth="1" />
        <line
          x1={padLeft}
          y1={height - padBottom}
          x2={width - padRight}
          y2={height - padBottom}
          stroke="#94a3b8"
          strokeWidth="1"
        />
        <text x={padLeft - 12} y={padTop + 4} className="fill-zinc-500 text-[10px]">
          {maxValue}
        </text>
        <text x={padLeft - 12} y={height - padBottom + 4} className="fill-zinc-500 text-[10px]">
          0
        </text>
        <text x={padLeft} y={height - 8} className="fill-zinc-500 text-[10px]">
          R{minRound}
        </text>
        <text x={width - padRight - 24} y={height - 8} className="fill-zinc-500 text-[10px]">
          R{maxRound}
        </text>

        {roles.map((role, idx) => {
          const points = history.map((point) => ({
            x: xForRound(point.roundNumber),
            y: yForValue(point.counts[role]),
          }));

          const pathD = points
            .map((point, pointIndex) => `${pointIndex === 0 ? "M" : "L"} ${point.x} ${point.y}`)
            .join(" ");

          return (
            <g key={`role-${role}`}>
              <path d={pathD} fill="none" stroke={LINE_COLORS[idx % LINE_COLORS.length]} strokeWidth="2" />
              {points.map((point, pointIndex) => (
                <circle
                  key={`role-${role}-${pointIndex}`}
                  cx={point.x}
                  cy={point.y}
                  r="2.2"
                  fill={LINE_COLORS[idx % LINE_COLORS.length]}
                />
              ))}
            </g>
          );
        })}
      </svg>
      <div className="mt-2 flex flex-wrap gap-3 text-xs">
        {roles.map((role, idx) => (
          <span key={`legend-${role}`} className="inline-flex items-center gap-1">
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ backgroundColor: LINE_COLORS[idx % LINE_COLORS.length] }}
            />
            {role}
          </span>
        ))}
      </div>
    </div>
  );
}

export default function Home() {
  const {
    playerCount,
    setPlayerCount,
    playerTypes,
    setPlayerTypes,
    seed,
    setSeed,
    sessionId,
    state,
    roundMetrics,
    scores,
    selectedBattlePlayer,
    setSelectedBattleContract,
    selectedCampaignContracts,
    setSelectedCampaignContracts,
    campaignSendHome,
    setCampaignSendHome,
    manualCampaign,
    manualBattle,
    error,
    busy,
    latestRound,
    roleSelectionHistory,
    selectedPlayerContracts,
    effectiveSelectedBattleContract,
    gameEnded,
    startSession,
    playRound,
    startManualBattle,
    rerollManualBattleDie,
    toggleManualBattleSacrifice,
    confirmManualBattle,
    startManualCampaign,
    startNextCampaignBattle,
    fetchScores,
    selectBattlePlayer,
  } = useGameSession();

  const hasQueuedCampaignSelection = selectedCampaignContracts.some((selectedId) =>
    selectedPlayerContracts.some((contract) => contract.id === selectedId),
  );

  const humanPlayerIds = new Set(
    state?.players
      .filter((_, i) => playerTypes[i] === "human")
      .map((p) => p.id) ?? [],
  );

  const humanPlayerList = state?.players.filter((_, i) => playerTypes[i] === "human") ?? [];
  const chartPlayerIds = state?.players.map((player) => player.id) ?? [];
  const roleCardsForChart = useMemo(() => ROLE_CARDS, []);

  return (
    <div className="min-h-full bg-[radial-gradient(circle_at_0%_0%,#f8d5a5_0%,#f2e8cf_35%,#dbe7c9_70%,#b5d5c5_100%)] px-6 py-8 text-zinc-900">
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <section className="rounded-3xl border border-zinc-900/15 bg-white/75 p-6 shadow-[0_12px_40px_rgba(24,35,18,0.16)] backdrop-blur">
          <h1 className="text-3xl font-semibold tracking-tight">Field of Honour Console</h1>
          <p className="mt-2 max-w-3xl text-sm text-zinc-700">
            Thin API + UI wiring is active. Start a session, then execute rounds one at a time.
          </p>
          <div className="mt-4 flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-sm">
              Players
              <input
                type="number"
                min={2}
                max={6}
                value={playerCount}
                onChange={(e) => setPlayerCount(Number(e.target.value))}
                className="w-28 rounded-xl border border-zinc-400 bg-white px-3 py-2"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Seed
              <input
                type="number"
                value={seed}
                onChange={(e) => setSeed(Number(e.target.value))}
                className="w-28 rounded-xl border border-zinc-400 bg-white px-3 py-2"
              />
            </label>
            <button
              onClick={startSession}
              disabled={busy}
              className="rounded-xl bg-zinc-900 px-5 py-2 text-sm font-medium text-zinc-50 hover:bg-zinc-700 disabled:opacity-60"
            >
              {busy ? "Working..." : "Start Session"}
            </button>
            <button
              onClick={playRound}
              disabled={!sessionId || busy}
              className="rounded-xl bg-emerald-700 px-5 py-2 text-sm font-medium text-emerald-50 hover:bg-emerald-600 disabled:opacity-60"
            >
              Play Next Round
            </button>
            <button
              onClick={fetchScores}
              disabled={!sessionId || busy}
              className="rounded-xl bg-amber-700 px-5 py-2 text-sm font-medium text-amber-50 hover:bg-amber-600 disabled:opacity-60"
            >
              Score Game
            </button>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {Array.from({ length: playerCount }, (_, i) => (
              <div key={i} className="flex items-center gap-2 rounded-xl border border-zinc-300 bg-white/80 px-3 py-2 text-sm">
                <span className="w-20 font-medium">Player {i + 1}</span>
                <button
                  onClick={() =>
                    setPlayerTypes((prev) => {
                      const next = [...prev];
                      next[i] = "human";
                      return next;
                    })
                  }
                  disabled={!!sessionId}
                  className={`rounded-lg px-3 py-1 text-xs font-medium ${
                    playerTypes[i] === "human"
                      ? "bg-indigo-700 text-indigo-50"
                      : "bg-zinc-200 text-zinc-600 hover:bg-zinc-300"
                  } disabled:opacity-60`}
                >
                  Human
                </button>
                <button
                  onClick={() =>
                    setPlayerTypes((prev) => {
                      const next = [...prev];
                      next[i] = "ai";
                      return next;
                    })
                  }
                  disabled={!!sessionId}
                  className={`rounded-lg px-3 py-1 text-xs font-medium ${
                    playerTypes[i] === "ai"
                      ? "bg-zinc-700 text-zinc-50"
                      : "bg-zinc-200 text-zinc-600 hover:bg-zinc-300"
                  } disabled:opacity-60`}
                >
                  AI
                </button>
              </div>
            ))}
          </div>
          {sessionId ? (
            <p className="mt-4 text-xs text-zinc-700">Session: {sessionId}</p>
          ) : null}
          {error ? (
            <p className="mt-3 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          ) : null}
          {gameEnded ? (
            <p className="mt-3 rounded-lg border border-emerald-400 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800">
              Game over — a player has completed {10} contracts. Use &ldquo;Score Game&rdquo; to see final standings.
            </p>
          ) : null}
        </section>

        {state ? (
          <section className="grid gap-4 lg:grid-cols-[2fr_1fr]">
            <div className="rounded-3xl border border-zinc-900/15 bg-white/80 p-5 shadow-[0_12px_34px_rgba(17,24,39,0.12)]">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-xl font-semibold">Current State</h2>
                <p className="text-sm text-zinc-600">
                  Round {state.roundNumber} | Start: {state.startPlayerId}
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-zinc-300 text-left">
                      <th className="py-2">Player</th>
                      <th className="py-2">Crowns</th>
                      <th className="py-2">Debt</th>
                      <th className="py-2">Equipment</th>
                      <th className="py-2">Company</th>
                      <th className="py-2">Queue</th>
                      <th className="py-2">Completed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.players.map((player) => (
                      <tr key={player.id} className="border-b border-zinc-200/70 align-top">
                        <td className="py-2 font-medium">{player.id}</td>
                        <td className="py-2">{player.crowns}</td>
                        <td className="py-2">{player.debt}</td>
                        <td className="py-2">{player.equipment}</td>
                        <td className="py-2">
                          M:{player.company.melee} R:{player.company.ranged} H:{player.company.mounted}
                        </td>
                        <td className="py-2">{player.queue.map((c) => c.title).join(", ") || "-"}</td>
                        <td className="py-2">{player.completed.length}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="rounded-3xl border border-zinc-900/15 bg-white/80 p-5 shadow-[0_12px_34px_rgba(17,24,39,0.12)]">
              <h2 className="text-xl font-semibold">Latest Round</h2>
              {latestRound ? (
                <div className="mt-3 space-y-3 text-sm">
                  <p>
                    Round {latestRound.roundNumber} | Costed campaigns: {latestRound.campaignResults.length}
                  </p>
                  {latestRound.campaignResults.map((result) => (
                    <div key={result.playerId} className="rounded-xl border border-zinc-300/80 bg-zinc-50 p-3">
                      <p className="font-medium">{result.playerId}</p>
                      <p className="text-xs text-zinc-700">
                        Cost {result.campaignCostPaid} | Spent eq {result.equipmentSpent} | Earned eq {result.equipmentEarned}
                      </p>
                      <p className="text-xs text-zinc-700">
                        Losses M:{result.losses.melee} R:{result.losses.ranged} H:{result.losses.mounted}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-2 text-sm text-zinc-600">No rounds played yet.</p>
              )}
            </div>
          </section>
        ) : null}

        {state && roundMetrics.length > 0 ? (
          <section className="rounded-3xl border border-zinc-900/15 bg-white/85 p-5 shadow-[0_12px_34px_rgba(17,24,39,0.12)]">
            <h2 className="text-xl font-semibold">Player Metrics By Round</h2>
            <p className="mt-1 text-sm text-zinc-700">
              X-axis is round number, Y-axis is metric value, one line per player.
            </p>
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <MetricLineChart
                title="Crowns"
                history={roundMetrics}
                playerIds={chartPlayerIds}
                metric="crowns"
              />
              <MetricLineChart
                title="Melee Troops"
                history={roundMetrics}
                playerIds={chartPlayerIds}
                metric="melee"
              />
              <MetricLineChart
                title="Ranged Troops"
                history={roundMetrics}
                playerIds={chartPlayerIds}
                metric="ranged"
              />
              <MetricLineChart
                title="Mounted Troops"
                history={roundMetrics}
                playerIds={chartPlayerIds}
                metric="mounted"
              />
              <MetricLineChart
                title="Equipment"
                history={roundMetrics}
                playerIds={chartPlayerIds}
                metric="equipment"
              />
              <MetricLineChart
                title="Completed Contracts"
                history={roundMetrics}
                playerIds={chartPlayerIds}
                metric="contracts"
              />
              <RoleSelectionLineChart
                title="Role Selections (Cumulative)"
                history={roleSelectionHistory}
                roles={roleCardsForChart}
              />
            </div>
          </section>
        ) : null}

        {scores ? (
          <section className="rounded-3xl border border-zinc-900/15 bg-white/85 p-5 shadow-[0_12px_34px_rgba(17,24,39,0.12)]">
            <h2 className="text-xl font-semibold">Scores</h2>
            <ol className="mt-3 space-y-2 text-sm">
              {scores.map((score) => (
                <li key={score.playerId} className="rounded-xl border border-zinc-300 bg-zinc-50 p-3">
                  <span className="font-medium">{score.playerId}</span>: {score.totalRenown} renown (contracts {" "}
                  {score.renownFromContracts}, sets {score.renownFromSets}, awards {score.renownFromAwards}, debt penalty -{score.debtPenalty})
                </li>
              ))}
            </ol>
          </section>
        ) : null}

        {state && humanPlayerIds.size > 0 ? (
          <section className="rounded-3xl border border-zinc-900/15 bg-white/85 p-5 shadow-[0_12px_34px_rgba(17,24,39,0.12)]">
            <h2 className="text-xl font-semibold">Manual Battle Mode</h2>
            <p className="mt-2 text-sm text-zinc-700">
              Start a battle for a queued contract, then reroll and mark sacrifices before confirming.
            </p>

            <div className="mt-3 flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1 text-sm">
                Player
                <select
                  value={selectedBattlePlayer}
                  onChange={(e) => {
                    selectBattlePlayer(e.target.value);
                  }}
                  className="min-w-40 rounded-xl border border-zinc-400 bg-white px-3 py-2"
                >
                  {humanPlayerList.map((player) => (
                    <option key={player.id} value={player.id}>
                      {player.id}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col gap-1 text-sm">
                Contract
                <select
                  value={effectiveSelectedBattleContract}
                  onChange={(e) => setSelectedBattleContract(e.target.value)}
                  className="min-w-64 rounded-xl border border-zinc-400 bg-white px-3 py-2"
                >
                  {selectedPlayerContracts.length === 0 ? (
                    <option value="">No queued contracts</option>
                  ) : (
                    selectedPlayerContracts.map((contract) => (
                      <option key={contract.id} value={contract.id}>
                        {contract.title} ({contract.id})
                      </option>
                    ))
                  )}
                </select>
              </label>

              <button
                onClick={startManualBattle}
                disabled={busy || !selectedBattlePlayer || !effectiveSelectedBattleContract}
                className="rounded-xl bg-indigo-700 px-5 py-2 text-sm font-medium text-indigo-50 hover:bg-indigo-600 disabled:opacity-60"
              >
                Start Battle
              </button>
            </div>

            <div className="mt-4 rounded-2xl border border-zinc-300 bg-zinc-50 p-4">
              <p className="text-sm font-medium">Manual Campaign Chain</p>
              <p className="mt-1 text-xs text-zinc-700">
                Select up to 3 queued contracts in order, start campaign, then run battles one-by-one.
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {selectedPlayerContracts.map((contract) => {
                  const checked = selectedCampaignContracts.includes(contract.id);
                  return (
                    <label key={contract.id} className="flex items-center gap-2 rounded-lg border border-zinc-300 bg-white px-2 py-1 text-xs">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          const isChecked = e.target.checked;
                          setSelectedCampaignContracts((prev) => {
                            if (isChecked) {
                              if (prev.length >= 3) {
                                return prev;
                              }
                              return [...prev, contract.id];
                            }
                            return prev.filter((id) => id !== contract.id);
                          });
                        }}
                      />
                      {contract.title}
                    </label>
                  );
                })}
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  onClick={startManualCampaign}
                  disabled={busy || !hasQueuedCampaignSelection}
                  className="rounded-xl bg-violet-700 px-4 py-2 text-xs font-medium text-violet-50 hover:bg-violet-600 disabled:opacity-60"
                >
                  Start Campaign
                </button>
                <button
                  onClick={startNextCampaignBattle}
                  disabled={busy || !manualCampaign || manualCampaign.completed}
                  className="rounded-xl bg-sky-700 px-4 py-2 text-xs font-medium text-sky-50 hover:bg-sky-600 disabled:opacity-60"
                >
                  Start Next Campaign Battle
                </button>
              </div>

              <div className="mt-3 rounded-xl border border-zinc-300 bg-white p-3">
                <p className="text-xs font-medium text-zinc-800">Send troops home before next campaign battle</p>
                <div className="mt-2 grid gap-2 sm:grid-cols-3">
                  {(["melee", "ranged", "mounted"] as TroopType[]).map((type) => {
                    const max = manualCampaign?.activeTroops[type] ?? 0;
                    return (
                      <label key={`send-home-${type}`} className="flex flex-col gap-1 text-xs">
                        <span className="uppercase tracking-wide text-zinc-700">{type}</span>
                        <input
                          type="number"
                          min={0}
                          max={max}
                          value={campaignSendHome[type]}
                          onChange={(e) => {
                            const raw = Number(e.target.value);
                            const safeValue = Number.isFinite(raw) ? Math.max(0, Math.min(max, Math.floor(raw))) : 0;
                            setCampaignSendHome((prev) => ({
                              ...prev,
                              [type]: safeValue,
                            }));
                          }}
                          disabled={!manualCampaign || manualCampaign.completed || busy}
                          className="w-full rounded-lg border border-zinc-300 bg-zinc-50 px-2 py-1"
                        />
                        <span className="text-[11px] text-zinc-600">Max {max}</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              {manualCampaign ? (
                <p className="mt-2 text-xs text-zinc-700">
                  Campaign: {manualCampaign.playerId} | Step {manualCampaign.currentIndex}/{manualCampaign.contractIds.length} | Cost paid {manualCampaign.campaignCostPaid} | Active troops M:{manualCampaign.activeTroops.melee} R:{manualCampaign.activeTroops.ranged} H:{manualCampaign.activeTroops.mounted}
                </p>
              ) : null}
            </div>

            {manualBattle ? (
              <div className="mt-4 space-y-3 rounded-2xl border border-zinc-300 bg-zinc-50 p-4 text-sm">
                <p className="font-medium">
                  {manualBattle.playerId} vs {manualBattle.contractTitle}
                </p>
                <p className="text-xs text-zinc-700">
                  Requirement M:{manualBattle.requirements.melee} R:{manualBattle.requirements.ranged} H:{manualBattle.requirements.mounted} | Equipment spent {manualBattle.equipmentSpent} | Remaining {manualBattle.equipmentRemaining}
                </p>
                <p className="text-xs text-zinc-700">
                  Preview: {manualBattle.preview.willSucceed ? "Will Succeed" : "Will Fail"} | Dead M:{manualBattle.preview.dead.melee} R:{manualBattle.preview.dead.ranged} H:{manualBattle.preview.dead.mounted} | Wounded M:{manualBattle.preview.wounded.melee} R:{manualBattle.preview.wounded.ranged} H:{manualBattle.preview.wounded.mounted}
                </p>

                {(["melee", "ranged", "mounted"] as TroopType[]).map((type) => (
                  <div key={type}>
                    <p className="mb-1 text-xs font-medium uppercase tracking-wide text-zinc-700">{type}</p>
                    <div className="flex flex-wrap gap-2">
                      {manualBattle.rolls[type].map((roll, idx) => {
                        const selected = manualBattle.sacrifices[type].includes(idx);
                        return (
                          <div key={`${type}-${idx}`} className="flex items-center gap-1 rounded-lg border border-zinc-300 bg-white px-2 py-1">
                            <button
                              onClick={() => rerollManualBattleDie(type, idx)}
                              disabled={busy}
                              className="rounded-md bg-zinc-900 px-2 py-1 text-xs text-zinc-50 disabled:opacity-50"
                              title="Reroll die"
                            >
                              {roll}
                            </button>
                            <button
                              onClick={() => toggleManualBattleSacrifice(type, idx)}
                              disabled={busy}
                              className={`rounded-md px-2 py-1 text-xs ${selected ? "bg-rose-600 text-rose-50" : "bg-zinc-200 text-zinc-700"}`}
                              title="Toggle sacrifice"
                            >
                              S
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}

                <button
                  onClick={confirmManualBattle}
                  disabled={busy}
                  className="rounded-xl bg-emerald-700 px-5 py-2 text-sm font-medium text-emerald-50 hover:bg-emerald-600 disabled:opacity-60"
                >
                  Confirm Battle
                </button>
              </div>
            ) : (
              <p className="mt-3 text-sm text-zinc-600">No active manual battle.</p>
            )}
          </section>
        ) : null}
      </main>
    </div>
  );
}
