import { NextResponse } from "next/server";

import { runFinishingPositionSimulations } from "@/lib/field-of-honour/simulation";

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      sims?: number;
      maxAttempts?: number;
      guardLimit?: number;
      playerCount?: number;
    };

    const report = runFinishingPositionSimulations({
      sims: body.sims,
      maxAttempts: body.maxAttempts,
      guardLimit: body.guardLimit,
      playerCount: body.playerCount,
    });

    return NextResponse.json(report);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Simulation failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
