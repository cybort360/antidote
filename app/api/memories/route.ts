import { NextResponse } from "next/server";
import { getStore } from "@/lib/store";
import { toErrorBody } from "@/lib/errors";

export async function GET() {
  try {
    const store = getStore();
    const memories = await store.listMemories();
    const filtered = memories.filter((n) => n.kind === "memory" || n.kind === "derived");
    return NextResponse.json(filtered, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const body = toErrorBody(error);
    return NextResponse.json(body.error, { status: body.status });
  }
}
