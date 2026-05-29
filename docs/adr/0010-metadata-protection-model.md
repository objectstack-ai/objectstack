# ADR-0010: Metadata Protection Model

**Status:** Proposed
**Date:** 2026-05-29
**Supersedes:** —
**Builds on:** ADR-0005 (Metadata Customization Overlay), ADR-0008 (Metadata Repository & Change Log), ADR-0009 (Execution-Pinned Metadata)

---

## 1. Context

ObjectStack already ships a complete metadata **lifecycle** —
draft → publish → rollback — backed by a per-environment overlay store
(ADR-0005, ADR-0008). What it lacks is a **protection model**: the rules
that decide *which* items a tenant may modify, *which attributes within
those items* are off-limits, and *who* is allowed to override the
defaults.

Today the only knob is the type-level `allowOrgOverride` flag on each
`MetadataTypeRegistryEntry`. That flag is binary and applies to every
item of that type:

- Flip it on → every packaged item of the type is overridable.
- Flip it off → no packaged item of the type can be overridden, even
  ones a tenant clearly *should* be allowed to customise.

This coarse-grained design has already caused real friction:

1. To protect critical package-shipped objects (e.g. the `setup` app, the
   `sys_user` object), we recently flipped `object`/`field` to
   `allowOrgOverride: false`. That correctly locks the dangerous items
   but as collateral damage also blocks the 99% of packaged objects
   where label / icon / picklist edits should be perfectly safe.
2. Even when overlay is allowed for a type, nothing prevents a tenant
   from rewriting a field's `name` or `type` — both physically tied to
   the underlying database column. The change validates against the Zod
   schema, the overlay is written, and the runtime crashes on the next
   insert.
3. There is no `actor` recorded on overlay rows, so auditors cannot
   answer "who changed this field's required flag last Friday?"
4. The only escape hatch for emergency unlock is the
   `OBJECTSTACK_METADATA_WRITABLE` environment variable, which is
   process-wide, undated and bypasses any RBAC.

These gaps are well-trodden ground in the low-code industry. Salesforce,
ServiceNow, Microsoft Dataverse and Frappe / ERPNext all converged on a
**four-layer** protection model with very similar shape. This ADR adopts
that model for ObjectStack with the minimum surface area needed to close
the gaps above.

---

## 2. Industry Reference

Every mature low-code platform that allows runtime customisation of
package-delivered metadata implements protection at **three or four
nested layers**. The vocabulary differs but the layering is identical.

| Layer | Salesforce | ServiceNow | Dataverse | Frappe |
|---|---|---|---|---|
| L1 — Type level | Standard vs Custom Object | Application scope | Solution Component types | Standard vs Custom DocType |
| L2 — Package level | Managed vs Unmanaged Package | Application `sys_policy` | Managed vs Unmanaged Solution | Module flags |
| L3 — Item level | `isProtected` per component | `sys_policy` per record | `IsCustomizable` per entity | DocType `istable` etc. |
| L4 — Attribute level | per-field per-attribute matrix | Dictionary Override | per-attribute Managed Properties | `Property Setter` per field |
| Provenance marker | `__c` naming suffix | `sys_customer_updated` | `IsManaged` flag | `customer_updates` table |
| Audit | Setup Audit Trail (immutable) | `sys_audit` + `sys_customer_updated_xml` | Audit Log | basic log |
| Emergency unlock | `ModifyMetadata` permission + Change Set | "Customer Update" override | "Override Behavior" admin | direct DB edit |
| Reset to default | delete the customisation | delete customer update | delete the customisation | delete Custom Field / Property Setter |

Two architectural notes are common to all four:

- **Defence is cumulative, not exclusive.** A write must pass every
  layer; rejection at any one is enough. Code paths short-circuit at
  the first refusal.
- **Removal is reversal.** Deleting a customisation always restores the
  package-shipped default with zero loss. This is the operational
  superpower that lets administrators experiment freely.

ObjectStack today implements L1, partial L2, and the lifecycle (draft /
publish / rollback). L3, L4, provenance, audit, RBAC unlock and
reset-to-default are absent.

---

## 3. Decision

