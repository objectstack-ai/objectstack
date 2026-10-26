# ADR-0056: Permission editing belongs in Studio — Setup keeps user management and assignment

**Status**: Accepted — implemented in objectstack-ai/objectui#2403 (2026-07-13). Revised from the original **Option B** (which kept `system_permissions` editable in Setup as an exception) to the **pure model** below: Studio designs *every* facet, Setup only assigns + shows read-only summaries.
**Author**: ObjectUI app-shell / Studio team
**Consumers**: `@object-ui/app-shell` (Setup object surfaces for `sys_permission_set`; Studio Access pillar `AccessPillar` / `PermissionMatrixEditPage`; `views/metadata-admin/*`; `builtinComponents.tsx`), `@object-ui/plugin-form` (the generic object form that renders the `sys_permission_set` textareas today)
**Relates to (framework)**: **ADR-0090** (Permission Model v2 — concept convergence; names ObjectUI *Studio + Setup* as consumers, D6 explain, D7 lint, D12 delegated admin/`adminScope`), **ADR-0092** (identity-table write guard — the same "UI hint ≠ server boundary" discipline), **ADR-0086** (authz metadata↔config boundary — package vs environment provenance on permission sets), **ADR-0066** (unified authorization model — the `sys_capability` registry that backs P2), **ADR-0049** (no unenforced security properties), **ADR-0057** (RLS depth / business-unit tree, referenced by the RLS + admin-scope editors), **ADR-0084** (application-builder IA — Access as Studio's fourth pillar)
**Relates to (objectui)**: **ADR-0053** / **ADR-0055** (nav / surface-context precedent), **ADR-0054** (UI-testability contract — proofs for each phase)
**Tracking**: objectstack-ai/objectui#2398 (epic — "Consolidate permission-set editing into Studio")

---

> **Cross-repo numbering note.** ObjectUI keeps its own ADR sequence (latest is
> ADR-0055); this is ADR-0056 in **that** sequence. The `framework` repo has an
> unrelated ADR-0056 (permission-model landing verification). The two repos'
> ADR numbers have always collided (0036 / 0054 / 0055 differ across repos), so
> every framework cross-reference above is given **by title**, not by number
> alone. If the reviewers would rather this decision live in the framework
> permission-ADR series (0049 / 0066 / 0086 / 0090 / 0092), it becomes
> framework ADR-0093 instead — see *Alternatives considered* A5.

## TL;DR

A permission set has **two** editing surfaces today, over the **same**
`sys_permission_set` record:

- **Setup** (`com.objectstack.setup`, gated `setup.access`) lists permission
  sets under *Access Control* (`nav_permission_sets` → the `sys_permission_set`
  **object**). The generic object form renders **six `Field.textarea` columns**,
  each a hand-edited **JSON blob**: `object_permissions`, `field_permissions`,
  `system_permissions`, `row_level_security`, `tab_permissions`, `admin_scope`.
- **Studio** (gated `studio.access`) has an **Access pillar** whose
  `PermissionMatrixEditPage` is a structured, Salesforce-style matrix — but it
  edits **only** object CRUD/VAMA/lifecycle (`objects`) and field-level R/W
  (`fields`). The other four concerns have **no structured editor anywhere**;
  raw JSON in Setup is the only way to author them.

Raw JSON authorization metadata is exactly the failure surface **ADR-0090**
(AI-authored metadata, security-domain lint, explain-by-construction) and
**ADR-0049** (no unenforced/unvalidated security properties) argue against: it
is unvalidated at author time, invisible to the explain engine and the D7
publish linter, and a silent-incident footgun.

**Decision (pure model): permission *design* is a Studio concern; Setup only
*assigns* users and shows every facet read-only.** All **six** facets — including
`system_permissions` — are authored in the structured permission matrix editor
(`PermissionMatrixEditPage`); Setup renders each facet read-only as a summary +
a "Design in Studio →" deep-link, and hosts user assignment. No facet is ever
raw JSON in Setup.

The original Option B kept `system_permissions` *editable in Setup* as an
exception (the "who-may-enter-Studio is a Setup act" bootstrap argument). That
exception is **dropped**: the structured editor is reached from Setup's own
env-scope metadata route (`/apps/com.objectstack.setup/metadata/permission/:name`,
under `setup.access`) as well as from the Studio Access pillar (package scope,
`studio.access`), so *designing* capabilities never requires separately entering
Studio — the bootstrap knot A2 worried about doesn't arise (see A2, revised).

Target end-state, field by field:

| `sys_permission_set` column | Concept | Edited today | Structured editor | Setup shows |
| --- | --- | --- | --- | --- |
| `object_permissions` | Object CRUD/VAMA/lifecycle | Setup JSON **and** Studio matrix | `PermissionMatrixEditor` (exists) | read-only summary + deep-link |
| `field_permissions` | Field-level R/W (FLS) | Setup JSON **and** Studio matrix | `PermissionMatrixEditor` (exists) | read-only summary + deep-link |
| `system_permissions` | Capability strings (incl. `studio.access`) | Setup JSON textarea | `sys_capability` multi-select (new) | read-only chips + deep-link |
| `admin_scope` | Delegated-admin scope (ADR-0090 D12) | Setup JSON textarea | new structured editor | read-only summary + deep-link |
| `row_level_security` | RLS policies (USING/CHECK) | Setup JSON textarea | new structured RLS editor | read-only summary + deep-link |
| `tab_permissions` | App/tab visibility | Setup JSON textarea | new structured tab-visibility editor | read-only summary + deep-link |

---

## Context

### The two surfaces, and the record underneath them

Both surfaces ultimately write **one** table, `sys_permission_set`
(`@objectstack/plugin-security`, `managedBy: 'config'`), whose columns are all
`Field.textarea` typed *"JSON-serialized …"*. They differ only in **path**:

- **Setup → live data.** `security-plugin.ts` contributes
  `{ id: 'nav_permission_sets', type: 'object', objectName: 'sys_permission_set' }`
  into Setup's `group_access_control` (next to *Positions* → `sys_position` and
  *Capabilities* → `sys_capability`). Opening a row renders the generic object
  form: six JSON textareas, a live CRUD write to the row.
