---
name: objectstack-data
description: >
  Design ObjectStack data schemas — objects, fields, relationships,
  validations, indexes, hooks, security, seeds and datasources. Use when the
  user is creating or modifying `*.object.ts` files or `src/data/*.ts` seed
  modules, picking field types, modelling relationships, writing
  `beforeInsert`/`afterUpdate` hooks, configuring per-object access control,
  pointing an object at an existing external database, or authoring bootstrap
  / demo data. Use for `visibleWhen` / `readonlyWhen` / `requiredWhen` rules
  that belong on fields. Do not use for querying data (see objectstack-query)
  or for plugin / kernel hooks (see objectstack-platform). CEL expressions:
  load objectstack-formula alongside.
license: Apache-2.0
compatibility: Requires @objectstack/spec 17.x (Zod v4 schemas)
metadata:
  author: objectstack-ai
  version: "4.4"
  domain: data
  tags: object, field, validation, index, relationship, hook, schema, permission, rls, security, seed, fixture
---

# Data Modeling — ObjectStack Data Protocol

## Skill Boundaries

| Need | Use instead |
|:-----|:------------|
| Query, filter, or aggregate records | **objectstack-query** |
| Define REST API endpoints or auth | **objectstack-api** |
| Build views, dashboards, or apps | **objectstack-ui** |
| Create a plugin or register services | **objectstack-platform** |

---

## Quick Reference — Detailed Rules

For comprehensive documentation with incorrect/correct examples:

- **[Naming Conventions](./rules/naming.md)** — snake_case rules, option values, config properties
- **[Field Types](./rules/field-types.md)** — All 49 field types and configs
- **[Relationships](./rules/relationships.md)** — lookup vs master_detail, junction patterns, delete behaviors
- **[Validation Rules](./rules/validation.md)** — All validation types, script inversion, severity levels
- **[Index Strategy](./rules/indexing.md)** — btree/gin/gist/fulltext, composite indexes, partial indexes
- **[Data Lifecycle & Retention](./rules/lifecycle.md)** — `lifecycle` classes (record/audit/telemetry/transient/event), retention/TTL/rotation/archive policies; ❗ append-only objects must declare one (distinct from lifecycle *hooks* below)
- **[Lifecycle Hooks](./references/data-hooks.md)** — the 8 lifecycle events, `handler` vs sandboxed `body` (ctx + capability contract), registration, canonical patterns
- **[Datasources & Federation](./rules/datasources.md)** — `defineDatasource`, external/federated objects (`remoteName`/`columnMap`), auto-connect gating, credentials; ❌ no `field.columnName` on external objects
- **[Security & Access Control](./rules/security.md)** — permission sets, assignment rows, RLS policies, `secret` / `requiredPermissions`, `tenancy`, platform-global posture

---

## Core Concepts

### Object Definition

An **Object** is the fundamental data entity in ObjectStack. It maps to a
database table and exposes automatic CRUD APIs.

**Required properties:**

| Property | Type   | Convention | Description |
|:---------|:-------|:-----------|:------------|
| `name`   | string | `snake_case` | Immutable machine identifier (`/^[a-z_][a-z0-9_]*$/`) |
| `fields` | map    | keys in `snake_case` | Field definitions |
| `sharingModel` | enum | one of the four below | Org-wide default record visibility (OWD). Zod marks it optional, but **a publish with no authored `sharingModel` is refused** with the 422 lint envelope `security-owd-unset` — absence is not a decision (maintainer ruling 2026-08-13). Author it on every object |

**`sharingModel` — the four canonical values** (ADR-0090 D4; legacy aliases
removed). A *custom* object that omits it resolves to `private` at runtime, but
the publish door rejects it before that:

| Value | Who can read / write |
|:--|:--|
| `private` | owner only (widen with sharing rules, RLS, or `readScope`/`writeScope`) |
| `public_read` | everyone reads; the owner writes |
| `public_read_write` | everyone reads and writes |
| `controlled_by_parent` | inherited from the master record (`master_detail` children) |