Adopt the four-layer protection model. Each write to the metadata API
is checked in order:

```
PUT /api/v1/meta/:type/:name (and POST .../publish, .../rollback, DELETE)
      │
      ▼
  L1  type-level allowOrgOverride       ─ fail → 403 not_overridable
      │
      ▼
  L2  package-level metadataDefaults    ─ fail → 403 package_locked
      │
      ▼
  L3  per-item _lock                    ─ fail → 403 item_locked
      │
      ▼
  L4  per-path frozenPaths              ─ fail → 422 frozen_path
      │
      ▼
  write overlay row (with actor, source, diff)
      │
      ▼
  audit log append (immutable)
```

The check order matters. Coarse layers fail fast and produce the most
informative error. By the time control reaches L4 the request is
already known to be writeable in principle — only specific *paths*
within the payload are rejected.

### 3.1 L1 — Type level (unchanged)

The existing `allowOrgOverride` / `allowRuntimeCreate` flags on
`MetadataTypeRegistryEntry` continue to express **type-wide** policy:

- `allowOrgOverride: false` → no overlay write to any item of this type
  is ever accepted from a tenant. (`datasource`, `router`, `function`,
  `service` keep this stance because they encode deployment topology.)
- `allowRuntimeCreate: false` → tenants cannot author brand-new items
  of this type at runtime.

The previous binary choice "lock the whole type vs leave it open" is
preserved but is now expected to be the *least restrictive* default:
fine-grained protection lives at L2 / L3 / L4.

### 3.2 L2 — Package level (new)

Package authors declare a default lock in the package manifest. The
loader applies it to every artifact produced by that package, equivalent
to stamping `_lock` on each file individually.

```ts
// objectstack.package.ts
export default definePackage({
  id: 'com.objectstack.setup',
  metadataDefaults: {
    lock: 'full',
    lockReason: 'Core admin UI — tenant edits can lock users out',
  },
  unlocked: [
    'view/setup_user_list',       // explicit exceptions
    'translation/*',              // glob allowed
  ],
});
```

Semantics:

- `metadataDefaults.lock` applies the named lock level to every artifact
  this package contributes, unless the artifact itself already declares
  a lock (artifact wins) or its `type/name` matches an entry in
  `unlocked` (which clears the package default).
- The loader writes the resolved lock into the artifact's `_lock` and
  `_lockSource: 'package'` fields, so downstream protocol code sees a
  single normalised shape (L3) and never reads the manifest at request
  time.

### 3.3 L3 — Item level (new)

Every metadata artifact may declare a per-item lock:

```ts
defineApp({
  name: 'setup',
  label: 'Setup',
  _lock: 'full',
  _lockReason: 'Core admin UI — see ADR-0010',
});
```

Lock levels (named after ServiceNow `sys_policy` with explicit
delete-vs-edit split borrowed from Dataverse):

| `_lock` | Overlay writes | Delete | New items (same type) |
|---|---|---|---|
| `none` *(default)* | allowed if L1/L2 allow | allowed | allowed |
| `no-overlay` | rejected | allowed | allowed |
| `no-delete` | allowed | rejected | allowed |
| `full` | rejected | rejected | allowed |

`full` blocks all destructive operations on the *specific item* but
never restricts the user's ability to author **new** items of the same
type — symmetry with the L1 split between `allowOrgOverride` (override
existing) and `allowRuntimeCreate` (author new).

### 3.4 L4 — Attribute / path level (new)

For artifacts whose lock permits overlay writes, `frozenPaths` declares
which JSON paths within the payload remain off-limits:

```ts
defineObject({
  name: 'crm_account',
  fields: { /* ... */ },
  _frozenPaths: [
    'name',                       // table name = physical column
    '_packageId',
    'fields.*.name',
    'fields.*.type',
    'fields.id.*',                // system field fully frozen
    'fields.created_at.*',
  ],
});
```

A write that touches any frozen path returns `422 frozen_path` with the
offending path in the error envelope. Glob semantics follow JSON
Pointer with the `*` wildcard meaning "any single key" (no recursion).

