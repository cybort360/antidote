import { NextRequest, NextResponse } from "next/server";
import { listRetrievalEvents } from "@/lib/pipeline/causality";
import { ListRetrievalsSchema } from "@/lib/validation";
import { toErrorBody } from "@/lib/errors";

export async function GET(req: NextRequest) {
  const parsed = ListRetrievalsSchema.safeParse({
    limit: req.nextUrl.searchParams.get("limit") ?? "100",
    agentId: req.nextUrl.searchParams.get("agentId") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: { code: "BAD_REQUEST", message: "Invalid query", details: parsed.error.flatten() } }, { status: 400 });
  }
  try {
    const events = await listRetrievalEvents(parsed.data.limit, parsed.data.agentId);
    return NextResponse.json({ events }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const body = toErrorBody(error);
    return NextResponse.json(body.error, { status: body.status });
  }
}
