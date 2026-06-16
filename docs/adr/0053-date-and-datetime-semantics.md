# ADR-0053: `date` is a timezone-naive calendar day; `datetime` is an instant rendered in a reference timezone

**Status**: Proposed (2026-06-16)
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
