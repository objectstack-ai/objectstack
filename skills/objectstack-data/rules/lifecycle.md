# Data Lifecycle & Retention

Declaring how long an object's data lives and how its space is
reclaimed (ADR-0057). Distinct from
**lifecycle hooks**, which run logic on writes.

## Why This Exists

Every object without a `lifecycle` block is **immortal**: rows are never
deleted, and on SQLite the file never shrinks.

**Rule: any append-only, high-write-rate object MUST declare a `lifecycle`
block.**
The platform LifecycleService sweeps declared policies hourly, deletes
expired rows under a system context, and reclaims driver space.

## Lifecycle Classes

| Class | Contract | Typical use |
|:-|:-|:-|
| `record` | Business truth — permanent; policies FORBIDDEN | accounts, orders |
| `audit` | Compliance ledger — retain → archive → delete | audit trails |
| `telemetry` | High-frequency log — rotation / short retention | activity streams, run history |
| `transient` | Ephemeral state — TTL auto-expire | receipts, codes, sessions |
| `event` | Bus messages — very short TTL (hours) | scheduled fan-out |

## Syntax

<!-- os:check -->
```typescript
import { ObjectSchema, Field } from '@objectstack/spec/data';

// ✅ Telemetry stream: bounded by a rotation window
export const ApiCallLog = ObjectSchema.create({
  name: 'api_call_log',
  sharingModel: 'private',
  // reap past 14 days (created_at)
  lifecycle: { class: 'telemetry', retention: { maxAge: '14d' }, storage: { strategy: 'rotation', shards: 14, unit: 'day' } },
  fields: { endpoint: Field.text({}), status: Field.number({}) },
});

// ✅ Ephemeral token: TTL on its own expiry field
export const ImportTicket = ObjectSchema.create({
  name: 'import_ticket',
  sharingModel: 'private',
  // reap 1 day after expires_at
  lifecycle: { class: 'transient', ttl: { field: 'expires_at', expireAfter: '1d' } },
  fields: { expires_at: Field.datetime({}) },
});

// ✅ Compliance ledger: hot window, then cold storage
export const ConsentLog = ObjectSchema.create({
  name: 'consent_log',
  sharingModel: 'private',
  lifecycle: { class: 'audit', retention: { maxAge: '90d' }, archive: { after: '90d', to: 'archive', keep: '7y' } },
  fields: { subject: Field.text({}) },
});

// ✅ Mixed table: paused rows are live workflow state — `onlyWhen` scopes the age sweep
export const AutomationRun = ObjectSchema.create({
  name: 'sys_automation_run',
  lifecycle: { class: 'telemetry', retention: { maxAge: '30d', onlyWhen: { status: { $in: ['completed', 'failed'] } } } },
  fields: { status: Field.select(['running', 'paused', 'completed', 'failed'], {}) },
});
```

Duration literals: `<n>` + `h` / `d` / `w` / `y`.

## Validation Rules (rejected at parse time)

```typescript
// ❌ Non-record class with no bounding policy
lifecycle: { class: 'telemetry' }

// ❌ archive.after must equal retention.maxAge
lifecycle: { class: 'audit', retention: { maxAge: '90d' }, archive: { after: '30d', to: 'archive' } }

// ❌ onlyWhen + rotation/archive: both act on age alone, destroying/moving rows the filter protects
lifecycle: { class: 'telemetry', retention: { maxAge: '14d', onlyWhen: { status: 'done' } }, storage: { strategy: 'rotation', shards: 14, unit: 'day' } }
```

## Safety Semantics

- **Archive-then-delete**: an object declaring `archive` is never
  hot-deleted before the copy to the archive datasource succeeded. No
  datasource registered under the `archive.to` name ⇒ rows are retained.
- **Rotation** time-shards the table on SQLite (writes hit the
  current shard, reads go through a view under the object's name, expired
  shards are DROPped). Other dialects enforce the same window with an
  age-based reap.
- **Separation**: registering a datasource named `telemetry` moves every
  `telemetry`/`event`/`audit` object onto it.

## Sealing (`seal`)

`seal` makes an `audit` ledger tamper-evident (ADR-0154): `os audit verify`
exits 1 on a row edited, inserted or deleted outside the platform and on a
chain fault (a link, a signature, a row `listed_twice`).

Ten minutes after each `created_at` hour, `@objectstack/plugin-audit` signs
its rows, per organization chain (plus one chain for rows about no
organization), into one checkpoint, or consecutive checkpoints of at most
10,000 rows; late rows get a `late` checkpoint. Columns enter in clear,
`valueFields` as salted commitments.

`chainField` (optional, default `tenant_id`) names the chain column: a text
or lookup column holding the organization id, e.g. the injected
`organization_id`. Fixed once checkpoints exist: a change reads `listed_twice`.

<!-- os:check -->
```typescript
import { ObjectSchema, Field } from '@objectstack/spec/data';

// ✅ The sealer needs declared `id` and `tenant_id` (stamped on insert)
export const PolicyChangeLog = ObjectSchema.create({
  name: 'policy_change_log',
  sharingModel: 'private',
  lifecycle: { class: 'audit', retention: { maxAge: '1y' }, seal: { valueFields: ['new_value'] } },
  fields: { id: Field.text({}), tenant_id: Field.lookup('sys_organization', {}), new_value: Field.textarea({}) },
});
```

Refused at parse: `seal` off class `audit`, a `valueFields` name that is
undeclared, `id` or `created_at` (they order the leaves), a chain column (`chainField`, else `tenant_id`) the object lacks or that
cannot name an organization (not one text value, `id`, `created_at`, or in
`valueFields`), and beside `seal` any `onlyWhen`, a `ttl` not on
`created_at`, or rotation `storage`. Unsealed, `error` hourly: no declared `id`; a `password`,
`secret`, `formula`, `summary`, `image`, `file`, `avatar`, `video` or `audio`
column; no `cryptoProvider` on `AuditPlugin`.

Signed expiry covers objects whose lifecycle is declared in packaged metadata:
their sealed rows leave only by whole checkpoints and read as `expired`. On
such an object with no `archive`, a retention override below the declared
window is rejected and the declared window applies; to keep rows for less
time, shorten the declared window. On any other sealed object (one created at
runtime) the sweeper still deletes sealed rows, which then read as missing.

## Operations

| Knob | Where | Effect |
|:-|:-|:-|
| `enabled` | `lifecycle` settings namespace | Runtime master switch |
| `retention_overrides` | settings, **tenant-scoped** | Per-object window overrides; sealed objects: see § Sealing |
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
- A hook's message is untranslated.
- A flow a record create/update trigger starts sets it with a `save_notice`
  node (`config.message`, `{{ }}` renders); refused in any other flow, and
  after an `approval` / `wait`.
  Its message translates under `flows.<flow>.notices.<node_id>.message`
  in the saver's locale.
  Refused by name in a `subflow` / `map` child; after one whose child can
  pause, the flow is not armed (`unboundCause: 'notice_after_suspending_subflow'`).
