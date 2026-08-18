# @objectstack/plugin-audit

System audit-trail objects for ObjectStack: the immutable `sys_audit_log` ledger, the
`sys_activity` stream, `sys_comment`, and the ObjectQL hooks that write them.

## What this package actually does

`AuditPlugin` does three things when the kernel starts it:

1. **Registers three system objects** — `sys_audit_log`, `sys_activity`, `sys_comment`.
2. **Installs ObjectQL hook subscribers** that write ledger and activity rows on data
   mutations, plus record-level access gates for `sys_comment`.
3. **Installs the record-view writer** — an `afterFind` hook that records `read` rows for
   the objects a deployment opted in, and is not installed at all when nothing is opted
   in. See [Record-view auditing](#record-view-auditing--the-read-action).

⚠️ **There is no audit service you call to log a record change.** Record-level audit rows
are produced by `afterInsert` / `afterUpdate` / `afterDelete` hooks, not by application
code. The one registered service slot (`audit`) is the **auth-event write ingress** and has
exactly one method — see [The `audit` service slot](#the-audit-service-slot) below.

## Installation

```bash
pnpm add @objectstack/plugin-audit
```

## Usage

The plugin is a class, registered on the kernel. Write and activity auditing take no
configuration at all:

```typescript
import { AuditPlugin } from '@objectstack/plugin-audit';

await kernel.use(new AuditPlugin());
```

Write coverage is not configured per object — see
[Coverage](#coverage-subtraction-not-an-allow-list). The one thing that *is* configured is
**record-view auditing**, which records nothing until objects are named:

```typescript
await kernel.use(
  new AuditPlugin({
    readAudit: { objects: ['contact', 'account'] },
  }),
);
```

`readAudit` is the only key `AuditPluginOptions` declares, and it accepts exactly three
settings, no others:

| Option | Default | Meaning |
|---|---|---|
| `readAudit.objects` | `[]` | The closed per-object opt-in. Empty installs no hook |
| `readAudit.maxBatchSize` | `50` | Flush once this many views are buffered |
| `readAudit.flushIntervalMs` | `2000` | Flush this long after the first view of a batch |

⚠️ The writer itself has one more knob — `maxBufferedEvents` (default `10000`) — that the
plugin does **not** forward. Setting it requires calling `installReadAuditWriter` directly
against the engine; there is no plugin-level spelling for it.

The plugin depends on the ObjectQL engine (`com.objectstack.engine.objectql`) and resolves
it at `kernel:ready`. If no engine is available it logs a warning and installs no writers.

## What lands on the ledger

`sys_audit_log.action` is a closed enum. Every value has a writer in the platform, and
these are the only values that are ever written:

| `action` | Written by | On |
|---|---|---|
| `create` | `installAuditWriters` (this package) | `afterInsert` |
| `read` | `installReadAuditWriter` (this package) | `afterFind`, on opted-in objects only, and only for record-detail views |
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
| `action` | select | One of the eight values above |
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

**`ip_address` / `user_agent` are populated on auth events only.** Neither the
record-level writer nor the record-view writer stamps them: a `create` / `update` /
`delete` / `read` row records who and what, not from where. Do not read a null client
fingerprint on such a row as "the request had none". ⚠️ The shipped `record_views` list
view carries an `ip_address` column, and on a `read` row that column is **always empty**
for this reason.

**`old_value` / `new_value` are null on every `read` row**, deliberately and not as an
omission — see [Record-view auditing](#record-view-auditing--the-read-action).

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

⚠️ **Read coverage is the opposite shape** — a closed opt-in, not subtraction. The two are
not inconsistent: for writes, an object nobody remembered to list is one whose changes go
unrecorded, so the safe default is "audited"; for reads, the same default would record
every record anyone opens on every object in the system, burying the views an auditor is
actually looking for and charging every read for it. Read coverage is therefore
enumerated, and the exclusion list applies on top of it — an excluded object cannot be
opted in.

## Record-view auditing — the `read` action

Answers "who viewed this record, and when?". Nothing is recorded until a deployment names
the objects it wants recorded.

### The opt-in is an install-time list, not a metadata key

⛔ There is no `enable.auditReads` object-metadata key and no global switch. The audited
set is a constructor argument, given once at the place the plugin is installed:

```typescript
new AuditPlugin({ readAudit: { objects: ['contact', 'account'] } });
```

That shape is deliberate. A declarable metadata key can be set on an object in a
deployment that never installs this plugin — producing a metadata file that *reads* as
audited and writes nothing. A declaration a compliance reviewer mistakes for coverage is
worse than an absent feature, and one input at the point of installation cannot make that
claim.

`installReadAuditWriter` filters the list before it registers anything:

- names on the audit exclusion list above are **dropped with a warning** naming the object,
  not silently accepted — the list is derived from the write-side exclusions rather than
  re-typed, so the two cannot disagree;
- duplicates and blanks are removed, and the returned handle reports `auditedObjects`,
  i.e. what was actually registered rather than what was asked for;
- an empty (or fully excluded) set registers **no hook at all**, so a deployment that opts
  nothing in pays nothing on its read path.

### Only record-detail views produce a row

A read is recorded when **both** hold:

1. it materialized exactly one record — `findOne` returning a record, not `find` returning
   an array (an array, `null` or `undefined` result is never a detail view); and
2. its predicate **pinned the primary key**. `GET /data/:object/:id` reaches the engine as
   `findOne(object, { where: { id } })`, which is the record-detail surface. A `findOne`
   carrying any other predicate is "give me *a* matching record" — an internal lookup, not
   someone opening a record.

The predicate walk tolerates what the security middleware leaves behind: an `id` equality
AND-composed with an RLS/tenant clause still counts, and the explicit `{ id: { $eq: … } }`
spelling is accepted. `$or` or `$not` anywhere on the path **disqualifies** the read — the
row may have matched through the other arm, so the id equality no longer proves the read
was for that record. Nesting is walked to a fixed depth of 8.

⇒ **List and search reads are never recorded**, including a list read that happened to
return exactly one record. List auditing is a deferred follow-up, and a deferral that
leaked rows anyway would not be one.

### Ledger writes happen off the request path

The hook **enqueues and returns**; it awaits nothing. Rows are persisted on a later tick by
a batcher, flushed whichever comes first — `maxBatchSize` views buffered (default 50) or
`flushIntervalMs` since the batch's first view (default 2000ms) — and the plugin's
`destroy()` drains the tail so a clean shutdown does not take the last batch with it.

`created_at` on each row is the instant the record was **viewed**, not the instant its
batch drained. Batching would otherwise stamp a whole batch with one flush timestamp, and a
ledger that answers "when did they look?" with the time its own buffer emptied is wrong by
up to the flush interval.

Two failure postures, both loud once and never retried:

- **Buffer overflow.** Past `maxBufferedEvents` (default 10000) the **oldest** buffered
  views are dropped and a `warn` is logged once. The reads all still succeeded and returned
  200, so nothing else reports the hole.
- **A failed ledger write.** The batch is lost, an `error` is logged once, and the read is
  unaffected — an audit write must never turn a valid read into an error, and retrying in a
  loop against an unreachable table turns a degradation into an outage.

### What the row contains — and what it deliberately does not

A `read` row carries `action: 'read'`, the view instant on `created_at`, `user_id`,
`actor`, `object_name`, `record_id`, and `tenant_id` — the viewed record's own
organization, falling back to the viewer's session organization, so a row about an org-A
record does not land behind org B's tenant wall. In multi-tenant mode, where the platform
injects an `organization_id` column onto `sys_audit_log`, the same value is stamped there
too: that column is what the row-level tenant wall gates on, and an unstamped row is one
non-admin members can never see.

⛔ **No field values are ever recorded.** `old_value` and `new_value` stay `null`. The
`afterFind` hook runs *inside* the security middleware, ahead of its field masking, so the
record it sees is pre-mask plaintext; copying values in would mint a plaintext copy of
exactly what field-level security withholds, inside the one table compliance staff are
granted broad access to. It follows that the ledger does not record *what the viewer
actually saw* — only that they opened the record.

Two boundaries are declared rather than left to be discovered:

- **A system-elevated read writes no row.** Anything carrying `session.isSystem` — an
  `api.sudo()` path, a formula recompute, a roll-up, a trigger — is the platform reading
  for its own bookkeeping, not a person opening a record. Note `sudo()` keeps the caller's
  user id, so this flag is the only thing separating the two.
- **A read with no principal writes no row.** With neither a user id nor an actor there is
  no answer to "who", and a row naming nobody only adds noise to the one query this
  capability exists to serve.

Rows surface in the shipped `record_views` list view.

## What the ledger does not record

Stated explicitly, because a gap in an audit surface is easily mistaken for coverage:

- **Reads are on the ledger only where they were opted in, and only as record-detail
  views.** An object absent from `readAudit.objects` produces no `read` row at all, and no
  list or search read produces one on any object. See
  [Record-view auditing](#record-view-auditing--the-read-action) for the full scope.
- **What a viewer actually saw is not on the ledger.** A `read` row records who opened
  which record; it carries no field values, so it cannot answer which fields were visible
  to that viewer after masking.
- **Failed operations are not on the ledger.** There is no success/failure column, and the
  write hooks fire only on `after*` events — that is, only on operations that succeeded. A
  failed write is not distinguishable from an absent one here. The same holds for reads:
  the `afterFind` hook is reached only by a read that succeeded, so a refused read leaves
  no trace.
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
| `record_views` | `read` — who opened which record |
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

**Record-view auditing adds no enterprise dependency.** The platform capability registry
declares this package's edition as `open`; `read` rows are written by this package, and the
opt-in is ordinary plugin configuration, so nothing about the capability degrades on an
open build. The boundary above still applies to `read` rows the same way it applies to
every other row — they are read through the same permission system, so a grant written with
a hierarchy-relative scope shows a manager only their own record-view rows without the
enterprise resolver.

## Exports

```typescript
// Plugin
export { AuditPlugin };

// Writer installation + test probe
export { installAuditWriters, createFieldPresenceProbe };

// Record-view auditing (the `read` action)
export { installReadAuditWriter, createReadAuditBatcher, extractDetailReadId, READ_AUDIT_ACTION };
export type {
  ReadAuditBatcher, ReadAuditBatcherOptions, ReadAuditEvent, ReadAuditLogger,
  ReadAuditTimers, ReadAuditWriterHandle, ReadAuditWriterOptions,
};

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
