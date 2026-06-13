# ADR-0047: Two run modes for object UI — data views vs interface pages, user filters, and runtime visualization choice

**Status**: Proposed (2026-06-12)
**Deciders**: ObjectStack Protocol Architects
**Builds on**: [ADR-0005](./0005-metadata-customization-overlay.md) (one Zod source per type, org overlay), [ADR-0017](./0017-object-has-many-view.md) (independent view entities, `viewKind`), [ADR-0019](./0019-app-as-consumer-unit.md) (App is the consumer-facing unit — navigation decides what users see), [ADR-0027](./0027-metadata-authoring-lifecycle.md) (draft · publish lifecycle), [ADR-0033](./0033-ai-assisted-metadata-authoring.md) (**AI is the long-term author of metadata — the design center this ADR inherits**)
**Consumers**: `@objectstack/spec` (view + page Zod schemas), `@objectstack/objectql` (registry validation/diagnostics), `../objectui` (console `ObjectView` / `PageView`, `plugin-list`), framework templates (`hotcrm`, `app-showcase`), the `objectstack-ui` authoring skill

**Premise**: same as ADR-0033 — the platform is pre-launch, the primary author of UI metadata is an AI, and a human confirms. Every design choice below is therefore evaluated against two questions: *does it make the generated-by-default experience correct?* and *can an AI author get it wrong?*

---

## TL;DR

