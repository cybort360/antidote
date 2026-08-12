import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getStore } from "@/lib/store";
import { toErrorBody } from "@/lib/errors";
import { authenticatedPrincipal } from "@/lib/request-identity";

const CreateSessionSchema = z.object({ agentId: z.string().trim().min(1).max(128) });

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: { code: "BAD_REQUEST", message: "Invalid JSON body" } }, { status: 400 });
  }
  const parsed = CreateSessionSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json({ error: { code: "BAD_REQUEST", message: "Invalid request", details: parsed.error.flatten() } }, { status: 400 });
  }
  try {
    const session = await getStore().getOrCreateSession(authenticatedPrincipal(req) ?? parsed.data.agentId);
    return NextResponse.json(session, { status: 201 });
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
    const sessions = await getStore().listSessions(limit);
    return NextResponse.json({ sessions }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const body = toErrorBody(error);
    return NextResponse.json(body.error, { status: body.status });
  }
}
