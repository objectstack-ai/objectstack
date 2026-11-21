# Security & Access Control

## Object-level permissions (RBAC)

Grant CRUD access per object with boolean bits on a permission set:

<!-- os:check -->
```typescript
import { definePermissionSet } from '@objectstack/spec';

export const salesUser = definePermissionSet({
  name: 'crm_sales_user',
  objects: {
    account: { allowRead: true, allowCreate: true, allowEdit: true },
    contact: { allowRead: true },
  },
});

// defineStack({ permissions: [salesUser], ... })
```

- `permissionSets:` is **refused at load** (`Unrecognized key(s) on this stack definition`, naming the key).
- Bits: `allowCreate` / `allowRead` / `allowEdit` / `allowDelete`, plus
  `allowTransfer` (ownership change), `viewAllRecords` / `modifyAllRecords`
  (super-user, bypass sharing).
- **`isDefault: true` = the `everyone` baseline (ADR-0090 D5).** A published package
  declares **exactly one**, anchor-safe: `describeAnchorForbiddenBits(set, 'everyone')`
  (`@objectstack/spec/security`) returns `null`, else lint
  (`security-anchor-high-privilege`) and the binding refuse it. With none, invited
  members get nothing until an admin assigns each; no gate counts them. Its
  `systemPermissions` may name only app capabilities declared under `capabilities:`.
- `tabPermissions` hides an app, never gates it: objectstack-ui → Who sees or opens an app.

## Assigning a permission set to a user

