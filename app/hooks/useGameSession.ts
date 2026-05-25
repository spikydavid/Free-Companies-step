import { useCallback, useEffect, useMemo, useState } from "react";

import type {
  FinalScore,
  ManualCampaignState,
  ManualBattleState,
  PlayerState,
  RoleCard,
  RoundResult,
  TroopCounts,
  TroopType,
} from "@/lib/field-of-honour";

interface GameSnapshot {
  roundNumber: number;
  startPlayerId: string;
  players: PlayerState[];
}

interface PlayerRoundMetrics {
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
  players: PlayerRoundMetrics[];
}

type RoleSelectionCounts = Record<RoleCard, number>;

interface RoleSelectionPoint {
  roundNumber: number;
  counts: RoleSelectionCounts;
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

const createEmptyTroops = (): TroopCounts => ({ melee: 0, ranged: 0, mounted: 0 });

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

function createEmptyRoleSelectionCounts(): RoleSelectionCounts {
  return {
    NEGOTIATOR: 0,
    SURGEON: 0,
    ARMOURER: 0,
    FORAGER: 0,
    PAYMASTER: 0,
    RECRUITER: 0,
    BATTLE_MASTER: 0,
    RETURN_ALL_ROLES: 0,
  };
}

function toRoundMetricsPoint(state: GameSnapshot, roundNumber: number): RoundMetricsPoint {
  return {
    roundNumber,
    players: state.players.map((player) => ({
      playerId: player.id,
      crowns: player.crowns,
      melee: player.company.melee,
      ranged: player.company.ranged,
      mounted: player.company.mounted,
      equipment: player.equipment,
      contracts: player.completed.length,
    })),
  };
}

function extractCardNumberFromId(contractId: string): number {
  return Number.parseInt(contractId.trim().toUpperCase().replace(/^C/, ""), 10);
}

function resolveSelectedCampaignContracts(
  selectedIds: string[],
  queuedContracts: Array<{ id: string; cardNumber: number }>,
): string[] {
  const used = new Set<string>();
  const resolved: string[] = [];

  for (const selectedIdRaw of selectedIds) {
    const selectedId = selectedIdRaw.trim().toUpperCase();
    if (!selectedId) {
      continue;
    }

    const exact = queuedContracts.find(
      (contract) => contract.id.toUpperCase() === selectedId && !used.has(contract.id),
    );
    if (exact) {
      used.add(exact.id);
      resolved.push(exact.id);
      continue;
    }

    const selectedCardNumber = extractCardNumberFromId(selectedId);
    if (!Number.isFinite(selectedCardNumber)) {
      continue;
    }

    const fallback = queuedContracts.find(
      (contract) => contract.cardNumber === selectedCardNumber && !used.has(contract.id),
    );
    if (fallback) {
      used.add(fallback.id);
      resolved.push(fallback.id);
    }
  }

  return resolved;
}

export function useGameSession() {
  const [playerCount, setPlayerCount] = useState(2);
  const [playerTypes, setPlayerTypes] = useState<("human" | "ai")[]>(["ai", "ai"]);
  const [seed, setSeed] = useState(7);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [state, setState] = useState<GameSnapshot | null>(null);
  const [roundHistory, setRoundHistory] = useState<RoundResult[]>([]);
  const [roundMetrics, setRoundMetrics] = useState<RoundMetricsPoint[]>([]);
  const [scores, setScores] = useState<FinalScore[] | null>(null);
  const [selectedBattlePlayer, setSelectedBattlePlayer] = useState<string>("");
  const [selectedBattleContract, setSelectedBattleContract] = useState<string>("");
  const [selectedCampaignContracts, setSelectedCampaignContracts] = useState<string[]>([]);
  const [campaignSendHome, setCampaignSendHome] = useState<TroopCounts>(createEmptyTroops());
  const [manualCampaign, setManualCampaign] = useState<ManualCampaignState | null>(null);
  const [manualBattle, setManualBattle] = useState<ManualBattleState | null>(null);
  const [gameEnded, setGameEnded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function updatePlayerCount(count: number) {
    const clamped = Math.max(2, Math.min(6, count));
    setPlayerCount(clamped);
    setPlayerTypes((prev) => {
      if (clamped > prev.length) {
        return [
          ...prev,
          ...(Array(clamped - prev.length).fill("ai") as ("human" | "ai")[]),
        ];
      }
      return prev.slice(0, clamped);
    });
  }

  const latestRound = useMemo(
    () => (roundHistory.length > 0 ? roundHistory[roundHistory.length - 1] : null),
    [roundHistory],
  );

  const roleSelectionHistory = useMemo<RoleSelectionPoint[]>(() => {
    const running = createEmptyRoleSelectionCounts();
    const points: RoleSelectionPoint[] = [{ roundNumber: 0, counts: { ...running } }];

    for (const round of roundHistory) {
      for (const role of ROLE_CARDS) {
        const selectedCount = Object.values(round.rolesSelectedByPlayer).filter(
          (selectedRole) => selectedRole === role,
        ).length;
        running[role] += selectedCount;
      }

      points.push({
        roundNumber: round.roundNumber,
        counts: { ...running },
      });
    }

    return points;
  }, [roundHistory]);

  const hasHumanPlayers = useMemo(
    () => playerTypes.slice(0, playerCount).some((type) => type === "human"),
    [playerCount, playerTypes],
  );

  const selectedPlayerContracts =
    state && selectedBattlePlayer
      ? state.players.find((item) => item.id === selectedBattlePlayer)?.queue ?? []
      : [];

  const effectiveSelectedBattleContract = selectedPlayerContracts.some(
    (contract) => contract.id === selectedBattleContract,
  )
    ? selectedBattleContract
    : selectedPlayerContracts[0]?.id ?? "";

  const resetManualState = useCallback(() => {
    setManualCampaign(null);
    setManualBattle(null);
  }, []);

  const resetManualSelectionState = useCallback(() => {
    setSelectedCampaignContracts([]);
    setCampaignSendHome(createEmptyTroops());
    resetManualState();
  }, [resetManualState]);

  function selectBattlePlayer(nextPlayer: string) {
    setSelectedBattlePlayer(nextPlayer);
    const queue = state?.players.find((item) => item.id === nextPlayer)?.queue ?? [];
    setSelectedBattleContract(queue[0]?.id ?? "");
    resetManualSelectionState();
  }

  async function startSession() {
    setBusy(true);
    setError(null);
    setScores(null);
    setGameEnded(false);
    setRoundMetrics([]);

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
      setRoundMetrics([toRoundMetricsPoint(data.state, 0)]);
      const firstHumanId = data.state.players.find((_, i) => playerTypes[i] === "human")?.id;
      setSelectedBattlePlayer(firstHumanId ?? data.state.players[0]?.id ?? "");
      const firstHumanQueue = data.state.players.find((_, i) => playerTypes[i] === "human")?.queue;
      setSelectedBattleContract(firstHumanQueue?.[0]?.id ?? "");
      resetManualSelectionState();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create game session");
    } finally {
      setBusy(false);
    }
  }

  const playRound = useCallback(async () => {
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
      const completedRound = data.roundHistory[data.roundHistory.length - 1]?.roundNumber;
      if (completedRound !== undefined) {
        setRoundMetrics((prev) => [
          ...prev,
          toRoundMetricsPoint(data.state, completedRound),
        ]);
      }
      if ((data as { gameEnded?: boolean }).gameEnded) {
        setGameEnded(true);
      }
      if (data.state.players.length > 0 && !selectedBattlePlayer) {
        setSelectedBattlePlayer(data.state.players[0].id);
      }
      resetManualSelectionState();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to play round");
    } finally {
      setBusy(false);
    }
  }, [sessionId, selectedBattlePlayer, resetManualSelectionState]);

