import { NextRequest, NextResponse } from "next/server";
import { matchPoisonPatterns } from "@/lib/pipeline/security";
import { toErrorBody } from "@/lib/errors";

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: { code: "BAD_REQUEST", message: "Invalid JSON body" } }, { status: 400 });
  }
  try {
    const result = await matchPoisonPatterns(body as Parameters<typeof matchPoisonPatterns>[0]);
    return NextResponse.json(result);
  } catch (error) {
    const response = toErrorBody(error);
    return NextResponse.json(response.error, { status: response.status });
  }
}