Declaring a set grants nobody anything — an assignment is **data**: one row in
the join object **`sys_user_permission_set`**,
carrying `user_id`, `permission_set` (the set's machine **`name`**) and an
optional `organization_id` (`null` = every org context). Optional `valid_from` /
`valid_until` bound a half-open window; `granted_by` is stamped by the gate on
insert — never author it.

⚠️ **Never a record id** — a `permission_set` the security catalog does not hold
is refused `400 VALIDATION_FAILED` (`reference_not_found`); none at all, `required`.
One grant per `(user_id, permission_set, permission_set_package, organization_id)`; a guard
index (none on `driver-memory`) holds grants naming no package to one per user, set and
organization. Name `permission_set_package` on insert when two packages hold the name, or
the grant is refused `409 RESOURCE_CONFLICT`, naming each holder.

Only a tenant admin — or a delegated `adminScope` carrying `manageAssignments`
for that set and user — may `POST /api/v1/data/sys_user_permission_set`; plain
CRUD bits on the table are not enough.

**Grant looks inert?** Check in order: the set is switched off; the validity
window has passed; `organization_id` mismatch.
`GET /api/v1/security/explain?object=&operation=&userId=` answers from the
enforcing code path. Explaining another user takes `manage_users`,
administering one of their organizations, or a delegated `adminScope` covering
them.

## Row-Level Security (RLS)

The **enforced** RLS surface is a list of `rowLevelSecurity` policies on a
**permission set / profile**, *not* a
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
none applies the policies restrict nothing — an
`update`/`delete` target with no write-class `using` is bounded by the caller's
`select` policies.

```typescript
rowLevelSecurity: [
  {
    name: 'own_records',
    object: 'account',                       // REQUIRED per policy
    operation: 'all',                        // singular: select|insert|update|delete|all
    using: 'owner_id == current_user.id',
    check: 'owner_id == current_user.id',
  },
  {
    name: 'own_tasks',   // task.assignee: { type: 'user', defaultValue: 'current_user' }
    object: 'task',
    operation: 'insert',
    check: 'assignee == current_user.id',
  },
]
```

A `check` over a field the request never names refuses a plain create ("add a
task" answers 403). Give the tying field a default the check admits:
`defaultValue: 'current_user'` fills an omitted `user` field before `check` is
judged, so `own_tasks` admits a create that names no assignee.

Predicates are **canonical CEL** (ADR-0058): `field == current_user.<prop>`,
`field == 'literal'`, `field in current_user.<array>`, comparisons (`>`/`<`/`>=`/`<=`),
`&&`/`||`/`!`, and `== null` checks all lower to a pushdown filter. **No** cross-object
traversal or subqueries — those are a compile error (ADR-0055), never silently dropped.

| Placeholder | Resolves to |
|:--|:--|
| `current_user.id` | the caller's user id (ownership) |
| `current_user.email` | the caller's email (ADR-0056) |
| `current_user.organization_id` | the caller's tenant |
| `current_user.org_user_ids` | ids of users in the same org |
| `current_user.positions` | the caller's positions (ADR-0090 D3) |
| `current_user.queues` | the ownership queues the caller sits in (ADR-0142 D3) |
| `current_user.KEY` | the set an object's `membershipKeys.KEY` declares |

- Prefer the built-in `member_default` owner scoping (`owner_only_writes` /
  `owner_only_deletes`) and the object's `sharingModel` (ADR-0056 D1) over
  hand-written policies for the common cases.

## Membership keys — a `current_user.KEY` set the roster object declares

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
rowLevelSecurity: [
  { name: 'portal_orders', object: 'order', operation: 'select', using: 'account in current_user.portal_account_ids' },
  // the person is a record: roster `employee` declares
  // my_employee_ids: { userField: 'user', valueField: 'id' }
  { name: 'own_leave', object: 'leave_request', operation: 'select', using: 'employee in current_user.my_employee_ids' },
]
```

- `userField`: the roster's user column (`user`, or a lookup to `sys_user`);
  `valueField`: the reference column whose values form the set, or `id`
  (`membership-key-value-field-invalid`; never the same column);
  `filter`: optional canonical CEL over the roster's own
  columns, no `current_user.*`.
- With `id` the set is the ids of the caller's own roster rows; it grants
  nothing by itself. Tested against a column not referencing the roster, or another
  object's `id`, it is refused (`rls-predicate-membership-key-target`).
- One name per stack: a key on two objects, a kernel name (a fixed
  placeholder above, `accessible_org_ids`) and a key on an object extension are refused.
- Read once per request as a system read in the caller's organization, at
  most 1,000 values; more, a failed read or a
  `filter` that does not compile matches **no rows**. Whoever writes roster
  rows grants the key.
- **Choose by what the rows are keyed on:** the user → owner scoping; a
  position → `positions` on the policy; a named record (the caller's own
  roster row too) → a membership key;
  a parent's owner, parent optional → an optional master (relationships.md);
  one record, once → a sharing rule or a manual share; a team's records → a
  sharing rule whose `sharedWith: { type: 'queue', value: '<queue name>' }`
  reaches an ownership queue's members ([Ownership queues](#ownership-queues--park-a-record-for-a-team-to-claim)).
- A package's rule reads `value` as its package's queue, else the one
  holder in its declared `dependencies` closure plus `sys`, else (none
  declares it) an org's `sys_queue` row. Else it grants no one new, warned
  `RESOURCE_CONFLICT`: `outside-closure` (only a non-dependency
  or an environment item holds `support`),
  `ambiguous-in-closure` (two dependencies do), `ambiguous-in-environment`
  (the one it reaches and a non-dependency do).

## Positions grant only what they name; portal users are `external`

- A position distributes **only** the sets its `permissionSets` names
  (ADR-0131 D3/D4): `{ name: 'crm_sales_rep', label: 'Sales Rep', permissionSets:
  ['crm_sales_user'] }`. A set that merely shares the position's name is reported,
  never granted; a name matching no set confers nothing.
- A package's position reads each name as its package's set, else the one holder
  in its declared `dependencies` closure plus `sys`; else it is refused. It
  still loads; the boot's catalog reference report logs each refusal with every
  candidate, and the position grants nothing through that name (its other sets
  still do). `outside-closure` / `ambiguous-in-closure` as for a queue above
  (the environment: a set authored in Setup; a second package shipping a name
  is refused at install). Fix: declare the dependency. Stored grants,
  environment-authored positions, admin overlays of a package position and the
  `everyone`/`guest` anchors resolve environment-wide.
- A portal or partner user is an organization member on the `external`
  membership tier (one per member —
  https://objectstack.ai/docs/permissions/authentication#membership-tiers-are-a-closed-list).
  The `everyone` baseline does not reach it, it sees no
  member directory and holds no business unit, and every org-wide default is
  owner-only for it: rows reach it **only** through the explicit grants above.

## Field permissions — a row-conditioned edit lock (`when`)

A set's `fields` entry (`'OBJECT.FIELD': { readable, editable }`) may carry
`when`, a row condition in the same canonical CEL as `rowLevelSecurity[].using`.
**Choose by who loses the edit — one mechanism per need, never both:**

- Locked for **everyone** at that stage → a [validation rule](./validation.md)
  on the object.
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

**`type: 'secret'` (ADR-0100): query a credential only for presence.** A
`secret` / `password` column is never a filter, sort, group-by or import `matchFields` key (`400 INVALID_FIELD`;
an import row naming it fails). Search never scans it: keep it out of
`searchableFields`.

```typescript
fields: {
  api_key: { type: 'secret', label: 'API Key' },
}
// also `null`, `$exists`, `$empty` / `is_not_empty`
where: { api_key: { $null: false } }  // ObjectQL, hook `query.filter`
filter: [{ field: 'api_key', operator: 'is_not_null' }]  // list view
```

**Per-field access gating — `requiredPermissions` (ADR-0066 D3).** The field
is **masked on read and denied on write** unless
the caller holds ALL listed capabilities — strictest-wins
over permission-set field grants.

```typescript
fields: {
  ssn: {
    type: 'text',
    requiredPermissions: ['view_pii'],
  },
}
```

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
none:

- Reads of a tenant object pass the **Layer 0 tenant wall** (ADR-0095 D1):
  `organization_id == <caller's organization>`, AND-composed ahead of all
  business RLS. A row with **null or absent** `organization_id`
  is **denied**.
  Under `single` the wall is inert.
- The `viewAllRecords` superuser bit is **posture-gated and wall-blind**: it
  short-circuits **business RLS only**, on objects whose posture allows it
  (`access.default: 'private'`, `tenancy: { enabled: false }`, or a
  better-auth-managed identity table), and never crosses the Layer 0 wall —
  that takes a *true platform admin*: the superuser bit **and** a
  platform-exclusive capability (`manage_metadata`, `manage_platform_settings`,
  `studio.access`, `manage_users`) on one of those postures.

**Recipe — env-global, admin-only object that admins can fully see:**

```typescript
tenancy: { enabled: false },
requiredPermissions: ['manage_platform_settings'], // capability AND-gate → members get 403
```

> ⚠️ **Both keys are load-bearing.** `tenancy: { enabled:
> false }` alone switches the wall off for **every** caller, so any set with a
> wildcard (`'*'`) read grant — the shipped `viewer_readonly`; not
> `member_default`, which is explicit-allow — reads every row env-wide. `requiredPermissions` alone leaves a
> tenant object whose untagged rows the wall denies to everyone (above). Posture model: ADR-0066.

## Renaming or removing a shipped access item

Administrators act on a package's access items by **name** — switching a
permission set, position or sharing rule off, cloning a set, naming its objects,
fields and capabilities in their own sets — and an upgrade can quietly undo them:
a **rename** stops the old switch-off matching and the item arrives switched
**on**; a **removed** object, field or capability leaves a clone or own set
naming nothing; a **field deny added** to a shipped set is missing from every
clone. Keep shipped names stable; when a change is needed, the release notes say
what changed and what an administrator re-checks after upgrading.

**Renaming a position:** declare `renamedFrom: ['old_name']` on the renamed
position, never delete and re-add (holders lose its sets). At boot its
holders (`sys_user_position`) move to the new name in every organization,
idempotently. Only holders: no other reference to the old name is rewritten,
Setup-authored ones included. Re-point your own source naming the old one: a
`type: 'position'` sharing recipient, queue member or approver, a policy's
`positions`, a `current_user.positions` predicate. The boot log lists stored
references by table (sharing, queue and share recipients, pending approvers,
invitations) for an admin. Not carried (warned): an old name still a position anywhere,
claimed twice, recorded under another owner (a package or the environment),
switched off, or a disabled claimant.

## Access depth — `readScope` / `writeScope`

Beyond `SKILL.md` § Access depth: a scope
widens the owner match declaratively instead of a hand-written RLS policy
(ADR-0057 D1): it resolves at request time into an `owner_id IN (…)` set and
AND-injects like RLS. The hierarchy-relative three are the open-core boundary
(ADR-0016): the paid plugin goes in `plugins[]`. The CLI only advises on a missing or unwired plugin: `os validate`
warns, `os verify --json` lists it in `capabilities`.

## Ownership queues — park a record for a team to claim

Every `ownership: 'user'` object carries a platform-injected `queue` column
beside `owner_id` (an object declaring its own `queue` field is refused). A
record **sits in** a queue when `owner_id` is empty and `queue` names it: the
queue's members read and edit it (rows widen, verbs never — no delete). Declare
the queue on the stack; a declared queue's members are positions only, an
organization adds users and teams through `sys_queue_member` rows:

<!-- os:check -->
```typescript
import { defineQueue } from '@objectstack/spec/security';

export const supportIntake = defineQueue({
  name: 'crm_support_intake',   // the one name the `queue` column, a rule, an approver and a sharing recipient use
  label: 'Support Intake',
  members: [{ type: 'position', value: 'crm_service_agent' }],
});
// defineStack({ queues: [supportIntake], assignmentRules: [...] }) — routing rows in: objectstack-automation
```

**Claim** is an ordinary by-id update, `{ owner_id: <your id> }`, admitted to a
member while the record is unowned; one writer wins, the other gets `409
CONCURRENT_UPDATE`. **Release**: the owner writes `owner_id: null` and the record
sits in its home queue again. **Move**: writing another `queue` is a transfer
(`allowTransfer` or `modifyAllRecords`). ⛔ Never a per-record `assigned_to`
picklist, a round-robin counter field, or a hook that picks an owner.
