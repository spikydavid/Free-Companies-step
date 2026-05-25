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

const createEmptyTroops = (): TroopCounts => ({ melee: 0, ranged: 0, mounted: 0 });

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

  const selectedPlayerContracts =
    state && selectedBattlePlayer
      ? state.players.find((item) => item.id === selectedBattlePlayer)?.queue ?? []
      : [];

  const effectiveSelectedBattleContract = selectedPlayerContracts.some(
    (contract) => contract.id === selectedBattleContract,
  )
    ? selectedBattleContract
    : selectedPlayerContracts[0]?.id ?? "";

  function resetManualState() {
    setManualCampaign(null);
    setManualBattle(null);
  }

  function resetManualSelectionState() {
    setSelectedCampaignContracts([]);
    setCampaignSendHome(createEmptyTroops());
    resetManualState();
  }

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
      resetManualSelectionState();
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
      resetManualSelectionState();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to play round");
    } finally {
      setBusy(false);
    }
  }

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

  return {
    playerCount,
    setPlayerCount,
    seed,
    setSeed,
    sessionId,
    state,
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
  };
}
