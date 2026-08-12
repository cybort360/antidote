import { NextRequest, NextResponse } from "next/server";
import { recordDerivedMemory } from "@/lib/pipeline/decision";
import { RecordDerivedSchema } from "@/lib/validation";
import { toErrorBody } from "@/lib/errors";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: { code: "BAD_REQUEST", message: "Invalid JSON body" } }, { status: 400 });
  }
  const parsed = RecordDerivedSchema.omit({ decisionId: true }).safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json({ error: { code: "BAD_REQUEST", message: "Invalid request", details: parsed.error.flatten() } }, { status: 400 });
  }
  try {
    const memory = await recordDerivedMemory({ ...parsed.data, decisionId: id });
    return NextResponse.json(memory, { status: 201 });
  } catch (error) {
    const response = toErrorBody(error);
    return NextResponse.json(response.error, { status: response.status });
  }
}
