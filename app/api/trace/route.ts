import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getStore } from "@/lib/store";
import { runMcpOperation, MCP_CAPABILITIES, MCP_AGENT_ID, MCP_AGENT_LABEL, getMcpBackend } from "@/lib/mcp/client";
import { toErrorBody } from "@/lib/errors";
import { authenticatedPrincipal } from "@/lib/request-identity";

const RunSchema = z.object({
  capability: z.enum(MCP_CAPABILITIES),
  memoryId: z.string().trim().min(1).max(128).optional(),
  agentId: z.string().trim().min(1).max(128).optional(),
});

export async function GET(req: NextRequest) {
  const limit = Number(req.nextUrl.searchParams.get("limit") ?? "50");
  const agentId = req.nextUrl.searchParams.get("agentId") ?? undefined;
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
    return NextResponse.json({ error: { code: "BAD_REQUEST", message: "limit must be an integer in 1..500" } }, { status: 400 });
  }
  try {
    const store = getStore();
    const operations = await store.listMcpOperations(limit, agentId);
    return NextResponse.json({
      agent: { id: MCP_AGENT_ID, label: MCP_AGENT_LABEL },
      provider: getMcpBackend().provider,
      operations,
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const body = toErrorBody(error);
    return NextResponse.json(body.error, { status: body.status });
  }
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: { code: "BAD_REQUEST", message: "Invalid JSON body" } }, { status: 400 });
  }
  const parsed = RunSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json({ error: { code: "BAD_REQUEST", message: "Invalid request", details: parsed.error.flatten() } }, { status: 400 });
  }
  try {
    const params: Record<string, unknown> = {};
    if (parsed.data.memoryId) params.memoryId = parsed.data.memoryId;
    const operation = await runMcpOperation({ agentId: authenticatedPrincipal(req) ?? parsed.data.agentId, capability: parsed.data.capability, params });
    return NextResponse.json({ operation }, { status: 201 });
  } catch (error) {
    const body = toErrorBody(error);
    return NextResponse.json(body.error, { status: body.status });
  }
}