Type registry entries may declare **default frozen paths** that the
loader appends to every packaged artifact of the type:

```ts
// in DEFAULT_METADATA_TYPE_REGISTRY
{
  type: 'object',
  defaultFrozenPaths: ['name', '_packageId', 'fields.*.name', 'fields.*.type'],
  // ...
}
```

Frozen-path enforcement only runs against artifacts whose `_provenance`
is `'package'` (see §3.5). Tenant-authored items have no frozen paths;
the tenant owns them outright.

### 3.5 Provenance marker (new)

Every artifact carries a `_provenance` field:

| Value | Meaning |
|---|---|
| `package` | Loaded from a code package (any of `.object.ts`, `.view.json`, …). Set by the loader, immutable thereafter. |
| `org` | Authored at runtime by a tenant via the metadata API. Set on first save. |
| `env-forced` | Written via the emergency escape hatch (env variable or `?force=true` with `metadata.unlock_protected` permission). Triggers stronger audit. |

Rules:

- Overlay rows targeting a `package` artifact respect L3 + L4.
- Tenant `org` artifacts ignore L3 / L4 entirely (the tenant owns them
  in full, can also delete them).
- `_provenance` itself is in every type's default `frozenPaths`. A
  client can never relabel its own override as "package".

Provenance also drives the Studio UI: "package" items get a lock icon
and a "modify with care" banner; "org" items get a delete button.

### 3.6 Audit trail (new)

A new table `sys_metadata_audit` records every write:

| Column | Meaning |
|---|---|
| `id` | uuid |
| `ts` | wall clock |
| `environment_id` | tenant scope |
| `actor_user_id` | who called the API (NULL for system jobs) |
| `actor_system_id` | service identifier when actor is non-human |
| `type`, `name` | target metadata |
| `op` | `save_draft` / `publish` / `discard_draft` / `rollback` / `delete` / `reset_to_default` |
| `source` | `studio` / `cli` / `api` / `env-forced` / `package-install` |
| `diff` | JSON Patch of the change |
| `package_id`, `package_version` | base package coordinates at the time of write |
| `lock_overridden` | `_lock` value that was bypassed (NULL if none) |
| `request_id` | correlation with the HTTP request log |

Audit rows are **append-only**. There is no API to update or delete
them; the table is owned by the metadata plugin and surfaces only as
read-only queries on `/api/v1/meta/audit?type=&name=&since=`.

The audit table is independent of `sys_metadata_overlay` and
`sys_metadata_history` (ADR-0008) — the latter store *state*, the
former stores *intent and provenance*. Compliance reports read from
the audit table.

### 3.7 Reset to package default (new)

A new operation:

```
POST /api/v1/meta/:type/:name/reset
  → 200 { reset: true, restoredFrom: 'package', version: 'sha256:...' }
```

Semantics: delete the overlay row(s) for the target item, regardless of
draft / publish state. The next GET returns the package-shipped
definition unchanged. Equivalent to ServiceNow "Remove Customer
Update" or Frappe "Reset Customizations".

Guarded by `_lock` (rejected for `no-delete` and `full`) and by L1
`allowOrgOverride`. Records an audit row with `op: reset_to_default`.

### 3.8 Emergency unlock (revised)

The `OBJECTSTACK_METADATA_WRITABLE` env variable remains for
**single-process dev / bootstrap** scenarios but is no longer the
production unlock path. Two replacement mechanisms:

1. **Permission-gated force write.** A new permission
   `metadata.unlock_protected` lets the holder send
   `X-Override-Lock: true` (header) plus `?force=true` (query). When
   both are present and the permission check passes, L2/L3/L4 are
   bypassed. The audit row records `lock_overridden` and
   `source: env-forced`.
2. **Per-environment unlock list.** A new settings key
   `metadata.unlocked_items: string[]` (list of `type/name` strings,
   globs allowed) flips L3 to `none` for the named items in that
   environment only. Persisted, not env-variable; editable only with
   the same `metadata.unlock_protected` permission. Mirrors Salesforce
   "Remote Site Settings" precedent — high-risk toggles live in DB +
   audit log, not env files.

