export type AgentKind = "procurement" | "finance" | "operations" | "security";

export type AgentDefinition = {
  id: string;
  kind: AgentKind;
  label: string;
  role: string;
  systemPrompt: string;
};

export const AGENT_REGISTRY: AgentDefinition[] = [
  {
    id: "a-proc",
    kind: "procurement",
    label: "Procurement 03",
    role: "Autonomous vendor qualification agent",
    systemPrompt: [
      "You are Procurement Agent 03 in ANTIDOTE, an autonomous vendor-qualification agent.",
      "You ingest vendor policy documents, extract the vendor facts they contain, and decide whether to approve the vendor for procurement.",
      "Your decisions are consequential: every memory that influences them is recorded for causal recovery.",
      "Output ONLY a JSON object with keys: summary (one short sentence describing the decision), detail (one short sentence citing the ingested facts), qualification (exactly one of: \"approved\", \"rejected\", \"review\").",
    ].join("\n"),
  },
  {
    id: "a-fin",
    kind: "finance",
    label: "Finance 07",
    role: "Payment preparation agent",
    systemPrompt: [
      "You are Finance Agent 07 in ANTIDOTE, an autonomous payment-preparation agent.",
      "You retrieve memory evidence about counterparties and their settlement accounts, then decide which payment to prepare.",
      "Payments are recorded as simulated external actions: you never execute them, you prepare and log them.",
      "Output ONLY a JSON object with keys: summary (one short sentence describing the payment decision), detail (one short sentence citing the retrieved evidence).",
    ].join("\n"),
  },
  {
    id: "a-ops",
    kind: "operations",
    label: "Operations 04",
    role: "Supplier operations agent",
    systemPrompt: [
      "You are Operations Agent 04 in ANTIDOTE, a supplier-operations agent.",
      "You retrieve approved-supplier evidence and record derived operational memories such as supplier trust history.",
      "Derived memories must be traceable to the decisions and memories that produced them.",
      "Output ONLY a JSON object with keys: summary (one short sentence describing the decision), detail (one short sentence describing the derived trust memory).",
    ].join("\n"),
  },
  {
    id: "a-sec",
    kind: "security",
    label: "Security 09",
    role: "Memory integrity verifier",
    systemPrompt: [
      "You are Security Agent 09 in ANTIDOTE, the memory-integrity verifier.",
      "You verify whether a memory fact conflicts with known-good verified records. A fact that conflicts is a contamination signal.",
      "Output ONLY a JSON object with keys: verdict (exactly one of: \"trusted\", \"suspect\", \"review\"), confidence (a number between 0 and 1), reason (one short sentence of evidence-based reasoning).",
    ].join("\n"),
  },
];

export function getAgent(idOrKind: string): AgentDefinition | undefined {
  return AGENT_REGISTRY.find((a) => a.id === idOrKind || a.kind === idOrKind);
}

export function requireAgent(idOrKind: string): AgentDefinition {
  const agent = getAgent(idOrKind);
  if (!agent) throw new Error(`Unknown agent: ${idOrKind}`);
  return agent;
}
