---
"@objectstack/spec": minor
"@objectstack/objectql": minor
"@objectstack/plugin-security": minor
---

feat(security): the Layer 0 tenant wall records its verdict on the operation, and the bulk data-event producer reads it instead of re-deriving the wall

`BulkDataEventSchema.organizationId` is stamped on a `data.records.updated` / `data.records.deleted` event only when the Layer 0 tenant wall named exactly one organization for the whole predicate write. The producer (`publishBulkDataEvent`, `@objectstack/objectql`) used to decide that by re-deriving the wall's inputs — posture, context, and the object's own tenancy clauses. It could never see the third clause plugin-security folds into `tenancyDisabled`: the deployment-declared `platformGlobalObjects` carve-out (#12699). On such an object under an armed wall the producer stamped the caller's organization while Layer 0 had composed no wall at all — a wrong key asserting "every affected record belongs to this organization" over a batch that could span several, the #13566 leak shape reappearing on the bulk path (#15706).

Ruled on #15706 (seam (i), ADR-0131 D8 「一道谓词，算一次」): the wall records what it decided, and the reader composes nothing.

- **`@objectstack/spec`** — new export `TenantLayer0VerdictSchema` / `TenantLayer0Verdict` (`@objectstack/spec/security`): the four verdicts a Layer 0 wall can reach for one operation — `none`, `organization`, `organizations`, `deny`. Additive.
- **`@objectstack/objectql`** — `OperationContext` gains an optional member `tenantLayer0Verdict`, written by the enforcement layer at the moment it composes the wall onto the operation's predicate. Additive widening of a published surface, hence `minor`. `publishBulkDataEvent` now reads that member and nothing else: a recorded `organization` (or a one-member `organizations`) verdict stamps the key; `none`, `deny`, a multi-member set, a malformed value, or NO recorded verdict all omit it. The engine no longer consults the enforced posture, the execution context or the object schema to answer the question — the mirror is deleted, not moved.
- **`@objectstack/plugin-security`** — the engine middleware records `opCtx.tenantLayer0Verdict` on every operation whose predicate it composes the wall onto (reads and predicate writes); `computeTenantLayer0Filter` is now a projection of the new `computeTenantLayer0Verdict`, so the recorded verdict and the injected predicate come from one computation. An on-behalf-of write records the intersection of the caller's and the delegator's walls. System contexts and by-id writes record nothing (no wall is composed for them).

What moves, and in which direction: a deployment-exempted object under an armed wall now publishes `organizationId` ABSENT (it was wrongly present); a `PLATFORM_ADMIN` rung on a PUBLIC tenant object now publishes it PRESENT (the wall stands there; it was conservatively absent); a hand-built context with no rung is answered by the plugin's capability probe rather than conservatively absent. Every population the previous producer answered correctly is unchanged.
