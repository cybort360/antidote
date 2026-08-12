import { NextRequest, NextResponse } from "next/server";
import { getStore } from "@/lib/store";
import { toErrorBody } from "@/lib/errors";

export async function GET(req: NextRequest) {
  const limit = Number(req.nextUrl.searchParams.get("limit") ?? "100");
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
    return NextResponse.json({ error: { code: "BAD_REQUEST", message: "limit must be an integer in 1..500" } }, { status: 400 });
  }
  try {
    const contaminations = await getStore().listContaminationEvents(limit);
    return NextResponse.json({ contaminations }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const body = toErrorBody(error);
    return NextResponse.json(body.error, { status: body.status });
  }
}
