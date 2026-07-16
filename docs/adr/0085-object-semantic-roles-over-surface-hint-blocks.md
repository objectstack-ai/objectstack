# ADR-0085: Presentation intent on an object is declared as cross-surface semantic roles, never as per-surface hint blocks (delete `detail`, retire `views.*`, type `stageField`)

**Status**: Accepted (2026-07-16) — proposed 2026-07-02; execution complete through PR4 + real-backend verification, see the as-built addendum
**Deciders**: ObjectStack Protocol Architects
**Builds on**: [ADR-0049](./0049-no-unenforced-security-properties.md) (enforce-or-remove trichotomy), [ADR-0078](./0078-no-silently-inert-metadata.md) (completeness gate; "AI is the author, silent no-op manufactures false completion"), [ADR-0032](./0032-unified-expression-layer.md) (validate-by-default, no silent failure), ADR-0079 (`nameField` — the canonical object-level semantic-role precedent)
**Supersedes**: the `detail.*` passthrough-block approach adopted by [objectui#2065](https://github.com/objectstack-ai/objectui/issues/2065) and proposed in [objectui#2148](https://github.com/objectstack-ai/objectui/issues/2148) §方案-6 (that mechanism was the right escape hatch *given* the spec of the day; this ADR replaces the mechanism, not the goals — both issues' goals ship)
**Consumers**: `@objectstack/spec` (`ObjectSchema`), `@object-ui` (plugin-detail synth, plugin-form, app-shell `RecordDetailView`, object designer), templates/examples, the `objectstack-ui` authoring skill, cloud AI-build prompts
**Surfaced by**: the objectui [PR #2149](https://github.com/objectstack-ai/objectui/pull/2149) review — wiring `fieldGroups` into detail pages exposed the full pathology of the hint channels (inventory below)

---

## TL;DR

The object protocol accumulated **three parallel channels** for "how should this object present itself", and every one of them is broken in a way invisible to its authors:

| Channel | State found (2026-07) |
|---|---|
| `objectDef.views.*` (`views.form.sections`, `views.detail.highlightFields`, …) | Readers-only legacy. `ObjectSchema.create()` rejects the key; **zero authors** exist in framework or objectui (examples, templates, packages, docs all grepped). Dead code with a doc trail that still teaches it. |
| `detail: { … }.passthrough()` | Spec types 3 keys; the UI reads **9**. Of the typed keys, `hideReferenceRail` is a **no-op for spec authors** (the rail is default-off and the only enabling key, `showReferenceRail`, is untyped — spec typed the useless half of the pair). Passthrough bred wild riders (`relatedLayout`, `showReferenceRail`) that parse fine and do whatever the console of the week does. |
| `fieldGroups[]` (typed, ADR-worthy MVP) | **Two-way key drift**: spec declares `defaultExpanded`/`icon`/`description`/`visibleOn` — no UI consumer reads any of them; the UI (form + detail) reads `collapsible`/`collapsed` — the spec rejects/strips both. Designer-authored objects (bare-key DB hydration) collapse correctly; spec-authored packages silently can't. |

Each key individually looks like a small fix. The **generator** of the bug class is architectural: a per-surface hint block plus passthrough invites every surface to mint its own dialect, and none of the three gates (validity lint, liveness ledger, prove-it-runs) sees the drift because each key is "valid" somewhere.

**Decision.** An object declares presentation intent **only as object-level semantic roles** — facts about the data a machine cannot infer, consumed by *every* surface: `nameField` (what a record is called), `highlightFields` (which fields matter most — **renamed from `compactLayout`** via the ADR-0079 alias pattern), `stageField` (which field is the linear lifecycle; `false` = declared non-linear), `fieldGroups` (how fields cluster semantically). The `detail` block is **deleted** and `views.*` readers are **deleted**. Per-surface presentation toggles are **rejected at this layer** — full-page control already exists via assigned pages.

---

## Context

objectui#2148 set out to make the detail page honour `fieldGroups` (only forms did) and discovered along the way that every detail-page hint the console documented was written on keys the spec rejects. PR #2149 fixed both correctly *within the rules of the day*: it routed hints through the one spec-writable location — the passthrough `detail` block. Reviewing that PR, we inventoried the entire hint surface across both repos and found the table above.

Three observations turn this from cleanup into an architecture decision:

1. **The bug class regenerates.** `views.*` was objectui's pre-spec dialect; when spec rejected it, authors routed around through `detail` passthrough; passthrough then bred `showReferenceRail`/`relatedLayout` riders. Killing keys without killing the channel just moves the dialect.
2. **Every failure mode is a silent no-op**, which ADR-0078 identifies as the worst possible shape when AI is the primary author: the AI writes `detail.stagefield` or `fieldGroups[].collapsed`, gets a success envelope, and reports done. A human might notice the page didn't change; an agent will not.
3. **The survivors all share one property.** Working through the nine `detail.*` keys, each either (a) duplicated an existing semantic role, (b) toggled the presentation of *correct* information, or (c) injected business intent no machine can infer. Only class (c) survived scrutiny — and class (c) keys are never page-scoped. That property is the invariant worth writing down.

## Decision

### 1. The semantic-role invariant

`ObjectSchema` carries presentation-relevant metadata **only** as object-level semantic roles. A semantic role:

- states a fact about the business meaning of the data (**not** about one page's layout);
- is consumed by **every** surface where it is meaningful — grids, forms, detail pages, drawers, previews, AI summaries;
- is named after the *fact*, never after a page (`stageField`, not `detail.stageField`).

The four roles, three of which already exist:

| Role | Question it answers | Consumers (non-exhaustive) |
|---|---|---|
| `nameField` (ADR-0079) | What is this record called? | headers, links, lookups, breadcrumbs |
| `highlightFields: string[]` **(renamed from `compactLayout`)** | Which fields matter most, in priority order? (`[0]` wins where only one field fits) | default list/grid columns (ObjectGrid, ObjectView, InterfaceListPage), child-record previews, `record:details` auto layout, **detail highlight strip (first 4)**; future: kanban card fields — Salesforce compact-layout semantics |
| `stageField: string \| false` **(newly typed)** | Which field is the linear lifecycle? `false` = the status-like field is *non-linear*; suppress stage heuristics | detail path/stepper; future: kanban default grouping, list badges, report bucketing |
| `fieldGroups[]` + `Field.group` | How do fields cluster semantically? | form sections, detail sections, drawers, designer |

**Why the rename.** `compactLayout` is a misnomer twice over: the value is an ordered field list, not a layout (no structure — the name primes an AI author to expect columns/sections), and its heaviest real consumer is default list columns, which are not a "compact" context. `highlightFields` is already the renderer-side term of art (`HighlightField`, `record:highlights`, `HeaderHighlight`, `deriveFieldGroupSections`' sibling `deriveHighlightFields`, `HighlightFieldsProvider`) and the name the retired docs taught (`views.detail.highlightFields`) — renaming the protocol key unifies the metadata vocabulary with the renderer vocabulary, one fewer mapping for an AI to hold. Mechanics follow ADR-0079's `displayNameField → nameField` precedent exactly: `compactLayout` is accepted as a parse-time alias, copied onto `highlightFields`, both preserved on output, describe marks the old key deprecated. In-repo authors (35 platform-objects + examples) migrate mechanically in the same PR.

Zero-config stays zero-config: heuristics (name-based stage detection, auto highlight derivation, auto primary/"more details" split) remain the defaults; roles override them; `stageField: false` is the one explicit "stop guessing" signal.

### 2. The admission test for future keys

A new presentation-intent key enters `ObjectSchema` only if **both** hold:

1. it injects business intent **not inferable** from the schema (the machine cannot know whether `status` is ordinal, or which four fields this business watches);
2. it binds to the object **across surfaces** — if the honest name for the key contains a page name, it fails.

Keys that merely hide/re-arrange correct information (`hideRelatedTab`, `showReferenceRail`, `relatedLayout`, `useFieldGroups`, explicit `detail.sections`, or a **modal-vs-page presentation surface** such as a `recordSurface` key) are rejected at this layer. The supported path for per-page control is the one that already exists and is honestly scoped: an **assigned page** (full page schema). A record's *default* surface (full page vs. drawer/modal overlay) is not authored at all: it is **derived** from how heavy the record is — `deriveRecordSurface` (#2578) — because field count is exactly the kind of fact a machine can infer, so a `recordSurface` key fails admission test #1. If a genuine relationship-level need appears (e.g. "this child object is noise on every parent"), it gets modeled at the relationship layer, not as a page toggle.

### 3. Deletions (all evidenced zero-author)

- **`detail` block removed from `ObjectSchema`** — all three typed keys. `renderViaSchema` retires *together with* the legacy monolith renderer path in objectui (separate execution PR; the key is only that path's steering wheel, deleting it alone saves nothing). `hideReferenceRail`/`hideRelatedTab` are removed outright (the former is a proven no-op for spec authors; the latter's raison d'être — overriding rail/tab dedup — died with the rail).
- **`views.*` reader paths deleted** from `RecordDetailView` (3 sites). No deprecation window: a deprecation window protects existing authors, and the authored population is measured zero.
- **No second "important fields" list.** The detail highlight strip consumes `highlightFields` (first 4) → existing heuristic; it does not get its own key. One curated list, every surface.
- **`fieldGroups.visibleOn` removed from the MVP schema** (ADR-0049: no consumer anywhere → remove; re-add with its enforcement when a consumer ships). `icon`/`description` get wired by the shared derivation below or entered in the liveness ledger with a milestone.

### 4. Collapse semantics converge on one enum

`fieldGroups[].collapse: 'none' | 'expanded' | 'collapsed'` (default `'none'`) replaces spec `defaultExpanded` **and** UI `collapsible`/`collapsed`. One key, three valid states, no expressible contradiction (`collapsible:false, collapsed:true` dies with the pair). `defaultExpanded` and the UI pair are accepted as normalization-time aliases for one minor, then dropped; a designer-data migration maps existing bare-key rows.

### 5. One shared derivation, every surface

The grouping semantics — declared order, empty groups dropped, ungrouped fields to a trailing untitled bucket, collapse passthrough, audit/system-field handling — are **protocol semantics**, authored once as a pure helper (`deriveFieldGroupLayout(def)`) in `@objectstack/spec` (the ADR-0078 §2 shared-predicate pattern). `@object-ui` plugin-form, plugin-detail synth, app-shell, and the designer consume it; the two existing near-identical objectui copies are deleted. objectui already pins its spec version, so semantics version with the protocol.

### 6. Author-time guardrails (two-tier, per the existing lint idiom)

Warnings (fragile): `Field.group` references an undeclared group key; a declared group no field references; `stageField`/`compactLayout` entries naming fields that don't exist. These are the completeness predicates ADR-0078 expects for this type — the runtime stays forgiving (unknown group → ungrouped bucket), the author gets told.

## Consequences

- **Spec surface change is breaking on paper, dead in practice.** Removal of the `detail` block keys falls under the ADR-0059 §4 discussion; since every removed key is provably unauthorable or no-op (evidence in this ADR), the documented dead-export exception (PR #2272 precedent) plausibly applies. Release owner decides major vs. exception at version time.
- **objectui PR #2149 simplifies**: keep the `fieldGroups` detail wiring and tests (the valuable 80%); drop all `detail.*`/`views.*` reads; `detectStatusField` reads top-level `stageField` only; highlight derivation reads `highlightFields` (with the `compactLayout` alias honoured until the spec bump lands); the never-merged `detail.sections`/`sectionGroups`/`useFieldGroups` additions are dropped before they become contract.
- **The rename sweep is mechanical but wide**: ~36 in-repo authors (35 platform-objects + examples) plus five objectui consumer sites (ObjectGrid, ObjectView ×2, InterfaceListPage, RecordDetailView child preview, `record:details` auto layout) move to `highlightFields`; external/DB metadata keeps parsing via the alias. A follow-up wires kanban card fields to the role (today: view-level `cardFields` + heuristic only).
- **Objects with `fieldGroups` change appearance on detail pages** (grouped cards instead of auto two-section). Intended; release-noted; recoverable by editing the groups. No per-surface escape hatch is provided — that was decided deliberately under §2.
- **Docs and skills** teaching `views.*` or `detail.*` are updated in the same change series (the docs-accuracy harness owns the sweep).
- **What this does *not* restrict**: assigned pages keep full per-page power; `record:reference_rail` remains a renderer capability composable in a page schema — it just has no object-level switch.

## Alternatives considered

- **Type the `detail` block (strict) and keep it** — rejected. It legitimizes the per-surface config layer that generated the bug class; every future page grows a sibling block (`list.*`, `kanban.*`), each a new dialect.
- **Keep passthrough, add lint warnings for unknown keys** — rejected per ADR-0032/0078: warnings on a success path do not stop an AI author; the envelope still says done.
- **Keep a `useFieldGroups: false` / `detail.sections` escape hatch for the detail redesign** — rejected. The risk it hedges is aesthetic and recoverable (edit the groups); the cost is a permanent per-surface divergence concept plus (for `sections`) an exclusive field list whose omissions silently hide data. Re-adding a hatch later is a minor; carrying an unused one is forever.
- **Add `highlightFields` alongside `compactLayout`** — rejected. Two curated "important fields" lists drift; Salesforce solved this the same way: the compact layout drives the highlights panel. (Resolved instead as a rename: one list, the clearer name.)
- **Keep the `compactLayout` name** — rejected. The name claims a structure the value doesn't have, misses its own biggest consumer (default list columns), and mismatches the renderer vocabulary that already says "highlight" everywhere. A protocol whose keys are named for what they actually do is itself an AI guardrail; the rename costs one alias (ADR-0079 machinery already exists) and a mechanical in-repo sweep.
- **Deprecation window for `views.*`** — rejected as cargo cult: there is no author to deprecate for. Windows are for populations, not for ghosts.

## As-built addendum (2026-07-16)

Execution landed across both repos; differences from the proposal are noted inline.

- **Roles & rename** — `highlightFields` shipped with the ADR-0079 alias machinery; the `compactLayout` alias was then fully retired by framework#2536 (served metadata now carries the canonical key only). `stageField` is spec-typed including the strict-`false` suppression contract (renderer side objectui#2168).
- **§5 shared derivation** — `deriveFieldGroupLayout` lives in `@objectstack/spec` (`packages/spec/src/data/field-group-layout.ts`) and passes group `icon`/`description`/`collapse` through; objectui form/detail synth consume it (the two pre-existing near-copies were deleted).
- **§6 guardrails** — `@objectstack/lint` `validate-semantic-roles`: undeclared `Field.group` reference, declared-but-unreferenced group, dangling `stageField`/`highlightFields` pointers; plus `field-group-shadowed` (added by the #2548 follow-up): a group whose every visible member is hoisted into the detail highlight strip (or is the record title) renders on forms but never on detail pages.
- **PR4 (legacy-path deletion)** — objectui#2546 removed the monolith `DetailView` branch in `RecordDetailView` together with the `detail.renderViaSchema` kill-switch and the `?renderViaSchema=0` debug param; schema-driven is the only path.
- **Cross-surface consumption** — kanban default card fields ride `highlightFields` (objectui#2541), alongside grids/lists/detail strip.
- **Verification** — parse: `@objectstack/spec` suite; served pipeline: `packages/qa/dogfood/test/semantic-roles.dogfood.test.ts`; real-backend browser pass over the four detail shapes (grouped / ungrouped / `stageField: false` / related-heavy): framework#3019, runbook + results in `docs/audits/2026-07-adr-0085-detail-shapes-browser-verify.md`, and a permanent Playwright spec in `examples/app-showcase/e2e/detail-shapes.spec.ts`.
- **Consequence surfaced by the browser pass** — because detail bodies hide strip fields, a fully-highlighted group silently disappears from detail pages. Judged working-as-intended (one curated list, every surface) but author-surprising — hence the `field-group-shadowed` warning and the semantic-zoo fixture keeping one non-highlighted member per group.
