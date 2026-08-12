import { NextRequest, NextResponse } from "next/server";
import { getCausalChain } from "@/lib/pipeline/causality";
import { LineageQuerySchema } from "@/lib/validation";
import { toErrorBody } from "@/lib/errors";

export async function GET(req: NextRequest) {
  const parsed = LineageQuerySchema.safeParse({ memoryId: req.nextUrl.searchParams.get("memoryId") });
  if (!parsed.success) {
    return NextResponse.json({ error: { code: "BAD_REQUEST", message: "memoryId query parameter is required", details: parsed.error.flatten() } }, { status: 400 });
  }
  try {
    const chain = await getCausalChain(parsed.data.memoryId);
    return NextResponse.json(chain, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const body = toErrorBody(error);
    return NextResponse.json(body.error, { status: body.status });
  }
}