The env variable continues to take precedence in tests and CI to keep
existing fixtures working, but production deployments are expected to
drop it.

---

## 4. Schema additions

### 4.1 `MetadataArtifactBase` (in `packages/spec/src/kernel/`)

Every artifact's Zod schema extends a common base that adds optional
protection fields. The fields are stripped on write and reattached on
load by the metadata loader, so user-authored TS files do not need to
import them unless they want to opt in.

```ts
// packages/spec/src/kernel/metadata-artifact.zod.ts
export const MetadataLockSchema = z.enum(['none', 'no-overlay', 'no-delete', 'full']);
export type MetadataLock = z.infer<typeof MetadataLockSchema>;

export const MetadataProvenanceSchema = z.enum(['package', 'org', 'env-forced']);
export type MetadataProvenance = z.infer<typeof MetadataProvenanceSchema>;

export const MetadataArtifactBaseSchema = z.object({
  _packageId: z.string().optional(),
  _packageVersion: z.string().optional(),
  _provenance: MetadataProvenanceSchema.optional(),
  _lock: MetadataLockSchema.optional(),
  _lockReason: z.string().optional(),
  _lockSource: z.enum(['artifact', 'package', 'env', 'settings']).optional(),
  _frozenPaths: z.array(z.string()).optional(),
});
```

Each metadata Zod schema (`ObjectSchema`, `ViewSchema`, `AppSchema`, …)
spreads the base in:

```ts
export const AppSchema = MetadataArtifactBaseSchema.extend({
  name: z.string().regex(/^[a-z_][a-z0-9_]*$/),
  label: z.string(),
  navigation: z.array(NavigationItemSchema),
  // …
});
```

This keeps the loader, the protocol and Studio's editor reading from a
single normalised shape.

### 4.2 `MetadataTypeRegistryEntry` extension

```ts
const MetadataTypeRegistryEntryBaseSchema = z.object({
  // … existing fields …
  defaultFrozenPaths: z.array(z.string()).default([])
    .describe('JSON paths frozen on every packaged item of this type'),
});
```

The loader unions `entry.defaultFrozenPaths` with `artifact._frozenPaths`
when materialising a packaged item, so the type can declare blanket
schema-level locks (e.g. `name`, `_packageId`) without each file having
to repeat them.

### 4.3 Package manifest extension

```ts
export const PackageMetadataDefaultsSchema = z.object({
  lock: MetadataLockSchema.optional(),
  lockReason: z.string().optional(),
});

export const PackageManifestSchema = z.object({
  // … existing …
  metadataDefaults: PackageMetadataDefaultsSchema.optional(),
  unlocked: z.array(z.string()).default([])
    .describe('type/name patterns exempted from metadataDefaults.lock'),
});
```

### 4.4 New tables

```sql
-- audit log (immutable, no UPDATE/DELETE)
CREATE TABLE sys_metadata_audit (
  id              UUID PRIMARY KEY,
  ts              TIMESTAMPTZ NOT NULL DEFAULT now(),
  environment_id  TEXT NOT NULL,
  actor_user_id   TEXT,
  actor_system_id TEXT,
  type            TEXT NOT NULL,
  name            TEXT NOT NULL,
  op              TEXT NOT NULL,
  source          TEXT NOT NULL,
  diff            JSONB,
  package_id      TEXT,
  package_version TEXT,
  lock_overridden TEXT,
  request_id      TEXT,
  INDEX idx_audit_env_type_name (environment_id, type, name, ts DESC)
);

-- per-environment unlock list (small, write-rarely)
CREATE TABLE sys_metadata_unlocked (
  environment_id  TEXT NOT NULL,
  pattern         TEXT NOT NULL,           -- 'type/name' or glob
  reason          TEXT,
  granted_by      TEXT NOT NULL,
  granted_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at      TIMESTAMPTZ,
  PRIMARY KEY (environment_id, pattern)
);
```

---

## 5. API surface changes

### 5.1 GET response shape (additive)

