# Assessment: reference-integrity & option-key validation for app metadata (issue #3583)

**Type**: development assessment / landscape (NOT an ADR — this routes work, it does not decide).
**Scope**: the nine bug categories from the HotCRM audit (issue #3583) mapped against the current validation surface — `defineStack` cross-refs (`packages/spec/src/stack.zod.ts`), `@objectstack/lint` rules, and the CLI `validate`/`lint`/`compile` wiring — plus the shared infrastructure the missing rules need.
**Frames**: [ADR-0072](../adr/0072-reference-scope-and-resolvability.md) (reference resolvability — D1 "a reference that cannot resolve is never offered; if typed, it is warned"), [ADR-0078](../adr/0078-no-silently-inert-metadata.md) (completeness gate — lint-not-Zod, one shared predicate per surface, verify-then-enforce ratchet), [ADR-0049](../adr/0049-no-unenforced-security-properties.md) (enforce-or-remove trichotomy), Prime Directive #12 (reject at the producer, never a consumer fallback).
**Method**: two parallel read-only inventories over `packages/spec`, `packages/lint`, `packages/cli`, `packages/platform-objects`, `packages/plugins/plugin-approvals`, cross-checked by hand. File:line references are accurate as of this worktree (2026-07-27).

> **Outcome (see §3):** the ~20 shipped HotCRM instances collapse into **7 lint rules + 3 small hole-fixes + 1 shared resolution substrate**, phased behind the ADR-0078 ratchet. Two categories need a spec decision before any rule can exist (§5 D1/D2); one is honestly not statically checkable (§5 D4).

---

## 1. Category-by-category disposition

Status legend — **G** gap (no check exists) · **P** partial (check exists, this shape escapes) · **B** blocked on a spec decision · **X** not statically checkable.

| # | HotCRM bug class | Authoring surface (spec) | What exists today | Status |
|---|---|---|---|---|
| 1a | `object: 'user'` in a bulk-action lookup param | `ActionParamSchema.reference` / `objectOverride` — `ui/action.zod.ts:99`, `:54` | Nothing. The `.refine()` at `action.zod.ts:133` only demands `reference` be *present* for inline lookup params, never that it resolves. | **G** |
| 1b | `object: 'user'` in dashboard global filters | `GlobalFilterOptionsFromSchema.object` — `ui/dashboard.zod.ts:281` | Nothing — `validate-widget-bindings.ts` checks filter **field bindings** against the dataset object (`DASHBOARD_FILTER_FIELD_UNKNOWN`, `:463`) but never `optionsFrom.object` (grep: zero hits). | **G** |
| 2 | App navigation targeting `sys_approval_process` (registered by nothing) | `ObjectNavItemSchema.objectName` — `ui/app.zod.ts:119`; opt-out `requiresObject` `:71` | `stack.zod.ts:758-797` errors on unknown nav objects, **but**: (a) it walks only `app.navigation`, never `app.areas[].navigation` (`:759`); (b) `requiresObject` skips the check entirely (`:769`) and the *value* of `requiresObject` is verified against nothing; (c) there is no registry of what plugins actually register — `sys_approval_process` exists nowhere (plugin-approvals registers exactly `sys_approval_request/_action/_approver/_token/_delegation`, `approvals-plugin.ts:74`; the process object was removed by ADR-0019). | **P** |
| 3 | `bulkActions: ['mass_update', …]` naming undefined actions | `ListViewSchema.bulkActions: z.array(z.string())` — `ui/view.zod.ts:699` | Nothing. The resolution universe (stack.actions ∪ object.actions) is already computed by `validate-dashboard-action-refs.ts:143-174` — for dashboards only. | **G** |
| 4 | Page headers / KPI cards referencing nonexistent fields | `record:highlights` `fields[].name` (`ui/component.zod.ts:140`), `element:number` `object`+`field` (`:242-253`), `record:details.fields`, `record:path.statusField`, `element:filter.fields`, InterfacePage `columns/sort/filterBy/buttons` (`ui/page.zod.ts:238-266`) — all reached through the untyped `PageComponent.properties` bag (`ui/page.zod.ts:86`) | No page rule resolves fields against objects. `validate-react-page-props` checks required-binding presence + prop-name typos only; `validate-jsx-pages` is parse-level. Field-existence lint exists for forms (`FORM_FIELD_UNKNOWN`), semantic roles, and flow templates — never pages. | **G** |
| 5a | Hook filtering `crm_lead` on a nonexistent `campaign` field | `HookSchema.condition` (CEL) — `data/hook.zod.ts:131` | `validate-expressions.ts:254-261` checks hook conditions against the object's fields — **only when `hook.object` is a single string**; array / `"*"` targets get zero checking (`:259`). `hook.object` existence is checked at `stack.zod.ts:634-647` (own objects only, no platform exemption). | **P** |
| 5b | Hook writing `contact_email`/`contact_phone` to an object without those fields | `HookBodySchema` — opaque JS/expression source (`data/hook-body.zod.ts`) | Nothing, and nothing can: the write set is buried in a `z.string()` JS body. The flow-side analogues (`validate-readonly-flow-writes`, `validate-flow-template-paths`) work because flow nodes declare writes *structurally*. | **X** (§5 D4) |
| 6 | Agent skills listing 11 undefined tools; hand-off to a nonexistent skill; knowledge indexes defined nowhere | `agent.skills` (`ai/agent.zod.ts:166`), `skill.tools` incl. trailing wildcard (`ai/skill.zod.ts:106`), `agent.tools[].name` (`:169`), `agent.knowledge.indexes` (`:37`) | **Zero AI lint rules** (grep `packages/lint/src` for agents/skills/tools/knowledge: no hits). Worse: knowledge indexes have **no definition site in a stack at all** — `KnowledgeSourceSchema` is never referenced by `stack.zod.ts`, so `knowledge.indexes` is unresolvable *by construction*. "Hand-off" has no schema field anywhere (`ZOD_SCHEMA_AUDIT_REPORT.md:131`) — the HotCRM hand-off must live in free-form prompt/config text. | **G** / **B** (§5 D1, D2) |
| 7 | Chart `yAxis` naming raw fields instead of dataset measures | Dashboard `chartConfig` (covered), `ReportChartSchema.yAxis` — a bare *string*, `ui/report.zod.ts:30-34`; `ListChartConfigSchema.values` — `ui/view.zod.ts:437-451`; `<ObjectChart>` react block — `ui/react-blocks.ts:104-115` | `CHART_FIELD_UNKNOWN` exists but is scoped to `stack.dashboards` (`validate-widget-bindings.ts:353`); report charts would be silently skipped even if wired (the `Array.isArray(chartConfig.yAxis)` guard at `:571` vs. the report's string shape); list-view charts and react-page charts have no rule; the `if (!dataset) continue` at `:437` bypasses all chart checks on the raw-config `lint`/`doctor` paths. | **P** |
| 8 | Navigation-exposed objects (`crm_forecast`, `crm_knowledge_article`) granted by no permission set | `stack.permissions[].objects` (`security/permission.zod.ts:257`) × app nav | `buildAccessMatrix` (`packages/lint/src/build-access-matrix.ts`) already computes exactly the needed join input — but no lint rule consumes it (only `compile.ts`'s opt-in `access-matrix.json` snapshot gate). Note: the platform has **no Profile concept** (ADR-0090 D2) — the issue's "profile" reads as permission set + position. | **G** |
| 9 | Translation bundles keyed to nonexistent fields; option translations keyed by label / by values not in the option list | `TranslationDataSchema` — `system/translation.zod.ts:159-327`; option maps keyed by *value* (`:24`) | `computeI18nCoverage` (`cli/src/utils/i18n-coverage.ts`) is forward-only (missing keys). The reverse direction is *specced but unbuilt*: `TranslationDiffStatus 'redundant'` (`translation.zod.ts:614-618`) and `redundantKeys` (`:711`) have **no producer**. Bonus bug found: `i18n-coverage.ts:213` only handles record-map options, but `FieldSchema.options` is canonically an **array** (`data/field.zod.ts:318`) — option coverage silently never fires for canonical select fields. | **G** |

Related but distinct (not in #3583's list, noted for completeness): no static rule anywhere checks that an option **value** referenced in other metadata (kanban group values, `ChartConfig.colors` maps, filter literals) is in the field's option list — write-time enforcement exists (`rule-validator.ts:511`) but metadata literals never hit the write path. Tier-B candidate; see §3 Phase 3.

---

## 2. Two structural root causes (why 20 instances share one shape)

### 2.1 There is no shared resolution substrate — every rule re-derives "what exists" and re-guesses "what might come from elsewhere"

Each existing rule hand-rolls its own known-name collection (`collectKnownTargets` in `validate-dashboard-action-refs.ts:143`, `buildFieldIndex` in `validate-expressions.ts:43`, per-rule object maps in the flow rules) **and** its own strategy for the cross-package unknown. Seven distinct strategies are live today:

| # | Strategy | Where | Failure mode |
|---|---|---|---|
| S1 | `sys_` prefix skip (silent) | `validate-flow-trigger-readiness.ts:114,137` | **False negatives**: `sys_approval_process` sails through; also misses `cloud_`/`ai_` that spec's own `isPlatformObjectName` (`stack.zod.ts:606-608`, unexported) exempts |
| S2 | Warning + "ignore if another package" hint | same rule `:123-126`; `validate-capability-references.ts:112` | Honest but noisy; can't distinguish typo from plugin ref |
| S3 | Bail out when the object isn't resolvable | `validate-flow-template-paths.ts:230`; `validate-readonly-flow-writes.ts:144`; `validate-widget-bindings.ts:447` | Field-level checks silently vanish for any cross-package object |
| S4 | Whole-rule advisory posture | `validate-capability-references.ts:24-29` | Errors that *should* gate (own-stack typos) can't |
| S5 | Severity split by resolvability class | `validate-dashboard-action-refs.ts:250-257` | Correct — the pattern to generalise |
| S6 | "Empty collection ⇒ don't judge" | `stack.zod.ts:775,780,785` | A stack with 1 dashboard gets nav-dashboard checking; a stack with 0 gets none |
| S7 | Author-declared opt-out (`requiresObject`) | `stack.zod.ts:764-774` | Correct in principle, but the declared value itself is verified against nothing |

The `sys_|cloud_|ai_` prefix heuristic is the load-bearing flaw: it encodes "platform objects exist that this stack can't see" as a *namespace guess* instead of a *fact*. `packages/platform-objects` exports no name registry; plugin object registration happens inside `init()` at runtime (`approvals-plugin.ts:67-90`) and is statically invisible; spec's curated `SystemObjectName` map (`system/constants/system-names.ts:22-75`) is real but incomplete (~27 names; no `sys_business_unit`, `sys_notification`, `sys_approval_*`). So today no check — new or old — can tell `sys_user` (real) from `sys_approval_process` (fictional).

**Implication**: before writing category rules, land one shared substrate (§3 Phase 1): an exported platform/plugin object-name registry in `@objectstack/spec` (the `PLATFORM_CAPABILITY_NAMES` precedent, `security/capabilities.ts:53`, already consumed by lint) kept honest by a conformance test in `platform-objects`/plugins (a test bridges the packages without violating the lint → spec-only dependency rule, `packages/lint/src/index.ts:11-12`), plus a `ResolutionContext` helper in `@objectstack/lint` that builds the known-name universes (objects incl. platform registry, per-object field maps, actions, views, datasets+measures, tools/skills/agents, option values per select field) **once** per run and gives every rule the same S5-style resolution ladder (§4).

### 2.2 Placement asymmetry: hard parse errors vs. lint, and `validate`/`lint` wiring drift

The existing coverage is split between `defineStack` hard errors (`validateCrossReferences` in `stack.zod.ts` — hooks→object, view data→object, seeds, mappings, permissions grants, nav, action→flow/page) and `@objectstack/lint` rules — and the two CLI commands run **different rule subsets** (`lint.ts:11-12` wires 9 lint-package rules; `validate.ts:11-24` wires ~15, only partially overlapping; `compile.ts` and `doctor.ts` differ again). ADR-0078 already names this path asymmetry as the enemy. New rules must therefore: (a) live in `@objectstack/lint` as pure `(stack) => Finding[]` functions — *not* new Zod refines, so existing stacks keep parsing (ADR-0078 non-goal #1); (b) be wired into `validate` **and** `lint` (and `compile` where the sibling rules already run) in the same PR that lands them; (c) treat the wiring drift itself as a cleanup item (§5 D5) — a single shared rule-suite runner would prevent the next asymmetry, but is not a prerequisite for these rules.

---

## 3. Proposed work plan

Effort legend: **S** ≤ ~1 day · **M** 2–4 days · **L** ≥ 1 week. Every rule ships with a sibling `.test.ts`, a fixture reproducing its HotCRM instance(s) (§6), and wiring into `validate` + `lint`.

### Phase 0 — verified hole-fixes, no new infrastructure (all S; can land immediately, in parallel)

| Fix | What | Where |
|---|---|---|
| F1 | Walk `app.areas[].navigation` (and nav `children` under areas) in the existing nav cross-ref check — the hole that lets an areas-based app skip all nav validation | `stack.zod.ts:758-797` |
| F2 | i18n coverage: accept the canonical **array** shape of `FieldSchema.options` (mirror `i18n-extract.ts:273-299`) | `cli/src/utils/i18n-coverage.ts:213` |
| F3 | Flag a dataset-less widget on the raw-config path instead of silently skipping all chart checks (`if (!dataset) continue`) — `CHART_CONFIG_MISSING` already exists for the adjacent case | `validate-widget-bindings.ts:437` |
| F4 | Extend hook-condition checking to array-valued `hook.object` (intersect field sets, or check per-object) | `validate-expressions.ts:259` |

### Phase 1 — the shared substrate (M overall; prerequisite for Phases 2–3)

1. **`PLATFORM_PROVIDED_OBJECT_NAMES` in `@objectstack/spec`** — a curated `ReadonlySet<string>` of every object name shipped by `platform-objects` and the official plugins (approvals, security, sharing, webhooks, tenant …), plus exported `isPlatformObjectName()` (today module-private in `stack.zod.ts:606`). Kept honest by conformance tests in the *owning* packages asserting "every object I register is in the spec list, and every list entry with my prefix is registered by someone" — the dependency stays lint → spec only. Follows the `PLATFORM_CAPABILITY_NAMES` precedent exactly.
2. **`ResolutionContext` in `@objectstack/lint`** — one builder producing the known-name universes + a `resolveObject(name)` / `resolveField(object, name)` / `resolveAction(name)` API that returns `own | platform | unknown-platform-prefixed | unknown`, so every rule applies the §4 ladder identically. Existing rules migrate opportunistically (not a big-bang rewrite); new rules use it from day one.
3. **Retire S1 in place**: `validate-flow-trigger-readiness`'s bare prefix skip becomes a registry lookup — unknown `sys_x` turns from silence into a warning. (This is the change that would have caught `sys_approval_process` on every surface at once.)

### Phase 2 — high-value rules on the substrate (each independent once Phase 1 lands)

| Rule | Covers | Resolution universe | Severity | Effort |
|---|---|---|---|---|
| R1 `validate-object-references` | 1a, 1b, and every other bare object ref no rule owns: action-param `reference`/`objectOverride`, dashboard `optionsFrom.object`, page `element:*` `object` / `dataSource.object`, `requiresObject` values (S7's missing verification) | own objects ∪ platform registry | §4 ladder: unknown non-prefixed → **error**; unknown prefixed → warning | M |
| R2 `validate-view-action-refs` | 3 (`bulkActions`; also list-view row/header action name lists that resolve the same way) | stack.actions ∪ object.actions — extract `collectKnownTargets` from `validate-dashboard-action-refs` into the context | **error** (dead button, matches `DASHBOARD_ACTION_TARGET_UNDEFINED` posture) | S |
| R3 `validate-page-field-bindings` | 4 | typed prop-walkers for the known component types (`record:highlights`, `element:number`, `record:details`, `record:path`, `element:filter`, `element:form`, `element:recordPicker`, interface-page config) resolving against the bound object; S3-skip when the object itself is cross-package | **warning** (renderers degrade; matches `FORM_FIELD_UNKNOWN`) — `element:number.field` with aggregate ≠ count arguably error | M |
| R4 `validate-chart-bindings` extension | 7 | report charts (handle the string-`yAxis` shape), list-view `chart.values`/`dimensions`, `<ObjectChart>` react-block axis fields vs. `objectName`'s fields | **error** for own-dataset measure misses (matches `CHART_FIELD_UNKNOWN`) | M |

### Phase 3 — rules needing a join or a decision first

| Rule | Covers | Notes | Effort |
|---|---|---|---|
| R5 `validate-nav-access` | 8 | `buildAccessMatrix` × app nav (own, non-platform objects only): nav-exposed object where no permission set grants read → **warning** (grants may come from another package's set, `adminScope`, or the superuser wildcard — advisory is the honest ceiling, per §2.1 S4 precedent). Optionally also "app hidden by `tabPermissions` for every set". First actual lint consumer of `buildAccessMatrix`. | M |
| R6 `validate-translation-references` | 9 | **Landed 2026-07-28.** The reverse/orphan direction the spec already names (`'redundant'`): bundle keys → objects/fields/views/actions/sections/action-params, apps + nav ids, dashboards + widget ids + header `actionUrl`, `globalActions`; option sub-keys must be option **values** (a key that matches a display label is named as such; near-misses get did-you-mean, plus a namespace-segment pass so `task` suggests `todo_task`). **warning** throughout (orphan keys are inert, not broken). Cross-package objects follow the §4 ladder with S3 intact: a registered platform object is skipped WHOLLY, since its fields are not visible from here. Scope note: `TranslationDataSchema` only — the object-first `AppTranslationBundleSchema` is the `translation` METADATA TYPE, not `stack.translations`, so its keys are skipped rather than reported; `messages`/`validationMessages`/`settings`/`settingsCommon`/`metadataForms` are deliberately unjudged (their keys are owned by code, plugins and the platform registry, so there is no stack-enumerable universe). | M/L → shipped M |
| R7 `validate-ai-references` | 6 (the resolvable subset) | `agent.skills` → stack.skills; `skill.tools` (wildcard-aware) → stack.tools; `agent.tools[].name` → actions/flows by declared type. Kernel-provided skills/tools (`ask`/`build` register theirs at runtime) need either inclusion in the Phase-1 registry or S2 advisory severity — resolve with D2. `knowledge.indexes`/`sources` is **blocked on D1** — do not lint a namespace that has no definition site; that would institutionalise the gap. | M + D1/D2 |
| R8 (Tier-B candidate) option-value literals in metadata | — | kanban group values, `ChartConfig.colors` keys, filter literals vs. select options. High false-positive surface (filters legitimately hold dynamic/user values) — per the ADR-0078 sharing-rule lesson, this gets a verification note *before* it becomes a rule, or it doesn't ship. | ? |

---

## 4. One severity ladder (replaces S1–S4 guesswork)

For any name reference, resolution outcome → disposition:

1. **Resolves in own stack** → OK.
2. **Unresolved, not platform-prefixed** (`user`, `mass_update`, `total_revenue`) → **error**. This is the pure typo class — every one of HotCRM's category-1/3/4 instances lands here. No legitimate cross-package story exists for an unprefixed name referenced by your own metadata.
3. **Unresolved, platform-prefixed, in the registry** (`sys_user`, `sys_business_unit`) → OK.
4. **Unresolved, platform-prefixed, NOT in the registry** (`sys_approval_process`) → **warning**: "no known platform or official-plugin object registers this name; if a third-party package provides it, declare `requiresObject` / suppress". Third-party plugins remain statically unknowable — warning is the honest ceiling, and the explicit opt-out (S7) is the escape hatch.
5. **Explicit opt-outs** — `requiresObject` present (but its value itself goes through this same ladder via R1), `${…}`/`{…}` interpolation, external URLs → skip, per the existing exemption discipline (`validate-dashboard-action-refs.ts:41-46` keeps false positives near zero).

Field-level checks inside a cross-package object stay S3 (skip) — we cannot judge fields of an object we can't see; the ladder only governs the *object/name* layer.

---

## 5. Open decisions (each needs an owner before its dependent rule starts)

- **D1 — knowledge indexes/sources need a definition site or an experimental marker.** `agent.knowledge.indexes` references a namespace with no stack slot (`KnowledgeSourceSchema` is orphaned from `stack.zod.ts`). Per the ADR-0049/0078 trichotomy the current state — parsed, unmarked, unresolvable — is the prohibited fourth state. Either add `knowledgeSources` to the stack (spec change, ADR-worthy) or mark the fields `[EXPERIMENTAL — not enforced]`. R7 is blocked on this for the knowledge half only.
- **D2 — runtime-registered skills/tools vs. static lint.** `ask`/`build` kernel agents register skills/tools via service at boot (same invisibility as plugin objects). Extend the Phase-1 registry with official skill/tool names, or run R7 at S2 advisory severity. Small decision; take it when R7 starts.
- **D3 — where does nav-access belong?** R5-as-lint-warning (proposed) vs. folding into `compile`'s access-matrix snapshot gate. Lint wins on path symmetry (ADR-0078); the snapshot gate stays the drift detector.
- **D4 — hook body writes are not statically checkable, say so.** The write set lives in opaque JS (`hook-body.zod.ts`). Options: (a) accept the gap and document it (hook writes are the one HotCRM category with no static answer); (b) a structured `writes: [field]` declaration on `HookSchema` that the runtime enforces (contract-first, but new spec surface + runtime work); (c) registration-time dev diagnostics (ADR-0078 §4, deferred/evidence-gated there). Recommendation: (a) now, file (b) as its own issue — do not let this category stall the other eight. **Decided 2026-07-27 (#3700): (a); revised 2026-07-28 — (b) dropped, #3700 closed as not planned.** The gap stays documented at the authoring surfaces (`content/docs/automation/hook-bodies.mdx` "Not statically checked: the write set"; `ScriptBodySchema` TSDoc); the documentation is the whole disposition, so ADR-0107, which only recorded it, was withdrawn. (b) will not be built — the declaration duplicates the write set in a second place the author must keep in sync, adding authoring friction and a new error surface (worst for AI authors); in practice, exercising hooks against a SQL driver (in-memory SQLite) covers the failure mode that schemaless `memory://` green lights hide. (c) remains deferred under ADR-0078 §4, unchanged.
- **D5 — rule-suite wiring drift.** `validate`/`lint`/`compile`/`doctor` each hand-pick rule subsets. A shared "run the reference-integrity suite" entry point in `@objectstack/lint` would make the next rule's wiring a one-liner and end the drift. Worth doing with Phase 2, not before.

---

## 6. Verification plan (the ratchet)

Per ADR-0078 §5 and the audit discipline (`2026-06-metadata-functional-completeness.md`: candidates, not bugs — the scariest one collapsed on a three-file read):

1. **HotCRM is the regression corpus.** Each of the ~20 shipped instances becomes a fixture in the owning rule's `.test.ts` (reduced to minimal stacks — HotCRM itself isn't vendored). A rule ships only when it catches its instances *and* runs clean over `examples/`, the showcase app, and the platform seed apps (zero false positives — the ADR-0072 D1 trust contract: one dead finding and authors stop trusting the linter).
2. **Each Phase-2/3 rule lands separately** (one PR each), behind its verification pass. No omnibus "reference integrity" mega-PR.
3. **Phase 1's registry gets conformance tests in the owning packages** the same day the list lands — an unhonest registry is worse than the prefix heuristic it replaces.
4. Re-run the HotCRM audit (or its fixture corpus) after Phase 2 and record the residual: what still passes cleanly and *why* (D1/D2/D4 categories), so the issue can be closed with an explicit accepted-gap statement instead of silence.

## 7. Non-goals

- **No new Zod hard-failures for these categories** — existing stacks must keep parsing (ADR-0078 non-goal #1). Phase 0's F1 extends an *existing* `defineStack` error to a surface it already claimed to cover; everything new is lint.
- **No runtime fallbacks or alias tolerance** for any of these references (Prime Directive #12) — the fix is always at the producer.
- **No static analysis of hook/script JS bodies** (D4) and **no linting of free-form prompt text** (the "hand-off" case) — surfaces without structure are marked, not guessed at.
- **No prefix-heuristic in any new rule** — new rules consume the registry or the ladder, never `startsWith('sys_')`.