- **Studio → metadata draft.** The Access pillar (`StudioDesignSurface.tsx`,
  fourth pillar per ADR-0084) lists the **`permission` metadata type** and opens
  `PermissionMatrixEditPage`. Under a package it writes a **draft** that Publish
  promotes into the `sys_permission_set` row (ADR-0086 P2); at environment scope
  it writes the row live. The metadata shape is `PermissionSetSchema`
  (`packages/spec/src/security/permission.zod.ts`, camelCase `objects` /
  `fields` / `systemPermissions` / `tabPermissions` / `rowLevelSecurity` /
  `contextVariables` / `adminScope` / `isDefault` / `managedBy` / `packageId`).

So this is **not** two data stores — it is two *editors of the same
authorization record*, one structured-but-partial (Studio, objects+fields only),
one total-but-raw (Setup, six JSON blobs). That overlap is the problem.

### Why raw JSON editing is the wrong surface for authorization

1. **It is the exact anti-pattern ADR-0090 is built to remove.** ADR-0090's
   thesis: authorization metadata is AI-authored, so *vocabulary is attack
   surface* and *structure is the precondition for defense* — the D6 explain
   engine, D7 security-domain publish linter, and access-matrix snapshot gate
   can only exist because grants are structured data. A JSON textarea is a hole
   straight through all of it: no field validation, no cross-field refine, no
   diff the explain engine can read.
2. **ADR-0049 discipline.** A `readonly`/affordance is a UI hint, not a server
   boundary (this is precisely the ADR-0092 finding for identity tables). Raw
   JSON authoring is the mirror failure: it *looks* like editing structured
   permissions while bypassing every author-time guard the structured path has.
