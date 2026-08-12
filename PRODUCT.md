# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Security engineers, AI platform teams, operators, and hackathon judges who need to inspect how a compromised agent memory influenced downstream decisions and actions.

## Product Purpose

ANTIDOTE makes poisoned AI memory reversible. It stores the influence chain from source through memory, retrieval, decision, action, and derived memory, then lets an operator simulate and execute a durable repair.

## Positioning

ANTIDOTE treats memory influence as transactional state. A revocation traces and repairs dependent artifacts instead of deleting the original memory row and losing the consequence trail.

## Operating Context

Users investigate a suspicious memory in a forensic case interface. They inspect lineage, calculate a blast radius, execute a repair, review attack recognition, inspect governed agent trace operations, and read the audit ledger.

## Capabilities and Constraints

- The application has demo and live modes.
- Demo mode uses the in-memory Zenith incident and deterministic fallbacks.
- Live mode requires CockroachDB, optional Bedrock, optional managed CockroachDB MCP, AWS Lambda, and S3 evidence archival.
- Repair preserves history, transitions trust states, cancels pending actions, flags irreversible actions for review, and queues re-evaluations.
- The finance transfer shown in the demo is safely simulated and never executed.
- Existing APIs, interaction semantics, live data, status vocabulary, and accessibility must remain intact through redesign.

## Brand Commitments

- Product name: ANTIDOTE.
- Core line: Causal recovery for poisoned AI memory.
- The user has made immersive creative-development references binding, especially Lando Norris, Bruno Simon, Lusion, Active Theory, Immersive Garden, Unseen Studio, Noomo, Obys, Cyd Stumpel, and David Alaba.
- The experience must keep forensic evidence and repair state legible. It must not imitate reference-site branding, assets, or copy.

## Evidence on Hand

- Product truth: `README.md`, `ARCHITECTURE.md`, `DEVPOST.md`, API routes, core pipeline, and test suites.
- Verified local evidence: typecheck, 100 unit/demo tests, production build, and 16/16 demo release checks.
- No verified live CockroachDB, Bedrock, managed MCP, Lambda, or S3 deployment evidence exists yet.
- No final photography or campaign imagery exists yet. Image prompts will be prepared after the site implementation.

## Product Principles

- Make the causal chain inspectable.
- Simulate before mutation.
- Preserve evidence during containment.
- Keep automated claims distinct from verified live evidence.
- Let future incidents benefit from confirmed attack intelligence.

## Accessibility & Inclusion

- Provide semantic HTML, keyboard-operable controls, visible focus, readable contrast, and reduced-motion behavior.
- Motion and canvas effects must enhance the evidence view without becoming required to understand or operate the product.

## Landing Experience Motion Thesis

- Focal moment: a visible poisoned memory routes a red signal through a causal field. Activating containment reverses that signal in chartreuse and leaves the chain governed and visible.
- Continuity: the primary landing action previews the same blast-radius simulation that appears in the functional case map. The secondary action scrolls directly into that map.
- Feedback: the landing status changes from active contamination to containment complete. The scene also switches direction and color, so the visitor sees what the control changed.
- Budget: one Canvas 2D scene uses one frame loop only while visible and only when reduced motion is off. It pauses when hidden or offscreen. The static canvas remains meaningful without animation.
