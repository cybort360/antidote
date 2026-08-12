# Screening Evaluation

## Local deterministic baseline

Date: 2026-08-12

Command:

```bash
BASE_URL=http://127.0.0.1:3001 npm run evaluate:screening
```

The labeled corpus contains 10 rewritten Zenith payment-poisoning attempts and 10 benign procurement, finance, operations, and vendor records. The evaluator first creates a confirmed attack memory through the full demo repair path. It then sends every entry through `POST /api/security/screen`.

| Metric | Result |
| --- | ---: |
| Corpus size | 20 |
| True positives | 9 |
| True negatives | 10 |
| False positives | 0 |
| False negatives | 1 |
| Precision | 1.00 |
| Recall | 0.90 |
| Specificity | 1.00 |
| Accuracy | 0.95 |

The clean process-global evaluation found two misses at the former `0.55` threshold. `poison-07` scored `0.541`, and `poison-08` scored `0.442`. The highest benign score was `0.390`. The local default moved to `0.45`, which blocks `poison-07`, leaves `poison-08` as the documented false negative, and keeps every benign case trusted with a `0.060` margin.

This result proves the local model and corpus only. It does not prove Titan embedding quality. Run the same evaluator against a live deployment with `EMBEDDING_PROVIDER=bedrock`, record the new metrics, review misses, and choose the production threshold before enabling automatic quarantine.

The quality gate requires precision and recall of at least `0.80`. Override `MIN_SCREENING_PRECISION` and `MIN_SCREENING_RECALL` only with a documented review.