3. **Duplication + drift.** `object_permissions` / `field_permissions` are
   editable in **both** surfaces, in **two** shapes (snake_case JSON textarea vs
   the matrix's typed model). Two ways to author the same grant is two ways to
   author it *wrong*, and only one of them is linted.
4. **Audience mismatch (the ADR-0084 / studio.app split).** Setup is the
   operator/admin app (users, SSO, system config, `setup.access`); Studio is the
   maker/implementer app (schema-side, `studio.access`). Fine-grained
   permission *design* (object matrices, FLS, RLS predicates, delegated-admin
   scopes) is maker work; permission-set **assignment** to people and
   who-can-enter-Studio are operator work. The current split cuts across that
   line.

### What already exists (so the plan doesn't rebuild it)

- **`PermissionMatrixEditor`** (`views/metadata-admin/PermissionMatrixEditor.tsx`)
  — structured editor for `objects` (C/R/U/D + Transfer/Restore/Purge +
  ViewAll/ModifyAll, with cascade rules) and `fields` (R/W). Package- and
  environment-scoped, OCC + destructive-change dialog, per-object OWD/`private`
  badges (ADR-0066/0090), assigned-users section. **It does not yet edit
  `systemPermissions`, `tabPermissions`, `rowLevelSecurity`, `adminScope`, or
  `contextVariables`.**
- **`sys_capability`** (`@objectstack/plugin-security`, ADR-0066 D1) — a
  first-class capability **registry** object: `name` / `label` / `description` /
  `scope` (`platform` | `org`) / `managed_by` (`platform` | `package` | `admin`)
  / `active`. Seeded from `PLATFORM_CAPABILITIES` in
  `@objectstack/spec/security/capabilities.ts`, which already includes
  `setup.access`, `studio.access`, `manage_users`, `manage_metadata`,
  `manage_platform_settings`, `manage_org_users`. **Setup already lists it**
  (*Capabilities* nav). P2 needs only a picker over this object — **no new
  object.**
- **`AdminScopeSchema`** (ADR-0090 D12, in `permission.zod.ts`) — the exact
  target shape for the `admin_scope` editor: `businessUnit`, `includeSubtree`,
  `manageAssignments`, `assignablePermissionSets[]`. `manageBindings` and
  `authorEnvironmentSets` were retired by objectstack-ai/objectstack#23488 (the
  spec refuses both).
- **`RowLevelSecurityPolicySchema`** (`spec/security/rls.zod.ts`) — the target
  shape for the RLS editor: `name` / `object` / `operation` / `using` / `check`
  (CEL-style predicates).
- **`AccessExplainPanel`** (`views/metadata-admin/`) — the D6 "view as / why can
  X" explain surface already present alongside the matrix; the structured
  editors should sit next to it, not behind a JSON blob.

## Decision

**Pure model — permission *design* is a structured-editor concern; Setup only
*assigns* and *summarizes*.**

1. **All six facets are authored in the structured permission matrix editor**
   (`PermissionMatrixEditPage`): object/field via the existing grid, plus the
   new **System Capabilities** (`sys_capability` multi-select), **Row-Level
   Security**, **Tab Visibility**, and **Delegated Admin Scope** editors. The
   editor is reached from the Studio Access pillar (package scope, `studio.access`)
   **and** from Setup's env-scope metadata route (`setup.access`) via the
   per-facet deep-link — the same component, two entry points.
2. **Setup keeps, and only keeps:** user CRUD / invite / import (unchanged;
   ADR-0092), position management, and **permission-set *assignment*** (binding
   sets to users/positions via `sys_user_permission_set` /
   `sys_position_permission_set`, surfaced directly on the `sys_permission_set`
   record page). Setup **stops being a permission-authoring surface entirely** —
   every facet renders read-only there (summary + "Design in Studio →").
