# Data Lifecycle & Retention

Guide for declaring how long an object's data lives and how its space is
reclaimed (ADR-0057 — system data lifecycle & retention). Distinct from
**lifecycle hooks** (`beforeInsert` / `afterUpdate` …), which run logic on
writes: this page covers the rows' retention, rotation and archival
— and, at its end, the save notice a hook hands the saver.

## Why This Exists

Every object without a `lifecycle` block is **immortal**: rows are never
deleted, and on SQLite the file never shrinks. That's correct for business
records — and a guaranteed disk leak for anything append-only.

**Rule: any append-only, high-write-rate object (event log, run history,
delivery outbox, ephemeral tokens) MUST declare a `lifecycle` block.**
The platform LifecycleService sweeps declared policies hourly, deletes
expired rows under a system context, and reclaims driver space.

## Lifecycle Classes

| Class | Contract | Typical use |
|:------|:---------|:------------|
| `record` | Business truth — permanent; policies FORBIDDEN | accounts, orders, invoices |
| `audit` | Compliance ledger — retain → archive → delete | audit trails |
| `telemetry` | High-frequency log — rotation / short retention | activity streams, run history |
| `transient` | Ephemeral state — TTL auto-expire | receipts, codes, sessions |
| `event` | Bus messages — very short TTL (hours) | scheduled fan-out |

## Syntax

```typescript
import { ObjectSchema, Field } from '@objectstack/spec/data';

// ✅ Telemetry stream: bounded by a rotation window
export const ApiCallLog = ObjectSchema.create({
  name: 'api_call_log',
  lifecycle: {
    class: 'telemetry',
    retention: { maxAge: '14d' },                                // reap past 14 days (created_at)
    storage: { strategy: 'rotation', shards: 14, unit: 'day' },  // O(1) shard DROP on SQLite
  },
  fields: {
    endpoint: Field.text({}),
    status: Field.number({}),
  },
});

// ✅ Ephemeral token: TTL on its own expiry field
export const ImportTicket = ObjectSchema.create({
  name: 'import_ticket',
  lifecycle: {
    class: 'transient',
    ttl: { field: 'expires_at', expireAfter: '1d' },  // reap 1 day after expires_at
  },
  fields: {
    expires_at: Field.datetime({}),
  },
});

// ✅ Compliance ledger: hot window, then cold storage
export const ConsentLog = ObjectSchema.create({
  name: 'consent_log',
  lifecycle: {
    class: 'audit',
    retention: { maxAge: '90d' },
    archive: { after: '90d', to: 'archive', keep: '7y' },  // must: after === maxAge
  },
  fields: {
    subject: Field.text({}),
  },
});

// ✅ MIXED table: terminal history is telemetry, but paused rows are live
// workflow state — `onlyWhen` scopes the age sweep to the declared filter
export const AutomationRun = ObjectSchema.create({
  name: 'sys_automation_run',
  lifecycle: {
    class: 'telemetry',
    retention: {
      maxAge: '30d',
      onlyWhen: { status: { $in: ['completed', 'failed'] } },  // paused rows never reaped
    },
  },
  fields: {
    status: Field.select(['running', 'paused', 'completed', 'failed'], {}),
  },
});
```

Duration literals: `<n>` + `h` / `d` / `w` / `y` — e.g. `'6h'`, `'14d'`,
`'12w'`, `'7y'`.

## Validation Rules (rejected at parse time)

```typescript
// ❌ Non-record class with no bounding policy — grows forever, exactly the bug
lifecycle: { class: 'telemetry' }

// ❌ Policies on record-class — business truth is permanent
lifecycle: { class: 'record', retention: { maxAge: '30d' } }

// ❌ Archive window detached from the hot window
lifecycle: { class: 'audit', retention: { maxAge: '90d' }, archive: { after: '30d', to: 'archive' } }

// ❌ Free-form durations
lifecycle: { class: 'telemetry', retention: { maxAge: '2 weeks' } }  // use '2w'

// ❌ onlyWhen + rotation/archive — shard DROPs and the Archiver act on age
//    alone and would destroy/move rows the filter protects
lifecycle: {
  class: 'telemetry',
  retention: { maxAge: '14d', onlyWhen: { status: 'done' } },
  storage: { strategy: 'rotation', shards: 14, unit: 'day' },
}
```

## Safety Semantics

- **No `lifecycle` block = today's behavior**: `record` is the implicit default.
- **Archive-then-delete is atomic-ish and safe by default**: an object
  declaring `archive` is never hot-deleted before the copy to the archive
  datasource succeeded. If no datasource is registered under the `archive.to`
  name, rows are simply retained — a compliance ledger cannot be destroyed
  by declaring a lifecycle.
- **Rotation** physically time-shards the table on SQLite (writes hit the
  current shard, reads go through a view under the object's name, expired
  shards are DROPped). Other dialects enforce the same window with an
  age-based reap.
- **Separation**: registering a datasource named `telemetry` moves every
  `telemetry`/`event`/`audit` object onto it — telemetry bloat can't touch
  the business DB.

## Operations

| Knob | Where | Effect |
|:-----|:------|:-------|
| `enabled` | `lifecycle` settings namespace | Runtime master switch |
| `retention_overrides` | settings, **tenant-scoped** | Per-object window overrides — a regulated tenant sets `'2y'` while dev keeps days |
| `quotas` / `quota_defaults` | settings | Row ceilings; breaches ALERT (never delete beyond declared policy) |
| `growth_alert_rows` | settings | Per-sweep growth spike alert |
| `OS_LIFECYCLE_DISABLED=1` | env | Disables sweeping entirely |

## Save Notice

A create/update hook calls `ctx.notice('Sent to your manager for approval')`
— a sandboxed `body` or the deprecated inline `handler`, no capability. The
answer carries it as `notice`; the console shows it on the save toast. **Info
severity**: an outcome, never a problem — distinct from validation
`warnings`. A `record:alert` banner is page metadata shown whenever the
record's state says so; the notice is for what *this* save started.

- One message per write, **the last call wins**; never stored.
- Insert/update dispatches only. A write nobody waits on (batch, seed,
  import, a nested write) sets nothing.
- Not a non-empty string ⇒ the write refuses; a refused write answers its
  error, no notice.
- A flow a record create/update trigger starts sets it with a `save_notice`
  node (`config.message`, `{{ }}` renders); refused in any other flow, and
  after an `approval` / `wait`.
