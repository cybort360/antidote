import { NextRequest, NextResponse } from "next/server";
import { getStore } from "@/lib/store";
import { recordAttackMemory } from "@/lib/pipeline/security";
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
    const input = body as Parameters<typeof recordAttackMemory>[0];
    const attack = await recordAttackMemory({ ...input, actor: authenticatedPrincipal(req) ?? input.actor });
    return NextResponse.json(attack, { status: 201 });
  } catch (error) {
    const response = toErrorBody(error);
    return NextResponse.json(response.error, { status: response.status });
  }
}

export async function GET(req: NextRequest) {
  const limit = Number(req.nextUrl.searchParams.get("limit") ?? "100");
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
    return NextResponse.json({ error: { code: "BAD_REQUEST", message: "limit must be an integer in 1..500" } }, { status: 400 });
  }
  try {
    const attacks = await getStore().listAttackMemories(limit);
    return NextResponse.json({ attacks }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const body = toErrorBody(error);
    return NextResponse.json(body.error, { status: body.status });
  }
}
