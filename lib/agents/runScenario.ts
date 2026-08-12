import { isDemo } from "../config";
import { useEmptyDemoStore } from "../store";
import { shortId } from "../hash";
import { runProcurement, type ProcurementResult } from "./procurement";
import { runFinance, type FinanceResult } from "./finance";
import { runOperations, type OperationsResult } from "./operations";
import { runSecurity, type SecurityResult } from "./security";
import { DEFAULT_VENDOR_DOCUMENT } from "./base";

export type ScenarioRunResult = {
  runId: string;
  status: "completed";
  mode: "demo" | "live";
  deterministic: boolean;
  vendorDocument: string;
  procurement: ProcurementResult;
  finance: FinanceResult;
  operations: OperationsResult & {
    decisionId: string;
    derivedMemoryId: string;
    decisionSummary: string;
    decisionDetail: string;
    derivedLabel: string;
    derivedDetail: string;
  };
  security: SecurityResult;
  chain: {
    sourceId: string;
    poisonedMemoryId: string;
    memoryIds: string[];
    derivedMemoryIds: string[];
    decisionIds: string[];
    actionIds: string[];
    agents: { id: string; sessionId: string }[];
  };
};

export type ScenarioRunOptions = {
  repair?: boolean;
  fresh?: boolean;
  vendorDocument?: string;
  deterministic?: boolean;
};

/**
 * The autonomous Zenith poisoning scenario:
 *   Procurement ingests a malicious vendor document → poisoned memory.
 *   Finance retrieves the derived approval and prepares a $24,000 payment.
 *   Operations derives a downstream trusted-vendor memory.
 *   Security determines the originating memory is compromised and repairs it.
 * Each agent runs in its own session; every retrieval is logged; every decision
 * stores the exact memory IDs that influenced it.
 */
export async function runZenithScenario(options: ScenarioRunOptions = {}): Promise<ScenarioRunResult> {
  const runId = shortId("run");
  const demo = isDemo();
  const deterministic = options.deterministic ?? demo;

  if (options.fresh && demo) {
    // Self-contained, reproducible run: start from an empty store in demo mode.
    useEmptyDemoStore();
  }

  const vendorDocument = options.vendorDocument ?? DEFAULT_VENDOR_DOCUMENT;
  const sourceUri = `vendor-policy-${runId}.pdf`;

  const procurement = await runProcurement({ vendorDocument, sourceUri, runId, deterministic });
  const finance = await runFinance({ runId, deterministic });
  const operations = await runOperations({ runId, deterministic, vendorDocument });
  if (!operations.decisionId || !operations.derivedMemoryId || !operations.decisionSummary || !operations.decisionDetail || !operations.derivedLabel || !operations.derivedDetail) {
    throw new Error("The scenario requires approved-supplier evidence before the operations agent runs");
  }
  const security = await runSecurity({ runId, deterministic, memoryId: procurement.poisonedMemoryId, repair: options.repair ?? true });

  const agents = [
    { id: procurement.agentId, sessionId: procurement.sessionId },
    { id: finance.agentId, sessionId: finance.sessionId },
    { id: operations.agentId, sessionId: operations.sessionId },
    { id: security.agentId, sessionId: security.sessionId },
  ];

  return {
    runId,
    status: "completed" as const,
    mode: demo ? "demo" : "live",
    deterministic,
    vendorDocument,
    procurement,
    finance,
    operations: operations as ScenarioRunResult["operations"],
    security,
    chain: {
      sourceId: procurement.sourceId,
      poisonedMemoryId: procurement.poisonedMemoryId,
      memoryIds: procurement.memoryIds,
      derivedMemoryIds: [procurement.derivedMemoryId, operations.derivedMemoryId],
      decisionIds: [procurement.decisionId, ...(finance.decisionId ? [finance.decisionId] : []), operations.decisionId],
      actionIds: finance.actionId ? [finance.actionId] : [],
      agents,
    },
  };
}
