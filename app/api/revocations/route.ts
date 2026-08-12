import { NextRequest, NextResponse } from "next/server";
import { computeBlastRadius, executeRepair } from "@/lib/recovery";
import { RevocationSchema } from "@/lib/validation";
import { toErrorBody } from "@/lib/errors";
import { authenticatedPrincipal } from "@/lib/request-identity";

function summarize(plan: Awaited<ReturnType<typeof computeBlastRadius>>) {
  return {
    rootMemoryId: plan.rootMemoryId,
    memories: plan.memoryIds.length,
    derivedMemories: plan.derivedMemoryIds.length,
    decisions: plan.decisionIds.length,
    actions: plan.actionIds.length,
    actionsToCancel: plan.cancelActionIds.length,
    actionsRequiringReview: plan.reviewActionIds.length,
    agents: plan.needsReevaluation.length,
    retrievals: plan.retrievalEventIds.length,
    evidence: plan.evidence.length,
    reevaluations: plan.reevaluations.length,
  };
}

export async function POST(req: NextRequest) {
  let parsed;
  try {
    parsed = RevocationSchema.safeParse(await req.json());
  } catch {
    return NextResponse.json({ error: { code: "BAD_REQUEST", message: "Invalid JSON body" } }, { status: 400 });
  }
  if (!parsed.success) {
    return NextResponse.json({ error: { code: "BAD_REQUEST", message: "Invalid request", details: parsed.error.flatten() } }, { status: 400 });
  }
  try {
    const plan = await computeBlastRadius(parsed.data.memoryId);
    if (!parsed.data.execute) {
      // Dry-run simulation: returns exactly what will be affected; no state changes.
      return NextResponse.json({ mode: "simulation", affected: summarize(plan), plan });
    }
    const result = await executeRepair(plan, { reason: parsed.data.reason, actor: authenticatedPrincipal(req) ?? parsed.data.actor });
    return NextResponse.json({ mode: "repair", affected: summarize(plan), result });
  } catch (error) {
    const body = toErrorBody(error);
    return NextResponse.json(body.error, { status: body.status });
  }
}

export async function GET(req: NextRequest) {
  const memoryId = req.nextUrl.searchParams.get("memoryId");
  if (!memoryId) {
    return NextResponse.json({ error: { code: "BAD_REQUEST", message: "memoryId query parameter is required" } }, { status: 400 });
  }
  try {
    const plan = await computeBlastRadius(memoryId);
    return NextResponse.json({ mode: "simulation", affected: summarize(plan), plan }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const body = toErrorBody(error);
    return NextResponse.json(body.error, { status: body.status });
  }
}
