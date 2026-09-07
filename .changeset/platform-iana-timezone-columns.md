---
'@objectstack/platform-objects': minor
---

feat(platform-objects): `sys_job.timezone` and `sys_report_schedule.timezone` are validated against the IANA domain (#15872)

**BREAKING** accept-set narrowing on two published columns, shipped as `minor`
under the repo's launch-window convention for breaking changes. Both columns now
declare `valueDomain: 'iana_time_zone'`, so a value the shipped build stored
without complaint is refused from this release on. During the launch window the
bump level is not the carrier of breaking-ness and says nothing about whether a
release breaks you; this banner is the carrier, and the ADR-0087 disposition at
the foot of this changeset is the other one.

**What stops being accepted.** A write to either column is now refused with the
ADR-0114 field error code `value_domain` unless the value is a member of the
IANA/tzdb set, tested with the `Intl.DateTimeFormat` probe. Three classes of
string that the previous build accepted are outside that set:

- **UTC-offset spellings** — `UTC+8`, `GMT+0800`, `+08:00`. They name an offset,
  not a zone, and no offset spelling is an IANA identifier. The tzdb's own
  fixed-offset zones are members and keep working: `Etc/GMT-8` is accepted.
- **Windows / CLDR display names** — `China Standard Time`,
  `Pacific Standard Time`. That is the Windows time-zone vocabulary, a different
  naming scheme from tzdb, and no member of it is a tzdb identifier.
- **shape-valid identifiers for zones that do not exist** — `Mars/Olympus`. A
  `Region/City` pattern cannot separate an unassigned identifier from a real
  one; membership can, which is what the domain is for.

**What keeps working.** Every genuine IANA identifier, including `UTC` — the
membership predicate is the `Intl.DateTimeFormat` probe, deliberately not the
`Intl.supportedValuesOf('timeZone')` enumeration, which omits `UTC`. That
matters here rather than academically: `'UTC'` is `sys_report_schedule.timezone`'s
own declared default.

**Stored rows are unaffected — only writes are judged.** No upgrade step, no
backfill, no DDL. In the published words of the contract this declaration is
governed by (`packages/spec/src/data/field.zod.ts`, the `valueDomain` description):

> Checked on the WRITTEN value only (the `min`/`max`/`maxLength` transition-gate
> class): a stored value outside a domain declared later is never re-read and
> survives unrelated edits — only a write carrying a non-member is refused, with
> the field error code `value_domain`.

So a deployment already holding `UTC+8` in one of these columns keeps it and
reads it back unchanged; what changes is the next write. The one thing to know
before upgrading is therefore an authoring fact, not a data-at-rest one: a
producer that writes one of the three spellings above starts getting a refusal
where it previously got a success, and for `sys_report_schedule` that refusal is
the point — see the behaviour note below.

The platform's two oldest IANA time-zone columns predate `valueDomain` and disagreed with each other in three dimensions at once — length (100 vs 64), default (none vs `'UTC'`) and validation (neither). This closes the third: both now declare `valueDomain: 'iana_time_zone'`, the same declaration and the same `Intl.DateTimeFormat` membership probe that `sys_business_unit.timezone` and `sys_organization.timezone` carry (#14238). Four columns, one spelling of "is this a real zone".

**What it was worth, measured before the fix rather than assumed.** The two columns are not equally exposed, and only one of them was dangerous.

- `sys_report_schedule.timezone` is read back and handed to a scheduler. `ReportService.nextRunAt` calls `new Cron(cron, { timezone }).nextRun(from)`, and croner does not reject a non-member zone at construction when there is no callback — it throws from `nextRun()`. That throw was caught and turned into a fall back to `interval_minutes`. So a typo'd zone silently discarded the cron expression: an admin's "every weekday 09:00 Asia/Shanghai" became "every 1440 minutes, forever", logged only as `invalid cron '<expr>'` — a warning naming the wrong input, because the expression was fine. Not a throw and not a fall back to UTC: the wrong instant, permanently. Refusing the write is what closes it. (`scheduleReport`'s eager create-time guard did not catch it either: it constructs a callback-less `Cron` and is blind to exactly this half of its own input. That is a separate defect in `plugin-reports`, carded, not fixed here.)
- `sys_job.timezone` is written and never read. `DbJobAdapter` mirrors the in-memory schedule onto the row; its three `sys_job` read sites take `id` / `run_count` / `failure_count` only. The zone the scheduler honours never travels through this column, and `DbJobAdapter.schedule` awaits the cron adapter before it upserts the row, so a non-member cannot even reach the column that way — croner constructed WITH a callback throws, and `AppPlugin` reports it as `Background job FAILED TO SCHEDULE — it will never run`. The door this declaration closes there is the other one: a direct write from Studio, REST or a script, which had no validation at all.

**What is deliberately NOT converged**, and is pinned so that staying unconverged is a decision rather than a drift someone repairs by reflex:

- **the defaults still differ.** A default here is a consumer semantic, not a shape question. `sys_report_schedule` documents and implements a UTC default; `sys_job` has no reader at all, and minting one would change what an unset row means.
- **the bounds still differ (100 vs 64).** `maxLength` is not only a write bound — it reaches DDL, and narrowing a physical `varchar(100)` is `driver-sql`'s `narrow_varchar` op at severity `error`, category destructive ("narrowing may truncate"). What the column physically holds in a deployment is not readable from the repo, so the convergence is a separate decision and #15872 stays open on it. Note what the domain declaration already costs the wider bound: no member is longer than 32 characters on the current Node baseline, so 100 now admits nothing 64 would not.

<!-- adr-0087: not-required (no-migration-prescription) A DECLARED-BREAKING accept-set narrowing on two existing columns that leaves nobody a metadata rewrite to perform. `valueDomain` is the `min`/`max`/`maxLength` transition-gate class: only a WRITTEN value is judged, a stored value outside a domain declared later is never re-read and survives unrelated edits, so `objectstack migrate meta` has nothing to rewrite and there is no tombstone to mint. No metadata key, export, config field or stored shape is renamed, retired, re-typed or tombstoned; no column is added, dropped or re-bounded (`maxLength` is unchanged on both, deliberately), so boot schema-sync plans no DDL either. What an upgrader has to know is a WRITE-PATH fact rather than a stored-shape one, and the body above states it rather than assuming it: a deployment that already stored a non-IANA string in either column keeps it and reads it back unchanged; what changes is that the next WRITE of such a value is refused with the ADR-0114 field error code `value_domain`. The channel that reaches an affected producer is that refusal, at its own write, which is more precise than a ledger line the producer never reads. -->
