import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { screenCandidates } from "@/lib/pipeline/screen";
import { getEmbedder } from "@/lib/embed";
import { toErrorBody } from "@/lib/errors";

const ScreenSchema = z.object({
  text: z.string().min(1).max(8000),
  sourceUri: z.string().trim().max(2048).optional().default("document.txt"),
  label: z.string().trim().max(256).optional().default("candidate"),
});

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: { code: "BAD_REQUEST", message: "Invalid JSON body" } }, { status: 400 });
  }
  const parsed = ScreenSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json({ error: { code: "BAD_REQUEST", message: "Invalid request", details: parsed.error.flatten() } }, { status: 400 });
  }
  try {
    const embedding = await getEmbedder().embed(parsed.data.text);
    const result = await screenCandidates([{ label: parsed.data.label, detail: parsed.data.text, content: parsed.data.text, embedding, sourceUri: parsed.data.sourceUri }]);
    return NextResponse.json({ candidate: result.candidates[0], blocked: result.blocked.length > 0 });
  } catch (error) {
    const response = toErrorBody(error);
    return NextResponse.json(response.error, { status: response.status });
  }
}
