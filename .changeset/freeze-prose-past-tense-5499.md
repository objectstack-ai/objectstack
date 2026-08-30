---
"@objectstack/spec": patch
---

Restate the dissolved #5499 investment freeze in the past tense at the migration-registry sites that still asserted it as live.

The maintainer lifted the #5499 investment freeze for `driver-mongodb` and `driver-memory` on 2026-08-11 (recorded in the head note of `packages/spec/src/data/aggregation-conformance.ts`), but five sentences in the ADR-0087 migration registry still asserted it in the present tense — three of them citing the freeze as the standing reason a known divergence is not being fixed. Those sentences ship: they are carried by the published `spec-changes.json` and by the generated `docs/protocol-upgrade-guide.md`, so a reader of either was told a premise that expired 18 days earlier.

Each site is re-dated so it records what was true when the ruling was taken, keeping the #5499 anchor rather than deleting it. No ruling is re-argued and no divergence is dispositioned — the rationales all survive losing the freeze premise, and the debts the thaw makes due are left explicitly open for triage.
