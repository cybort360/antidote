import { NextRequest, NextResponse } from "next/server";
import { getStore } from "@/lib/store";
import { toErrorBody } from "@/lib/errors";

export async function GET(req: NextRequest) {
  const limit = Number(req.nextUrl.searchParams.get("limit") ?? "200");
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
    return NextResponse.json({ error: { code: "BAD_REQUEST", message: "limit must be an integer in 1..1000" } }, { status: 400 });
  }
  try {
    const events = await getStore().listAuditEvents(limit);
    return NextResponse.json({ events }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const body = toErrorBody(error);
    return NextResponse.json(body.error, { status: body.status });
  }
}
