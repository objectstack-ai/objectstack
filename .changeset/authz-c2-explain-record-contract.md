---
"@objectstack/spec": minor
---

feat(spec): C2-α — extend the `explain` contract to record granularity (#2920)

The access-explanation contract (ADR-0090 D6) now carries the schema for
record-level authorization explanations, so the β-phase engine
(`plugin-security` + `plugin-sharing`) and the Studio/Setup "view as" UI can be
built against a stable wire shape. Contract-only: no engine or UI changes ship
here.

Request side:
- `ExplainRequest.recordId` (optional) — explain one concrete record at row
  granularity. Omitted = the pre-C2 object-level question, answered identically
  (backward compatible).

Response side (row-level attribution, present only for record-grained requests):
- New `ExplainMatchedRule` — a concrete share / sharing rule / ownership fact /
  team / territory / RLS policy / Layer 0 tenant filter that admitted or
  excluded the record at a layer, with its access level (`grants`), how it
  reached the principal (`via`), the row predicate (`predicate`), and its
  `effect` on the record.
- New `ExplainRecordAttribution` — a layer's per-record determination
  (`outcome`, effective `rowFilter`, `matchesRecord`, matched `rules`), attached
  as the optional `ExplainLayer.record`.
- New top-level `ExplainDecision.record` — the row-level bottom line
  (`recordId`, `visible`, `decidedBy`).

Reserved for the ADR-0095 kernel chain (β fills these; optional, backward
compatible):
- New `tenant_isolation` layer id (Layer 0, the always-first tenant wall).
- New `ExplainLayer.kernelTier` (`layer_0_tenant` | `layer_1_business`) so a
  consumer can tell the tenant wall from business RLS without hard-coding ids.
- New `AuthzPosture` enum (`PLATFORM_ADMIN` > `TENANT_ADMIN` > `MEMBER` >
  `EXTERNAL`) exposed as the optional `ExplainDecision.principal.posture`.

Backward compatibility: every new field is optional or additive; existing
object-level requests and reports parse unchanged. The contract test locks the
new field shapes alongside the existing ones.
