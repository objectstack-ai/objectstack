---
name: objectstack-data
description: >
  Design ObjectStack data schemas — objects, fields, field conditional
  rules, relationships, validations, indexes, lifecycle hooks, permissions,
  row-level security —
  and the seeds (`defineSeed()`) that load fixtures and
  reference data alongside them. Use when the user is creating or
  modifying `*.object.ts` / `*.seed.ts` files, picking field types,
  modelling relationships, writing `beforeInsert`/`afterUpdate` hooks,
  configuring per-object access control, or authoring bootstrap / demo
  data. Use for `visibleWhen` / `readonlyWhen` / `requiredWhen` rules that
  belong on fields. Do not use for querying data (see objectstack-query) or for
  plugin / kernel hooks (see objectstack-platform). CEL expressions in
  formulas / validations / sharing rules / dynamic seed values: load
  objectstack-formula alongside.
license: Apache-2.0
compatibility: Requires @objectstack/spec 16.x (Zod v4 schemas)
metadata:
  author: objectstack-ai
  version: "4.3"
  domain: data
  tags: object, field, validation, index, relationship, hook, schema, permission, rls, security, seed, fixture
---

# Data Modeling — ObjectStack Data Protocol

Expert instructions for designing business data schemas using the ObjectStack
specification. This skill covers Object definitions, Field type selection,
relationship modelling, validation rules, index strategy, and lifecycle hooks.

---

## Skill Boundaries

| Need | Use instead |
|:-----|:------------|
| Query, filter, or aggregate records | **objectstack-query** |
| Define REST API endpoints or auth | **objectstack-api** |
| Build views, dashboards, or apps | **objectstack-ui** |
| Create a plugin or register services | **objectstack-platform** |

---

## When to Use This Skill

- You are creating a **new business object** (e.g., `account`, `project_task`)
- You need to **choose the right field type** from the 49 supported types
- You are configuring **lookup / master-detail relationships** between objects
- You need to add **validation rules** (cross-field, state machine, format, etc.)
- You are optimising **query performance with indexes**
- You are extending an existing object with new fields or capabilities
- You need to **implement data lifecycle hooks** for business logic

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

**Important optional properties:**

