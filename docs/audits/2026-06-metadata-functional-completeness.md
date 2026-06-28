# Audit: Metadata functional-completeness — "valid-but-inert" authored instances

**Date**: 2026-06-28
**Lens**: per-*instance* functional completeness (distinct from the per-*property* liveness audits in this directory)
**Method**: 5 blind-angle parallel investigators across `framework` + `cloud`, then synthesis with adversarial verification of the highest-stakes finds.
**Drives**: [ADR-0078](../adr/0078-no-silently-inert-metadata.md) (no-silently-inert-metadata gate)
**Relates to**: ADR-0049 (enforce-or-remove, property level), ADR-0054 (prove-it-runs, integration level), ADR-0077 (authoring-surface routing), ADR-0038 (build-verification-loop), the #1878 property-liveness audit cluster.

---

## What this audit is (and is NOT)

The existing `docs/audits/*-property-liveness.md` set answers: **"does any runtime code read property P?"** (the type-level question ADR-0049's ledger tracks). That audit found ~half of all spec *properties* dead.

This audit answers a different, **instance-level** question:

> A metadata node passes its Zod schema (so authoring tools accept it and report success), and its properties are individually *live* (a consumer reads them) — yet the authored **instance** is **runtime-DEAD** because it omits a sibling/dependent config the consumer needs, and the consumer **silently no-ops** rather than erroring.

The canonical case (fixed in [cloud#687](https://github.com/objectstack-ai/cloud/pull/687)): a `summary` field is authored as `{type:'summary'}` with no `summaryOperations`. `summaryOperations` is a *live* property (the engine reads it). The `summary` *type* is *live* (the engine's `buildSummaryIndex` reads it). But this **instance** is dead: `engine.ts:1669` `if (!d.summaryOperations) continue` silently skips it, so it reads `0`/null everywhere — and any formula dividing by it (an "occupancy rate") is stuck at 0, while the AI reports *"上座率做好了 / the rate is ready."*

Neither existing gate catches this:
- **Liveness ledger (ADR-0049)** is per-property: `summaryOperations` IS live, so the ledger is green.
- **Prove-it-runs (ADR-0054)** proves a *correctly-authored* instance runs; it does not assert that an *incompletely-authored* but Zod-valid instance is rejected at author time.
- **Gate 1 (authoring-validity lint)** is where this belongs — and it is **incompletely and asymmetrically implemented** (see below).

## Why it matters more when the author is an AI

A human who authors a bare summary sees the field render `0`, gets suspicious, and digs in. An AI emits the field, receives a success envelope, and confidently reports it done — the review step that catches the human's mistake is the step AI authoring removes. "Valid-but-inert" is therefore *worse than a hard error*: it manufactures a false sense of completion. This is the same asymmetry ADR-0049 names for security properties ("false sense of compliance") and ADR-0054 names for integration ("ships silently into a third-party app"), applied to per-instance completeness.

## The structural gap: Gate 1 is path-dependent and asymmetric

Field/instance-completeness checks today live **only in the cloud AI-build graph-lint** (`packages/service-ai-studio/src/verify/graph-lint.ts`, ADR-0038): `formula_without_expression`, `summary_missing_operations`, `select_without_options`, the `flow_*` family, `empty_dashboard`, etc. The framework's own `@objectstack/lint` (`packages/lint/src/`, run by `os build`/`os validate`/`os lint`) covers **expressions** (`validate-expressions`), **widget bindings** (`validate-widget-bindings`), and **SDUI styling** (`validate-responsive-styles`) — but **no field-level or view/action/automation completeness**. `formula_without_expression` does **not** exist anywhere in the framework.

Consequence: a stack authored by **any non-cloud surface** — `os` CLI + a coding assistant, an MCP agent, `os validate` in CI, a hand author — gets **none** of the instance-completeness coverage. As AI authoring fans out across surfaces, locking the checks to one surface means every other surface re-discovers the same dead-instance bugs independently.

## Method

Five parallel investigators, each blind to the others (multi-modal sweep so one lens' blind spot is covered by another):

1. **Runtime silent-skip hunter** — sites in `objectql`/automation that consume optional config and silently no-op when absent (`if (!x) continue`, guard-with-no-else).
2. **Schema-optionality auditor** — config that is `.optional()` (or unenforced cross-field) in `@objectstack/spec` yet runtime-required.
3. **Lint coverage-gap mapper** — the full coverage map of cloud graph-lint + framework `@objectstack/lint`, and the delta.
4. **Per-metadata-type contract auditor** — the minimal "will-it-run" contract per type and whether anything enforces it.
5. **Authoring-path config-drop hunter** — cloud build-agent paths that silently drop functional config during materialization.

The angles cross-validated strongly (the high-confidence items below were each surfaced by ≥2 investigators).

---

## Catalog

Confidence: **✓** verified in this audit / confirmed by cloud#687 · **~** corroborated by ≥2 investigators, not independently re-verified · **?** single-source, needs verification before acting. "Ships dead": **Y** silent (no error, no warn) · **WARN** logs only · **N** thrown/Zod-rejected (not actually inert).

### Tier A — confirmed or strongly corroborated; silently ships dead; AI-likely

| # | construct | evidence (file:line) | author-omission → inert | dead? | conf |
|---|---|---|---|---|---|
| A1 | **Authoring-path config-drop** — `objectBody` allow-lists only `{type,label,required,reference,options}`; `editBuildFieldDef` similar; `BlueprintFieldSchema` has **no slot** for `summaryOperations`/`expression`/`defaultValue`/`precision`/`referenceFilters`/`deleteBehavior`/`autonumberFormat`; granular tool `type` enums **exclude** `summary,master_detail,currency,percent,user` | cloud `blueprint-tools.ts:1037`, `metadata-tools.ts:2614`, `create-object.tool.ts`; spec `solution-blueprint.zod.ts` | model authors a roll-up/typed-money/scoped-lookup correctly → materialization strips it → dead shell | Y | ✓ |
| A2 | **action without `locations`** → button never renders anywhere | spec `action.zod.ts:250` (`.optional()`, no default); runtime `ActionEngine.ts:197` filters by `locations.includes(...)` | omit `locations` (or author a "button" with no handler) | Y | ~ |
| A3 | **lookup/master_detail without `reference`** → relationship silently absent | spec `field.zod.ts:405` (`reference` optional); engine `engine.ts:1776` `$expand` `if (!reference) continue` | omit `reference` | Y | ~ |
| A4 | **calendar/gantt/kanban view with no config block** → blank | `view.zod.ts:569-570` blocks `.optional()`; `ObjectView.tsx` injects default field names (`start_date`/`status`) so it *renders* but is empty when the object lacks those literal fields | omit the `calendar`/`gantt`/`kanban` block | Y | ~ |
| A5 | **Gate-1 coverage asymmetry** — field/instance completeness exists only in cloud graph-lint, not `@objectstack/lint` | coverage map (method §3) | author via `os`/MCP/hand → no completeness lint at all | — | ✓ |

### Tier B — plausible; verify before acting

| construct | evidence (claimed) | dead? | conf |
|---|---|---|---|
| `select`/`multiselect` without options **disables server-side value validation** (any value accepted, not just empty UI) | `record-validator.ts:205,212` (`allowed.length>0` gate) | Y | ? |
| **No write-side referential integrity** — bad `reference`/FK value persists; only read-time `$expand` notices | `record-validator.ts:222-225`; engine has no write-side FK check | Y | ? |
| `unique:true` is a **no-op on the memory driver** (default dev/test/serverless) + no engine-level uniqueness backstop | `driver-memory` ~`:148/:332/:378` | Y | ? |
| **composite/repeater/record sub-field constraints unenforced** — stored as opaque JSON | record-validator/engine: no sub-field handling | Y | ? |
| **approval with empty/unresolvable `approvers`** → request opens, suspends flow forever | `approval-service.ts:455/484/537,316` | Y | ? |
| **app nav targets of type page/report/url/component/action unchecked** → 404 on click | cloud `graph-lint.ts:730-754` checks only object+dashboard | Y | ~ |
| **dataset with zero measures** → starves every bound widget | `dataset.zod.ts:133-134` arrays present but no `.min(1)` | Y | ? |
| **webhook with no triggers** never auto-fires; **schedule trigger with syntactically-invalid cron** passes the trigger layer | `auto-enqueuer.ts:215`; `schedule-trigger.ts:64-67` | Y | ? |
| **autonumber / file / vector** field types — zero functional-completeness coverage (vector is `@planned`, not a regression) | `field.zod.ts:521-523`; driver `vectorSearch:false` | Y/N-A | ? |

### Tier C — lower severity / by-design / perf (record, do not rush)

`precision`/`scale`/`indexed`/index `type`/`partial` are no-ops on most/all drivers (perf/cosmetic, not dead-feature) · fail-open CEL predicates are warn-only **by documented design** (ADR-0058 fail-policy) · `vector` semantic search is roadmapped, not a regression.

---

## Worked correction: the "sharing-rule fail-open" candidate was wrong

Investigator 4 flagged, as a P0 security hole, that a criteria sharing rule with an empty `condition` fails **open** (shares every record). **Verified false:**

- `CriteriaSharingRuleSchema.condition` is **required** — `sharing.zod.ts:79` is `ExpressionInputSchema` with **no `.optional()`** (the claim of `.optional()` was a misread).
- `ExpressionInputSchema = z.union([ z.string().min(1).transform(...), ExpressionSchema ])` — the string branch **rejects empty** (`.min(1)`).
- The bootstrap's "empty condition = match-all" branch (`bootstrap-declared-sharing-rules.ts:105`) is intentional and **gated**; the file's whole design (per its header + ADR-0049) is to **skip** untranslatable/owner rules rather than seed a permissive match-all.

So the natural authoring path **cannot** silently drop the predicate. Residual: only a hand-crafted `{dialect,source:''}` envelope or a direct `sys_sharing_rule` row could reach the match-all branch — worth a one-line belt-and-suspenders guard, **not a P0**. This is consistent with ADR-0049 already being *applied* to `SharingRuleSchema` (#1887). 

**Lesson** (it sets the disposition for the whole catalog): the audit produces *candidates*, not confirmed bugs. The scariest one collapsed on a 3-file read. Every Tier-A/B item gets a verification pass before it becomes a lint rule.

---

## Disposition (feeds ADR-0078)

- **Enforce now** (v1 ratchet — high confidence, high AI-likelihood): A1 (authoring config-drop, cloud), A2 (action completeness), A3 (relationship `reference`), A4 (date-view binding) — as the seed of a **shared functional-completeness predicate** consumed by both `@objectstack/lint` and cloud graph-lint.
- **Verify, then enforce**: Tier B, each behind a 1–3 file confirmation (the sharing-rule lesson).
- **Mark `experimental` / leave**: Tier C and vector (roadmapped) — per the ADR-0049 `[EXPERIMENTAL — not enforced]` convention, not a silent parse.