3. **No exception for `system_permissions`.** Capabilities are designed in the
   structured editor like every other facet; Setup shows the granted capabilities
   read-only. The bootstrap concern (granting `studio.access` shouldn't require
   Studio) is resolved by the editor's env-scope entry point living **inside
   Setup** (`/apps/com.objectstack.setup/metadata/permission/:name`, `setup.access`),
   not by keeping a JSON/authoring field on the record.
4. **No permission concern is editable as free-text JSON anywhere in Setup** —
   record view, inline edit, and the create/edit form all render the facets
   read-only.

This is the objectui-side realization of ADR-0090's stated ObjectUI
consequences (Access pillar owns the matrix; provenance/default badges; explain
by construction) and extends the matrix from objects+fields to the full
permission-set surface.

### Phased rollout

All phases shipped in **objectstack-ai/objectui#2403** (browser-verified against
the app-showcase backend, ADR-0054 proofs). All are **objectui**; framework spec
touchpoints are called out as companion follow-ups (this ADR does not itself
change framework source).

- **P1 — Setup: all six facets → read-only summary + Studio deep-link.** ✅
  A new `permission-facet-link` widget renders each facet read-only (counts, or
  capability chips) plus a "Design in Studio →" deep-link into the env-scope
  `PermissionMatrixEditPage` (`/apps/:appName/metadata/permission/:setName`). The
  widget is stamped onto all six fields via the single
  `ObjectStackAdapter.getObjectSchema` choke point and honored by DetailSection
  (read + inline edit) and the record form. Kills the `[Object]`/JSON display.

- **P1b — Setup: user assignment on the record page.** ✅ The add/remove-users
  panel (`AssignedUsersSection`, via `sys_user_permission_set`) renders directly
  on the `sys_permission_set` record page (`RecordPermissionAssignmentsRenderer`).

- **P2 — Studio: System Capabilities editor.** ✅ A `sys_capability` multi-select
  (active, scope-grouped, labelled) added to `PermissionMatrixEditPage`, wired to
  `PermissionSetDraft.systemPermissions`. Capabilities are now *designed* here,
  not authored in Setup.