| Property | Default | Description |
|:---------|:--------|:------------|
| `label` | Auto from `name` | Human-readable singular label |
| `pluralLabel` | — | Plural form (e.g., "Accounts") |
| `namespace` | — | **Not a schema key** — `ObjectSchema.create()` rejects unknown keys, so authoring it is a build error. Embed the prefix directly in `name` instead (e.g. `name: 'crm_account'`) |
| `datasource` | `'default'` | Target datasource ID for virtualized data |
| `nameField` | derived (e.g. `'name'`/`'title'`) | **Canonical** record-title field — the stored field used as the record's display name. Use a single text/email field, or a formula field (`returnType: 'text'`) for a composite title |
| `displayNameField` | — | **Deprecated** alias for `nameField` (still honored as a fallback) |
| `titleFormat` | — | **Retired (ADR-0079)** — a render-only template the server can't return or query. Use `nameField`; for a composite title, designate a `returnType: 'text'` formula field as `nameField` |
| `enable` | — | Capability flags (trackHistory, searchable, apiEnabled, etc.) |
| `fieldGroups` | — | Ordered list of logical field groups for forms/detail pages (see [Field Groups](#field-groups-mvp)) |
| `lifecycle` | `record` semantics (permanent) | Data retention/rotation/archival contract (ADR-0057). **Required for append-only, high-write-rate objects** — a `telemetry`/`transient`/`event`/`audit` class must declare a bounding policy or parsing fails (see [Data Lifecycle & Retention](./rules/lifecycle.md)) |

### Object Capabilities (`enable`)

Toggle system behaviours per object:

| Flag | Default | Purpose |
|:-----|:--------|:--------|
| `trackHistory` | `false` | Field-level audit trail |
| `searchable` | `true` | Index records for global search |
| `apiEnabled` | `true` | Expose via automatic REST / GraphQL APIs |
| `apiMethods` | all | Whitelist specific operations (`get`, `list`, `create`, …) |
| `files` | `false` | Attachments & document management |
| `feeds` | `true` | Social feed, comments, mentions — **opt-out**: explicit `false` hides the feed UI and rejects new comments |
| `activities` | `true` | Activity timeline (`sys_activity` mirror of CRUD) — **opt-out**: explicit `false` stops mirroring and hides the timeline |
| `clone` | `true` | Record deep cloning |

---

## Field Groups (MVP)

Organize fields into logical groups (e.g., "Contact Information", "Billing",
"System") for forms, detail pages, and editors.

- Declare groups on `ObjectSchema.fieldGroups` — **array order is the display order**.
- Assign each field to a group via `Field.group`, which references an
  `ObjectFieldGroup.key`. In-group display order equals the traversal order
  of `fields`.
- Group keys must be `snake_case`; group labels are human-readable.
- Optional per-group: `icon`, `description`, and `collapse`
  (`'none'` always open · `'expanded'` collapsible, starts open ·
  `'collapsed'` collapsible, starts closed — replaces the deprecated
  `defaultExpanded` flag, ADR-0085). Groups render identically on forms,
  modals, and detail pages; for a bespoke single-page layout assign a
  custom Page instead.

<!-- os:check -->
```typescript
import { ObjectSchema } from '@objectstack/spec/data';

export default ObjectSchema.create({
  name: 'account',
  label: 'Account',

  fieldGroups: [
    { key: 'contact_info', label: 'Contact Information', icon: 'user' },
    { key: 'billing',      label: 'Billing', collapse: 'collapsed' },
    { key: 'system',       label: 'System' },
  ],

  fields: {
    name:       { type: 'text',  required: true, group: 'contact_info' },
    email:      { type: 'email',                  group: 'contact_info' },
    phone:      { type: 'phone',                  group: 'contact_info' },
    vat_id:     { type: 'text',                   group: 'billing' },
    billing_address: { type: 'address',           group: 'billing' },
    created_at: { type: 'datetime', readonly: true, group: 'system' },
    created_by: { type: 'lookup', reference: 'user', readonly: true, group: 'system' },
  },
});
```

**Supported migrations at this layer:** add / rename / delete / reorder groups
(edit the `fieldGroups` array), assign a field to a group (edit `Field.group`).
Explicit per-field in-group ordering is deferred to a future iteration.

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
  the field **silently stripped** from an UPDATE payload; the write reports
  success but the value never lands (#2948). System-context writes —
  `runAs:'system'` flows, system hooks, seeds, imports, migrations — are exempt
  and DO write it. So the pattern "users can't edit this, but automation
  maintains it" is expressed by declaring the field `readonly` **and** running
  the maintaining flow `runAs:'system'` (see **objectstack-automation**), not by
  removing `readonly`. Writing a `readonly` field from a `runAs:'user'`
  `update_record` node is a build-time **error** (`os validate` / `os build`).
- Use `requiredWhen` for conditional requiredness; the ObjectQL validator
  enforces it on submit. `conditionalRequired` is a deprecated compatibility
  alias, not the preferred authoring field.
- For inline `master_detail` grids, predicates are evaluated row-by-row against
  the child row's `record`, so line-item rules should live on child fields.
- For complex predicates, load **objectstack-formula** and emit CEL via
  `P\`...\``; do not use Salesforce-style `AND`, `IN (...)`, or `{field}`
  syntax.

---

## Quick Reference — Detailed Rules

For comprehensive documentation with incorrect/correct examples:

- **[Naming Conventions](./rules/naming.md)** — snake_case rules, option values, config properties
- **[Field Types](./rules/field-types.md)** — All 49 field types with decision tree and configs
- **[Relationships](./rules/relationships.md)** — lookup vs master_detail, junction patterns, delete behaviors
- **[Validation Rules](./rules/validation.md)** — All validation types, script inversion, severity levels
- **[Index Strategy](./rules/indexing.md)** — btree/gin/gist/fulltext, composite indexes, partial indexes
- **[Data Lifecycle & Retention](./rules/lifecycle.md)** — `lifecycle` classes (record/audit/telemetry/transient/event), retention/TTL/rotation/archive policies; ❗ append-only objects must declare one (distinct from lifecycle *hooks* below)
- **[Lifecycle Hooks](./rules/hooks.md)** — Hook quick reference (→ see [references/data-hooks.md](./references/data-hooks.md) for the full 8-event guide + the sandboxed `body` ctx/capability contract)
- **[Datasources & Federation](./rules/datasources.md)** — `defineDatasource`, external/federated objects (`remoteName`/`columnMap`), auto-connect gating, credentials; ❌ no `field.columnName` on external objects

---

## Quick-Start Template

<!-- os:check -->
```typescript
import { ObjectSchema } from '@objectstack/spec/data';

export default ObjectSchema.create({
  name: 'support_case',
  label: 'Support Case',
  enable: {
    trackHistory: true,
    feeds: true,
    activities: true,
  },
  fields: {
    subject:     { type: 'text', required: true, maxLength: 255 },
    description: { type: 'richtext' },
    status:      { type: 'select', required: true, options: [
      { label: 'New',       value: 'new', default: true },
      { label: 'Open',      value: 'open' },
      { label: 'Escalated', value: 'escalated', color: '#e74c3c' },
      { label: 'Resolved',  value: 'resolved',  color: '#2ecc71' },
      { label: 'Closed',    value: 'closed' },
    ]},
    priority:    { type: 'select', options: [
      { label: 'Low',    value: 'low' },
      { label: 'Medium', value: 'medium', default: true },
      { label: 'High',   value: 'high',   color: '#e67e22' },
      { label: 'Urgent', value: 'urgent',  color: '#e74c3c' },
    ]},
    account:     { type: 'lookup', reference: 'account', required: true },
    contact:     { type: 'lookup', reference: 'contact' },
    assigned_to: { type: 'lookup', reference: 'user' },
    due_date:    { type: 'datetime' },
  },
  validations: [
    {
      name: 'status_flow',
      type: 'state_machine',
      field: 'status',
      transitions: {
        new:       ['open'],
        open:      ['escalated', 'resolved'],
        escalated: ['open', 'resolved'],
        resolved:  ['open', 'closed'],
        closed:    [],
      },
      message: 'Invalid status transition.',
    },
  ],
  indexes: [
    { fields: ['status', 'priority'] },
    { fields: ['account'] },
  ],
});
```

---

## Schema evolution on an existing database

The metadata→DB sync is **additive-only**: new tables/columns are created on
boot, but existing columns are **never** altered or dropped. A non-additive
change to an object that already has data silently diverges from the physical
schema, and the **database column wins at write time** (#2186):

| Change | Existing DB on restart |
|--------|------------------------|
| add object / field / index | ✅ applied automatically (additive) |
| `required: true → false` (relax `NOT NULL`) | dev auto-heals (`autoMigrate:'safe'`); otherwise `os migrate apply` |
| type / length change, drop field, rename | `os migrate apply` (`--allow-destructive` for drops / tightenings) |

Tell-tale: `/meta` reports a field optional but a write still 400s
`"<field> is required"` — that is a stale `NOT NULL` column (physical drift),
**not** a validator bug. `os dev` reconciles loosening automatically; otherwise
`os migrate plan` to preview and `os migrate apply` to reconcile. CLI details:
see **objectstack-platform**.

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
> attributes (role, added_at, …). (#1872)

### Validation Patterns

**⚠️ Script validation is inverted:** Validation **fails** when expression is `true`.

> On **insert**, an optional field omitted from the payload reads as `null` in a
> validation predicate — so `record.due_date == null` matches an omitted field the
> same as an explicit `null` (#1871). (On update, the prior record supplies it.)

The **complete** set of validation types (`ValidationRuleSchema` discriminators):
- `script` — Formula expression (inverted logic)
- `state_machine` — Legal state transitions
- `format` — Regex or built-in format
- `cross_field` — Compare values across fields
- `json_schema` — Validate a JSON field against a JSON Schema
- `conditional` — Apply a nested rule only `when` a predicate holds

> **There is NO `unique` validation type** (removed from the spec in #1475).
> Enforce uniqueness — including composite — with a **unique index**:
> `indexes: [{ fields: ['tenant_id', 'email'], unique: true }]`.

See [rules/validation.md](./rules/validation.md) for all types and examples.

### Index Patterns

**Omit default values:** `type` defaults to `'btree'`, `unique` defaults to `false`.

```typescript
indexes: [
  { fields: ['status', 'created_at'] },              // btree (default)
  { fields: ['email'], unique: true },                // btree + unique
  { fields: ['description'], type: 'fulltext' },      // non-default type
]
```

See [rules/indexing.md](./rules/indexing.md) for composite/partial/gin/gist indexes.

### Lifecycle Hooks

Implement business logic at data operation lifecycle points:

<!-- os:check -->
```typescript
import { Hook, HookContext } from '@objectstack/spec/data';

const accountHook: Hook = {
  name: 'account_defaults',
  object: 'account',
  events: ['beforeInsert'],
  handler: async (ctx: HookContext) => {
    if (!ctx.input.industry) {
      ctx.input.industry = 'Other';
    }
    ctx.input.created_at = new Date().toISOString();
  },
};

export default accountHook;
```

The `handler` above is the inline (in-process) form. The **preferred**,
metadata-native form is a sandboxed `body` — `{ language: 'js', source, capabilities }`
run in an isolated VM, the shape that AI/Studio-authored hooks and every build
artifact carry. See [rules/hooks.md](./rules/hooks.md) for the quick reference, or
[references/data-hooks.md](./references/data-hooks.md) for complete documentation
of all 8 lifecycle events, both registration forms, the **sandboxed `body` ctx +
capability contract**, and patterns.

---

## CRM Schema Blueprint (Production Pattern)

Mirror these CRM-style patterns when designing enterprise metadata objects:

| Pattern | Typical Location | Implementation Cue |
|:--|:--|:--|
| Object layout via field groups | `src/objects/*.object.ts` | Use `fieldGroups[]` + per-field `group` for deterministic form structure |
| Capability gating | `src/objects/*.object.ts` | Use `enable` flags (`trackHistory`, `apiMethods`, `files`, `feeds`, `activities`) per object |
| Index + validation pairing | `src/objects/*.object.ts` | Keep `indexes[]` aligned to common filters and enforce invariants with `validations[]` |
| Relationship constraints | `src/objects/*.object.ts` | Use `lookup` + `lookupFilters` (`[{ field, operator, value }]`) for constrained child selection |
| Lifecycle automation | `src/objects/*.hook.ts` | Use a lifecycle **hook** (a `Hook` object registered via `defineStack({ hooks })`) or a top-level `record_change` flow for field updates triggered by record changes. There is **no** object-level `workflows[]` field — authoring one is a build error (#1535). |
| State transitions | `src/objects/*.object.ts` | Prefer explicit `state_machine` validation rules (one per state field) — there is **no** separate `stateMachines` map |

For metadata authoring, keep expressions in CEL (`P\`...\``, `F\`...\``,
`cel\`...\``) and avoid legacy formula-string syntax.

---

## Object Extension Model

When extending an object you do not own, author an extension with
`defineObjectExtension()` and register it on the stack's `objectExtensions`
array:

```typescript
import { defineObjectExtension } from '@objectstack/spec';

export const accountExtension = defineObjectExtension({
  extend: 'account',           // target object name
  fields: { custom_score: { type: 'number' } },
  priority: 300,               // higher = applied later
});

// objectstack.config.ts
// defineStack({ objectExtensions: [accountExtension], ... })
```

- `priority` controls merge order (default `200`; range `0–999`)
- Extensions can add fields, validations, and indexes — but cannot remove them
- Do **not** author `ownership: 'extend'` on an object schema — the object-level
  `ownership` property is the *record-ownership* enum (`'user' | 'org' | 'none'`),
  unrelated to extensions

---

## Security & Access Control

Per-object access control is authored in **permission sets**, not on the object
schema. There is no object-level `permissions` key (and no `hooks` key either) —
`ObjectSchema.create()` **rejects** both as unknown keys.

### Object-level permissions (RBAC)

Grant CRUD access per object with boolean bits on a permission set:

```typescript
import { definePermissionSet } from '@objectstack/spec';

export const salesUser = definePermissionSet({
  name: 'sales_user',
  objects: {
    account: { allowRead: true, allowCreate: true, allowEdit: true },
    contact: { allowRead: true },
  },
});
```

- Bits: `allowCreate` / `allowRead` / `allowEdit` / `allowDelete`, plus
  `allowTransfer` (ownership change), `viewAllRecords` / `modifyAllRecords`
  (super-user, bypass sharing).
- Source: `node_modules/@objectstack/spec/src/security/permission.zod.ts`
- Combine with `enable.apiMethods` to also restrict the HTTP surface.

### Access depth (scope-depth) — the ERP "see my unit / my unit and below" axis

For owner-scoped (`private`) objects, a per-object grant on a permission set can
carry **`readScope` / `writeScope`** that *widens the owner-match declaratively* —
the ERP "my own / my reports / my unit / my unit and below / whole org" axis
(ADR-0057 D1). It saves hand-writing one RLS policy per object.

```typescript
// in a permission set's `objects` map
objects: {
  account: {
    allowRead: true, allowEdit: true,
    readScope: 'unit_and_below',  // see accounts owned by my BU + descendant BUs
    writeScope: 'own',            // but only edit my own
  },
}
```

| Scope | Who you can see / write |
|:--|:--|
| `own` | `owner == me` (baseline; unset = this) |
| `own_and_reports` | me + everyone below me on the `sys_user.manager_id` chain |
| `unit` | owners in my business unit (`sys_business_unit`) |
| `unit_and_below` | my BU + all descendant BUs (BFS) |
| `org` | the whole tenant (≈ `viewAllRecords` / `modifyAllRecords`) |

Resolves at request time into an `owner_id IN (…)` set and AND-injects like RLS
(no compiler change; ADR-0055). Sharing rules still widen on top.

> ⚠️ **Open-core boundary (ADR-0016).** `own` and `org` work in open-source. The
> **hierarchy-relative** scopes — `own_and_reports` / `unit` / `unit_and_below` —
> need the **paid** `@objectstack/security-enterprise` plugin (BU-subtree +
> manager-chain resolver). Without it they **fail closed to `own`** (never
> fail-open), and `defineStack` errors if a grant uses one without
> `requires: ['hierarchy-security']`. In an open-source app, author `own` / `org`
> + explicit sharing rules; reach for `unit*` only when the enterprise plugin is
> present.

### Row-Level Security (RLS)

The **enforced** RLS surface is a list of `rowLevelSecurity` policies on a
**permission set / profile** (`PermissionSetSchema.rowLevelSecurity`), *not* a
CEL predicate on the object. Each policy carries a `using` (read filter) and/or
`check` (write filter) **string** predicate. The compiler ANDs `using` into
every read for users carrying that set; `check` gates writes. (`@objectstack/plugin-security`
re-reads the target row through the write filter before single-id `update`/`delete`.)

```typescript
// in a permission set (definePermissionSet)
rowLevelSecurity: [
  {
    name: 'own_records',
    object: 'account',                       // REQUIRED per policy
    operation: 'all',                        // singular: select|insert|update|delete|all
    using: 'owner_id == current_user.id',    // read scope
    check: 'owner_id == current_user.id',    // write scope
  },
  {
    name: 'org_isolation',
    object: 'contact',
    operation: 'select',
    using: 'organization_id == current_user.organization_id',
  },
]
```

Predicates are **canonical CEL** (ADR-0058): `field == current_user.<prop>`,
`field == 'literal'`, `field in current_user.<array>`, comparisons (`>`/`<`/`>=`/`<=`),
`&&`/`||`/`!`, and `== null` checks all lower to a pushdown filter. **No** cross-object
traversal or subqueries — those are a compile error (ADR-0055), never silently dropped.
A legacy SQL-style `=` / `IN (...)` predicate still compiles via a **deprecated** bridge
(emits a warning) but should be authored in CEL. The compiler resolves these
`current_user.*` placeholders:

| Placeholder | Resolves to |
|:--|:--|
| `current_user.id` | the caller's user id (ownership) |
| `current_user.email` | the caller's email (ADR-0056 #2054) |
| `current_user.organization_id` | the caller's tenant |
| `current_user.org_user_ids` | ids of users in the same org (for `IN`) |
| `current_user.positions` | the caller's positions (for `IN`; ADR-0090 D3) |

- Source: `node_modules/@objectstack/spec/src/security/permission.zod.ts` (policy shape),
  `node_modules/@objectstack/spec/src/security/rls.zod.ts` (predicate grammar).
- Owner-scoping shortcut: the built-in `member_default` set already owner-scopes
  writes via `owner_only_writes` / `owner_only_deletes`, and an object's
  `sharingModel` (`private` / `public_read` / `public_read_write` / `controlled_by_parent`, ADR-0056 D1)
  is the declarative way to set the org-wide default — prefer those over
  hand-written policies for the common cases.

> **Removed:** a former object-level `rls` config (`RLSConfigSchema`, a free-form
> CEL `predicate` on the object) was **removed** from the spec (ADR-0056 D8,
> "design+enforce or remove"). Permission-set `rowLevelSecurity` policies are the
> only RLS surface — author them as shown above.

### Sensitive fields — `secret` type + `requiredPermissions`

The former `encryptionConfig` and `maskingRule` field keys were **pruned from
`FieldSchema`** — they had no runtime consumer (dead surface; setting them
protected nothing). The real channels are:

**Encrypted-at-rest values — `type: 'secret'` (ADR-0100).** For reversible
machine credentials (DB passwords, API keys, tokens): the engine encrypts the
value on write via the registered `ICryptoProvider`, stores the ciphertext
handle in `sys_secret`, persists only an opaque ref on the row, and masks the
value on read. **Fail-closed:** with no crypto provider registered, writes
throw rather than persist cleartext.

```typescript
fields: {
  api_key: { type: 'secret', label: 'API Key' },
}
```

**Per-field access gating — `requiredPermissions` (ADR-0066 D3).** Capabilities
required to READ/EDIT the field. A field declaring `requiredPermissions` is
**masked on read and denied on write** unless the caller holds ALL listed
capabilities — an AND-gate that is strictest-wins over permission-set field
grants. Enforced by plugin-security's FieldMasker.

```typescript
fields: {
  ssn: {
    type: 'text',
    requiredPermissions: ['view_pii'],  // mask on read / deny on write without it
  },
}
```

- Source: `node_modules/@objectstack/spec/src/data/field.zod.ts`
  (`secret` field type, `requiredPermissions`)

### Multi-tenancy

For SaaS, set `tenancy` on the object schema for row-level tenant isolation
(the tenant field is injected on write and enforced on read). The block is
**strict** — exactly two keys:

```typescript
tenancy: {
  enabled: true,             // enable row-level tenant isolation
  tenantField: 'tenant_id',  // default: 'tenant_id'
}
```

- The former `shared` / `isolated` / `hybrid` mode key (`tenancy.strategy`) was
  **retired** (#2763) — an unknown `tenancy` key is now a loud parse error with
  upgrade guidance, never silently stripped.
- **Database-per-tenant isolation is not object metadata** — it is an
  environment/deployment choice (each environment carries its own database URL).
- Platform/env-global objects declare `tenancy: { enabled: false }` to opt out
  of org row-scoping (see the visibility-posture recipe below).

### Platform-global / admin-only objects (visibility posture)

Some system/config objects are **env-global** (not partitioned per org) and
should be visible to a **platform admin env-wide** but hidden from members —
e.g. identity tables a plugin writes via its own adapter (`sys_sso_provider`,
OAuth clients). These hit a non-obvious interaction:

- The default `member_default` ships a **wildcard `tenant_isolation` RLS**
  (`organization_id == current_user.organization_id`). Any row whose
  `organization_id` is **null or absent** (common for adapter-written rows that
  never get the tenant stamp) is **denied** — the list renders empty.
- A platform admin's `viewAllRecords` superuser bypass is **posture-gated**: it
  fires **only** for objects marked `access.default: 'private'` **or**
  `tenancy: { enabled: false }`. On ordinary tenant objects it deliberately does
  **not** grant cross-tenant visibility — so the admin sees 0 rows too.

**Recipe — env-global, admin-only object that admins can fully see:**

```typescript
tenancy: { enabled: false }, // env IS the tenant; admin viewAllRecords bypass applies
requiredPermissions: ['manage_platform_settings'], // object-level gate → members get 403
```

> ⚠️ **Don't use either flag alone.** `tenancy.enabled:false` *by itself* drops
> the wildcard RLS, and `member_default`'s `'*': allowRead` then **leaks every
> row to all authenticated users**. `access.default:'private'` *by itself* opts
> the admin's `'*'` grant out too, so the **admin sees nothing**. The
> `tenancy.enabled:false` + `requiredPermissions` pair is the correct combo
> (admin sees all, non-admins 403). Posture model: ADR-0066.

### Cross-skill notes

- **API auth providers** (OIDC, JWT, API key) live in **objectstack-api**.
- **Kernel-level RBAC services** (role inheritance, custom policy engines)
  live in **objectstack-platform**.
- **CEL predicate syntax** (`P\`...\``, operators, functions) lives in
  **objectstack-formula**.

---

## Metadata Protection (`protection`)

Package authors can lock shipped metadata against Studio edits / overlays / deletes.
See ADR-0010 for the full model.

The `protection` block is **declared on the source schema** (`*.object.ts`,
`*.app.ts`, `*.view.ts`, …) and stripped at load time — it never appears in
the runtime envelope. The runtime instead populates `_lock`, `_lockReason`,
`_lockDocsUrl`, `_lockSource`, and `_packageId`, which REST returns to Studio
and the lock banner reads.

### Schema

```ts
protection?: {
  /** Lock level — controls what Studio can do to this item. */
  lock: 'none' | 'no-overlay' | 'no-delete' | 'full';
  /** REQUIRED — reason shown in the Studio lock banner (1–500 chars). */
  reason: string;
  /** Optional doc URL — renders as a "View docs" link in the banner. */
  docsUrl?: string;
}
```

The block is `.strict()`: `reason` is **required** (min 1 / max 500 chars) and
unknown keys are rejected.

| `lock` | Edit (overlay) | Delete | Typical use |
|:---|:---:|:---:|:---|
| `none` (default) | ✅ | ✅ | Normal authored metadata |
| `no-overlay` | ❌ | ✅ | Schema is platform-defined but tenant can drop it (e.g. `sys_role`) |
| `no-delete` | ✅ | ❌ | Tenant may customize fields but the object itself must exist |
| `full` | ❌ | ❌ | Core admin UI / platform identity (e.g. `sys_user`, `app/setup`) |

### Example — fully locked platform object

```ts
// src/objects/sys-user.object.ts
import { ObjectSchema } from '@objectstack/spec/data';

export const SysUserObject = ObjectSchema.create({
  name: 'sys_user',
  label: 'User',
  protection: {
    lock: 'full',
    reason: 'Core identity object — see ADR-0010.',
    docsUrl: 'https://docs.objectstack.ai/adr/0010-metadata-protection',
  },
  fields: { /* ... */ },
});
```

### Example — schema-locked but deletable

```ts
// src/objects/sys-role.object.ts
import { ObjectSchema } from '@objectstack/spec/data';

export const SysRoleObject = ObjectSchema.create({
  name: 'sys_role',
  label: 'Role',
  protection: {
    lock: 'no-overlay',
    reason: 'RBAC schema is platform-defined — see ADR-0010.',
    docsUrl: 'https://docs.objectstack.ai/adr/0010-metadata-protection',
  },
  fields: { /* ... */ },
});
```

### Example — locking a shipped app

The same block works on non-object metadata (apps, views, dashboards, flows,
agents, tools, skills, reports, email-templates):

```ts
// src/apps/setup.app.ts
import { defineApp } from '@objectstack/spec';

export const SetupApp = defineApp({
  name: 'setup',
  label: 'Setup',
  protection: {
    lock: 'full',
    reason: 'Core admin UI shipped by @objectstack/platform-objects — see ADR-0010.',
    docsUrl: 'https://docs.objectstack.ai/adr/0010-metadata-protection',
  },
  // ...
});
```

### Enforcement

- **REST**: `PUT /api/v1/meta/:type/:name` and `DELETE` return `403 item_locked`
  for any operation the lock forbids. Layered-read endpoints
  (`GET ?layers=true`) include `lock`, `lockReason`, `lockDocsUrl`, `lockSource`,
  and `packageId` so Studio can render the banner.
- **Studio**: `ResourceEditPage` renders a banner with the lock reason and the
  "View docs" link (from `docsUrl`); edit + delete buttons are hidden according
  to the lock.
- **Package vs Artifact source**: `_lockSource: 'package'` when the lock comes
  from a code-shipped schema, `'artifact'` when set by a workspace artifact.
  Artifact locks override package locks (workspace wins).

### Authoring guidance

- Default to **no `protection` block** for tenant-authored metadata.
- Use `full` for anything Studio editing would break at runtime (core identity,
  platform admin UIs, system flows).
- Use `no-overlay` for schemas that platform owns but a tenant may legitimately
  not need (then they can delete it).
- Always include `reason` — it is the only thing the end-user sees first.
- Prefer pointing `docsUrl` to an ADR or onboarding doc, not a marketing page.

---

## Advanced Features Checklist

| Feature | When to Consider |
|:--------|:-----------------|
| `tenancy` | Multi-tenant SaaS — `{ enabled: true, tenantField: 'tenant_id' }` row-level isolation (DB-per-tenant is an environment/deployment choice, not object metadata) |
| `lifecycle` | Append-only / high-write-rate objects — retention / rotation / archival contract (ADR-0057); see [rules/lifecycle.md](./rules/lifecycle.md) |
| per-field `trackHistory` | Render a field's value changes as human-readable activity-timeline entries (pair with `enable.trackHistory`, ADR-0052 §5b) |

> The former `softDelete` / `versioning` object keys were **removed** from the
> spec (#2377, ADR-0049 enforce-or-remove) — authoring them is now a build
> error with upgrade guidance. `partitioning` / `cdc` were never schema keys,
> and the `encryptionConfig` / `maskingRule` field keys were pruned (see
> [Sensitive fields](#sensitive-fields--secret-type--requiredpermissions)).

---

## Seed Data & Fixtures (`defineSeed()`)

Object definition and its seed data live together — writing a `*.object.ts`
almost always goes with a `*.seed.ts` (test fixtures, reference rows,
bootstrap data). `defineSeed()` is type-safe: pass the object definition
and TypeScript checks every record's field keys at compile time.

> The factory is named `defineSeed` — **not** `defineDataset`. The `dataset`
> name is reserved for the unrelated ADR-0021 analytics semantic layer
> (`defineDataset` from `@objectstack/spec/ui`), which is not a seed factory.

### Quick start

```typescript
// src/data/index.ts
import { defineSeed } from '@objectstack/spec/data';
import { Status } from '../objects/status.object';
import { Category } from '../objects/category.object';

// Reference data — every environment
export const statusSeed = defineSeed(Status, {
  externalId: 'code',
  mode: 'upsert',
  records: [
    { code: 'active',   label: 'Active',   color: '#2ecc71' },
    { code: 'inactive', label: 'Inactive', color: '#95a5a6' },
  ],
});

// Demo data — dev/test only
export const categorySeed = defineSeed(Category, {
  externalId: 'slug',
  mode: 'upsert',
  env: ['dev', 'test'],
  records: [
    { slug: 'electronics', name: 'Electronics' },
  ],
});

export const SeedData = [statusSeed, categorySeed];   // parents first
```

### `Seed` fields

| Field | Default | Purpose |
|:------|:--------|:--------|
| `object` | derived | Auto-set from `objectDef.name` — never write manually |
| `externalId` | `'name'` | Stable business key used for upsert / update lookup |
| `mode` | `'upsert'` | Import strategy (see below) |
| `env` | `['prod','dev','test']` | Environments where the seed loads |
| `records` | — | `Partial<Record<keyof object.fields, unknown>>[]` |

Full Zod shape: `node_modules/@objectstack/spec/src/data/seed.zod.ts`.

### Import modes

| Mode | Behavior | Use for |
|:-----|:---------|:--------|
| `upsert` (default) | Update by `externalId`, insert if missing. Idempotent. | Reference data, bootstrap rows |
| `insert` | Insert all; fail on duplicate `externalId`. | Append-only / audit tables |
| `update` | Update only existing rows; never create. | Patching existing config |
| `ignore` | Insert; silently skip duplicates. | Additive bootstrap |
| `replace` ⚠️ | Delete everything, then insert. **Data loss.** | Cache / lookup tables only — never user data |

### `externalId` selection

Pick a stable natural business key. **Never use `id`** — UUIDs differ
across environments.

| Scenario | Key |
|:---------|:----|
| Named entities (country, currency) | `'code'` / `'slug'` |
| Users / contacts | `'email'` |
| Externally sourced | `'external_id'` |
| Generic | `'name'` (default) |

### Relationship references

For `lookup` fields, supply the **natural key** of the target record (not
its UUID). The seed runner resolves at load time. Order seeds so parents
appear before children in the exported array:

> If a lookup value matches no natural key, the loader now falls back to
> resolving it as the target's `id` (#1814) — so a reference to a real existing
> record by internal id resolves instead of dangling to null. Natural keys
> remain the portable default; rely on the id fallback only for records you
> didn't seed (e.g. a system user).

```typescript
const contacts = defineSeed(Contact, {
  externalId: 'email',
  records: [{
    email: 'john@acme.example.com',
    first_name: 'John',
    account: 'Acme Corporation',   // natural key of an Account record
  }],
});
```

### Dynamic values (CEL)

Any field value may be a CEL expression evaluated at install time against
a single per-load pinned `now`. This is the **only** correct way to author
time-based or identity-derived seed values — `new Date()` ships the package
author's clock to every customer and breaks build determinism.

```typescript
import { defineSeed } from '@objectstack/spec/data';
import { cel } from '@objectstack/spec';

defineSeed(Opportunity, {
  records: [{
    name:            'Acme Q3 Renewal',
    close_date:      cel`daysFromNow(45)`,
    created_at:      cel`now()`,
    owner_id:        cel`os.user.id`,   // installer
    organization_id: cel`os.org.id`,
  }],
});
```

Stdlib in seed context: `now()`, `today()`, `daysFromNow(n)`, `daysAgo(n)`,
`isBlank(v)`, `coalesce(v, fallback)`. Scope: `os.user`, `os.org`, `os.env`.
See **objectstack-formula** for the full contract.

**Determinism gate:** two consecutive `os build` runs with no source
changes must produce byte-identical `dist/objectstack.json`. CEL + pinned
`now` is what guarantees that — using `Date.now()` will fail CI.

### Seed best practices

| Practice | Why |
|:---------|:----|
| Always use `defineSeed()`, never `SeedSchema.parse()` | Lose compile-time field checking otherwise |
| Prefer natural keys (`code` / `email` / `slug`) | Portable across environments |
| Default to `upsert` | Idempotent re-runs |
| Scope demo data with `env: ['dev','test']` | Keep noise out of prod |
| Order seeds parent → child in the exported array | References resolve at load time |
| Use `replace` only on cache/lookup tables, with comments | Data-loss footgun |
| One `{object}.seed.ts` file per object | Readability at scale |

---

## Linting & Generation Quality

`objectstack lint` checks the data model against the conventions in this skill —
not just naming/labels but the relationship/master-detail/roll-up patterns. Run
it after authoring or generating metadata. Severities: `error` (structural,
fails the command), `warning` (likely-wrong choice), `suggestion` (nudge).

Data-model rules (in addition to naming/label/i18n):

| Rule | Severity | Catches |
|---|---|---|
| `relationship/missing-reference` | error | lookup/master_detail without a `reference` target |
| `relationship/master-detail-required` | warning | a `master_detail` that isn't `required` (a detail can't exist without its master) |
| `relationship/delete-behavior` | suggestion | `master_detail` without an explicit `deleteBehavior` |
| `relationship/line-items-inline-edit` | suggestion | a `*_line`/`*_item` master_detail child without `inlineEdit` |
| `relationship/line-item-should-be-master-detail` | suggestion | a line-item-shaped child using `lookup` instead of `master_detail` |
| `relationship/association-inline-edit` | warning | an association (comment/audit/activity) marked `inlineEdit` (clutters the parent form — use a detail-page related list) |
| `rollup/missing-summary` | suggestion | a parent of numeric master_detail children with no roll-up `summary` |
| `field/select-missing-options` | warning | a `select`/`multiselect`/`radio` with no `options` (or options source) |
| `object/missing-name-field` | suggestion | an object with no name/title field or `primaryField` |

These same rules are the **rubric for AI-generated metadata** — a generation is
"good" exactly when it is schema-valid and lint-clean:

- `objectstack lint --score` — print a 0–100 metadata-quality score (+ letter
  grade and severity breakdown) for the current project. Schema errors and lint
  errors weigh most; suggestions barely move it.
- `objectstack lint --eval` — run the generation eval over a bundled golden
  corpus (invoice+lines, project+tasks, blog+comments, expense+lines,
  account+contacts) offline; each case must clear the pass bar (`--eval-min`,
  default 75). Deterministic, no API key.
- `objectstack lint --eval --generator ./gen.mjs` — **live** eval: the module
  default-exports `(prompt, id) => stack`; wire it to your agent /
  `AIService.generateObject<SolutionBlueprint>` (+ blueprint→metadata expansion)
  to benchmark a real model against the same rubric.

When generating object metadata, target a lint-clean model: master_detail (with
`required` + `deleteBehavior` + `inlineEdit` for line items), roll-up summaries
on parents, `select` options, and a name/title field per object.

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
evaluates to `null` and never fires (#2183/#2185). `os lint` is a *separate*
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
