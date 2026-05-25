"use client";

import { useMemo, useState } from "react";

import type {
  FinalScore,
  ManualCampaignState,
  ManualBattleState,
  PlayerState,
  RoundResult,
  TroopCounts,
  TroopType,
} from "@/lib/field-of-honour";

interface GameSnapshot {
  roundNumber: number;
  startPlayerId: string;
  players: PlayerState[];
}

interface SessionPayload {
  sessionId: string;
  state: GameSnapshot;
  roundHistory: RoundResult[];
}

interface BattlePayload {
  battle?: ManualBattleState;
  error?: string;
}

interface CampaignPayload {
  campaign?: ManualCampaignState;
  error?: string;
}

export default function Home() {
  const createEmptyTroops = (): TroopCounts => ({ melee: 0, ranged: 0, mounted: 0 });
  const [playerCount, setPlayerCount] = useState(2);
  const [seed, setSeed] = useState(7);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [state, setState] = useState<GameSnapshot | null>(null);
  const [roundHistory, setRoundHistory] = useState<RoundResult[]>([]);
  const [scores, setScores] = useState<FinalScore[] | null>(null);
  const [selectedBattlePlayer, setSelectedBattlePlayer] = useState<string>("");
  const [selectedBattleContract, setSelectedBattleContract] = useState<string>("");
  const [selectedCampaignContracts, setSelectedCampaignContracts] = useState<string[]>([]);
  const [campaignSendHome, setCampaignSendHome] = useState<TroopCounts>(createEmptyTroops());
  const [manualCampaign, setManualCampaign] = useState<ManualCampaignState | null>(null);
  const [manualBattle, setManualBattle] = useState<ManualBattleState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const latestRound = useMemo(
    () => (roundHistory.length > 0 ? roundHistory[roundHistory.length - 1] : null),
    [roundHistory],
  );

  async function startSession() {
    setBusy(true);
    setError(null);
    setScores(null);

    try {
      const playerIds = Array.from({ length: playerCount }, (_, i) => `Player ${i + 1}`);
      const res = await fetch("/api/game/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ playerIds, seed }),
      });
      const data = (await res.json()) as SessionPayload & { error?: string };
      if (!res.ok) {
        throw new Error(data.error ?? "Failed to create game session");
      }

      setSessionId(data.sessionId);
      setState(data.state);
      setRoundHistory(data.roundHistory);
      setSelectedBattlePlayer(data.state.players[0]?.id ?? "");
      setSelectedBattleContract(data.state.players[0]?.queue[0]?.id ?? "");
      setSelectedCampaignContracts([]);
      setCampaignSendHome(createEmptyTroops());
      setManualCampaign(null);
      setManualBattle(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create game session");
    } finally {
      setBusy(false);
    }
  }

  async function playRound() {
    if (!sessionId) {
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/game/session/${sessionId}/round`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ auto: true }),
      });
      const data = (await res.json()) as SessionPayload & { error?: string };
      if (!res.ok) {
        throw new Error(data.error ?? "Failed to play round");
      }

      setState(data.state);
      setRoundHistory(data.roundHistory);
      if (data.state.players.length > 0 && !selectedBattlePlayer) {
        setSelectedBattlePlayer(data.state.players[0].id);
      }
      setSelectedCampaignContracts([]);
      setCampaignSendHome(createEmptyTroops());
      setManualCampaign(null);
      setManualBattle(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to play round");
    } finally {
      setBusy(false);
    }
  }

  async function startManualBattle() {
    if (!sessionId || !selectedBattlePlayer || !selectedBattleContract) {
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/game/session/${sessionId}/battle/start`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          playerId: selectedBattlePlayer,
          contractId: selectedBattleContract,
        }),
      });
      const data = (await res.json()) as BattlePayload;
      if (!res.ok || !data.battle) {
        throw new Error(data.error ?? "Failed to start manual battle");
      }
      setManualBattle(data.battle);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start manual battle");
    } finally {
      setBusy(false);
    }
  }

  async function rerollManualBattleDie(type: TroopType, index: number) {
    if (!sessionId || !manualBattle) {
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/game/session/${sessionId}/battle/reroll`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type, index }),
      });
      const data = (await res.json()) as BattlePayload;
      if (!res.ok || !data.battle) {
        throw new Error(data.error ?? "Failed to reroll die");
      }
      setManualBattle(data.battle);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reroll die");
    } finally {
      setBusy(false);
    }
  }

  async function toggleManualBattleSacrifice(type: TroopType, index: number) {
    if (!sessionId || !manualBattle) {
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/game/session/${sessionId}/battle/sacrifice`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type, index }),
      });
      const data = (await res.json()) as BattlePayload;
      if (!res.ok || !data.battle) {
        throw new Error(data.error ?? "Failed to toggle sacrifice");
      }
      setManualBattle(data.battle);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to toggle sacrifice");
    } finally {
      setBusy(false);
    }
  }

  async function confirmManualBattle() {
    if (!sessionId || !manualBattle) {
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/game/session/${sessionId}/battle/confirm`, {
        method: "POST",
      });
      const data = (await res.json()) as {
        state?: GameSnapshot;
        result?: {
          campaign?: {
            active: boolean;
            completed: boolean;
          };
        };
        error?: string;
      };
      if (!res.ok || !data.state) {
        throw new Error(data.error ?? "Failed to confirm manual battle");
      }

      setState(data.state);
      setManualBattle(null);
      if (data.result?.campaign?.completed || data.result?.campaign?.active === false) {
        setManualCampaign(null);
      } else if (data.result?.campaign?.active) {
        const campaignRes = await fetch(`/api/game/session/${sessionId}/campaign`);
        const campaignData = (await campaignRes.json()) as CampaignPayload;
        if (campaignRes.ok && campaignData.campaign) {
          setManualCampaign(campaignData.campaign);
        }
      }
      const active = data.state.players.find((p) => p.id === selectedBattlePlayer);
      setSelectedBattleContract(active?.queue[0]?.id ?? "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to confirm manual battle");
    } finally {
      setBusy(false);
    }
  }

  async function startManualCampaign() {
    if (!sessionId || !selectedBattlePlayer || selectedCampaignContracts.length === 0) {
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/game/session/${sessionId}/campaign/start`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          playerId: selectedBattlePlayer,
          contractIds: selectedCampaignContracts,
        }),
      });
      const data = (await res.json()) as CampaignPayload;
      if (!res.ok || !data.campaign) {
        throw new Error(data.error ?? "Failed to start manual campaign");
      }

      setManualCampaign(data.campaign);
      setCampaignSendHome(createEmptyTroops());
      setManualBattle(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start manual campaign");
    } finally {
      setBusy(false);
    }
  }

  async function startNextCampaignBattle() {
    if (!sessionId || !manualCampaign || manualCampaign.completed) {
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/game/session/${sessionId}/battle/start`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sendHome: campaignSendHome }),
      });
      const data = (await res.json()) as BattlePayload;
      if (!res.ok || !data.battle) {
        throw new Error(data.error ?? "Failed to start next campaign battle");
      }

      setManualBattle(data.battle);
      setCampaignSendHome(createEmptyTroops());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start next campaign battle");
    } finally {
      setBusy(false);
    }
  }

  const selectedPlayerContracts = useMemo(() => {
    if (!state || !selectedBattlePlayer) {
      return [];
    }
    const player = state.players.find((item) => item.id === selectedBattlePlayer);
    return player?.queue ?? [];
  }, [state, selectedBattlePlayer]);

  async function fetchScores() {
    if (!sessionId) {
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/game/session/${sessionId}/score`);
      const data = (await res.json()) as {
        scores?: FinalScore[];
        error?: string;
      };

      if (!res.ok || !data.scores) {
        throw new Error(data.error ?? "Failed to score game");
      }

      setScores(data.scores);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to score game");
    } finally {
      setBusy(false);
    }
  }

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
          {sessionId ? (
            <p className="mt-4 text-xs text-zinc-700">Session: {sessionId}</p>
          ) : null}
          {error ? (
            <p className="mt-3 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
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

        {state ? (
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
                    const nextPlayer = e.target.value;
                    setSelectedBattlePlayer(nextPlayer);
                    const queue = state.players.find((item) => item.id === nextPlayer)?.queue ?? [];
                    setSelectedBattleContract(queue[0]?.id ?? "");
                    setSelectedCampaignContracts([]);
                    setCampaignSendHome(createEmptyTroops());
                    setManualCampaign(null);
                    setManualBattle(null);
                  }}
                  className="min-w-40 rounded-xl border border-zinc-400 bg-white px-3 py-2"
                >
                  {state.players.map((player) => (
                    <option key={player.id} value={player.id}>
                      {player.id}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col gap-1 text-sm">
                Contract
                <select
                  value={selectedBattleContract}
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
                disabled={busy || !selectedBattlePlayer || !selectedBattleContract}
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
                  disabled={busy || selectedCampaignContracts.length === 0}
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
