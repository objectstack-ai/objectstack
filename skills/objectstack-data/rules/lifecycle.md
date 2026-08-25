# Data Lifecycle & Retention

Guide for declaring how long an object's data lives and how its space is
reclaimed (ADR-0057 — system data lifecycle & retention). Not to be
confused with **lifecycle hooks** (`beforeInsert` / `afterUpdate` …) —
those run business logic on data operations; *this* page is about
retention, rotation, and archival of the rows themselves.

## Why This Exists

Every object without a `lifecycle` block is **immortal**: rows are never
deleted, and on SQLite the file never shrinks. That's correct for business
records — and a guaranteed disk leak for anything append-only. A scheduled
flow writing telemetry every 20 seconds once grew a dev database from 2 MB
to 260 MB with zero business data in it.

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

- **No `lifecycle` block = today's behavior.** Nothing is deleted. `record`
  is the implicit default.
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

## Decision Tree

1. Users create/edit it and it represents business state? → `record` (omit the block).
2. Is it a compliance/audit trail? → `audit` + `retention`, add `archive` if cold storage exists.
3. Written by machines at high frequency, value decays in days/weeks? → `telemetry` + `retention` (add rotation `storage` for the hottest tables).
4. Meaningless after a deadline (tokens, receipts, read-state)? → `transient` + `ttl` on the natural expiry field.
5. Bus/fan-out messages? → `event` + a short `ttl` (hours).
6. Table mixes prunable history with live state (e.g. terminal vs paused runs)?
   → add `retention.onlyWhen: { status: { $in: [...] } }` so rows outside the
   filter are retained regardless of age. Not combinable with rotation/archive.