1. **Two run modes, both first-class.** *Data mode* (navigation → object): every list view of the object renders as a switcher tab; users may create personal views; the toolbar is permissive. *Interface mode* (navigation → page): an author-curated page **references** one view as its source and exposes only the controls the author enabled — filter tabs or dropdowns, a fixed (or whitelisted) visualization, selected user actions. This mirrors Airtable's Data vs Interfaces split and Power Platform's model-driven vs canvas split.
2. **The iron rule: pages reference views, never restate them.** A page's `source` points at an object/view; columns, base filter, and sort are *inherited* from the view definition. The page schema carries presentation policy only — it has no field for columns, so the "page and view each declare columns, then drift" failure mode is unrepresentable.
3. **`userFilters` becomes spec.** The end-user quick-filter surface (Airtable "User filters": element = `tabs | dropdown | toggle`, plus per-field config) is formalized in `ListViewSchema` and `InterfacePageConfig`. The client already implements and renders it (verified live, below); today it works only by accident of raw passthrough, with no type for authors and no Studio form.
4. **Runtime visualization choice is an author-controlled whitelist.** `userActions.visualizations?: boolean | ViewType[]` at view level, `visualizations` at page level (superseding the misplaced `userFilters.elements` enum). Effective options = author whitelist ∩ types whose required field bindings resolve (kanban needs a select `groupBy`, calendar a date field, …). Data mode defaults open; interface mode defaults locked.
5. **Defaults are asymmetric on purpose.** Data mode auto-derives quick filters from select/boolean fields and allows user views; interface mode is closed until the author opens it. An AI that emits *nothing* beyond objects + views + navigation gets a correct, complete system — "omission is correct" is the strongest guardrail we can give a generative author.
6. **AI decision rule, encoded not implied.** Default output is objects + list views + navigation → objects. Interface pages are generated only on explicit signals (persona split, capability narrowing, portal/workspace language). The rule ships in the `objectstack-ui` skill; reference-integrity diagnostics become hard failures in the AI loop (per ADR-0033's draft gate).

---

## 1. Context — what exists (verified live, 2026-06-12)

The findings below come from running `examples/app-showcase` (:3000) against the
objectui console (:5180), logging in, and exercising the HotCRM `crm_account`
object — plus one runtime experiment: a view written through
`PUT /api/v1/meta/view/:name` carrying `tabs` + `userFilters` that the spec does
not declare.

**Already working:**

- **Auto-derived quick filters are live.** The `crm_account` list renders
  dropdown filters (类型 / 行业 / 是否活跃 / 更多) although the hotcrm template
  contains **zero** `userFilters` metadata — objectui's `ListView` derives them
  from the object's select/boolean fields. Selecting 行业=科技 correctly
  filters 5 → 2 records through the query pipeline.
- **Metadata-driven `userFilters` round-trips end-to-end.** The experimental
  view saved with `userFilters: { element: 'dropdown', fields: [行业, 评级] }`
  was stored verbatim (registry validation is warn-only and stores the raw
  item), echoed back intact with `_diagnostics.valid: true`, and the console
  rendered **exactly the two configured dropdowns**, replacing the auto-derived
  set. The client component (`plugin-list/UserFilters.tsx`) supports all three
  elements (`dropdown` / `tabs` / `toggle`), lookup-backed options, counts and
  defaults.
- **View switcher + user-created views (data mode)** work: 7 artifact views,
  overflow menu, "Manage all views…", runtime overlay create/delete (ADR-0005).
- **Runtime visualization switching exists as a dormant component**
  (`plugin-list/ViewSwitcher.tsx`), gated by a `showViewSwitcher` prop that
  only Studio's view preview enables.

**Broken or absent:**

- **`ListViewSchema` has no `userFilters`.** The working client behavior has
  no spec type: TS authors get excess-property errors, Studio cannot render a
  form for it, and an AI grounded in the Zod schema will never emit it.
- **View-level `tabs` don't reach the renderer.** The experiment's three
  filter tabs (全部 / 科技公司 / 金融公司) were stored and served but never
  rendered — the console's `ObjectView` forwards `listSchema.tabs` and drops
  `viewDef.tabs` (a one-line gap).
- **`InterfacePageConfig` is schema-only.** No page in the running system
  carries `interfaceConfig`; nothing renders it. Its
  `userFilters.elements: ['grid','gallery','kanban']` enum conflates
  *visualization choice* with *filter element type*.
- **No template exercises any of this.** `userFilters`, view `tabs`,
  `filterableFields`: zero occurrences across `app-showcase` and the
  `hotcrm`/`hr` templates — so the capability is invisible to both humans
  and few-shot-grounded AI authors.
- **Registry validation is warn-only** (`registry.validate()` logs and stores
  the raw item). Tolerable for humans; for an AI loop it means a misspelled
  field name produces no feedback at all.

## 2. Prior art

| Platform | Data-mode equivalent | Interface-mode equivalent | Lesson taken |
|---|---|---|---|
| **Airtable** | Data tab: every view user-creatable, grid-first | Interfaces: author-curated pages; *User filters* (Elements: tabs / dropdowns), *Appearance → Visualizations* fixed by author, *User actions* toggles | The panel we are matching feature-for-feature; end users never create views inside an interface |
| **Salesforce** | Object list views (user-creatable, admin-shareable, pinnable) | Lightning App Builder pages (curated regions/components) | List views remain the data asset; pages compose them. Personal vs shared views are permission-governed |
| **Microsoft Power Platform** | Model-driven apps: UI *generated* from Dataverse views/forms | Canvas apps: fully curated | "Generated-by-default is correct" scales; full curation is opt-in because it carries maintenance cost |
| **Notion** | Database with multiple views | Linked database views embedded in pages | Embeds are *references* to the source database — the iron rule in the wild |
| **Retool (counter-example)** | — | Everything is a hand-built page | With no generated data mode, every list costs author time and drifts from schema changes — what we avoid by keeping data mode primary |

## 3. Decision

### 3.1 The model: three layers, navigation decides the mode

| Layer | Metadata | Role | Required? |
|---|---|---|---|
| Data asset | `object` + its list views (ADR-0017 view entities) | Authoritative definition of columns/filter/sort; serves data mode | Yes — every object |
| Entry | `app.navigation` (ADR-0019) | `type: 'object'` → data mode; `type: 'page'` → interface mode | Yes |
| Presentation | `page.interfaceConfig` | Curated end-user surface; references a view, adds policy | Optional, signal-driven |

The same object may appear behind both entries (ops team gets the object,
business users get a page). The renderer (`plugin-list/ListView`) is shared;
`ObjectView` and `PageView` are two orchestrators feeding it different schema.

### 3.2 The iron rule

`interfaceConfig` carries **no column, no base-filter, no sort definitions** —
only: `source` (object or object+view), `userFilters`, `visualizations`,
`userActions`, `addRecord`, `showRecordCount`, and cosmetic appearance. Columns
and data semantics always come from the referenced view. Schema-level
unrepresentability is the strongest anti-drift and anti-AI-error mechanism we
have; we do not rely on lint to forbid what the type can simply not express.

### 3.3 Spec changes (`@objectstack/spec`)

1. **`UserFiltersSchema`** (new, `ui/view.zod.ts`), modeled on the proven
   objectui client type:

   ```ts
   export const UserFilterFieldSchema = z.object({
     field: z.string(),                       // must exist on the source object
     label: I18nLabelSchema.optional(),
     type: z.enum(['select','multi-select','boolean','date-range','text']).optional(), // default: infer
     options: z.array(OptionSchema).optional(),      // default: derive from field def
     showCount: z.boolean().optional(),
     defaultValues: z.array(z.union([z.string(), z.number(), z.boolean()])).optional(),
   });

   export const UserFiltersSchema = z.object({
     element: z.enum(['dropdown','tabs','toggle']),  // Airtable "Elements"
     fields: z.array(UserFilterFieldSchema).optional(), // dropdown/toggle
     tabs: z.array(ViewTabSchema).optional(),           // tabs element reuses ViewTabSchema
     showAllRecords: z.boolean().optional(),
   });
   ```

   Attached as `ListViewSchema.userFilters` (view-level convenience) and
   `InterfacePageConfigSchema.userFilters` (the primary home).
   `filterableFields` stays as the legacy shorthand; loaders auto-upgrade it
   to `userFilters.fields` entries.

2. **Runtime visualization whitelist.**
   `UserActionsConfigSchema.visualizations?: z.union([z.boolean(), z.array(ViewTypeEnum)])`
   (view level) and `InterfacePageConfigSchema.visualizations` (page level,
   full 8-type enum). The existing `userFilters.elements` 3-type enum is kept
   one release as a deprecated alias and folded in.

3. **Semantics, not rendering.** The spec defines *what the author allows*;
   capability filtering (does this object have a select field for kanban
   `groupBy`? a date field for calendar?) is renderer responsibility and must
   hide non-resolvable types rather than render with hardcoded fallbacks
   (`groupBy: 'status'` against an object without `status` renders garbage —
   observed in the current console code).

### 3.4 Asymmetric defaults

| | Data mode | Interface mode |
|---|---|---|
| Quick filters | Auto-derived from select/boolean fields (current live behavior, now blessed) | None until author configures `userFilters` |
| Visualization switching | On (all capability-resolvable types); user preference persists via the per-user view-patch channel | Locked to authored visualization unless whitelisted |
| User-created views | Allowed, governed by permissions + view `sharing` | Never |
| Filter state | Session-scoped (URL-param sync is a later, orthogonal step) | Session-scoped |

### 3.4a "No filter bar" is omission, not a literal `element: 'none'`

Airtable's User-filters control is a single tri-state selector
(**None / Tabs / Dropdown**). We deliberately do **not** mirror "none" as a
literal enum value: **"none" is the ABSENCE of `userFilters`**.

Rationale (declarative-metadata hygiene):

- **Consistency.** Every optional capability in the protocol is "off = key
  absent" (`kanban`, `grouping`, …). A literal `element: 'none'` would be the
  one special case authors and tooling must learn.
- **No dead config.** `element: 'none'` would leave an object whose `fields` /
  `tabs` are orphaned — undefined semantics for validation, overlay merge, and
  AI generation. Omission has one unambiguous meaning.
- **Cleaner diffs / overlays.** Disabling the bar is a key deletion (ADR-0005
  overlay semantics), not a value mutation dragging stale sub-config along.
- **Orthogonal axes.** "Is there a filter bar?" (presence) and "what style?"
  (`element`) are independent; one enum would couple them.

**`toggle` is deprecated; authoring offers Airtable's three.** The `element`
enum keeps `dropdown | tabs | toggle` for back-compat (existing configs keep
rendering), but `toggle` is **not** an authoring choice: it overlaps `tabs`
(presets) and `dropdown` (per-field values) without adding expressive power,
needs per-field `defaultValues` to be useful at all, and was the least-
exercised path. A homogeneous "everything is a toggle" bar only fits all-boolean
field sets — a narrow case better served by letting field *type* drive the
control inside `dropdown`. If stackable one-click quick-filters become a
validated need, design them explicitly (à la Linear filter chips), not via the
half-spec'd `toggle`.

**Storage and authoring UI are separate layers.** The Studio editor exposes a
first-class **None / Tabs / Dropdown** segmented selector (the `filter-mode`
widget) — selecting *None* writes `onChange(undefined)`, removing the key.
Authors get Airtable's explicit affordance; the protocol stays clean.

If a "disable but remember the configured fields/tabs" need ever arises, the
right shape is a separate `enabled: false` flag — never `element: 'none'`.

### 3.5 AI authoring rules (inherits ADR-0033's draft gate)

1. **Default output**: objects + list views + navigation → objects. *No pages.*
   Rationale: data mode is a functional superset; a missing page costs polish,
   a superfluous page costs a permanently-maintained duplicate asset. The
   asymmetry dictates the default.
2. **Generate an interface page only on explicit signals**: persona split
   ("销售人员看到…", customer portal), capability narrowing ("users must not
   change views", "only filter by industry/type"), or curation language
   (workspace / 工作台 / Airtable-interface-like). Ambiguity resolves to *no
   page*.
3. **The rule ships as text in the `objectstack-ui` skill** (decision tree +
   the iron rule + this ADR as reference), so the constraint binds at
   generation time, not only at validation time.
4. **Diagnostics are hard failures for AI.** The metadata write path already
   returns `_diagnostics`; it gains reference-integrity checks — `page.source`
   resolves; every `userFilters.fields[].field` and `tabs[].filter[].field`
   exists on the source object; kanban `groupBy` is a select. Human authors
   keep warn-and-store (ADR-0005 tolerance); the ADR-0033 agent loop treats
   `valid: false` as a failed apply and self-corrects before draft review.
5. **Templates are the few-shot corpus.** `hotcrm` gains one canonical
   interface page (e.g. a "销售工作台" referencing `all_accounts` with
   industry/type dropdowns and a locked grid) and one view with filter `tabs`;
   `app-showcase` covers the remaining permutations. Zero examples today is
   why zero AI generations use these features.

## 4. Non-goals

- **Per-user saved filter presets in the cloud** (Airtable lets interface
  users pin filter values) — session scope first; a `sys_user_view_state`
  channel is a separate decision.
- **Ad-hoc filter-builder spec for end users** — the advanced FilterBuilder
  remains a client feature; its output never persists as metadata.
- **Page composition beyond single-source lists** (multi-widget interface
  pages, cross-object layouts) — covered by the existing page/component
  schemas; this ADR only fixes the list-page run mode.
- **Back-compat machinery** — pre-launch premise; `filterableFields` and
  `userFilters.elements` aliases are one-release courtesies, not commitments.

## 5. Consequences

**Positive.** The Airtable-parity gap (in-page filter tabs / dropdowns,
author-controlled visualization) closes mostly by *formalizing what already
runs*; one orchestrator line, one schema block, and template examples deliver
the visible feature. AI authors get a closed loop: schema they can see,
diagnostics that push back, examples to imitate, and a default that is correct
when they emit nothing. The two modes stop being implicit — navigation type is
the single, auditable mode switch.

**Negative / accepted.** Two places can now declare `userFilters`
(view + page); precedence is fixed (page overrides view) and documented, but
it is still a second place. Interface pages remain a thinner v1 than
Airtable's (no per-user saved state). Warn-only validation persists for human
paths — we accept schema-invalid human metadata surviving, as today, until
ADR-0027 promotion tightens it.

## 6. Implementation plan

| Phase | Repo | Work | Size |
|---|---|---|---|
| 1 | framework | `UserFiltersSchema` + `userActions.visualizations` + `InterfacePageConfig` rework in spec; reference-integrity diagnostics | S |
| 2 | objectui | `ObjectView`: forward `viewDef.tabs`; import spec types (kill the local duplicate); wire `showViewSwitcher` behind the whitelist + capability filter | S |
| 3 | framework | Template examples (`hotcrm` workbench page, tabbed view); `objectstack-ui` skill decision rules | S |
| 4 | objectui | `PageView` renders `interfaceConfig` (single-source list + `UserFilters` toolbar, locked toolbar policy) | M |
| 5 | both | Studio authoring panel for user filters / visualizations (Airtable right-panel parity); AI loop treats diagnostics as hard failure | M |

Phases 1–3 are independently shippable and deliver the user-visible feature in
data mode; phase 4 activates interface mode; phase 5 completes the authoring
experience.

## 7. Open questions

1. Should interface-mode filter state sync to URL params for shareable links
   (Salesforce-style) in v1, or stay purely in memory?
2. Does `userFilters` on the *view* level survive long-term, or do we
   eventually deprecate it in favor of page-level-only once PageView ships?
3. Capability filtering for visualizations: renderer-local heuristics now —
   does the spec eventually need explicit per-type binding declarations
   (`kanban.groupByField` required) surfaced as authoring-time diagnostics?
