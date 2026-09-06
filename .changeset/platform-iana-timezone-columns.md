---
'@objectstack/platform-objects': minor
---

feat(platform-objects): `sys_job.timezone` and `sys_report_schedule.timezone` are validated against the IANA domain (#15872)

**BREAKING** accept-set narrowing on two published `isSystem` columns, shipped
as `minor` under the repo's launch-window convention for breaking changes. The
level is not the carrier during the window — `scripts/check-changeset-no-major.mjs`
refuses `major` repo-wide until GA — so this banner and the ADR-0087 disposition
below are the whole signal. Both columns shipped with no validation at all: every
string a `text` column accepts was accepted here. Measured against the shipped
build before the change, `UTC+8`, `China Standard Time` and `Mars/Olympus` all
store today and are all refused after it. Nothing is removed or renamed, and the
narrowing is still a break: a write that succeeded now fails.

The platform's two oldest IANA time-zone columns predate `valueDomain` and disagreed with each other in three dimensions at once — length (100 vs 64), default (none vs `'UTC'`) and validation (neither). This closes the third: both now declare `valueDomain: 'iana_time_zone'`, the same declaration and the same `Intl.DateTimeFormat` membership probe that `sys_business_unit.timezone` and `sys_organization.timezone` carry (#14238). Four columns, one spelling of "is this a real zone".

**The delta a consumer has to plan for.** The accept set is now exactly IANA/tzdb
membership under that probe (never the `Intl.supportedValuesOf('timeZone')`
enumeration, which omits `UTC`). A write of anything else is refused with the
ADR-0114 field error code `value_domain`, naming the field. What stops being
accepted, on either column:

- UTC-offset spellings — `UTC+8`, `GMT+0800`, `+08:00`.
- Windows / CLDR display names — `China Standard Time`, `Pacific Standard Time`.
- shape-valid identifiers for zones that do not exist — `Mars/Olympus`, a
  misspelled `Asia/Shanghia`.

Every genuine zone identifier keeps working, `UTC` included; both columns stay
`required: false`, so leaving the field unset is unaffected.

**Stored rows are unaffected**, and that is published contract text rather than a
courtesy. `packages/spec/src/data/field.zod.ts` declares `valueDomain` as
"Checked on the WRITTEN value only (the `min`/`max`/`maxLength` transition-gate
class): a stored value outside a domain declared later is never re-read and
survives unrelated edits — only a write carrying a non-member is refused, with the
field error code `value_domain`." So a deployment already holding `UTC+8` in
either column keeps that row, reads it back unchanged, and can still edit the rest
of it; what changes is the next WRITE of such a value. For `sys_report_schedule`
that refusal is the point — see the behaviour note below. `objectstack migrate
meta` has nothing to rewrite and boot schema-sync plans no DDL (`maxLength` is
unchanged on both, deliberately).

**What it was worth, measured before the fix rather than assumed.** The two columns are not equally exposed, and only one of them was dangerous.

- `sys_report_schedule.timezone` is read back and handed to a scheduler. `ReportService.nextRunAt` calls `new Cron(cron, { timezone }).nextRun(from)`, and croner does not reject a non-member zone at construction when there is no callback — it throws from `nextRun()`. That throw was caught and turned into a fall back to `interval_minutes`. So a typo'd zone silently discarded the cron expression: an admin's "every weekday 09:00 Asia/Shanghai" became "every 1440 minutes, forever", logged only as `invalid cron '<expr>'` — a warning naming the wrong input, because the expression was fine. Not a throw and not a fall back to UTC: the wrong instant, permanently. Refusing the write is what closes it. (`scheduleReport`'s eager create-time guard did not catch it either: it constructs a callback-less `Cron` and is blind to exactly this half of its own input. That is a separate defect in `plugin-reports`, carded, not fixed here.)
- `sys_job.timezone` is written and never read. `DbJobAdapter` mirrors the in-memory schedule onto the row; its three `sys_job` read sites take `id` / `run_count` / `failure_count` only. The zone the scheduler honours never travels through this column, and `DbJobAdapter.schedule` awaits the cron adapter before it upserts the row, so a non-member cannot even reach the column that way — croner constructed WITH a callback throws, and `AppPlugin` reports it as `Background job FAILED TO SCHEDULE — it will never run`. The door this declaration closes there is the other one: a direct write from Studio, REST or a script, which had no validation at all.

**What is deliberately NOT converged**, and is pinned so that staying unconverged is a decision rather than a drift someone repairs by reflex:

- **the defaults still differ.** A default here is a consumer semantic, not a shape question. `sys_report_schedule` documents and implements a UTC default; `sys_job` has no reader at all, and minting one would change what an unset row means.
- **the bounds still differ (100 vs 64).** `maxLength` is not only a write bound — it reaches DDL, and narrowing a physical `varchar(100)` is `driver-sql`'s `narrow_varchar` op at severity `error`, category destructive ("narrowing may truncate"). What the column physically holds in a deployment is not readable from the repo, so the convergence is a separate decision and #15872 stays open on it. Note what the domain declaration already costs the wider bound: no member is longer than 32 characters on the current Node baseline, so 100 now admits nothing 64 would not.

<!-- adr-0087: not-required (no-migration-prescription) An accept-set NARROWING on two published system columns, declared by ADDING one field property. Nothing is removed, renamed, re-typed or tombstoned: no metadata key, export, config field or stored shape moves, and no column is added, dropped or re-bounded, so `objectstack migrate meta` has no key to convert and boot schema-sync plans no DDL. `valueDomain` is the `min`/`max`/`maxLength` transition-gate class — only a WRITTEN value is judged and a stored non-member is never re-read — so a ledger entry here would prescribe a stored-metadata conversion that does not exist, which is false data in the one ledger this mechanism keeps true. The other five answers are closed to this change on their own terms: the touched surface is an object definition, i.e. metadata, so neither `runtime-interface-only` nor `type-surface-only` can be claimed; `@objectstack/platform-objects` publishes to npm, so not `unpublished`; and no pre-existing entry covers it, so not `already-registered`. The channel that reaches an affected deployment is the refusal itself, which names the field and the ADR-0114 code `value_domain`, and which real zone a non-member string should become is authoring intent no ledger line can decide. This body carries no rewrite prescription, which is the one mechanical check this category owes. -->
