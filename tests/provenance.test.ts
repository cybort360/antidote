import { describe, expect, it } from "vitest";
import { createEvidenceProvenance, verifyEvidenceProvenance } from "../lib/provenance";

describe("evidence provenance", () => {
  it("signs and verifies an artifact-bound digest", () => {
    const provenance = createEvidenceProvenance({
      artifactType: "source",
      digest: "a".repeat(64),
      secret: "tenant-signing-secret-with-32-bytes-minimum",
    });
    expect(provenance.signature).toMatch(/^[a-f0-9]{64}$/);
    expect(verifyEvidenceProvenance(provenance, "tenant-signing-secret-with-32-bytes-minimum")).toBe(true);
  });

  it("rejects changed artifact types, digests, and secrets", () => {
    const provenance = createEvidenceProvenance({
      artifactType: "repair",
      digest: "b".repeat(64),
      secret: "tenant-signing-secret-with-32-bytes-minimum",
    });
    expect(verifyEvidenceProvenance({ ...provenance, digest: "c".repeat(64) }, "tenant-signing-secret-with-32-bytes-minimum")).toBe(false);
    expect(verifyEvidenceProvenance(provenance, "different-signing-secret-with-32-bytes")).toBe(false);
  });
});