- **P3 — Studio: RLS / tab-visibility / admin-scope editors.** ✅ Structured
  editors (`PermissionAdvancedFacets`), collapsed by default below the object
  matrix: RLS per-policy rows (object · operation · enabled) with CEL USING/CHECK;
  tab visibility `visible | hidden | default_on | default_off`; delegated admin
  scope (business-unit + subtree, manage-assignments toggle,
  `assignablePermissionSets[]` allowlist; the -bindings / author-env-sets toggles
  were removed with objectui#12659 when the spec retired those keys). Each reads
  the draft's parsed field, tolerating a JSON string on load so legacy rows survive.

- **P4 — Assignment moved out of the design editor.** ✅ With assignment on the
  Setup record page (P1b), `AssignedUsersSection` is removed from
  `PermissionMatrixEditPage` — the editor is now purely a design surface, and no
  facet is editable as free-text JSON anywhere in Setup.

## Consequences

- **One authoring path per concern.** Objects/fields/RLS/tabs/admin-scope are
  authored once, in Studio, through validated editors the explain engine (D6)
  and publish linter (D7) can see. Capabilities are designed once, in Studio,
  through the `sys_capability` picker (P2); Setup only assigns permission sets
  to users (P1b) and shows every facet read-only (P1).
- **The Setup/Studio audience split (ADR-0084 / studio.app) is honored:**
  operators assign and grant-entry; makers design permissions.
- **AI-authoring safety improves** exactly where ADR-0090 wants it: no security
  concern is reachable as an unvalidated free-text blob.
- **Framework spec touchpoints:**
  - How the `sys_permission_set` form/detail renders was changed **objectui-side**
    (the `permission-facet-link` widget stamped in `getObjectSchema`) — no
    framework change was needed; the storage columns are untouched.
  - The RLS/tab/admin-scope editors read `RowLevelSecurityPolicySchema`,
    `tabPermissions` enum, and `AdminScopeSchema` from `@objectstack/spec` — no
    schema change, but the editors couple to those shapes.
  - **Open framework follow-up (Q7):** env-scope metadata saves of these facets
    don't project onto the queryable `sys_permission_set` data record the Setup
    summary reads — so Studio edits aren't reflected in Setup until the projection
    refreshes. Display-freshness only (enforcement reads the authoritative
    metadata), but it needs a framework-side fix to close the loop.
- **The structured editor becomes load-bearing for permission ops.** Designing a
  set now means opening the permission matrix editor; no facet can be authored
  from the record's own fields any more. The same editor has two entry points
  (Decision 1) — the package-scoped Studio Access pillar (`studio.access`) and
  Setup's own env-scope metadata route (`setup.access`) — so an operator who
  lacks `studio.access` can still design a set at environment scope, including
  granting `studio.access` itself. That is what dissolves the bootstrap knot A2
  worried about, and why P2 puts the capability picker in the structured editor
  instead of keeping a Setup exception (Decision 3).

## Open design questions

1. **Deep-link UX & scope (P1).** Setup permission sets are often
   **environment-authored** (`packageId` absent), but the Studio **Access
   pillar** is package-scoped (lists only a package's own sets). The deep-link
   target must therefore be the **environment-scope** `PermissionMatrixEditPage`
   (the editor already supports `packageId`-absent, whole-record save) reached
   via the shared `metadata-admin` permission route — **not** the package
   pillar. Confirm the exact route, how a package-managed (read-mostly) set is
   presented (matrix read-only + "edit in the owning package" per ADR-0086), and
   the back-navigation contract (return to the Setup row). Should the link
   cross-app-navigate (Setup → Studio) or open the matrix in a Setup-hosted
   route that reuses the component?
2. **What the RLS editor actually is (P4).** RLS `using`/`check` are CEL-style
   predicate expressions. A dropdown-only editor cannot express them; the real
   work is a **predicate/expression builder** (field · operator · value, with
   `current_user.*` context variables) that still round-trips hand-written CEL.
   How much of the expression surface (ADR-0058) is in scope for v1 vs a
   "simple rules + raw-CEL escape hatch" hybrid? Where do `contextVariables`
   (present in `PermissionSetSchema` but **not** a `sys_permission_set` column)
   live and get edited?
3. **Tab-visibility source of truth (P4).** Enumerating apps/tabs to offer
   `visible | hidden | default_on | default_off` — from installed apps metadata?
   Package-scoped or environment-wide? How are apps that appear/disappear after
   authoring reconciled?
4. **Admin-scope editor placement (P3/P4).** A row *inside* the object matrix,
   or a **separate Access-pillar panel**? `adminScope` is not per-object, so it
   does not fit the object×action grid; a sibling panel next to
   `AccessExplainPanel` is the likely shape. Needs the BU tree picker
   (`sys_business_unit`) and validation that `assignablePermissionSets` exist.
5. **Backward-compat for existing JSON on live sets.** Rows authored through the
   old textareas hold real JSON in all six columns. On first open in a
   structured editor: parse-and-render, and if a value is **malformed** or uses
   a shape the editor can't represent, fall back to a **read-only raw view + a
   guarded "edit JSON" escape hatch** rather than dropping data. Define the
   parse-failure contract, whether P5 keeps a hidden raw-JSON escape for
   irrecoverable values, and whether a one-time normalization/lint pass
   (ADR-0090 D7 family) should stamp legacy rows.
6. **~~`system_permissions` — Setup-only, or also in Studio?~~ — RESOLVED.**
   The Setup-only exception was dropped: capabilities are *designed* in the
   structured editor (Studio + Setup's env-scope route) and shown read-only on
   the Setup record page. No JSON/authoring field remains on the record.

7. **Metadata↔data-record projection freshness (NEW, from #2403 verification).**
   `sys_permission_set` has two representations: the **metadata** the structured
   editor writes (authoritative; enforcement + ADR-0090 explain read it), and the
   queryable **data record** (`/api/v1/data/sys_permission_set`, snake_case
   JSON-string columns) the Setup read-only summary reads. Env-scope metadata
   saves are live, but do **not** currently project onto the data record — so a
   fresh Studio edit isn't reflected in Setup's summary until the projection
   refreshes. This is display-freshness only (enforcement is correct), but it
   breaks the closed loop. **Framework follow-up:** make the projection track
   metadata saves, or have the Setup summary read the metadata directly.

## Alternatives considered

- **A1 — Keep both surfaces, just add validation to the JSON.** Rejected:
  validated JSON is still the anti-structure ADR-0090 removes; two authoring
  paths for objects/fields remain, and the RLS/tab/admin-scope concerns still
  have no usable editor. Lipstick on the footgun.
- **A2 — Move *everything* (including capabilities) into the structured editor;
  Setup only assigns. → ADOPTED (the pure model).** Originally rejected over a
  bootstrap knot (granting `studio.access` shouldn't require Studio). Resolved by
  reaching the structured editor from Setup's **own** env-scope metadata route
  (`setup.access`), not only the Studio pillar — so capability *design* is
  available to an operator without a separate Studio entry, and no
  authoring/JSON field stays on the record. This is what #2403 shipped.
- **A3 — Move all editing into Setup; delete the Studio matrix.** Rejected:
  inverts ADR-0084's maker/operator split, and Setup's generic object form is
  the raw-JSON surface we are trying to eliminate. The structured matrix is the
  asset, not the liability.
- **A4 — One mega-editor for all six concerns.** Rejected: the concerns have
  different shapes (object×action grid vs per-policy RLS list vs scalar
  capability set vs BU-scoped admin grant) and different audiences (P2 stays in
  Setup). Phase them as focused editors sharing the Access-pillar shell.
- **A5 — File this as framework ADR-0093 instead of objectui ADR-0056.**
  Defensible: the permission *model* ADRs (0049/0066/0086/0090/0092) all live in
  framework, and P2/P5 have framework spec touchpoints. Chosen against as the
  default because **all five phases are objectui UI-surface-ownership
  decisions** — precisely what objectui's ADR series records (0053 nav, 0054
  testability, 0055 bare-data-surface). If reviewers prefer the framework home,
  renumber to 0093 and keep the objectui cross-refs; the content is unchanged.

## References

- objectui: `packages/app-shell/src/views/metadata-admin/PermissionMatrixEditor.tsx`,
  `views/metadata-admin/AccessExplainPanel.tsx`,
  `views/studio-design/StudioDesignSurface.tsx` (`AccessPillar`),
  `services/builtinComponents.tsx` (registers `type: 'permission'` → the matrix).
- framework: `packages/plugins/plugin-security/src/objects/sys-permission-set.object.ts`
  (the six textarea columns), `objects/sys-capability.object.ts`,
  `security-plugin.ts` (Setup Access-Control nav; `permission` draft → published
  `sys_permission_set`), `packages/spec/src/security/permission.zod.ts`
  (`PermissionSetSchema`, `AdminScopeSchema`), `security/permission.form.ts`,
  `security/capabilities.ts` (`PLATFORM_CAPABILITIES`), `security/rls.zod.ts`.
- ADRs: framework ADR-0090 (permission model v2), ADR-0092 (identity write
  guard), ADR-0086 (authz metadata↔config boundary), ADR-0066 (unified authz /
  `sys_capability`), ADR-0049 (no unenforced security properties), ADR-0084
  (application-builder IA); objectui ADR-0053 / ADR-0054 / ADR-0055.
