---
'@objectstack/spec': minor
---

fix(spec)!: `CronSchedule.timezone` is judged by the `iana_time_zone` membership predicate (#16292)

**BREAKING** — an accept-set narrowing on a published authoring key.
`CronScheduleSchema.timezone` was a bare `z.string().optional().default('UTC')`, so
`defineJob` and `JobSchema.parse` took `timezone: 'UTC+8'` at authoring and build time
and said nothing. It is now judged by `isValueDomainMember('iana_time_zone', …)` — the
predicate `@objectstack/spec/shared` already exports, and the same judge the four
`valueDomain: 'iana_time_zone'` columns (`sys_business_unit.timezone`,
`sys_organization.timezone`, `sys_job.timezone`, `sys_report_schedule.timezone`) are
written against. Shipped as `minor` under the repo's launch-window convention for
accept-set narrowings.

No job that ran yesterday stops running. The value was already carried unchanged to
`CronJobAdapter.schedule`, where croner — constructed with a callback — throws on a
non-member and `AppPlugin` records a per-job `FAILED TO SCHEDULE` at `error` level plus
a `jobScheduleFailuresTotal` increment: the job was declared and never ran. What moves
is WHEN its author is told, from the first environment that boots to `defineJob` /
`os build`. So a stack whose job carries a zone the platform cannot honour now stops
building instead of booting-and-not-running.

Membership is the `Intl.DateTimeFormat` probe rather than a checked-in list, so the
accepted set is the host's own tz database — deliberately, and identically to those four
columns, the settings door and `resolveAuthzContext`. It is what every `Intl`-based
consumer downstream accepts, so the parse-time answer and the schedule-time answer
cannot disagree on one host. `UTC`, the key's own declared default, is a member on every
conforming runtime, so an omitted key is untouched.

`interval` and `once` schedules carry no zone and are unaffected. The boundary type
`JobSchedule.timezone` on `@objectstack/spec/contracts` is a third, separate door and is
deliberately left out of this change.

Clause-②: yes (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) No key, export, config field or stored shape is added, removed, renamed or re-spelled, and no metadata document has to be rewritten into a different one. The narrowing is value-level and undecidable in the upgrade direction: an offset spelling such as `UTC+8` names no zone at all, so nothing can derive whether its author meant `Asia/Shanghai`, `Asia/Singapore` or `Australia/Perth` — the answer is a fact about the deployment, never about the refused string. `objectstack migrate meta` therefore has nothing mechanical it could apply, and a ledger row would carry an empty mapping. The sibling column-tier narrowing of the same concept is already recorded as `platform-timezone-columns-iana-domain-refused`; this authoring-tier door is a different door and is deliberately not filed under that id. -->
