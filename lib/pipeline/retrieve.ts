import type { AttackMemoryMatch, RetrievedMemory, SearchMemoriesInput } from "../types";
import { getStore } from "../store";
import { getEmbedder } from "../embed";
import { RetrieveMemoriesSchema } from "../validation";

export type RetrieveResult = {
  matches: number;
  results: RetrievedMemory[];
  poisonMatches: AttackMemoryMatch[];
};

export async function retrieveMemories(input: SearchMemoriesInput): Promise<RetrieveResult> {
  const data = RetrieveMemoriesSchema.parse(input);
  const store = getStore();
  const queryEmbedding = await getEmbedder().embed(data.query);
  const [results, poisonMatches] = await Promise.all([
    store.searchMemories({ ...data, queryEmbedding }),
    store.matchPoisonPatterns(queryEmbedding, 3, 0.6),
  ]);
  return { matches: results.length, results, poisonMatches };
}
