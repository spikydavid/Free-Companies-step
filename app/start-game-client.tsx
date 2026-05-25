"use client";

import { useMemo, useState } from "react";

import { ROLE_PRIORITY } from "@/lib/field-of-honour/priorities";
import {
  createDefaultPlayerKinds,
  startGame,
  type PlayerKind,
  type StartGameResult,
} from "@/lib/field-of-honour/start-game";
import type { Contract } from "@/lib/field-of-honour/types";

interface StartGameClientProps {
  contracts: Contract[];
}

export function StartGameClient({ contracts }: StartGameClientProps) {
  const [playerCount, setPlayerCount] = useState(4);
  const [playerKinds, setPlayerKinds] = useState<PlayerKind[]>(createDefaultPlayerKinds(4));
  const [started, setStarted] = useState<StartGameResult | null>(null);
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
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : "Failed to start game");
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
