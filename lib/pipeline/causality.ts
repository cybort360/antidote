import type { CausalChain, RetrievalEvent } from "../types";
import { getStore } from "../store";
import { LineageQuerySchema } from "../validation";

export async function getCausalChain(memoryId: string): Promise<CausalChain> {
  const data = LineageQuerySchema.parse({ memoryId });
  return getStore().getCausalChain(data.memoryId);
}

export async function listRetrievalEvents(limit: number, agentId?: string): Promise<RetrievalEvent[]> {
  const store = getStore();
  const events = await store.listRetrievalEvents(limit, agentId);
  return events;
}