**Important optional properties:**

| Property | Default | Description |
|:---------|:--------|:------------|
| `label` | Auto from `name` | Human-readable singular label |
| `pluralLabel` | — | Plural form (e.g., "Accounts") — on 31/31 objects in the reference apps; author it alongside `label` |
| `icon` | — | Icon name for nav, list headers and lookup pickers — on 31/31 objects in the reference apps |
| `highlightFields` | derived | Ordered field keys used as a record's compact face: the columns a **related list** renders on the parent's detail page, and what a lookup picker shows. Declare it on the CHILD object (see [Relationships](./rules/relationships.md)) |
| `namespace` | — | **Not a schema key** — `ObjectSchema.create()` rejects unknown keys, so authoring it is a build error. Embed the prefix directly in `name` instead (e.g. `name: 'crm_account'`) |
| `datasource` | `'default'` | Target datasource ID for virtualized data |
| `nameField` | derived (e.g. `'name'`/`'title'`) | **Canonical** record-title field — the stored field used as the record's display name. Use a single text/email field, or a formula field (`returnType: 'text'`) for a composite title |
| `displayNameField` | — | **Deprecated** alias for `nameField` (still honored as a fallback) |
| `titleFormat` | — | **Deprecated, not removed (ADR-0079)** — render-only: the server can't return or query it. Use `nameField` (it wins); for a composite title, designate a `returnType: 'text'` formula field as `nameField` |
| `enable` | — | Capability flags (trackHistory, searchable, apiEnabled, etc.) |
| `fieldGroups` | — | Ordered list of logical field groups for forms/detail pages (see [Field Groups](./references/examples-objects.md#field-groups-mvp)) |
| `lifecycle` | `record` semantics (permanent) | Data retention/rotation/archival contract. **Required for append-only, high-write-rate objects** — a `telemetry`/`transient`/`event`/`audit` class must declare a bounding policy or parsing fails (see [Data Lifecycle & Retention](./rules/lifecycle.md)) |

### Object Capabilities (`enable`)

Toggle system behaviours per object:

| Flag | Default | Purpose |
|:-----|:--------|:--------|
| `trackHistory` | `false` | Field-level audit trail |
| `searchable` | `true` | Index records for global search |
| `apiEnabled` | `true` | Expose via automatic REST + MCP APIs |
| `apiMethods` | all | Whitelist over the six primitives (`get`, `list`, `create`, `update`, `delete`, `bulk`); derived verbs (search/export/upsert/…) follow automatically |
| `files` | `false` | Attachments & document management |
| `feeds` | `true` | Social feed, comments, mentions — **opt-out**: explicit `false` hides the feed UI and rejects new comments |
| `activities` | `true` | Activity timeline (`sys_activity` mirror of CRUD) — **opt-out**: explicit `false` stops mirroring and hides the timeline |
| `clone` | `true` | Record deep cloning |

---

## Search Fields (`searchableFields`)

`searchableFields` on the object is the canonical set `$search` scans (ADR-0061).
Leave it unset and search auto-defaults to the `nameField` plus the object's
short-text and enum columns (`text` / `email` / `phone` / `url` / `autonumber` /
`textarea` / `markdown` / `select` / `status`); declare it to pin the set
explicitly. Views may narrow it, never widen it.

### ⛔ Searching by a related record's title — mirror the value, always

`$search` scans **the queried object's own columns**. A dotted path is never a
search target: unlike `fields` / `sort` / `filters`, the search axis does not
resolve traversal, and `project_id.name` in `searchableFields` (or in a
`$searchFields` override) is **refused**, not silently dropped.

**This is the one prescription — emit it every time.** To search by a related
record's title, copy that title into a **stored field on this object** and
declare *that* field searchable. A task list searched by project name:

```typescript
// `project_name` is a stored, denormalized mirror of the parent's title.
{
  name: 'task',
  enable: { searchable: true },
  fields: {
    name:         { type: 'text', required: true },
    project_id:   { type: 'lookup', reference: 'project' },
    project_name: { type: 'text', label: 'Project Name' },   // ← the mirror
  },
  searchableFields: ['name', 'project_name'],
}
```

`?search=apollo` expands to `name $contains 'apollo' OR project_name $contains
'apollo'` — one single-table scan, every driver, no traversal. (A `text` mirror
also lands in the auto-default set when the object declares no
`searchableFields`.)

❌ **Never mirror onto a `formula` field.** A formula field is *virtual* — no
driver materializes a column for it, so a `$contains` predicate against one has
nothing to scan (the SQL driver would emit a `WHERE` over a column that does not
exist). CEL also only reads this record's own fields (`record.<field>`), so a
formula cannot fetch the related title in the first place. The
mistake is **refused, not silent**: a `formula` entry in any `searchableFields`
— the object's own set included — is an `os validate` error
(`searchable-field-unsearchable`), and a request naming one is `400
INVALID_FIELD`. It used to clear both and then never match.

**Mirror maintenance is the trade-off** — a mirror is denormalized data, only as
fresh as whatever writes it. Cover both write paths:

| When | What maintains the mirror |
|:-----|:--------------------------|
| A task is created, or re-pointed at another project | `beforeInsert` / `beforeUpdate` hook on `task` — read the parent's `name` for the incoming `project_id`, stamp `project_name` |
| A project is renamed | `afterUpdate` hook on `project` — re-stamp `project_name` on that project's tasks |

Rows written by a path that bypasses hooks (bulk import, direct SQL) need a
one-off backfill. See [Lifecycle Hooks](./references/data-hooks.md).

Both spellings are refused loudly: `os validate` reports
`searchable-field-unknown`, and a request naming the dotted path is `400
INVALID_FIELD`. Each message carries its own prescription.

Cross-object search paths are rejected by design, not pending. Do not invent a
per-project convention for this — the mirror field is the answer.

---

→ Moved verbatim to [references/examples-objects.md](./references/examples-objects.md) § Field Groups (MVP).

---

## Conditional Field Rules

Put conditional UI/data-entry rules on the **field definition** when the rule
belongs to the data model and should apply everywhere the field is edited:
default forms, Studio-authored forms, inline master-detail grids, public forms,
and API-backed writes.

<!-- os:check -->
```typescript
import { P } from '@objectstack/spec';
import { ObjectSchema, Field } from '@objectstack/spec/data';

export const Invoice = ObjectSchema.create({
  name: 'invoice',
  sharingModel: 'private',
  fields: {
    status: Field.select({
      options: [
        { label: 'Draft', value: 'draft' },
        { label: 'Sent', value: 'sent' },
        { label: 'Paid', value: 'paid' },
        { label: 'Void', value: 'void' },
      ],
    }),
    paid_at: Field.datetime({
      visibleWhen: P`record.status == 'paid'`,
      requiredWhen: P`record.status == 'paid'`,
    }),
    locked_total: Field.currency({
      readonlyWhen: P`record.status == 'paid'`,
    }),
  },
});
```

- Use `visibleWhen` to hide irrelevant fields in ObjectUI forms.
- Use `readonlyWhen` for state-locked fields; the ObjectQL write path ignores
  incoming changes when the predicate is `TRUE`.
- **`readonly: true` governs the end-user surface, not trusted system writers.**
  A non-system write (REST/UI, and any `runAs:'user'` flow — the default) has
  the field **stripped** from any non-system write; the write reports
  success but the value never lands. System-context writes —
  `runAs:'system'` flows, system hooks, seeds, imports, migrations — are exempt
  and DO write it. So the pattern "users can't edit this, but automation
  maintains it" is expressed by declaring the field `readonly` **and** running
  the maintaining flow `runAs:'system'` (see **objectstack-automation**), not by
  removing `readonly`. Writing a `readonly` field from a `runAs:'user'`
  `update_record` node is a build-time **error** (`os validate` / `os build`).
- Use `requiredWhen` for conditional requiredness; the ObjectQL validator
  enforces it on submit. The `conditionalRequired` alias was REMOVED in
  protocol 17 — emitting it is a parse error.
- **Choose by intent — invariant or transition gate.** A fact true of *every
  stored record* is an invariant: a `validations[]` `script` rule. A row that
  violates it is refused on any edit until repaired. A *transition* condition
  ("required once the record reaches `paid`") is `requiredWhen` / field bounds,
  which judge the write, not the stored row. "Required when X" reads like an
  invariant and is not one; an invariant written as a gate never enforces
  itself.
- For inline `master_detail` grids, predicates are evaluated row-by-row against
  the child row's `record`, so line-item rules should live on child fields.
- For complex predicates, load **objectstack-formula** and emit CEL via
  `P\`...\``; do not use Salesforce-style `AND`, `IN (...)`, or `{field}`
  syntax.

---

→ Moved verbatim to [references/examples-objects.md](./references/examples-objects.md) § Quick-Start Template.

---

## Schema evolution on an existing database

The metadata→DB sync is **additive-only**: new tables/columns are created on
boot, but existing columns are **never** altered or dropped. A non-additive
change to an object that already has data silently diverges from the physical
schema, and the **database column wins at write time**:

| Change | Existing DB on restart |
|--------|------------------------|
| add object / field / index | ✅ applied automatically (additive) |
| `storage: { notNull: true }` removed (relax `NOT NULL`) | ⚠️ **never auto-applied** — the drift is `category: 'needs_confirm'` (`relax_not_null`), so `os migrate apply` confirms it. Relaxing `required` alone changes no column |
| `unique` re-scoped global → per-tenant | dev auto-heals; otherwise `os migrate apply` (`replace_unique_index`) |
| type / length change, drop field, rename | `os migrate apply` (`--allow-destructive` for drops / tightenings) |
| declared index removed, or its columns changed | `os migrate apply` (`--allow-destructive` when it drops, or rebuilds as `UNIQUE`) |

**`required` is not the `NOT NULL` dial (ADR-0113).** `required` is the
**write contract** — the engine refuses an insert that omits the value — and it
implies nothing about the column. The physical constraint is a separate explicit
opt-in, `storage: { notNull: true }`, and it is what drift detection compares
against. So tightening `required` on a deployed object is safe (existing null
rows stay readable), while declaring `storage.notNull` over null rows is a
destructive migration. The two cannot be combined with `requiredWhen` — a
conditional contract cannot be an unconditional column constraint.

Tell-tale: `/meta` reports a field optional (no `required`, no `storage.notNull`)
but writes that omit it fail with a **raw driver error** rather than a clean
validation 400 — that is a stale `NOT NULL` column, not a validator bug. Run
`os migrate plan` to preview and `os migrate apply` to reconcile, or ratify the
column by declaring `storage: { notNull: true }`. CLI details: see
**objectstack-platform**.

---

## Common Patterns

### Naming Rules Summary

| Context | Convention | Example |
|:--------|:-----------|:--------|
| Object `name` | `snake_case` | `project_task` |
| Field keys | `snake_case` | `first_name`, `due_date` |
| Schema properties | `camelCase` | `maxLength`, `lookupFilters` |
| Option `value` | lowercase | `in_progress` |

See [rules/naming.md](./rules/naming.md) for incorrect/correct examples.

### Field Type Selection

49 types available. Quick categories:

- **Text:** `text`, `textarea`, `email`, `url`, `phone`, `password`, `markdown`, `html`, `richtext` — ⚠️ `password` on a generic object is **plaintext at rest** (masked on read, never hashed); prefer `secret` for credentials
- **Secret:** `secret` — reversible, **encrypted-at-rest** credential (DB password, API key, token) via the registered `ICryptoProvider`; masked on read, fail-closed (ADR-0100). The recommended type for credentials
- **Numbers:** `number`, `currency`, `percent`
- **Date/Time:** `date`, `datetime`, `time`
- **Logic:** `boolean`, `toggle`
- **Selection:** `select`, `multiselect`, `radio`, `checkboxes`
- **Relational:** `lookup`, `master_detail`, `tree`, `user` — `user` is a person picker (a lookup specialized to `sys_user`; stored identically to `lookup`)
- **Media:** `image`, `file`, `avatar`, `video`, `audio`
- **Calculated:** `formula`, `summary`, `autonumber` — `formula` fields take a CEL expression in `expression` (use `F\`...\`` from `@objectstack/spec`); see **objectstack-formula** skill
- **Embedded:** `composite`, `repeater`, `record` — embedded JSON sub-objects stored on the parent row (no separate table / FK)
- **Enhanced:** `location`, `address`, `code`, `json`, `color`, `rating`, `slider`, `signature`, `qrcode`, `progress`, `tags`, `vector`

See [rules/field-types.md](./rules/field-types.md) for full reference.

### Relationship Patterns

| Pattern | Implementation |
|:--------|:---------------|
| One-to-Many (independent) | `lookup` field on child |
| One-to-Many (owned) | `master_detail` field on child |
| Many-to-Many (simple) | multi-value `lookup` (`multiple: true`) — an **array column** of ids |
| Many-to-Many (with attributes) | Junction object with two `lookup` fields |
| Hierarchical | `tree` field (self-reference) |

See [rules/relationships.md](./rules/relationships.md) for detailed examples.

> **`multiple: true` lookup ≠ junction object.** A multi-value lookup
> (`{ type: 'lookup', reference: 'x', multiple: true }`) is stored and read as an
> **array of ids** on the record — reference elements positionally
> (`{record.tags.0}` in flow values). It is NOT a junction table. Reach for a
> **junction object** (two lookups) only when the relationship itself carries
> attributes (role, added_at, …).

### Validation Patterns

**⚠️ Script validation is inverted:** Validation **fails** when expression is `true`.

> On **insert**, an optional field omitted from the payload reads as `null` in a
> validation predicate — so `record.due_date == null` matches an omitted field the
> same as an explicit `null`. (On update, the prior record supplies it.)

The **complete** set of validation types (`ValidationRuleSchema` discriminators):
- `script` — Formula expression (inverted logic)
- `state_machine` — Legal state transitions
- `format` — Regex or built-in format
- `cross_field` — Compare values across fields
- `json_schema` — Validate a JSON field against a JSON Schema
- `conditional` — Apply a nested rule only `when` a predicate holds

> **There is NO `unique` validation type** (removed from the spec).
> Enforce uniqueness — including composite — with a **unique index**, and state
> its scope (ADR-0120):
> `indexes: [{ fields: ['department', 'email'], unique: 'organization' }]`.

See [rules/validation.md](./rules/validation.md) for all types and examples.

### Index Patterns

**The whole declaration surface is `fields` / `unique` / `name`.** `unique`
defaults to `false`; omit it when that is what you mean.

```typescript
indexes: [
  { fields: ['status', 'created_at'] },                // composite
  { fields: ['email'], unique: 'organization' },       // unique per organization
  { fields: ['hostname'], unique: 'global' },          // unique platform-wide
  { name: 'idx_acct_status', fields: ['status'] },     // custom name
]
```

> **`type` and `partial` were retired at protocol 17**: no driver
> ever read either, so an authored `type` chose no access method and an authored
> `partial` produced a full index with the predicate discarded. Both are now a
> `tsc` error and a parse error; `os migrate meta --from 16` strips them. Access
> methods and partial predicates are database-layer migrations.

> **A unique index must state its scope** — `'organization'` (one holder per
> organization, NULL-safe) or `'global'` (one holder across the installation).
> On a declared index bare `unique: true` is the deprecated spelling of
> `'global'`: it reads like "per organization" and does the opposite, so `os lint`
> warns and protocol 18 rejects it. On a FIELD, `unique: true` means
> `'organization'` and stays valid.

See [rules/indexing.md](./rules/indexing.md) for composite indexes, unique scope,
and how to build partial / gin / gist indexes at the database layer.

→ Moved verbatim to [references/examples-objects.md](./references/examples-objects.md) § Lifecycle Hooks (the hooks reference itself is [references/data-hooks.md](./references/data-hooks.md)).

---

---

## Object Extension Model

To add fields/validations/indexes to an object you do not own, author
`defineObjectExtension({ extend, fields, priority })` and register it on
`defineStack({ objectExtensions: [...] })`. `priority` sets merge order (default
`200`, range `0–999`); an extension can add but never remove. ⛔ Not the same key
as object-level `ownership` (the record-ownership enum
`'user' | 'business_unit' | 'org' | 'none'`). Schema:
`node_modules/@objectstack/spec/src/data/object.zod.ts` (`ObjectExtensionSchema`).

---

## Security & Access Control

Per-object access control is authored in **permission sets**, not on the object
schema. There is no object-level `permissions` key (and no `hooks` key either) —
`ObjectSchema.create()` **rejects** both as unknown keys.

Full rules: **[Security & Access Control](./rules/security.md)**.

### Access depth (scope-depth) — the ERP "see my unit / my unit and below" axis

On an owner-scoped (`private`) object, a per-object grant in a permission set may
carry `readScope` / `writeScope` to widen the owner match declaratively instead of
hand-writing an RLS policy (ADR-0057 D1): `own` (default) · `own_and_reports` ·
`unit` · `unit_and_below` · `org`. It resolves at request time into an
`owner_id IN (…)` set and AND-injects like RLS. ⚠️ Open-core boundary (ADR-0016):
only `own` and `org` work in open source — the hierarchy-relative three need the
paid `@objectstack/security-enterprise` plugin, **fail closed to `own`** without
it, and `defineStack` errors unless the grant declares
`requires: ['hierarchy-security']`. Schema: `PermissionSetSchema.objects.*`.

---

→ Moved verbatim to [references/examples-objects.md](./references/examples-objects.md) § Metadata Protection (`protection`).

---

→ Seed Data & Fixtures (`defineSeed()`) moved verbatim to [references/seeds.md](./references/seeds.md) (Quick start · `Seed` fields · Import modes · `externalId` selection · Relationship references · Dynamic values (CEL) · Seed best practices).

---

→ Linting & Generation Quality moved verbatim to [references/lint-rules.md](./references/lint-rules.md).

---

## Verify your work

After authoring or editing any `*.object.ts` / `*.seed.ts`, run the author-time
gate before reporting done:

```bash
os validate     # Zod schema + CEL predicates (record.<field> existence) + bindings
# or: os build  # the same gates, plus emits dist/
```

It catches what otherwise fails **silently at runtime**: a bare field ref in a
`requiredWhen` / `readonlyWhen` / `visibleWhen`, a validation rule, a formula, or
a row-level-security/sharing predicate (`done` instead of `record.done`) that
evaluates to `null` and never fires. `os lint` is a *separate*
pass that additionally checks the data model against the conventions in this
skill (relationships, master-detail, roll-ups) — run it too, but it does **not**
replace `os validate`. (Reminder: two consecutive `os build` runs with no source
change must be byte-identical — see the determinism gate above.) In a scaffolded
project the gate is `npm run validate`.

---

## References

See [references/_index.md](./references/_index.md) for the full list of Zod
schemas (with one-line descriptions) — pointers into
`node_modules/@objectstack/spec/src/`. Always `Read` the source for exact field
shapes; do not rely on memory of property names.
