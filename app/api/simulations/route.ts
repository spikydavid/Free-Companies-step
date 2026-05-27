import { NextResponse } from "next/server";

import { runFinishingPositionSimulations } from "@/lib/field-of-honour/simulation";

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      sims?: number;
      maxAttempts?: number;
      guardLimit?: number;
      playerCount?: number;
      aiDepotChoiceStrategy?: "random" | "one-turn-rollout";
      aiDepotRolloutTrials?: number;
      aiDraftStrategy?: "random" | "heuristic" | "one-round-rollout";
      aiDraftRolloutTrials?: number;
    };

    const report = runFinishingPositionSimulations({
      sims: body.sims,
      maxAttempts: body.maxAttempts,
      guardLimit: body.guardLimit,
      playerCount: body.playerCount,
      aiDepotChoiceStrategy: body.aiDepotChoiceStrategy,
      aiDepotRolloutTrials: body.aiDepotRolloutTrials,
      aiDraftStrategy: body.aiDraftStrategy,
      aiDraftRolloutTrials: body.aiDraftRolloutTrials,
    });

    return NextResponse.json(report);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Simulation failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