```jsonc
GET /api/v1/meta/app/setup
→ 200 {
    "type": "app",
    "name": "setup",
    "item": { /* … resolved (package + overlay) payload … */ },
    "provenance": "package",
    "packageId": "com.objectstack.setup",
    "packageVersion": "7.1.0",
    "lock": "full",
    "lockReason": "Core admin UI — see ADR-0010",
    "lockSource": "package",
    "frozenPaths": ["name", "_packageId", "navigation"],
    "editable": false,
    "deletable": false,
    "resettable": false
  }
```

Existing fields are unchanged; new fields are additive. Pre-ADR-0010
clients continue to work. Studio reads `editable` / `deletable` /
`resettable` to drive button state directly, no second round trip
needed.

### 5.2 New endpoints

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/v1/meta/:type/:name/reset` | Delete all overlay rows; restore package default |
| `GET`  | `/api/v1/meta/audit` | Query audit log (filter by type/name/since/actor) |
| `GET`  | `/api/v1/meta/unlocked` | List per-environment unlock entries |
| `POST` | `/api/v1/meta/unlocked` | Add a `type/name` pattern to the unlock list (requires `metadata.unlock_protected`) |
| `DELETE` | `/api/v1/meta/unlocked/:pattern` | Remove an unlock entry |

### 5.3 Error envelopes

All protection refusals carry a machine-readable `code` for client
branching and a human-readable hint pointing at this ADR:

```jsonc
// L1
{ "error": "[not_overridable] ...", "code": "not_overridable", "status": 403 }
// L2
{ "error": "[package_locked] App 'setup' belongs to package 'com.objectstack.setup' which sets metadataDefaults.lock=full.",
  "code": "package_locked", "status": 403, "package": "com.objectstack.setup" }
// L3
{ "error": "[item_locked] App 'setup' is locked (_lock=full). See ADR-0010 §3.3.",
  "code": "item_locked", "status": 403, "lock": "full" }
// L4
{ "error": "[frozen_path] Path 'fields.id.type' is frozen on packaged object 'crm_account'.",
  "code": "frozen_path", "status": 422, "path": "fields.id.type" }
