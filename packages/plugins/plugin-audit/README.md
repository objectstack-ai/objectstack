# @objectstack/plugin-audit

System audit-trail objects for ObjectStack: the immutable `sys_audit_log` ledger, the
`sys_activity` stream, `sys_comment`, and the ObjectQL hooks that write them.

## What this package actually does

`AuditPlugin` does two things when the kernel starts it:

1. **Registers three system objects** — `sys_audit_log`, `sys_activity`, `sys_comment`.
2. **Installs ObjectQL hook subscribers** that write ledger and activity rows on data
   mutations, plus record-level access gates for `sys_comment`.

⚠️ **There is no audit service you call to log a record change.** Record-level audit rows
are produced by `afterInsert` / `afterUpdate` / `afterDelete` hooks, not by application
code. The one registered service slot (`audit`) is the **auth-event write ingress** and has
exactly one method — see [The `audit` service slot](#the-audit-service-slot) below.

## Installation

```bash
pnpm add @objectstack/plugin-audit
```

## Usage

The plugin is a class, registered on the kernel. It takes no configuration:

```typescript
import { AuditPlugin } from '@objectstack/plugin-audit';

await kernel.use(new AuditPlugin());
```

That is the whole setup surface. Coverage is not configured per object — see
[Coverage](#coverage-subtraction-not-an-allow-list).

The plugin depends on the ObjectQL engine (`com.objectstack.engine.objectql`) and resolves
it at `kernel:ready`. If no engine is available it logs a warning and installs no writers.

## What lands on the ledger

`sys_audit_log.action` is a closed enum. Every value has a writer in the platform, and
these are the only values that are ever written:

| `action` | Written by | On |
|---|---|---|
| `create` | `installAuditWriters` (this package) | `afterInsert` |
| `update` | `installAuditWriters` (this package) | `afterUpdate`, only when the diff is non-empty |
| `delete` | `installAuditWriters` (this package) | `afterDelete` |
| `login` | `createAuthEventAuditSink` (this package), called by `@objectstack/plugin-auth` | session start |
| `logout` | `createAuthEventAuditSink` (this package), called by `@objectstack/plugin-auth` | session end |
| `config_change` | `@objectstack/service-settings` | every successful settings write |
| `import` | `@objectstack/plugin-auth` admin user import | one run-level row, with `record_id: null` |

Action values are snake_case. There is no namespaced `domain:action` spelling — the enum
above is the complete accepted set, and a value outside it is not a form this object takes.

## `sys_audit_log` fields

These are the columns the object declares. Every field is `readonly: true`; rows are
written only by internal system hooks running under `sudo()`, never through UI forms.

| Field | Type | Notes |
|---|---|---|
| `id` | text | Audit log entry id |
| `created_at` | datetime | When the action occurred (`NOW()` default) |
| `action` | select | One of the seven values above |
| `user_id` | lookup → `sys_user` | Null for non-user / service actions |
| `actor` | text | Principal label: a user id, `svc:<name>`, or null. Attributes service-token writes that `user_id` structurally cannot hold |
| `object_name` | text | Target object, e.g. `sys_user` |
| `record_id` | text | Id of the affected record |
| `old_value` | textarea | JSON-serialized previous state |
| `new_value` | textarea | JSON-serialized new state |
| `ip_address` | text | Auth events only — see below |
| `user_agent` | textarea | Auth events only — see below |
| `tenant_id` | lookup → `sys_organization` | Tenant context for multi-tenant isolation |
| `metadata` | textarea | JSON-serialized additional context |

**Secret masking.** `old_value` / `new_value` are written through a ledger view that masks
the object's credential fields, using the same contract predicate the read path masks with.
A credential *rotation* still produces a row — the raw values are compared for change
detection before masking is applied — so the audit trail of a secret change survives
without the secret itself reaching the ledger.

**`ip_address` / `user_agent` are populated on auth events only.** The record-level writer
does not stamp them: a `create` / `update` / `delete` row records who and what, not from
where. Do not read a null client fingerprint on a CRUD row as "the request had none".

## Coverage: subtraction, not an allow list

The audit hooks are registered against **all objects minus an exclusion list**, not against
an enumerated set of tracked objects.

This is deliberate and load-bearing: the object universe is open — `/meta` PUT registers
new objects into a running engine — so an enumerated allow list would freeze at boot and
silently stop auditing everything created afterwards. For a compliance ledger that is a
regression that reports nothing. Subtraction has no such failure mode: **an object nobody
had heard of at install time is audited by default.**

Excluded objects fall into two groups:

- **Recursion and auth noise** — the audit/activity tables themselves, plus session,
  presence and account tables.
- **Operational telemetry and plumbing** (ADR-0057) — platform-internal event/log/queue
  objects with a `telemetry` / `transient` / `event` lifecycle class. These are not
  user-attributable changes, and mirroring them into the ledger was the dominant source of
  unbounded row growth.

The exclusion list is one definition consumed on both the registration face and inside the
handlers, so the two cannot drift.

## What the ledger does not record

Stated explicitly, because a gap in an audit surface is easily mistaken for coverage:

- **Reads and views are not on the ledger.** No writer emits a read action, and the record
  writers subscribe only to `after*` write events. `sys_audit_log` answers "who changed
  this record", not "who looked at it".
- **Failed operations are not on the ledger.** There is no success/failure column, and the
  writers fire only on `after*` events — that is, only on operations that succeeded. A
  failed write is not distinguishable from an absent one here.
- **Field-level read access is not on the ledger.**

## Reading audit rows

`sys_audit_log` declares `apiMethods: ['get', 'list']` — it is read-only over the API, and
there is no dedicated audit REST namespace. Rows are read like any other object, through
the standard object API or `services.data`, and through the shipped list views:

| View | Shows |
|---|---|
| `recent` | Everything, newest first |
| `writes_only` | `create` / `update` / `delete` |
| `auth_events` | `login` / `logout` |
| `config_changes` | `config_change` / `import` |
| `all_events` | Everything, larger page size |

Indexes are declared on `created_at`, `user_id`, `(object_name, record_id)`, `action` and
`tenant_id`.

## The `audit` service slot

`AuditPlugin` registers one service, `audit`, in `init()`. It is the **write ingress for
non-CRUD events**, and its entire surface is:

```typescript
interface AuthEventAuditSink {
  recordAuthEvent(event: AuthSessionAuditEvent): Promise<void>;
}
```

`AuthSessionAuditEvent.action` is the closed union `'login' | 'logout'`. `@objectstack/plugin-auth`
resolves this slot lazily and calls it from the session lifecycle. It is not a query API:
to read audit history, query the `sys_audit_log` object.

## Retention and archival

`sys_audit_log` declares an ADR-0057 `audit` lifecycle class: retain hot for 90 days, then
archive to the `archive` datasource and keep for 7 years.

⚠️ **The archival half needs an `archive` datasource to be registered, and fails closed to
retention without one.** When no archive target resolves, the LifecycleService retains
every row rather than deleting it, and reports the object as `archive-pending` — a
compliance ledger is never dropped unarchived. So on a deployment with no archive
datasource, the practical behaviour is: **nothing is ever deleted, and the table grows.**

## Where the rows live

`sys_audit_log` (`lifecycle.class: 'audit'`) and `sys_activity` (`lifecycle.class:
'telemetry'`) are routed by ADR-0057 §3.6 to a dedicated `telemetry` datasource whenever
one is registered — which `os dev` provisions by default as a **sibling SQLite file**
(`dev.db` → `dev.telemetry.db`). `sys_comment` carries no lifecycle class and stays on the
primary datasource.

⚠️ Anything that reads these tables **without naming the object** — raw SQL against the
default datasource — will report "no such table" even though provisioning succeeded. The
plugin logs the resolved datasource per object at startup, and calls out the split when it
is in effect.

The plugin provisions all three tables at `kernel:ready` rather than letting them be
lazy-created on first write, so an environment that reads one first does not log errors.

## Who can read audit rows

Access to `sys_audit_log` is governed by the ordinary permission system, with one boundary
worth naming here.

Permission sets that use the **hierarchy-relative depth scopes** (`own_and_reports` /
`unit` / `unit_and_below`, ADR-0057) need the enterprise hierarchy resolver shipped by
`@objectstack/security-enterprise`. The open edition ships no resolver, so those scopes
**fail closed to `own`** — they never widen visibility without it. A grant written to let
managers read their reports' audit rows will, on an open build, show them only their own.
See [Access depth](/docs/permissions/permission-sets#access-depth--readscope--writescope-adr-0057-d1).

`sys_comment`'s record-level edit gates resolve the `sharing` service lazily; without it
those checks degrade to parent-record read visibility. If the engine exposes no middleware
seam, `sys_comment` read visibility is not installed at all and the plugin logs a warning
naming the consequence.

## Exports

```typescript
// Plugin
export { AuditPlugin };

// Writer installation + test probe
export { installAuditWriters, createFieldPresenceProbe };

// Auth-event ingress (the `audit` service slot)
export { createAuthEventAuditSink };
export type {
  AuthEventAuditLogger, AuthEventAuditSink, AuthEventAuditSinkOptions,
  AuthSessionAuditAction, AuthSessionAuditEvent,
};

// sys_comment record-level access
export { installCommentAccessHooks, installCommentReadVisibility, parseCommentThreadId };
export type {
  CommentAccessEngine, CommentAccessLogger, CommentReadMiddlewareCtx,
  CommentSharingLike, CommentThreadTarget,
};
```

## License

Apache-2.0. See [LICENSING.md](../../../LICENSING.md).

## See Also

- [@objectstack/plugin-security](../plugin-security/) — permissions, RLS and field-level security
- [@objectstack/plugin-auth](../plugin-auth/) — the caller of the `audit` slot's auth-event ingress
