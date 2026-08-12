import { createHmac, timingSafeEqual } from "node:crypto";

export type EvidenceProvenance = {
  artifactType: "source" | "repair";
  digest: string;
  digestAlgorithm: "sha256";
  signature?: string;
  signatureAlgorithm?: "hmac-sha256";
};

export function createEvidenceProvenance(input: {
  artifactType: EvidenceProvenance["artifactType"];
  digest: string;
  secret?: string;
}): EvidenceProvenance {
  const base: EvidenceProvenance = {
    artifactType: input.artifactType,
    digest: input.digest,
    digestAlgorithm: "sha256",
  };
  if (!input.secret) return base;
  return {
    ...base,
    signature: createHmac("sha256", input.secret).update(`${input.artifactType}:${input.digest}`).digest("hex"),
    signatureAlgorithm: "hmac-sha256",
  };
}

export function verifyEvidenceProvenance(provenance: EvidenceProvenance, secret: string): boolean {
  if (!provenance.signature || provenance.signatureAlgorithm !== "hmac-sha256") return false;
  const expected = createEvidenceProvenance({ artifactType: provenance.artifactType, digest: provenance.digest, secret }).signature!;
  const received = Buffer.from(provenance.signature);
  const reference = Buffer.from(expected);
  return received.length === reference.length && timingSafeEqual(received, reference);
}