```

---

## 6. Implementation phases

The migration is staged so each phase is independently shippable.

### Phase 1 — L3 + audit foundation (≈ 1 day) — ✅ **Implemented**

1. Add `MetadataArtifactBase` to `packages/spec/src/kernel/`. Spread it
   into every metadata Zod schema.
2. Add `_lock` enforcement in `protocol.saveMetaItem`, `publishMetaItem`,
   `deleteMetaItem`, `rollbackMetaItem`. Returns `403 item_locked`.
3. Add `lock` / `editable` / `deletable` fields to the GET response.
4. Add `sys_metadata_audit` table + write path. Record actor from the
   request context.
5. Update `setup` app, `sys_user` object and any other framework-shipped
   critical items with `_lock: 'full'`.
6. Contract tests:
   - PUT against `_lock: full` item → 403
   - PUT against `_lock: no-overlay` item → 403, DELETE allowed
   - PUT against `_lock: no-delete` item allowed, DELETE → 403
   - audit row written for every successful op
   - audit row also written for refused op (op = `denied`)

### Phase 2 — L4 + provenance, restore object overlay (≈ 1.5 days)

1. Loader stamps `_provenance: 'package'` on every artifact at load
   time. Loader rejects user-authored `_provenance` field on write.
2. `defaultFrozenPaths` on `MetadataTypeRegistryEntry`. Loader unions
   them with artifact `_frozenPaths`.
3. New JSON Pointer evaluator with `*` wildcard in `packages/spec/src/
   shared/json-path.ts`. Used by L4 enforcement on overlay save.
4. **Revert** the Phase-0 sledgehammer: flip `object` and `field` back
   to `allowOrgOverride: true`, `supportsOverlay: true`. Add
   `defaultFrozenPaths: ['name', '_packageId', 'fields.*.name',
   'fields.*.type']` for `object`. Tests update to cover the
   "soft-property edit ok, schema edit 422" matrix.
5. Add reset endpoint.

### Phase 3 — L2 + RBAC unlock (≈ 1 day)

1. `definePackage()` accepts `metadataDefaults` + `unlocked`. Loader
   resolves to artifact-level `_lock` at install time.
2. New permission `metadata.unlock_protected`. New header
   `X-Override-Lock` + query `?force=true` combination triggers the
   unlock path (still validates against L1; only L2/L3/L4 are bypassed).
3. `sys_metadata_unlocked` table + CRUD endpoints. Lock evaluator
   consults the unlock list before refusing.
4. Deprecate `OBJECTSTACK_METADATA_WRITABLE` in production builds (warn
   on startup); keep in test / dev.

### Phase 4 — Studio UI + diff UX (objectui side, ≈ 1 day) — ✅ **Implemented**

1. Read `editable` / `deletable` / `resettable` flags on the editor
   page; disable buttons + show tooltip with `lockReason`.
2. Lock badge on the directory list.
3. "Reset to package default" button (visible only when `resettable`).
4. Provenance badge ("Package" / "Custom") on the list and detail
   pages.
5. Audit log tab on each item (calls the new audit endpoint).

### Phase 4.3 — Package-level `protection` block (≈ ½ day) — ✅ **Implemented**

Public author surface (`packages/spec/src/shared/protection.zod.ts`)
that translates into the private `_lock` envelope at load time:

```ts
export const SETUP_APP: App = {
  name: 'setup',
  label: 'Setup',
  protection: {
    lock: 'full',
    reason: 'Core admin UI shipped by @objectstack/platform-objects.',
    docsUrl: 'https://docs.objectstack.ai/adr/0010-metadata-protection',
  },
  // ...
};
```

Loader (`metadata/plugin.ts` + `objectql/registry.ts`) calls
`applyProtection(item, { packageId })` to translate the block into the
private `_lock`/`_lockReason`/`_lockDocsUrl`/`_lockSource`/
`_provenance`/`_packageId` envelope and strips the public `protection`
block so it never leaks into the overlay row. `_lockSource` defaults to
`'package'` when a package id is supplied and `'artifact'` otherwise.
The `lockDocsUrl` is surfaced on the GET response and rendered as a
"View docs →" link in the Studio lock banner.

### Phase 5 — Optional: Solution stack (deferred)

Multi-layer overlay (base + ISV layer + customer layer) is the only
mature-platform feature left unaddressed by this ADR. It is large
enough to deserve its own ADR if and when ISV packaging becomes a
priority. The L1–L4 model in this ADR is forward-compatible: the
overlay table just needs an additional `layer` column.

---

## 7. Migration & backwards compatibility

This ADR ships as **additive** for every existing client.

1. **Schema:** the new `_lock`, `_lockReason`, `_provenance`,
   `_frozenPaths`, `_packageId`, `_packageVersion`, `_lockSource` fields
   are all `optional` on the artifact base. Existing artifacts validate
   unchanged; absence means `_lock: 'none'`, `_provenance: 'package'`
   for loader-introduced items.
2. **GET response:** `lock` / `editable` / `deletable` / `resettable`
   / `provenance` are *new* keys; pre-ADR-0010 clients ignore them.
3. **Write errors:** new error codes (`item_locked`, `frozen_path`,
   `package_locked`) join the existing set; all carry HTTP 403/422 so
   generic error handling continues to work.
4. **Object / field rollback:** Phase 2 *restores* the pre-incident
   default of `allowOrgOverride: true` for `object` and `field`. The
   net effect for tenants is "you can edit soft properties again, but
   schema-level paths are now frozen". This is strictly safer than the
   pre-ADR-0010 state (where schema edits were permitted but unsafe)
   and strictly more permissive than the Phase-0 sledgehammer.
5. **Audit log:** new table; nothing reads it until Phase 4 adds the
   Studio tab. Disk overhead is bounded by a per-environment rolling
   retention (default 365 days, configurable).
6. **Env unlock variable:** continues to function; warned-but-not-removed
   to preserve every existing CI fixture.

A short codemod in `packages/cli` will offer to add `_lock: 'full'`
declarations to apps/objects that contain the substring `setup`,
`admin`, `console`, `system` in their name, as a defaults-of-good-taste
nudge. The codemod is opt-in.

---

## 8. Consequences

### Positive

- Closes the four largest gaps versus Salesforce / ServiceNow /
  Dataverse / Frappe.
- Allows the Phase-0 sledgehammer (`object`/`field` type-level lock) to
  be replaced with the proper "type open, schema paths frozen" model,
  restoring the ability for tenants to edit packaged objects' soft
  properties.
- Produces a compliance-grade audit trail; "who changed this metadata
  field last week" becomes a SQL query.
- Emergency unlock moves from process-wide env variable to
  permission-gated, audited, per-item action.
- `reset` endpoint turns metadata customisation into a safe-by-default
  activity: the worst case is "click reset".

### Negative

- Adds three Zod schemas (`MetadataLockSchema`,
  `MetadataProvenanceSchema`, `MetadataArtifactBaseSchema`) and two
  tables (`sys_metadata_audit`, `sys_metadata_unlocked`).
- Every metadata write now consults four guards in sequence; a sub-
  millisecond cost in practice but worth noting for high-throughput
  bulk imports. The bulk-register endpoint will short-circuit by
  pre-resolving locks once per type.
- Package authors have one more thing to think about: whether their
  package should ship `metadataDefaults.lock`. Documentation must make
  this opt-in clearly, with concrete examples.
- The `OBJECTSTACK_METADATA_WRITABLE` env variable is soft-deprecated.
  Existing operators relying on it in production need a one-time
  migration (move to `metadata.unlock_protected` + the unlock list).

### Neutral

- Tenant ergonomics gain a "this is locked" experience instead of "the
  save mysteriously 403'd" experience.
- ISV packaging (Phase 5) becomes a smaller delta — the L1–L4 model is
  already layer-aware.

---

## 9. Alternatives considered

### 9.1 Keep the Phase-0 sledgehammer (type-level lock only)

The minimal patch. Rejected because:
- It still allows schema-level edits on the *open* types (`view`, `app`,
  …) — no L4 means nothing prevents `view.list.type = 'invalid'`.
- It permanently blocks tenants from doing safe edits (e.g. changing a
  package object's `label`), pushing them toward forking the package
  source, which defeats the platform's value proposition.
- It diverges from every reference platform and would surprise users
  coming from Salesforce / Dataverse.

### 9.2 SF-style `__c` suffix for provenance

Encode provenance into the *name* (`crm_account` is package,
`crm_account__c` is custom). Rejected because:
- ObjectStack names already participate in URL paths, foreign keys and
  the physical table name. Adding a suffix mid-life is a breaking
  rename.
- A dedicated `_provenance` field is cheaper, explicit, and future-
  proofs richer states (`env-forced`, future `merged` for stacked
  packages).

### 9.3 Liquibase-style change-set with explicit "apply" step

Demand that every metadata write be wrapped in a numbered change-set
that the operator applies. Rejected because:
- Doubles the user-visible workflow (write *and* apply).
- The draft / publish / rollback lifecycle already provides the
  "intent vs effect" separation that change-sets are designed for.

### 9.4 Pure RBAC (no per-item lock)

Replace `_lock` with permissions like `app.setup.edit`. Rejected
because:
- Permissions explode in count (1 per protected item).
- Loses the *self-describing* property: an artifact would no longer
  know it is locked; the lock would live in a separate permission
  matrix.
- RBAC unlock (Phase 3) is the right place for "who may bypass",
  *complementary* to per-item declarations, not a replacement.

---

## 10. References

- ADR-0005 — Metadata Customization Overlay (the two-layer base).
- ADR-0008 — Metadata Repository & Change Log (draft / publish /
  rollback storage).
- ADR-0009 — Execution-Pinned Metadata (version pinning for executable
  types).
- Salesforce: *ISVforce Guide* §"Managed Package Component Behavior",
  *Metadata API Developer Guide* §"Custom Object Modification".
- ServiceNow: *Product Documentation* §"Application scoping",
  §"Dictionary Override", §"Customer Updates".
- Microsoft Dataverse: *Power Apps Developer Guide* §"Use managed
  properties to restrict customizations".
- Frappe Framework: *Documentation* §"Customize Form", §"Property
  Setter", §"Custom Field".
