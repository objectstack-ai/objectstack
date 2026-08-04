# ADR-0057: System data has a lifecycle — declarative retention, rotation, and reclamation for platform-generated objects

**Status**: Accepted — **P0–P4 implemented** (P0 shipped with this ADR, [#2079](https://github.com/objectstack-ai/objectstack/pull/2079); P1–P4 in [#2791](https://github.com/objectstack-ai/objectstack/pull/2791), tracked in [#2786](https://github.com/objectstack-ai/objectstack/issues/2786)) (proposed 2026-06-20 · implemented 2026-07-10)
**Deciders**: ObjectStack Protocol Architects
**Builds on**: [ADR-0052](./0052-audit-is-not-the-activity-feed.md) (decomposed audit / activity / collaboration into bounded contexts — this ADR adds the *orthogonal* axis those contexts never specified: **how long each one lives and how its space is reclaimed**), [ADR-0049](./0049-no-unenforced-security-properties.md) (enforce-or-remove — a declared `retention` that drives no sweeper is dead surface; this ADR wires it to a runtime consumer), [ADR-0030](./0030-notification-platform-convergence.md) (notification objects are messaging-owned with their own lifecycle), [ADR-0021](./0021-analytics-dataset-semantic-layer.md) (precedent for moving event-shaped data off the primary OLTP store)
**Consumers**: `@objectstack/spec` (`lifecycle` object property + `LifecycleClass`), `@objectstack/objectql` (LifecycleService: Reaper / Rotator / Archiver), `@objectstack/plugin-audit` (audit/activity exclusion of telemetry objects — shipped P0), `@objectstack/driver-sql` (`auto_vacuum=INCREMENTAL` default + incremental-vacuum hook — shipped P0), `@objectstack/dogfood` (storage-growth regression gate), platform spec-liveness gate
**Pilot**: `app-showcase` (its 20s `showcase_scheduled_digest` flow grew `dev.db` to 260 MB+ over a multi-day `pnpm dev` — the symptom this ADR generalizes from)

---

## TL;DR

The platform can declare an object's structure, validations, permissions, and
relationships — but **not how long its data should live**. Every
platform-generated object therefore defaults to *immortal*. Any high-frequency
write source then grows the database without bound, and because the SQLite
driver ships `auto_vacuum=NONE`, the file never shrinks even after rows are
deleted.

A 20-second scheduled digest flow in `app-showcase` demonstrated this: each tick
fanned out to a job-run row, a notification (+ delivery + receipt), and an inbox
message — **and every one of those writes was mirrored into both `sys_audit_log`
and `sys_activity`** (~21 append-only rows/tick, of which audit+activity were
~76%). Over a multi-day dev session this reached **260 MB of pure
platform-generated telemetry — zero business data**.

This ADR makes **data lifecycle a first-class, declarable, runtime-enforced
metadata concern**, the same posture the platform already takes for validation
and security:

1. **Classify** every object by `lifecycleClass`: `record` | `audit` |
   `telemetry` | `transient` | `event`.
2. **Declare** retention / rotation / archival on the object metadata.
3. **Enforce** it with a single platform-owned **LifecycleService**
   (Reaper + Rotator + Archiver) — not N per-plugin implementations.
4. **Reclaim** space (SQLite `auto_vacuum=INCREMENTAL` + incremental vacuum).
5. **Stop the amplifier**: operational telemetry is excluded from the
   audit+activity writer at the seam (ADR-0052's event-spine finishes this).
6. **Gate it**: spec-liveness requires a `lifecycle` declaration on every
   non-`record` system object; a dogfood test asserts bounded growth so this
   class of regression turns CI red instead of filling a disk.

---

## 1. Context — how a few seed records became 260 MB

Forensics on the showcase `dev.db`:

- The file was **261 MB**; a freshly seeded one is **2.3 MB**. ~110×.
- **No business table grew.** `showcase_*`, `crm_*`, `pm_*` are the same seed
  rows every boot (upsert overwrites). The growth was entirely in append-only
  platform tables.
- **Driver pragmas:** `auto_vacuum=NONE`, `journal_mode=delete`,
  `freelist_count=0` → freed pages are never returned to the OS; the file is
  pinned at its high-water mark.
- **Two always-on scheduled jobs** drove the writes:
  `showcase_scheduled_digest` (`interval`, **20 000 ms**) and
  `approvals-sla-escalation` (`interval`, 300 000 ms).
- **Measured fan-out** (controlled ~120 s run): `sys_audit_log` +120,
  `sys_activity` +120, and `sys_job_run` / `sys_notification` /
  `sys_notification_delivery` / `sys_notification_receipt` / `sys_inbox_message`
  +15 each. Audit+activity were **~76 %** of all new rows — the dual-write
  amplifier described in ADR-0052 §1.
- **Rate:** ~+400 KB / 120 s ≈ **~290 MB/day** of continuous running.

Root causes, in order of leverage:

| # | Cause | Effect |
|---|-------|--------|
| 1 | No retention contract on any platform-generated object | append-only tables grow forever |
| 2 | Audit+activity dual-write on *every* mutation incl. internal plumbing | 4–8× row amplification |
| 3 | `auto_vacuum=NONE` | deleting rows would not shrink the file anyway |
| 4 | Demo-tuned 20 s interval | turns a slow leak into a fast one |

ADR-0052 already named #2 as a design flaw and set the long-term fix (an event
spine; audit becomes a pure sink). This ADR addresses #1, #3 — the lifecycle
axis — and ships the immediate mitigations for #2 and #4.

## 2. The principle — telemetry is not a system of record

The platform conflates two data kinds with opposite contracts into one OLTP
store with one persistence policy:

| Kind | Examples | True contract |
|------|----------|---------------|
| **System of record** | account, project, invoice, `sys_audit_log` | durable, retained, often immutable |
| **Operational telemetry** | activity, job_run, notification_*, inbox, http_delivery, ai_traces | value decays with time; **must be bounded** |

Every mature low-code platform separates these and bounds the second:

| Platform | Mechanism |
|---|---|
| **Salesforce** | **Big Objects** for high-volume/historical; **Field Audit Trail** `HistoryRetentionPolicy` (archive ≤10y); **Platform Events** retained ≤72h |
| **ServiceNow** | **Table Rotation** (time-sharded, DROP oldest shard = O(1) reclaim) + **Table Cleaner** (`sys_auto_flush`, delete by table/field/age) |
| **Dataverse / Power Platform** | **Elastic tables** with native **TTL** column; **Bulk Deletion** jobs; configurable **audit retention**; long-term retention to a data lake |
| **OutSystems** | logs in a **separate database** with configurable retention + cleanup |
| **Mendix** | **non-persistable entities** (memory-only) for transient state |

The consistent answer: **declarative, bounded-by-default lifecycle, enforced by a
platform-owned sweeper, with space actually reclaimed.**

## 3. Decision

### 3.1 Classify — `lifecycleClass` on every object

| Class | Meaning | Examples | Default contract |
|---|---|---|---|
| `record` | business truth | account, project, invoice | permanent, recoverable |
| `audit` | compliance ledger | `sys_audit_log`, `sys_metadata_audit` | retain → archive → delete |
| `telemetry` | high-frequency log / run flow | `sys_activity`, `sys_job_run`, `sys_notification_delivery`, `ai_traces`, `sys_http_delivery` | **rotation**, short retention |
| `transient` | workflow / ephemeral state | `sys_notification_receipt`, read inbox, `sys_device_code` | **TTL** auto-expire |
| `event` | event-bus messages | scheduled/trigger fan-out | very short TTL (hours) |

`record` is the safe default (back-compat: undeclared objects keep today's
behavior). The spec-liveness gate (§3.5) requires an explicit `lifecycle` on any
object declared `audit`/`telemetry`/`transient`/`event`.

### 3.2 Declare — `lifecycle` object metadata

```ts
defineObject({
  name: 'sys_activity',
  lifecycle: {
    class: 'telemetry',
    retention: { maxAge: '14d' },
    storage:  { strategy: 'rotation', shards: 14, unit: 'day' }, // DROP oldest shard
    reclaim: true,
  },
})

defineObject({
  name: 'sys_audit_log',
  lifecycle: {
    class: 'audit',
    retention: { maxAge: '90d' },              // hot window
    archive:   { after: '90d', to: 'datalake', keep: '7y' },
    strategy: 'archive-then-delete',
  },
})

defineObject({
  name: 'sys_notification_receipt',
  lifecycle: {
    class: 'transient',
    ttl: { field: 'created_at', expireAfter: '7d' },
  },
})
```

Policies are overridable per environment / tenant via `SettingsServicePlugin`
(regulated tenants set years; dev sets days).

### 3.3 Enforce — one platform-owned LifecycleService

```
LifecycleService (scans every object carrying a `lifecycle` declaration)
├── Reaper    — delete by TTL/age in batches (transient + low-freq telemetry); then incremental_vacuum   [≈ ServiceNow Table Cleaner]
├── Rotator   — time-shard high-freq telemetry; rotate by DROPping the oldest shard (O(1), real reclaim)  [≈ ServiceNow Table Rotation]
└── Archiver  — copy audit cold data to an archive datasource, then delete from the hot store             [≈ SF Field Audit Trail / Dataverse data lake]
```

Hard rule: **the LifecycleService's own deletes/rotations are not audited or
activity-logged** (otherwise cleanup re-feeds the tables it is draining — the
same self-audit trap ADR-0052 already guards). Aggregate one summary row at
most.

Second hard rule (implementation): **an object that declares `archive` is
never hot-deleted before the archive copy succeeded.** No archive datasource
registered ⇒ rows are retained (today's behavior), reported as
`archive-pending` — a compliance ledger cannot be destroyed by declaring a
lifecycle.

#### Amendment (#2755): reap guards — domain re-verification + external-resource reclaim

Some reapable rows are pointers to state the Reaper cannot see: `sys_file`
rows reference storage bytes (disk/S3), and a tombstoned orphan may have
regained `sys_attachment` references since it was marked. For these, a plugin
may register a **reap guard** at runtime
(`lifecycle.registerReapGuard(object, guard)`): the Reaper fetches candidate
rows in batches, the guard confirms each id — performing external cleanup
(byte deletion) and sweep-time re-verification first — or vetoes it (kept,
retried next sweep). Rules:

- A guarded object is **never blind-deleted**: an erroring guard fails safe
  (rows retained), and an engine without row reads skips the object
  (`reap-guard-unsupported`) rather than degrading to a blind delete.
- Guards are runtime wiring, not spec surface — detection and scheduling stay
  inside the single platform sweep (no bespoke sweepers, per the alternatives
  below); the guard is a domain callback, not a scheduler.
- First consumer: `sys_file` (service-storage) — attachment orphans are
  tombstoned by hooks when their last `sys_attachment` reference is deleted,
  reaped `30d` later by TTL with byte reclaim, with zero-reference
  re-verification at sweep time; abandoned `pending` uploads reap after `7d`.
- Second consumer: `sys_upload_session` (service-storage) — when an
  abandoned/terminal chunked-upload session row is reaped, its guard first
  aborts the backend multipart upload (S3 `AbortMultipartUpload` / local parts
  dir), skipping `completed` sessions and vetoing on abort failure so the
  session's already-uploaded parts don't leak.

#### Amendment (#5195): retention floors — a consumer's lower bound on a P4 override

P4 (§3.2, below) lets an operator override any object's window per environment
and per tenant through the `lifecycle` settings namespace. Until #5195 the only
validation on that override was *does it parse*, and a window is not only an
operator's decision: other code can depend on rows still being there.

`sys_job_queue` is the worked example. `DbQueueAdapter` dedups publishes by
comparing a terminal row's `created_at` against its idempotency window, so the
dedup check only means anything while that row exists; #5179 made the ordering
an invariant by refusing, at construction, an idempotency window longer than
the object's **declared** retention. A settings override the constructor cannot
see (`retention_overrides.sys_job_queue.maxAge = '1h'`) walks straight around
it: completed rows are reaped an hour after they are written, publish keeps
dedupping against 24h, and duplicate deliveries resume with **nothing in any
log** — a one-day-old enforced invariant with a side door.

So a consumer may register a **retention floor** at runtime
(`lifecycle.registerRetentionFloor(object, floor)`) declaring the shortest
window its own contract survives, plus the consequence and the fix. Rules:

- An override — global **or** tenant-scoped — below the floor is **rejected**,
  not clamped: the declared window keeps running, exactly as an unparseable
  override already resolves ("never fail open into no bound at all"). Clamping
  would enforce a third number written in neither the declaration nor the
  settings, and that number would move whenever an unrelated package changed
  its floor.
- The rejection is **`error`-level and says both halves** — what silently
  breaks below the floor and which two settings make it legal — because the
  failure it prevents leaves the system looking entirely healthy. It is also
  on the sweep report (`floorViolations`), machine-readable, every sweep.
- Floors are **runtime wiring, not spec surface**, for the same reason reap
  guards are, plus one of their own: the queue's floor *is*
  `DbQueueAdapterOptions.idempotencyWindowMs`, a per-kernel construction
  option, so a static key on the object's `lifecycle` block could only ever be
  a second copy of it that drifts. A declaration says how long rows are kept; a
  floor says how short a *consumer* can survive them being kept — different
  authors, different lifetimes.
- The floor also covers the declaration itself: a declared window below a
  registered floor is reported the same way, and still enforced — refusing to
  reap would trade a broken consumer contract for the unbounded table #5179
  just closed.
- First consumer: `sys_job_queue` (service-queue), floored at the adapter's
  configured idempotency window.

### 3.4 Reclaim — driver space hygiene

SQLite driver defaults to `auto_vacuum=INCREMENTAL` (shipped P0); the Reaper
issues `PRAGMA incremental_vacuum` after a sweep. `auto_vacuum` only re-lays-out
a *fresh* DB (or one after a one-time `VACUUM`), so existing files need a single
`VACUUM` to adopt it — acceptable, since the Reaper / a `db:clean` covers legacy
files.

### 3.5 Gate — make the regression impossible to reintroduce

- **Spec-liveness**: any object with `class ∈ {audit, telemetry, transient,
  event}` and no `lifecycle.retention`/`ttl`/`rotation` ⇒ CI red. (Mirrors
  ADR-0049 enforce-or-remove: a zero-retention telemetry object is a false
  surface.)
- **Dogfood storage-growth gate** (`@objectstack/dogfood`): boot an example
  app, let scheduled timers tick N times, assert each telemetry table ≤ its
  bound and DB-file delta ≤ threshold. Reverting any retention policy makes it
  red — the golden test for this class.

### 3.6 Physically separate telemetry (target state)

`telemetry`/`audit`/`event` objects move to a dedicated `datasource` (the
platform already supports `defaultDatasource`). Even on SQLite that is a
separate file, so telemetry bloat can never again pollute the business DB, and
the store can later be swapped for an append-only log / time-series / object
store. This is the ADR-0021 dataset-migration pattern applied to event-shaped
system data.

*Implemented as*: registering a datasource named **`telemetry`** routes every
`telemetry`/`event`/`audit`-classed object to it (engine `getDriver` step 3 —
after explicit `datasource`/`datasourceMapping`, before the manifest
`defaultDatasource`). Opt-in purely by the datasource's existence.
`transient` deliberately stays on the primary: those objects are user-session
data and some (better-auth's `sys_device_code`) are accessed outside the
engine — splitting their storage would split their brain.

## 4. Rollout

P1–P4 are tracked in [#2786](https://github.com/objectstack-ai/objectstack/issues/2786).

| Phase | Scope | Status |
|---|---|---|
| **P0 — stop the bleed** | (a) exclude operational/plumbing objects from the audit+activity writer (`plugin-audit` `SKIP_OBJECTS`); (b) SQLite `auto_vacuum=INCREMENTAL` driver default; (c) showcase digest interval 20s→60s, flagged demo-only | **shipped with this ADR ([#2079](https://github.com/objectstack-ai/objectstack/pull/2079))** |
| **P1 — contract** | `lifecycleClass` + `lifecycle` spec; LifecycleService Reaper; spec-liveness enforcement; dogfood growth gate | **implemented ([#2791](https://github.com/objectstack-ai/objectstack/pull/2791))** |
| **P2 — rotation/TTL** | Rotator (shard + DROP) for high-freq telemetry; transient TTL expiry | **implemented ([#2791](https://github.com/objectstack-ai/objectstack/pull/2791))** |
| **P3 — separation** | telemetry/audit on a dedicated datasource; Archiver cold-store | **implemented ([#2791](https://github.com/objectstack-ai/objectstack/pull/2791))** |
| **P4 — governance** | per-table storage quotas, growth alerts, tenant-level retention overrides | **implemented ([#2791](https://github.com/objectstack-ai/objectstack/pull/2791))** |

P0 alone removes ~76 % of the row growth (audit/activity exclusion) and a
further 3× (interval), and lets space be reclaimed — without any schema change
or migration. P1+ makes it bounded by construction.

## 5. Consequences

- **Positive.** Platform-generated data is bounded by default and reclaimable.
  Retention becomes a one-line declaration, enforced uniformly. Audit becomes a
  clean ledger (finishing ADR-0052's direction). The 260 MB regression becomes a
  CI assertion. Compliance retention (years) and dev ergonomics (days) are the
  same knob at different settings.
- **Cost.** A new spec property + a platform service + a datasource split.
  Sequenced P0→P4 so each step is independently shippable and back-compatible.
- **Back-compat.** Undeclared objects default to `record` (today's behavior).
  Object names and schemas are unchanged; only lifecycle policy and (P3) owning
  datasource change. The P0 audit exclusion only *stops creating* telemetry
  audit/activity rows — it neither reads nor deletes existing ones.

## 6. Alternatives considered

- **Just delete `dev.db` periodically.** Treats the symptom; production and
  long-lived dev DBs still grow unbounded, and nothing stops the next
  high-frequency writer.
- **Skip auditing by `context.isSystem`.** Too broad — the seed loader and
  server-side automations write *business* records with `isSystem: true`;
  dropping those from the ledger is a real compliance hole. The precise axis is
  the object's lifecycle class, not who wrote it.
- **Per-plugin cleanup jobs.** Produces N inconsistent implementations and
  re-introduces the self-audit trap each time. Lifecycle is a platform
  primitive, owned once.
- **Lower the interval only.** Reduces the rate but leaves growth unbounded over
  time and does not reclaim space.
