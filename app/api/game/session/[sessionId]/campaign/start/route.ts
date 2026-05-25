import { NextResponse } from "next/server";

import { getSession, startManualCampaignSession } from "@/lib/field-of-honour/session-store";

interface Params {
  params: Promise<{ sessionId: string }>;
}

interface StartCampaignBody {
  playerId?: string;
  contractIds?: string[];
}

function extractCardNumberFromId(contractId: string): number {
  return Number.parseInt(contractId.trim().toUpperCase().replace(/^C/, ""), 10);
}

function resolveCampaignContractIds(
  requestedContractIds: string[],
  queuedContracts: Array<{ id: string; cardNumber: number }>,
): string[] {
  const used = new Set<string>();
  const resolved: string[] = [];

  for (const requestedIdRaw of requestedContractIds) {
    const requestedId = requestedIdRaw.trim().toUpperCase();
    if (!requestedId) {
      continue;
    }

    const exact = queuedContracts.find(
      (contract) => contract.id.toUpperCase() === requestedId && !used.has(contract.id),
    );
    if (exact) {
      used.add(exact.id);
      resolved.push(exact.id);
      continue;
    }

    const requestedCardNumber = extractCardNumberFromId(requestedId);
    if (!Number.isFinite(requestedCardNumber)) {
      continue;
    }

    const fallback = queuedContracts.find(
      (contract) => contract.cardNumber === requestedCardNumber && !used.has(contract.id),
    );
    if (fallback) {
      used.add(fallback.id);
      resolved.push(fallback.id);
    }
  }

  return resolved;
}

export async function POST(request: Request, { params }: Params) {
  const { sessionId } = await params;
  const session = getSession(sessionId);
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const body = (await request.json().catch(() => ({}))) as StartCampaignBody;

  try {
    if (!body.playerId || !body.contractIds || body.contractIds.length === 0) {
      return NextResponse.json(
        { error: "playerId and at least one contractId are required" },
        { status: 400 },
      );
    }

    const player = session.engine.getState().players.find((item) => item.id === body.playerId);
    if (!player) {
      return NextResponse.json({ error: "Player not found" }, { status: 400 });
    }

    const resolvedContractIds = resolveCampaignContractIds(body.contractIds, player.queue);
    if (resolvedContractIds.length === 0) {
      return NextResponse.json(
        {
          error: "None of the selected campaign contracts are currently queued for this player",
          playerId: body.playerId,
          requestedContractIds: body.contractIds,
          queuedContractIds: player.queue.map((contract) => contract.id),
        },
        { status: 400 },
      );
    }

    const campaign = startManualCampaignSession(sessionId, body.playerId, resolvedContractIds);
    return NextResponse.json({ sessionId, campaign });
  } catch (error) {
    const player = body.playerId
      ? session.engine.getState().players.find((item) => item.id === body.playerId)
      : undefined;
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to start manual campaign",
        playerId: body.playerId,
        requestedContractIds: body.contractIds,
        queuedContractIds: player?.queue.map((contract) => contract.id) ?? [],
      },
      { status: 400 },
    );
  }
}
