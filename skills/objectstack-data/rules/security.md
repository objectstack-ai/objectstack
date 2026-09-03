# Security & Access Control

## Object-level permissions (RBAC)

Grant CRUD access per object with boolean bits on a permission set:

<!-- os:check -->
```typescript
import { definePermissionSet } from '@objectstack/spec';

export const salesUser = definePermissionSet({
  name: 'sales_user',
  objects: {
    account: { allowRead: true, allowCreate: true, allowEdit: true },
    contact: { allowRead: true },
  },
});

// Register it on the stack root under `permissions` — NOT `permissionSets`:
// defineStack({ permissions: [salesUser], ... })
```

- **Stack key: `permissions`.** The collection is named for the metadata kind,
  not for the factory, so `definePermissionSet()` output goes into
  `defineStack({ permissions: [...] })`. `permissionSets:` is **refused at
  load** — the top level is strict, so the stack fails with an
  `Unrecognized key(s) on this stack definition` error naming the key, never a
  silent drop. `ObjectStackDefinitionSchema`
  (`node_modules/@objectstack/spec/src/stack.zod.ts`) is the enumeration of
  record; `objectstack-platform` lists every top-level key.
- Bits: `allowCreate` / `allowRead` / `allowEdit` / `allowDelete`, plus
  `allowTransfer` (ownership change), `viewAllRecords` / `modifyAllRecords`
  (super-user, bypass sharing).
- Source: `node_modules/@objectstack/spec/src/security/permission.zod.ts`
- Combine with `enable.apiMethods` to also restrict the HTTP surface.

## Assigning a permission set to a user

Declaring a set grants nobody anything — an assignment is **data**: one row in
the join object **`sys_user_permission_set`** (`@objectstack/plugin-security`),
carrying `user_id`, `permission_set_id`, and an optional `organization_id`
(`null` = every org context). Optional `valid_from` / `valid_until` bound a
half-open window checked at resolution time; `granted_by` is stamped by the
gate on insert — never author it.

⚠️ **`permission_set_id` takes the `sys_permission_set` RECORD ID, not the set's
`name`.** Grants resolve by loading `sys_permission_set` **by `id`**, so a `name`
in that field matches nothing, raises no error, and silently grants nothing.
Declared sets are upserted by `name` with a **generated** `id` on `kernel:ready`
(ADR-0086 D5) — that id differs per environment, so resolve it first.

Assignment is therefore two calls, both `POST /api/v1/data/{object}`
(`…/query` with a QueryAST body for the read): look up the set's `id` in
`sys_permission_set` by `name`, then insert
`{ user_id, permission_set_id, organization_id }` into
`sys_user_permission_set`. Only a tenant admin — or a delegated `adminScope`
carrying `manageAssignments` for that set and user (ADR-0090 D12) — may write
it; plain CRUD bits on the table are not enough.

**Grant looks inert?** Check in order: a `name` in `permission_set_id`; the set
is `active: false`; the validity window has passed; `organization_id` mismatch.
`GET /api/v1/security/explain?object=&operation=&userId=` answers from the
enforcing code path (explaining another user needs `manage_users`).

## Row-Level Security (RLS)

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
| `current_user.email` | the caller's email (ADR-0056) |
| `current_user.organization_id` | the caller's tenant |
| `current_user.org_user_ids` | ids of users in the same org (for `IN`) |
| `current_user.positions` | the caller's positions (for `IN`; ADR-0090 D3) |

- Source: `node_modules/@objectstack/spec/src/security/permission.zod.ts` (policy shape),
  `node_modules/@objectstack/spec/src/security/rls.zod.ts` (predicate grammar).
- Owner-scoping shortcut: the built-in `member_default` set already owner-scopes
  writes via `owner_only_writes` / `owner_only_deletes`, and an object's
  `sharingModel` (ADR-0056 D1)
  is the declarative way to set the org-wide default — prefer those over
  hand-written policies for the common cases.

## Sensitive fields — `secret` type + `requiredPermissions`

`maskingRule` is **live** (plugin-security's FieldMasker enforces it). The real
channels are:

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

## Multi-tenancy

For SaaS, set `tenancy` on the object schema for row-level tenant isolation
(the tenant field is injected on write and enforced on read). The block is
**strict** — exactly two keys:

```typescript
tenancy: {
  enabled: true,   // enable row-level tenant isolation
  // tenantField — NO default; omit it and the driver uses `organization_id`
}
```

- **Database-per-tenant isolation is not object metadata** — it is an
  environment/deployment choice (each environment carries its own database URL).

## Platform-global / admin-only objects (visibility posture)

Some system/config objects are **env-global** (not partitioned per org) and
should be visible to a **platform admin env-wide** but hidden from members —
e.g. identity tables a plugin writes via its own adapter (`sys_sso_provider`,
OAuth clients). These hit a non-obvious interaction:

- Reads of a tenant object pass the **Layer 0 tenant wall** (ADR-0095 D1): an
  `organization_id == <the caller's organization>` filter AND-composed ahead of
  every business RLS policy. Any row whose `organization_id` is **null or
  absent** (common for adapter-written rows that never get the tenant stamp) is
  **denied** — the list renders empty. Single-tenant deployments never hit this;
  the wall is inert there.
- The `viewAllRecords` superuser bit is **posture-gated and wall-blind**: it
  short-circuits **business RLS only**, and only on objects whose posture allows
  it (`access.default: 'private'`, `tenancy: { enabled: false }`, or a
  better-auth-managed identity table). It never crosses the Layer 0 wall —
  crossing takes a *true platform admin* (the superuser bit **and** a
  platform-exclusive capability: `manage_metadata`, `manage_platform_settings`,
  `studio.access`, `manage_users`) on one of those same postures. So an org
  admin holding the superuser bit stays org-scoped, and on an ordinary tenant
  object nobody crosses — the admin sees 0 rows too.

**Recipe — env-global, admin-only object that admins can fully see:**

```typescript
tenancy: { enabled: false }, // not a tenant object → Layer 0 contributes nothing
requiredPermissions: ['manage_platform_settings'], // capability AND-gate → members get 403
```

> ⚠️ **Both keys are load-bearing — neither works alone.**
> `tenancy: { enabled: false }` *by itself* switches the wall off for **every**
> caller, and any permission set carrying a wildcard (`'*'`) read grant then
> reads every row env-wide — the shipped `viewer_readonly` still carries one, as
> may an app-declared default profile or a customer-authored set. (The
> `member_default` baseline is **not** one of them: it is explicit-allow and
> grants only the objects it names.) `requiredPermissions` *by itself* leaves the
> object a tenant object, so the wall keeps denying the untagged rows and even a
> platform admin sees nothing. The pair is the correct combo (admin sees all,
> non-admins 403), and `requiredPermissions` is the half that holds however
> permissive the caller's grants are — it is an AND-gate checked **before** the
> CRUD grant. Posture model: ADR-0066; tenant wall: ADR-0095 D1.
