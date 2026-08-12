import { NextRequest, NextResponse } from "next/server";
import { ingestDocument } from "@/lib/pipeline/ingest";
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
    const input = body as Parameters<typeof ingestDocument>[0];
    const result = await ingestDocument({ ...input, actor: authenticatedPrincipal(req) ?? input.actor });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    const response = toErrorBody(error);
    return NextResponse.json(response.error, { status: response.status });
  }
}