  async function startManualBattle() {
    if (!sessionId || !selectedBattlePlayer || !effectiveSelectedBattleContract) {
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
          contractId: effectiveSelectedBattleContract,
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
      if ((data as { gameEnded?: boolean }).gameEnded) {
        setGameEnded(true);
      }
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
      setSelectedCampaignContracts([]);
      setCampaignSendHome(createEmptyTroops());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to confirm manual battle");
    } finally {
      setBusy(false);
    }
  }

  async function startManualCampaign() {
    if (!sessionId || !selectedBattlePlayer) {
      return;
    }

    const filteredContractIds = resolveSelectedCampaignContracts(
      selectedCampaignContracts,
      selectedPlayerContracts,
    );
    if (filteredContractIds.length === 0) {
      setError("Selected campaign contracts are no longer queued. Please re-select contracts.");
      setSelectedCampaignContracts([]);
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
          contractIds: filteredContractIds,
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

  useEffect(() => {
    if (!sessionId || !state || busy || gameEnded || hasHumanPlayers) {
      return;
    }

    const timer = window.setTimeout(() => {
      void playRound();
    }, 350);

    return () => {
      window.clearTimeout(timer);
    };
  }, [sessionId, state, busy, gameEnded, hasHumanPlayers, playRound]);

  return {
    playerCount,
    setPlayerCount: updatePlayerCount,
    playerTypes,
    setPlayerTypes,
    seed,
    setSeed,
    sessionId,
    state,
    roundMetrics,
    scores,
    selectedBattlePlayer,
    selectedBattleContract,
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
    gameEnded,
  };
}
