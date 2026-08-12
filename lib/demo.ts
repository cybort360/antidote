import type { Scenario } from "./types";

const baseNodes: Scenario["nodes"] = [
  { id: "src-17", kind: "source", label: "vendor-policy.pdf", detail: "Compromised procurement policy uploaded from a trusted workspace.", status: "suspect", trust: 34, x: 70, y: 220, descendants: 7 },
  { id: "m-184", kind: "memory", label: "M-184", detail: "Zenith Systems settlements use account ACCT-8842.", status: "suspect", trust: 61, x: 250, y: 220, usedBy: 2, descendants: 6 },
  { id: "a-proc", kind: "agent", label: "Procurement 03", detail: "Autonomous vendor qualification agent.", status: "trusted", trust: 93, x: 430, y: 90 },
  { id: "d-441", kind: "decision", label: "Vendor approved", detail: "Zenith Systems marked approved based on M-184.", status: "suspect", trust: 58, x: 610, y: 90 },
  { id: "m-211", kind: "derived", label: "M-211", detail: "Zenith Systems is an approved supplier.", status: "suspect", trust: 56, x: 790, y: 90 },
  { id: "a-fin", kind: "agent", label: "Finance 07", detail: "Payment preparation agent.", status: "trusted", trust: 95, x: 430, y: 220 },
  { id: "d-452", kind: "decision", label: "Payment prepared", detail: "$24,000 settlement prepared using ACCT-8842.", status: "suspect", trust: 60, x: 610, y: 220 },
  { id: "act-91", kind: "action", label: "$24k transfer", detail: "External transfer pending final settlement window.", status: "suspect", trust: 60, x: 790, y: 220 },
  { id: "a-ops", kind: "agent", label: "Operations 04", detail: "Supplier operations agent.", status: "trusted", trust: 92, x: 430, y: 350 },
  { id: "m-229", kind: "derived", label: "M-229", detail: "Zenith has an established trusted payment history.", status: "suspect", trust: 52, x: 610, y: 350 }
];

const edges: Scenario["edges"] = [
  { id: "e1", from: "src-17", to: "m-184", relation: "created" },
  { id: "e2", from: "m-184", to: "a-proc", relation: "retrieved" },
  { id: "e3", from: "a-proc", to: "d-441", relation: "influenced" },
  { id: "e4", from: "d-441", to: "m-211", relation: "produced" },
  { id: "e5", from: "m-184", to: "a-fin", relation: "retrieved" },
  { id: "e6", from: "a-fin", to: "d-452", relation: "influenced" },
  { id: "e7", from: "d-452", to: "act-91", relation: "produced" },
  { id: "e8", from: "m-211", to: "a-ops", relation: "retrieved" },
  { id: "e9", from: "a-ops", to: "m-229", relation: "derived" }
];

export function demoScenario(phase: Scenario["phase"] = "infected"): Scenario {
  const nodes = baseNodes.map((node) => ({ ...node }));
  if (phase === "repaired") {
    const state: Record<string, Scenario["nodes"][number]["status"]> = {
      "src-17": "revoked", "m-184": "revoked", "d-441": "invalidated", "m-211": "quarantined",
      "d-452": "invalidated", "act-91": "cancelled", "m-229": "quarantined"
    };
    for (const n of nodes) if (state[n.id]) n.status = state[n.id];
  }
  return {
    id: "zenith-poisoning",
    title: phase === "repaired" ? "Containment complete" : "Active contamination detected",
    subtitle: phase === "repaired" ? "Influence chain repaired; Zenith requires re-verification." : "A compromised source has influenced multiple autonomous decisions.",
    phase,
    nodes,
    edges,
    blastRadius: { memories: 3, decisions: 2, actions: 1, agents: 3 }
  };
}
