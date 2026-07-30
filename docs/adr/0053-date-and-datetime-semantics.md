# ADR-0053: `date` is a timezone-naive calendar day; `datetime` is an instant rendered in a reference timezone

**Status**: Accepted (2026-06-16) — Phase 1 + addendum D-A1 implemented (`sql-driver.ts` `toDateOnly` write/read/filter normalization; analytics `coerceTemporalFilterValue`), Phase 2 landing incrementally; D-A2 resolved 2026-07-30: `temporalFilterValue` + `temporalFilterColumnSql` are optional `IDataDriver` contract members with identity semantics, and analytics types its driver seam from the contract. **Partly superseded (2026-07-29, addendum D-B1..D-B4):** Phase 1's "`Field.datetime` stays stored as UTC epoch ms" is replaced by one canonical UTC instant per dialect — `YYYY-MM-DDTHH:MM:SS.sssZ` text on SQLite, `timestamptz` on Postgres, `DATETIME(3)` on MySQL — applied on write and to filter comparands alike (#3912, #3942). **Extended (2026-07-30, addendum D-C1..D-C3):** `Field.time` takes the same construction — canonical `HH:MM:SS[.fff]` wall-clock text, one function on write/filter/read, `TIME(3)` on MySQL, UTC `NOW()` defaults on every dialect (#3994).
**Deciders**: ObjectStack Protocol Architects
**Builds on**: [ADR-0032](./0032-unified-expression-layer.md) (unified expression layer — CEL dialect, `today()`/`daysFromNow()`), [ADR-0014](./0014-record-form-field-type.md) (field types)
**Consumers**: `@objectstack/spec` (`Field.date`/`Field.datetime`), `@objectstack/driver-sql` (`coerceFilterValue`, `formatInput`/`formatOutput`, `dateFields`/`datetimeFields`), `@objectstack/formula` (`stdlib` time functions, `cel-engine` hydration), `@objectstack/objectql` (`applyFormulaPlan`), schedule/cron executors, report/analytics date bucketing, `sys-user-preference.timezone`.
**Surfaced by**: the formula/flow guardrail series (#1928) and the templates time-relative bug family (#1874). Browser testing of `example-crm` and `templates` found that a `Field.date` compared for equality against a time function (`end_date == daysFromNow(60)`, `expires_on: { $in: [daysFromNow(30)] }`) **silently matches nothing** — and that the value is stored as a full timestamp, not a calendar day.

---

## TL;DR

A `Field.date` is meant to be a **calendar day** ("close date", "due date",
"birthday"). Today ObjectStack stores and compares it as a **JS `Date` / full
timestamp** — an *instant*. That is the textbook "date-as-instant" mistake, and
it produces two failures:

1. **Silent equality miss.** The write path stores the full timestamp
   (`formatInput` does not normalize — `sql-driver.ts:1967`), but the filter path
   normalizes the query value to `YYYY-MM-DD` (`coerceFilterValue` —
   `sql-driver.ts:1543`). So `date == <date-only>` compares
   `"2026-08-15T17:24Z"` against `"2026-08-15"` → never equal. Range filters
   (`$gte`/`$lt`) only work by accident of lexicographic ISO ordering.
2. **Off-by-one across timezones.** A date stored as UTC-midnight
   (`new Date("2026-06-16")` = `2026-06-16T00:00Z`) renders as **June 15** for a
   user at UTC-8. Every mature platform avoids this by treating a date as a
   timezone-naive string and never converting it to an instant.

A third, related defect: `daysFromNow(n)`/`daysAgo(n)` keep the current
**wall-clock time** (`addDaysUtc` — `stdlib.ts:36`), unlike `today()` which
truncates to UTC midnight (`startOfDayUtc` — `stdlib.ts:19`). And `today()`
is computed in **UTC**, not the user/org timezone, even though a
`sys-user-preference.timezone` exists but is never read by the engine.

**Decision.** Adopt the industry-standard split, staged by risk:

- **`date` = a timezone-naive calendar day**, represented as a `YYYY-MM-DD`
  string end-to-end (storage, query, CEL). It is **never** converted to an
  instant and **never** timezone-shifted.
- **`datetime` = an instant**, stored as UTC, **rendered in a reference
  timezone** (org default, optionally overridden per user).
- **Phase 1 (low risk, do first):** make `Field.date` a `YYYY-MM-DD` string at
  the driver write/read boundary, aligning storage with the filter layer's
  *already-existing* date-only contract. This fixes the equality miss with no
  new semantics.
- **Phase 2 (needs review):** introduce a **reference-timezone** model so
  `today()`/`daysFromNow()` and `datetime` rendering are timezone-aware.

---

## Context

### The current three-layer asymmetry (verified)

| Layer | Treatment of `Field.date` | Evidence |
|-------|---------------------------|----------|
| Column | `date` → `table.date()` (SQLite has no real DATE type — TEXT affinity) | `sql-driver.ts:1816` |
| **Write** | **no normalization** — the JS `Date` is stored verbatim, keeping its time | `formatInput`, `sql-driver.ts:1967` |
| Read | no normalization — returns the stored string with its time | empirical: `dev.db` holds `"2026-07-15T17:24:56.533Z"` |
| **Filter** | **normalizes the query value to `YYYY-MM-DD`** (date-only string compare) | `coerceFilterValue`, `sql-driver.ts:1543-1554` |
| Formula | the stored string is hydrated to a `Date` (date-only → UTC midnight) and compared against the time-function `Date` | `applyFormulaPlan` (`engine.ts`), `hydrateOverloadStrings` (`cel-engine.ts`) |

The write/filter mismatch is the proximate cause: the filter layer already
*assumes* date-only, but the write layer does not deliver it.

### The time functions disagree with each other

- `today()` → start-of-day **UTC** (`startOfDayUtc`, `stdlib.ts:19,57`).
- `daysFromNow(n)`/`daysAgo(n)` → `now() ± n*24h`, **keeping wall-clock time**
  (`addDaysUtc`, `stdlib.ts:36`). Two calls a minute apart differ.
- CEL's only temporal type is `google.protobuf.Timestamp` (a UTC instant) —
  there is no `PlainDate`. So a date field flowing into CEL is forced into an
  instant, which is exactly what we want to avoid.

### How mature platforms model this (all converge)

| Platform | date type (tz-naive) | datetime type (instant) |
|----------|----------------------|--------------------------|
| PostgreSQL | `DATE` | `timestamptz` (UTC stored, session-TZ rendered) |
| **Salesforce** (closest analog) | **Date** — tz-independent, same for all users | **Date/Time** — UTC stored, rendered in running user's TZ; `TODAY()` is user-TZ |
| java.time | `LocalDate` | `Instant` / `ZonedDateTime` |
| JS Temporal | `Temporal.PlainDate` | `Temporal.Instant` / `ZonedDateTime` |
| Rails / Django | `Date` (naive) | UTC stored + active-zone render |
| Airtable | Date field, "include time" off | "include time" on + timezone setting |

The universal rule: **a calendar date is timezone-naive and is never stored as
an instant; an instant is stored in UTC and rendered in a timezone.** The choice
between them is precisely "does this concept depend on a timezone?"

---

## Decision — staged by risk

### Phase 1 — `Field.date` is a `YYYY-MM-DD` string end-to-end (low risk)

1. **Driver write** (`formatInput`): for every field in `dateFields[table]`,
   normalize the value to `YYYY-MM-DD` before insert/update (reuse the exact
   truncation already in `coerceFilterValue`). A `Date`, a full ISO string, or a
   `YYYY-MM-DD` string all collapse to the calendar day (UTC calendar day for a
   `Date`, matching the existing filter coercion).
2. **Driver read** (`formatOutput`): coerce stored `date` values to
   `YYYY-MM-DD` (slice any time component). This transparently repairs legacy
   rows that already hold a timestamp, so equality works without a data
   migration.
3. **CEL/formula**: a `date` field is a `YYYY-MM-DD` string. Date-only
   comparisons (`==`, `<`, `>=`) operate on the string; ISO-8601 sorts
   lexicographically = chronologically, so range comparisons stay correct.
   `today()`/`daysFromNow()` used against a date field are compared date-only.
4. **No change to `Field.datetime`** — it keeps full-instant semantics
   (`datetimeFields`, stored as UTC ms — `sql-driver.ts:1500`).

After Phase 1, `date == daysFromNow(n)` works (both sides are the same calendar
day), `$in` of dates works, and the day-window range pattern keeps working. The
#1950 lint becomes a belt-and-suspenders hint rather than the only mitigation.

### Phase 2 — reference-timezone model (needs review; behavior change)

5. **Reference timezone**: an org-level default timezone setting, optionally
   overridden by `sys-user-preference.timezone` (which exists but is currently
   unread). A single resolver computes "the active timezone" for an execution
   context (interactive user vs. scheduled job → org default).
6. **`today()`/`daysFromNow()`/`daysAgo()` become timezone-aware**: "what
   calendar day is it" is computed in the reference timezone, not UTC. (At
   23:00 UTC-8 on the 15th, `today()` must be the 15th, not UTC's 16th.) For a
   genuine sub-day time offset, authors use `now() + duration("Nh")` — the
   documented escape hatch.
7. **`datetime` rendering** uses the reference timezone at the presentation
   boundary (console, templates, reports). Storage stays UTC.

Phase 2 is gated on an explicit review because it changes the meaning of
`today()`/`daysFromNow()` and touches scheduling, reporting/date-bucketing, and
rendering.

---

## Consequences

- **Phase 1 fixes the silent equality bug at the root** and is shippable on its
  own; it aligns write with the filter contract rather than inventing a
  semantic. Risk is confined to anything that *relied* on a time component
  living inside a `Field.date` — which is already semantically illegitimate and
  should be a `Field.datetime`.
- **Legacy data**: read-side normalization (step 2) repairs old timestamped
  `date` rows on the fly. An optional one-time migration can rewrite them at
  rest. `Field.datetime` data is untouched.
- **Migration audit**: grep for code that reads a `Field.date` expecting a time
  component; convert those fields to `Field.datetime`.
- **Phase 2 blast radius**: cron/schedule day-boundaries, analytics date
  buckets (`dateGranularity`), and any UI that renders datetimes shift from
  implicit-UTC to reference-TZ. Each needs a test pass.
- **Rollback**: Phase 1 is a localized driver change (revertable); Phase 2 is
  feature-flaggable behind "reference timezone unset → UTC" (today's behavior).

---

## Non-goals

- Recurring events / RRULE, business-calendar/working-day arithmetic, and
  holiday calendars — out of scope.
- Per-field timezone overrides (à la Airtable's per-field setting) — the model
  here is org-default + user-override only.
- Changing the CEL substrate to add a native `PlainDate` type — we represent
  dates as strings rather than extending cel-js.

---

## Alternatives considered

1. **Status quo + the #1950 lint only.** Rejected: the lint warns but the root
   cause (date stored as instant, write/filter asymmetry, UTC `today()`)
   remains, and the tz off-by-one is untouched.
2. **Make everything `datetime`.** Rejected: erases the legitimate, useful
   distinction every analog platform keeps; "close date" genuinely is a
   tz-naive calendar day.
3. **Store `date` as a UTC-midnight instant and compare date-only everywhere.**
   Rejected: still tz-shifts on render (the off-by-one), and re-introduces the
   instant we are trying to remove.
4. **Truncate `daysFromNow()`/`daysAgo()` to midnight but leave storage as-is.**
   Rejected as a complete fix: it helps the formula path but not the
   write/filter asymmetry, and it bakes in UTC midnight (Phase 2's tz-aware
   `today()` supersedes it).

---

## Phase 2 — Detailed Design (implementation plan)

> **Status:** Phase 1 landed in `@objectstack/driver-sql` (PR #1968) — `Field.date`
> is now a tz-naive `YYYY-MM-DD` string at the write/read boundary. This section
> details Phase 2 (the reference-timezone model) for review. It is the plan, not
> yet a commitment to ship; each slice below is independently revertable and gated
> behind "reference timezone unset → UTC" (today's behavior).

### Reframe: two axes, two sources, two risk profiles

ADR-0053's "timezone model" is, in the code, **two distinct concerns** that must
be solved separately. Conflating them in one change is the chief risk of Phase 2.

| Axis | Question it answers | Source | Boundary |
|------|--------------------|--------|----------|
| **Compute-tz** | "what calendar day is it / which bucket does this fall in?" — `today()`/`daysFromNow()`, analytics bucketing, cron day-boundaries | the **execution context** (user / org / job) | threaded *into* evaluation |
| **Render-tz** | "show this UTC instant in the viewer's zone" — `datetime` display | the **viewer** | applied at the *presentation* boundary; storage stays UTC |

Everything below is organized along this split.

### The reference-timezone resolver

A single resolver computes the active timezone for an execution context, with this
precedence:

| Layer | Stored where | Read path |
|-------|--------------|-----------|
| User override | `sys-user-preference` (`key='timezone'`) — today a generic k/v store that the engine never reads (`sys-user-preference.object.ts`) | by `(user_id, key)` |
| Org default | a **`tenant`-scoped settings manifest** (new; e.g. `localization`/`timezone`) | `service-settings` — tenant scope is keyed by `ExecutionContext.tenantId` = `activeOrganizationId`, which **is** the org under one-org-per-environment (ADR-0002), so no new scope or schema migration is needed. The settings reactive client (`settings-service.ts` `createClient`) gives a cheap in-memory snapshot. |
| Fallback | — | `'UTC'` (flag-off default; identical to today) |

**Where it resolves — one chokepoint.** Fold the resolution into
`resolveExecutionContext` (`runtime/.../resolve-execution-context.ts`), which already
queries `sys_member` / permission-sets per request; reading one user-pref + one
settings snapshot there is consistent and benefits from any future caching. Add
**`timezone?: string` to `ExecutionContextSchema`** (`spec/.../execution-context.zod.ts`).
The timezone is then resolved **once per request** and rides the existing context
plumbing to every consumer. This is the *only* new data Phase 2 introduces.

**Three execution branches** (the resolver's input differs by entry path):

| Entry path | Identity available today | TZ source |
|------------|--------------------------|-----------|
| Interactive HTTP | `userId` + `tenantId` (resolved from session) | user override → org default → UTC |
| Scheduled job / cron | none — runs `isSystem`, handler gets only `{ jobId, data }` | the **job's own `timezone` field** (`sys_job.timezone`, already wired through croner) |
| Flow / record-change trigger | `userId` only (`AutomationContext` — `automation-service.ts`) | needs a `timezone` added to `AutomationContext`; org default |

### The shared DST-safe primitive

Phase 2 invents **no** new timezone math. The DST-correct pattern already exists and
is proven in `service-messaging`'s `preference-resolver.ts` (`wallClockInTz` /
`minutesOfDayInTz`), which uses `Intl.DateTimeFormat({ timeZone }).formatToParts()`.
Extract it once — `partsInTz(instant, tz) → { y, m, d, … }` and
`calendarDayUtc(instant, tz) → Date` — into a shared util consumed by formula,
analytics, and rendering. Same single-source-of-truth discipline as Phase 1's
`toDateOnly()` helper. **Never** hand-roll offset arithmetic (breaks across DST).

### The three decisions

**D1 — `today()`/`daysFromNow()`/`daysAgo()` return a `Date` at *UTC-midnight of the
reference-tz calendar day*** — `new Date(Date.UTC(y, m, d))` where `(y,m,d)` are the
calendar parts computed in the reference tz. **Not** a date-only string; **not**
"local-midnight-as-instant".

This is forced by how comparison actually works. `record.due_date == today()` never
compares a string to `today()`: when cel-js faults on `string <op> Timestamp`,
`hydrateOverloadStrings` (`cel-engine.ts`) rehydrates the date-only field string via
`Date.parse("2026-06-15")` = **UTC midnight**. So the field side is *always* a
UTC-midnight `Date` at compare time. For `today()` to compare cleanly it must also be
a UTC-midnight `Date` of the same calendar day. The driver filter path agrees
(`coerceFilterValue`/`toDateOnly` does `getUTC*` on a `Date`), and Phase 1 stores the
UTC calendar day. UTC-midnight-of-the-reference-tz-day is the *one* representation
consistent with all three boundaries (CEL hydration, driver filter, Phase-1 storage).

> **The trap:** representing `today()` as the reference-tz *local* midnight as an
> instant (e.g. `2026-06-15T07:00:00Z` for `America/Los_Angeles`) re-introduces the
> exact tz-shifted instant this ADR removes, and it would **not** equal the
> UTC-midnight-hydrated field — the silent-miss bug returns.

Bonus: making `daysFromNow(n)`/`daysAgo(n)` compute `calendarDay ± n → UTC-midnight`
**also fixes the "keeps wall-clock time" defect** (`stdlib.ts:36`) for free. The
`now() + duration("Nh")` escape hatch remains for genuine sub-day instants.

**D2 — tz-aware analytics buckets in-memory (JS), uniformly; do not emit
dialect-specific `date_trunc … AT TIME ZONE`.** Keep DB-side bucketing only for the
UTC/no-tz fast path. `date_trunc(… AT TIME ZONE tz)` is Postgres-only; SQLite has no
timezone database and MySQL needs tz tables loaded — splitting behavior by dialect
yields *different bucket boundaries on different drivers for the same data* (a
correctness landmine the sqlite-heavy test matrix wouldn't catch). The two existing
UTC-hardcoded JS bucketers (`service-analytics` `preview-evaluator.ts` `bucketDate`,
`dimension-labels.ts` `formatDateBucket`) swap `getUTC*` for the shared `partsInTz`
util — correct on every dialect, same DST-safe code as D1. The seam is ready:
`dataset-executor.ts` already carries a `timezone` field (hard-coded `'UTC'`).
*Accepted cost:* when tz ≠ UTC the GROUP BY can't be pushed down, so wide
aggregations pull more rows. Mitigate by keeping the DB-side UTC fast path when the
reference tz is unset or `'UTC'`, still pushing the date-range *filter* to the DB and
only bucketing in memory, and revisiting a Postgres-only pushdown later if a real
workload needs it. Ship correct-and-uniform first.

**D3 — wire report schedules onto the existing `CronJobAdapter`; do not delete the
fields.** `sys-report-schedule.object.ts` documents `cron_expression` as "reserved
for the next milestone when a cron-capable scheduler adapter is available, it wins
over `interval_minutes`" — that adapter now exists (`service-job` `cron-job-adapter.ts`,
croner + per-job `timezone`, already wired for `sys_job`). `report-service.ts`
`advanceSchedule` still reads only `interval_minutes` and ignores both
`cron_expression` and `timezone`. When `cron_expression` is present, schedule via
croner with the timezone; keep `interval_minutes` as the tz-agnostic fallback. This
flips two author-facing-but-runtime-dead fields to **live** in one move — the
*enforce* resolution the spec-liveness gate wants (record this PR as ledger
evidence). Report schedules run `SYSTEM_CTX`, so their tz source is the schedule's
own `timezone` field (same model as `sys_job`) — self-contained, off the resolver's
critical path.

### Critical blind spot to fix regardless of tz

`applyFormulaPlan` (`objectql` `engine.ts`, called from `find`/`findOne`) evaluates
read-time formula fields with **only `{ record }`** — no `now`, no `execCtx`, no
timezone. Today that means `today()` inside a formula field uses real wall-clock UTC.
`find`/`findOne` already hold `opCtx.context` (the `ExecutionContext`); thread
`{ now: nowSnap, timezone, user, org }` through — mirroring `applyFieldDefaults`,
which already does this correctly. Worth doing on its own (pinned `now` for
determinism + computed fields can reference user/org), independent of timezone.

### Implementation map

| Slice | Touch points (file) | Axis | Risk |
|-------|---------------------|------|------|
| 1. Resolver + `ExecutionContext.timezone` | `resolve-execution-context.ts`, `execution-context.zod.ts`, new settings manifest | plumbing | none (default UTC) |
| 2. `applyFormulaPlan` context threading | `objectql/engine.ts` | compute | low |
| 3. tz-aware `today()`/`daysFromNow()`/`daysAgo()` + shared `partsInTz` util | `formula/stdlib.ts`, `cel-engine.ts`, `formula/types.ts` | compute | behind flag |
| 4. Render-tz in template formatters + email path | `formula/template-engine.ts` (date/datetime formatters already take `locale` → add `timeZone`); `plugin-email` rendering currently bypasses the formatter pipeline and needs routing through it | render | low blast radius (one centralized formatter) + one outlier |
| 5. Analytics bucket tz | `service-analytics` `preview-evaluator.ts`, `dimension-labels.ts`, `dataset-executor.ts` | compute | highest (dialect — see D2) |
| 6. Report schedule → croner+tz | `plugin-reports/report-service.ts` | compute | low; doubles as liveness cleanup |

Cron day-boundaries (`sys_job`) need **no change** — already tz-wired via croner.

### Open prerequisites

- **Confirm cel-js supports `duration()` + Timestamp arithmetic** (the documented
  `now() + duration("Nh")` escape hatch). No `duration` usage exists in the formula
  package today; if unsupported this is a small prerequisite patch.
- **Email rendering is architectural, not a parameter.** `plugin-email` renders via a
  naive `String()` path with no formatter/locale/tz; routing it through the formula
  template engine (or porting the formatters) is the real cost in slice 4.

### Rollback

Every slice is feature-flaggable behind "reference timezone unset → UTC". With no org
reference timezone configured, the resolver returns `'UTC'` and all compute/render
paths are byte-for-byte today's behavior — the safe default and the rollback target.

---

## Addendum (2026-06-18) — the analytics raw-SQL filter path and the temporal-coercion contract

> **Status:** first increment landed (commit `6f4cf856e`, branch
> `fix/analytics-datetime-epoch-filter`). This addendum records a gap ADR-0053 did
> **not** reach and the contract follow-ups it implies. It extends, and does not
> revise, the decision above.

### The gap

ADR-0053 fixed the `date`-as-string-vs-instant family (#1874) on the driver CRUD
path, and Phase 1 explicitly left `Field.datetime` stored as UTC epoch ms
(`sql-driver.ts:1500`, decision step 4). But analytics has a **second filter
surface that never touches that coercion**: `NativeSQLStrategy` builds raw SQL and
runs it via `engine.execute`, bypassing the driver's dialect-aware
`coerceFilterValue` (`sql-driver.ts:1543`). `buildFilterClause` emits
`${col} <op> $N` and binds the comparand directly
(`native-sql-strategy.ts:385-425`); the only type recovery was
`coerceFilterValueForSql`, which re-derives a type by **regex on the value's
shape** — no schema type, no date branch (`filter-normalizer.ts:127-140`).

So a dashboard relative-date token resolved to an ISO string (`"2025-06-18"`),
filtered against a `Field.datetime` column stored as an INTEGER epoch on SQLite,
compiled to `epoch >= 'ISO'` — a TEXT-vs-INTEGER affinity compare that is **always
false → 0 rows / empty chart**. This is the `datetime` analogue of the `date`
equality miss Phase 1 fixed, on the one path 0053 did not address.

### Decisions

**D-A1 — The driver is the single source of dialect truth for filter-value
coercion; every raw-SQL surface routes through it.** Invariant: any surface that
binds a filter comparand into raw SQL (analytics `NativeSQLStrategy` today, and any
future raw-SQL strategy) **must** coerce through the driver's dialect-aware
temporal coercion, never re-derive a type from the value's textual shape. This
closes the `datetime` analogue of Phase 1's `date` fix on the path 0053 did not
reach. The first increment — commit `6f4cf856e` (branch
`fix/analytics-datetime-epoch-filter`) — exposes the driver's coercion to
analytics via a new `StrategyContext.coerceTemporalFilterValue(object, field,
value)` hook delegating to the driver, applied across `gte/lte/gt/lt/equals`,
`in/notIn`, and the `dateRange`/timeDimension path (`native-sql-strategy.ts:371`,
`:88-106`). SQLite `datetime` → epoch ms; `date` text and native-timestamp
dialects (Postgres/MySQL) pass through unchanged. **Record this PR as ledger
evidence** — the same enforce-resolution pattern D3 uses for the dead schedule
fields.

**D-A2 — Formalize `temporalFilterValue` onto the `IDataDriver` contract.** The
hook currently delegates to a **duck-typed** `driver.temporalFilterValue(...)`
that is not on the driver contract. Promote it to a first-class
`IDataDriver`-contract method so every consumer relies on a stable surface, and
**demote the regex-shape `coerceFilterValueForSql` to a last-resort fallback (or
retire it)** once the contract method is universal. (If an in-flight
`IDataDriver`-interface change is open, align this with it; do not block on it.)

> **Resolved (2026-07-30).** Both hooks — `temporalFilterValue` and the D-B
> column-side companion `temporalFilterColumnSql` — are optional members of
> `IDataDriver` (`spec/contracts/data-driver.ts`), documented as a PAIR:
> implementing one without the other reintroduces half of #3912, so the
> contract says implement both or neither, with "absent = identity" semantics
> for drivers whose storage form is the wire form. `SqlDriver implements
> IDataDriver`, so its signatures are compile-checked; analytics derives its
> driver seam by `Pick`-ing the contract instead of a local duck type, keeping
> the runtime `typeof` guards as the (correct) way to consume an optional
> member. `coerceFilterValueForSql` already sits behind the hook as the
> last-resort boolean/number recovery for non-temporal columns — the demotion
> this decision asked for — and is retained for exactly that role.

**D-A3 — Add a temporal conformance matrix as the runtime regression backstop.**
Cover `field-type {date, datetime} × operator {eq, gte/lte/gt/lt, in, dateRange} ×
relative-token {today, N_days_ago, N_months_ago, …} × driver {SQLite, Postgres at
minimum}`, asserting correct **row results** — not just emitted SQL. Analytics has
been refactored repeatedly; this seam must not silently regress. This complements
the #1950 build-time lint ADR-0053 already references: the lint warns at author
time, the matrix proves runtime correctness across drivers.

### Consequences

- The `datetime`-on-raw-SQL filter bug is closed at the driver boundary, mirroring
  Phase 1's "align the consumer with the driver's existing contract rather than
  inventing a semantic" stance. No change to Phase 2's reference-timezone plan.
- ~~Until D-A2 lands, the hook depends on a duck-typed driver method — a known,
  intentionally-temporary seam tracked here.~~ Landed 2026-07-30; see the
  resolution note under D-A2.

---

## Addendum (2026-07-29) — `Field.datetime` has ONE storage form per dialect, always a UTC instant

> **Status:** landed. This addendum **revises** the storage half of Phase 1 (which
> left `Field.datetime` "stored as UTC epoch ms" on SQLite) and **extends**
> D-A1 from the 2026-06-18 addendum to the column side of the comparison.
> Closes #3912; supersedes the epoch-ms convention referenced there.

### What the epoch-ms convention actually was

It was never a convention — it was a description of what better-sqlite3 happened
to do with a bound JS `Date`. Nothing enforced it: `formatInput` deliberately left
`datetime` untouched, so the storage form was decided by whichever writer got
there first.

- A JS `Date` (seed loader, import, server-side code) → INTEGER epoch ms.
- A REST/JSON write → ISO **TEXT**, because JSON has no `Date` type.
- A `defaultValue: 'NOW()'` slot → ISO TEXT.
- The platform's own `created_at` / `updated_at` → ISO TEXT (they are stamped
  with `toISOString()`), on **every** object in the system.

One column therefore held both forms at once, while the read path coerced filter
comparands to epoch ms purely from the DECLARED type. On SQLite's type ordering
(`INTEGER < TEXT`) that made a two-sided window collapse to zero rows and a
one-sided `>=` match every TEXT row regardless of the bound — the reported symptom
in #3912 (a dashboard `last_30_days` reading 0 with 29 rows in range). It also
left `ORDER BY` sorting all INTEGER rows before all TEXT ones (#3928).

### D-B1 — The canonical storage form is `YYYY-MM-DDTHH:MM:SS.sssZ`

`Field.datetime` is stored as fixed-width, zone-explicit UTC text on SQLite, and
written to Postgres/MySQL as that same string. `canonicalUtcDatetime()` is the one
function that produces it, applied on write (`formatInput`) and to every filter
comparand (`coerceFilterValue`) so the two sides of a comparison cannot disagree
about shape.

Chosen over the epoch integer because:

- Lexicographic order **is** chronological order, so range filters and `ORDER BY`
  read the column directly and can use an index. An epoch convention forces an
  expression wrapper on every temporal predicate — it moves the cost rather than
  removing it.
- `strftime`/`julianday` parse it, so the date-bucket expression needs no
  epoch↔text CASE (#3773).
- It is what `formatOutput` already presents, so storage and presentation stop
  disagreeing — the asymmetry Phase 1 removed for `date`, now removed for
  `datetime`.
- It matches the `Field.date` convention, so the platform has one temporal
  storage story instead of one per field type.
- It was already the majority of rows on disk, so the migration is the smaller
  one.

### D-B2 — The comparand rule is dialect-INDEPENDENT, which fixes Postgres too

`coerceFilterValue` previously canonicalised only on SQLite and passed the value
through on native-timestamp dialects. That was not neutral. Measured against
PostgreSQL 16 with `TimeZone = Asia/Shanghai`:

- A zone-**naive** write (`'2026-03-20 12:00:00'`) bound into `timestamptz` was
  resolved against the SERVER's timezone and stored as `2026-03-20T04:00:00Z` —
  8 hours off the instant SQLite records for the same write, in direct violation
  of this ADR's "a naive wall clock is UTC" rule.
- A bare `YYYY-MM-DD` comparand (what a `{30_days_ago}` token expands to) meant
  midnight in the SERVER's timezone, so the identical query over the identical
  instant put a row on a **different calendar day** than it did on SQLite.

Stating the `Z` on both sides removes the server's timezone from the answer.
Postgres storage itself needed no change — knex's `table.timestamp` already
creates `timestamptz` (`useTz` defaults true, verified) — so this is a write- and
comparand-side fix there, not a migration. Regression cover is
`sql-driver-datetime-postgres-timezone.test.ts`, opt-in via `OS_TEST_POSTGRES_URL`
because CI provisions no server; it asserts it is pointed at a non-UTC server so
it cannot pass vacuously.

### D-B3 — Existing rows converge at schema sync; correctness never depends on it

`backfillCanonicalDatetimes` runs inside `initObjects`, rewriting SQLite rows that
are not already canonical (INTEGER/REAL epoch, zone-naive text, offset-bearing
text). It is idempotent, skips freshly-created tables entirely, and preserves
values SQLite cannot parse rather than nulling them.

It is allowed to fail. On error it logs and marks nothing, and the read paths keep
the `sqliteCanonicalDatetimeSql` repair that makes an un-migrated column compare
and bucket correctly — just without an index. A migration must never be able to
take boot down, and query correctness must never be contingent on one having run.
The corollary is that the repair expression stays in the codebase permanently: it
also covers external/unmanaged tables (ADR-0015), which never get a backfill.

`needsLegacyDatetimeRepair` is the single predicate every read path asks, so the
filter, bucket and analytics surfaces cannot drift apart about whether a column
is clean.

### Consequences

- D-A2 (promote `temporalFilterValue` onto the `IDataDriver` contract) now has a
  second method to carry with it: `temporalFilterColumnSql`, the column-side
  companion threaded to analytics as
  `StrategyContext.coerceTemporalFilterColumn`. Coercing the value alone is not
  sufficient on a mixed-form column, so any surface that binds a comparand into
  raw SQL must wrap its column reference too. Both promoted onto the contract
  2026-07-30 — see the resolution note under D-A2.
- D-A3's conformance matrix should gain a **storage-form** axis (canonical,
  legacy-epoch, legacy-naive) and a **server-timezone** axis, since both are now
  known to have produced dialect-divergent row results.
- #3928 (datetime `ORDER BY` mis-sorted on mixed storage) is closed by
  construction rather than by a sort-side fix.
### D-B4 — MySQL stores the same instant, spelled the way MySQL parses it

MySQL was the third dialect, and measurement (MariaDB 10.11, `default_time_zone
= '+08:00'`, process on `America/New_York`) found it the worst off — including
one defect D-B1 *introduced*:

- MySQL accepts neither the `T` separator nor the `Z` suffix in a datetime
  literal, so the canonical form failed the statement outright with *Incorrect
  datetime value*. An ISO comparand or REST/JSON write had **always** failed this
  way; canonicalising the write path extended it to `Date` writes too.
- `table.timestamp` emits MySQL `TIMESTAMP`: a 32-bit epoch that cannot hold an
  instant outside 1970..2038 (a contract end date in 2040 was rejected), carries
  no fractional digits so the canonical form's milliseconds were truncated, and
  converts on read/write using the session timezone.
- mysql2's `connection.timezone` defaults to the HOST's local zone and
  `@@session.time_zone` to the server's, so a zone-naive value landed 12 hours
  off with the two misconfigurations compounding.

The resolution keeps the logical canon and changes only the physical spelling:

1. `Field.datetime` maps to **`DATETIME(3)`** — range 1000..9999, milliseconds
   kept, and no timezone conversion of its own, so the column holds the UTC wall
   clock the driver writes. This is the ServiceNow model. Postgres deliberately
   keeps `timestamptz`: asking for precision 3 there would *reduce* it from
   microseconds. The builtin `created_at`/`updated_at` take the same type — the
   registry declares them `Field.datetime`, and they are what most list views
   sort by.
2. The connection is **pinned to UTC on both layers** — `connection.timezone =
   'Z'` for mysql2 and `SET time_zone = '+00:00'` via `pool.afterCreate` for the
   server. This is what makes the wall clock *be* the instant, and it keeps a
   not-yet-migrated `TIMESTAMP` column correct too. An explicit host choice is
   left alone; an existing `afterCreate` is chained, not replaced.
3. `storageDatetimeValue` respells the canonical instant as a MySQL literal for
   the bind, on the write path and the filter path alike. Deliberately strict:
   only an exactly-canonical string is rewritten, so an unparseable value or a
   year outside 1000..9999 reaches MySQL untouched and fails loudly.

`migrateMysqlDatetimeColumns` widens legacy `TIMESTAMP` columns at schema sync,
under the same failure policy as D-B3 — a `TIMESTAMP` column keeps *working*
(the driver binds the same literal and the session is UTC), it merely keeps the
range and precision limits. Verified on a real server: the ALTER moves no stored
instant, correctly-stored legacy rows round-trip exactly, and it is idempotent.

The same caveat as Postgres applies and is worth stating plainly: the migration
**cannot repair instants the old timezone-ambiguous write path recorded wrongly**
— that information is gone. It preserves what is on disk.

Regression cover is `sql-driver-datetime-mysql-storage.test.ts`, opt-in via
`OS_TEST_MYSQL_URL` (CI provisions no server), asserting a non-UTC server so it
cannot pass vacuously. 10 of its 13 cases fail without this change.

---

## Addendum (2026-07-30) — `Field.time` gets the same storage convention (D-C1..D-C3, #3994)

`Field.time` was the last temporal field type with **no storage convention at
all** — the exact meta-problem #3912 exposed for `Field.datetime`. `formatInput`
never touched it, `coerceFilterValue` returned its comparands unchanged, and the
read paths papered over the drift so well (`toTimeOnly`) that `find()` always
looked right. Measured on real servers (SQLite; PG 16 at `Asia/Shanghai`;
MariaDB 10.11 / MySQL 8.0 at `+08:00`; Node at `America/New_York`), the same
failure family followed: a business-hours window filter silently dropped 4 of 7
rows on SQLite (INTEGER epoch rows fail `>= '09:00'` because `INTEGER < TEXT`;
full-timestamp text fails `<= '18:00'` lexicographically), ORDER BY put 14:30
before 08:00, a full-ISO write failed the statement outright on PG **and**
MySQL, a bound `Date` stored a process-timezone wall clock on pg, MySQL's bare
`TIME` rounded `…00.500` up to `…01`, and a `NOW()` default resolved against
three different clocks on the three dialects.

### D-C1 — The canonical form is `HH:MM:SS`, `.fff` only when non-zero

A `Field.time` is a **timezone-naive wall-clock time-of-day** (#2004), so the
canonical text carries no zone: `HH:MM:SS`, extended to `HH:MM:SS.fff` exactly
when the milliseconds are non-zero. One function (`canonicalTimeOfDay`) produces
it and is applied on write (`formatInput`), to filter comparands
(`coerceFilterValue`/`temporalFilterValue`) and on read (`toTimeOnly`), the
D-B1 construction transplanted.

Why variable-width rather than datetime's fixed `.sss`: `.` sorts below every
digit, so lexicographic order is still chronological order across mixed widths
(`'14:30:00.100' < '14:30:01'`), and the zero-millisecond spelling `HH:MM:SS`
is what every dialect's native TIME emits — the field-zoo `f_time` round-trip
(#2022) keeps holding byte-for-byte. Determinism is what matters for equality
and `distinct()`, and each wall clock has exactly one spelling. A minutes-only
`'14:30'` completes to `'14:30:00'`.

A `Date` / epoch-ms / full-timestamp value folds to its **UTC** time-of-day —
matching the platform's instant semantics, the SQLite read repair's historical
behaviour, and `nowColumnDefault`; never the process or server timezone.
Uninterpretable values (including out-of-range wall clocks like `'25:00'`) pass
through untouched.

### D-C2 — Physical form per dialect

- **SQLite**: canonical TEXT (no native type). Legacy columns converge at
  schema sync via `backfillCanonicalTimes` — one `UPDATE` per column whose SET
  expression IS the read-repair SQL (`sqliteCanonicalTimeSql`), `IS NOT` guard,
  log-and-swallow failure policy, `os migrate plan` row-counted entry
  (`normalize_time_storage`) — D-B3 verbatim. Until it runs, filters wrap the
  column in the repair expression: correct, just unindexed.
- **Postgres**: native `time` (µs precision). The canonical literal binds
  unambiguously; the pre-fix failures were the *input* shapes, not the column.
- **MySQL**: `TIME(3)` — the `DATETIME(3)` precedent applied: bare `TIME` is
  zero-precision and **rounds** fractional literals, changing the stored wall
  clock. Legacy `TIME(0)` columns widen at schema sync
  (`migrateMysqlTimeColumns`, plan kind `widen_time_columns`), restating a
  `NOW()` expression default where declared.

### D-C3 — `NOW()` defaults are the UTC wall clock on every dialect

`knex.fn.now()` compiles to `CURRENT_TIMESTAMP`, which a TIME column resolves
in the **server's** zone on Postgres and the **inserting session's** zone on
MySQL (so the same column's default depended on who inserted). MySQL 8.0
additionally rejects a plain `CURRENT_TIMESTAMP` default on TIME. The defaults
are now expression-spelled per dialect — `strftime('%H:%M:%f','now')` with a
canonical `.000` trim on SQLite, `timezone('utc', now())::time(3)` on Postgres,
`(cast(utc_timestamp(3) as time(3)))` on MySQL (8.0.13+/MariaDB 10.2+ for the
expression-default syntax) — all reading the UTC clock.

The D-B3 caveat applies unchanged: the backfill converges *shapes*; a wall
clock the old path never recorded correctly (a pg `Date` bind serialised in the
host's zone) is not recoverable. Regression cover:
`sql-driver-time-canonical-storage.test.ts`, `sql-driver-time-of-day.test.ts`
(SQLite), `sql-driver-time-live-dialects.test.ts` (live PG + MySQL, in the CI
temporal-conformance job's non-UTC matrix).
