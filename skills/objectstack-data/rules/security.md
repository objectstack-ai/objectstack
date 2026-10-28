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

- `permissionSets:` is **refused at load** with an `Unrecognized key(s) on this
  stack definition` error naming the key; `ObjectStackDefinitionSchema` enumerates
  the keys.
- Bits: `allowCreate` / `allowRead` / `allowEdit` / `allowDelete`, plus
  `allowTransfer` (ownership change), `viewAllRecords` / `modifyAllRecords`
  (super-user, bypass sharing).
- Source: `node_modules/@objectstack/spec/src/security/permission.zod.ts`
- **`isDefault: true` = the `everyone` baseline (ADR-0090 D5).** A published package
  declares **exactly one**, anchor-safe: `describeAnchorForbiddenBits(set, 'everyone')`
  (`@objectstack/spec/security`) returns `null`, else lint
  (`security-anchor-high-privilege`) and the binding refuse it. With none, invited
  members get nothing until an admin assigns each; no gate counts them. Its
  `systemPermissions` may name only app capabilities declared under `capabilities:`.
- `enable.apiMethods` also restricts the HTTP surface.

## Assigning a permission set to a user

Declaring a set grants nobody anything — an assignment is **data**: one row in
the join object **`sys_user_permission_set`** (`@objectstack/plugin-security`),
carrying `user_id`, `permission_set` (the set's machine **`name`**) and an
optional `organization_id` (`null` = every org context). Optional `valid_from` /
`valid_until` bound a half-open window; `granted_by` is stamped by the gate on
insert — never author it.

⚠️ **Never a record id** — a `permission_set` the security catalog does not hold
is refused `400 VALIDATION_FAILED` (`reference_not_found`); none at all, `required`.
One grant per user, set and organization: enforced by the `unique: 'organization'` index.

Assignment is one `POST /api/v1/data/sys_user_permission_set`. Only a tenant admin —
or a delegated `adminScope` carrying `manageAssignments` for that set and user
(ADR-0090 D12) — may write it; plain CRUD bits on the table are not enough.

**Grant looks inert?** Check in order: the set is switched off; the validity
window has passed; `organization_id` mismatch.
`GET /api/v1/security/explain?object=&operation=&userId=` answers from the
enforcing code path (explaining another user needs `manage_users`).

## Row-Level Security (RLS)

The **enforced** RLS surface is a list of `rowLevelSecurity` policies on a
**permission set / profile** (`PermissionSetSchema.rowLevelSecurity`), *not* a
CEL predicate on the object. Each policy's `using` and/or `check` is a **string**
predicate. `using` admits rows: what a `select` policy lets the
caller read, and the existing rows an `update`/`delete` policy lets it change
or remove; on a read the applicable `using` OR-combine, then AND into the query.
`check` is judged on every row an `insert`/`update` writes (array inserts and
`multi: true` included; one failing row refuses the write), chosen per
operation: when any applicable policy declares `check`, only those decide
(OR-combined); else each applicable `using` stands in. A non-blank `check` on a
`select`/`delete` policy is refused. Default deny, among the policies that
apply: a row none admits is denied, an unevaluable policy fails closed; when
none applies the policies restrict nothing (the tenant wall still applies) — an
`update`/`delete` target with no write-class `using` is bounded by the caller's
`select` policies.

```typescript
// in a permission set (definePermissionSet)
rowLevelSecurity: [
  {
    name: 'own_records',
    object: 'account',                       // REQUIRED per policy
    operation: 'all',                        // singular: select|insert|update|delete|all
    using: 'owner_id == current_user.id',    // rows readable / targetable
    check: 'owner_id == current_user.id',    // every row written
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
A legacy SQL-style `=` / `IN (...)` predicate still compiles via a **deprecated**
bridge (warns). The compiler resolves these
`current_user.*` placeholders:

| Placeholder | Resolves to |
|:--|:--|
| `current_user.id` | the caller's user id (ownership) |
| `current_user.email` | the caller's email (ADR-0056) |
| `current_user.organization_id` | the caller's tenant |
| `current_user.org_user_ids` | ids of users in the same org (for `IN`) |
| `current_user.positions` | the caller's positions (for `IN`; ADR-0090 D3) |
| `current_user.KEY` | the set an object's `membershipKeys.KEY` declares (for `IN`) |

- Source: `node_modules/@objectstack/spec/src/security/rls.zod.ts`.
- Prefer the built-in `member_default` owner scoping (`owner_only_writes` /
  `owner_only_deletes`) and the object's `sharingModel` (ADR-0056 D1) over
  hand-written policies for the common cases.

## Membership keys — a `current_user.KEY` set the roster object declares

Rows keyed on a **named record** (an account, a supplier) rather than on a
person or a position: declare the set on the **roster** object whose rows
define it — not a stamp on every data row, not one policy per record.

<!-- os:check -->
```typescript
import { ObjectSchema } from '@objectstack/spec/data';

// Roster: one row per (portal user, account)
export default ObjectSchema.create({
  name: 'account_member',
  sharingModel: 'private',
  fields: {
    user:    { type: 'user', required: true },
    account: { type: 'lookup', reference: 'account', required: true },
    active:  { type: 'boolean', defaultValue: true },
  },
  membershipKeys: {
    portal_account_ids: { userField: 'user', valueField: 'account', filter: 'active == true' },
  },
});
```

```typescript
// in the portal permission set — a policy reads the set with `in`
rowLevelSecurity: [
  { name: 'portal_orders', object: 'order', operation: 'select', using: 'account in current_user.portal_account_ids' },
]
```

- `userField`: the roster's user column (`user`, or a lookup to `sys_user`);
  `valueField`: the reference column whose values form the set (never the
  same column); `filter`: optional canonical CEL over the roster's own
  columns, no `current_user.*`.
- One name per stack: a key on two objects, a kernel name (`id`,
  `organization_id`, `positions`, `org_user_ids`, `accessible_org_ids`,
  `email`, `queues`) and a key on an object extension are refused.
- Read once per request as a system read in the caller's organization (no
  read on the roster needed), at most 1,000 values; more, a failed read or a
  `filter` that does not compile matches **no rows**. Whoever writes roster
  rows grants the key.
- **Choose by what the rows are keyed on:** the person → owner scoping; a
  position → `positions` on the policy; a named record → a membership key;
  one record, once → a sharing rule or a manual share.

## Positions grant only what they name; portal users are `external`

- A position distributes **only** the sets its `permissionSets` names
  (ADR-0131 D3/D4): `{ name: 'sales_rep', label: 'Sales Rep', permissionSets:
  ['sales_user'] }`. A set that merely shares the position's name is reported,
  never granted; a name matching no set confers nothing.
- A portal or partner user is an organization member on the `external`
  membership tier (closed list `owner`, `admin`, `delegated_admin`, `member`,
  `external`, one per member —
  https://objectstack.ai/docs/permissions/authentication#membership-tiers-are-a-closed-list).
  The `everyone` baseline (`isDefault` sets) does not reach it, it sees no
  member directory and holds no business unit, and every org-wide default is
  owner-only for it: rows reach it **only** through explicit grants — a
  position or permission set whose row policies bound them (the key above),
  a sharing rule or a manual share.

## Field permissions — a row-conditioned edit lock (`when`)

A set's `fields` entry (`'OBJECT.FIELD': { readable, editable }`) may carry
`when`, a row condition in the same canonical CEL as `rowLevelSecurity[].using`.
**Choose by who loses the edit — one mechanism per need, never both:**

- Locked for **everyone** at that stage → a [validation rule](./validation.md)
  on the object (`readonlyWhen` likewise strips the write for everyone).
- Locked for **some permission sets** only → `when` on the field entries of
  each set that loses the edit; the other sets keep their grant.

```typescript
// finance may not change the contract's legal terms after approval
fields: {
  'clm_contract.governing_law': { readable: true, editable: false, when: "status in ['approved', 'signing', 'active']" },
}
```

- **Edit vote only.** Reads are row-blind; `readable: false` beside `when` is
  refused at parse time.
- **Same object.** Fields of the entry's object vs a literal or `current_user.*`;
  no relation reach (refused at `os validate` / publish).
- **Pre-image.** An update is judged on the stored row, so a write cannot unlock
  itself by moving `status` back; an insert on the row as sent.
- **Locks, never grants.** On unmatched rows the entry is absent; another held
  set's `editable: true` still wins (most-permissive merge).
- Docs: https://objectstack.ai/docs/permissions/field-level-security#row-conditioned-edit-locks-when
  and the recipe https://objectstack.ai/docs/permissions/access-recipes#data-lock-fields-for-a-position-once-a-record-reaches-a-stage

## Sensitive fields — `secret` type + `requiredPermissions`

`maskingRule` is **live** (FieldMasker). Two more channels:

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

**Per-field access gating — `requiredPermissions` (ADR-0066 D3).** A field
declaring `requiredPermissions` is **masked on read and denied on write** unless
the caller holds ALL listed capabilities — an AND-gate that is strictest-wins
over permission-set field grants.

```typescript
fields: {
  ssn: {
    type: 'text',
    requiredPermissions: ['view_pii'],
  },
}
```

- Source: `node_modules/@objectstack/spec/src/data/field.zod.ts`

## Multi-tenancy

Organization count is a **deployment posture** fact, never object metadata.
`single` (default) = one logical tenant: the bootstrapped Default Organization
only, a second refused (`403`); sub-units are business units. Tenants as
`sys_organization` rows need a walled posture (`group`/`isolated`; open core,
ADR-0132) — ⛔ never `single` + your own RLS. See ADR-0093,
https://objectstack.ai/docs/deployment/tenancy-modes.

Within a posture, `tenancy` on the object is the row-level knob (stamped on
write, enforced on read); **strict**, two keys:

```typescript
tenancy: {
  enabled: true,
  // tenantField: no default — omit it ⇒ `organization_id`
}
```

## Platform-global / admin-only objects (visibility posture)

Some system objects are **env-global** — **platform admin** sees all, members
none — e.g. identity tables a plugin writes via its own adapter
(`sys_sso_provider`, OAuth clients):

- Reads of a tenant object pass the **Layer 0 tenant wall** (ADR-0095 D1):
  `organization_id == <caller's organization>`, AND-composed ahead of all
  business RLS. A row with **null or absent** `organization_id`
  (adapter-written rows often lack it) is **denied** — the list renders empty.
  Under `single` the wall is inert.
- The `viewAllRecords` superuser bit is **posture-gated and wall-blind**: it
  short-circuits **business RLS only**, and only on objects whose posture allows
  it (`access.default: 'private'`, `tenancy: { enabled: false }`, or a
  better-auth-managed identity table). It never crosses the Layer 0 wall —
  crossing takes a *true platform admin* (the superuser bit **and** a
  platform-exclusive capability: `manage_metadata`, `manage_platform_settings`,
  `studio.access`, `manage_users`) on one of those same postures.

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
> grants only the objects it names.) `requiredPermissions` *by itself* leaves a
> tenant object, whose untagged rows the wall denies to everyone (above); it is
> the half that holds however permissive the caller's grants are. Posture model:
> ADR-0066.

## Renaming or removing a shipped access item

Administrators act on a package's access items by **name**: they switch a
permission set, position or sharing rule off, clone a set, and name its objects,
fields and capabilities in their own sets. A later version can quietly undo them
on upgrade:

- **Rename** → the old switch-off stops matching; the renamed item arrives switched **on**.
- **Remove** an object, field or capability → a customer's clone or own set names something that no longer exists.
- **Add a field deny** to a shipped set → a customer's clone does not carry it.

Keep shipped names stable. When such a change is genuinely needed, say so in the
release notes: what changed, and what an administrator should re-check after upgrading.
