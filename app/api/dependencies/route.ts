import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getStore } from "@/lib/store";
import { toErrorBody } from "@/lib/errors";

const QuerySchema = z.object({
  memoryId: z.string().trim().min(1).max(128),
  direction: z.enum(["down", "up"]).default("down"),
  maxDepth: z.coerce.number().int().min(1).max(50).default(10),
});

export async function GET(req: NextRequest) {
  const parsed = QuerySchema.safeParse({
    memoryId: req.nextUrl.searchParams.get("memoryId"),
    direction: req.nextUrl.searchParams.get("direction") ?? "down",
    maxDepth: req.nextUrl.searchParams.get("maxDepth") ?? "10",
  });
  if (!parsed.success) {
    return NextResponse.json({ error: { code: "BAD_REQUEST", message: "memoryId query parameter is required", details: parsed.error.flatten() } }, { status: 400 });
  }
  try {
    const dependencies = await getStore().getDependencies({ ...parsed.data, maxDepth: parsed.data.maxDepth });
    return NextResponse.json({ rootMemoryId: parsed.data.memoryId, direction: parsed.data.direction, dependencies }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const body = toErrorBody(error);
    return NextResponse.json(body.error, { status: body.status });
  }
}
