import { NextRequest, NextResponse } from "next/server";
import { recordDecision } from "@/lib/pipeline/decision";
import { toErrorBody } from "@/lib/errors";
import { authenticatedPrincipal } from "@/lib/request-identity";

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: { code: "BAD_REQUEST", message: "Invalid JSON body" } }, { status: 400 });
  }
  try {
    const input = body as Parameters<typeof recordDecision>[0];
    const decision = await recordDecision({ ...input, agentId: authenticatedPrincipal(req) ?? input.agentId });
    return NextResponse.json(decision, { status: 201 });
  } catch (error) {
    const response = toErrorBody(error);
    return NextResponse.json(response.error, { status: response.status });
  }
}
