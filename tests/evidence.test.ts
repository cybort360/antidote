import { afterEach, describe, expect, it } from "vitest";
import { archiveEvidence, archiveSourceDocument } from "../lib/evidence";

describe("evidence archival boundary", () => {
  const previousBucket = process.env.EVIDENCE_BUCKET;
  const previousRegion = process.env.AWS_REGION;
  const previousSigningSecret = process.env.EVIDENCE_SIGNING_SECRET;

  afterEach(() => {
    if (previousBucket === undefined) delete process.env.EVIDENCE_BUCKET;
    else process.env.EVIDENCE_BUCKET = previousBucket;
    if (previousRegion === undefined) delete process.env.AWS_REGION;
    else process.env.AWS_REGION = previousRegion;
    if (previousSigningSecret === undefined) delete process.env.EVIDENCE_SIGNING_SECRET;
    else process.env.EVIDENCE_SIGNING_SECRET = previousSigningSecret;
  });

  it("returns explicit non-archived evidence URIs without AWS configuration", async () => {
    delete process.env.EVIDENCE_BUCKET;
    delete process.env.AWS_REGION;
    const repair = await archiveEvidence("repairs/repair-1.json", { safe: true });
    expect(repair).toMatchObject({
      archived: false,
      uri: "demo://evidence/repairs/repair-1.json",
      provenance: { artifactType: "repair", digestAlgorithm: "sha256" },
    });
    const source = await archiveSourceDocument({ sourceUri: "vendor.pdf", content: "verified" });
    expect(source).toMatchObject({
      archived: false,
      uri: "demo://sources/vendor.pdf",
      provenance: { artifactType: "source", digestAlgorithm: "sha256" },
    });
    expect(repair.provenance.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(source.provenance.digest).toMatch(/^[a-f0-9]{64}$/);
  });
});
