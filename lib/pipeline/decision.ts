import type { ActionRecord, DecisionRecord, MemoryRecord, RecordActionInput, RecordDecisionInput, RecordDerivedInput } from "../types";
import { getStore } from "../store";
import { getEmbedder } from "../embed";
import { RecordActionSchema, RecordDecisionSchema, RecordDerivedSchema } from "../validation";

export async function recordDecision(input: RecordDecisionInput): Promise<DecisionRecord> {
  const data = RecordDecisionSchema.parse(input);
  return getStore().recordDecision(data);
}

export async function recordAction(input: RecordActionInput): Promise<ActionRecord> {
  const data = RecordActionSchema.parse(input);
  return getStore().recordAction(data);
}

export async function recordDerivedMemory(input: RecordDerivedInput): Promise<MemoryRecord> {
  const data = RecordDerivedSchema.parse(input);
  const embedding = await getEmbedder().embed(data.content ?? data.detail);
  return getStore().recordDerivedMemory({ ...data, embedding });
}
