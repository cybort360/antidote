import { AntidoteClient } from "../sdk";

const antidote = new AntidoteClient({ baseUrl: process.env.ANTIDOTE_URL, apiKey: process.env.ANTIDOTE_API_KEY });
const recalled = await antidote.retrieve({ agentId: "finance-agent-07", query: "What approval is required for a $24,000 payment?", k: 5 });
const memoryIds = recalled.results.map((result) => result.memory.id);
if (memoryIds.length === 0) throw new Error("No trusted memory evidence returned");

const decision = await antidote.recordDecision({
  agentId: "finance-agent-07",
  memoryIds,
  summary: "Request a second approver before payment",
  idempotencyKey: "payment-24000-decision-v1",
});

const action = await antidote.recordAction(decision.id, {
  actionType: "approval.requested",
  summary: "Second approval requested",
  payload: { amount: 24000, currency: "USD", simulated: true },
  idempotencyKey: "payment-24000-action-v1",
});

console.log({ decision: decision.id, action: action.id, status: action.status });
