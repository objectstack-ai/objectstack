# ADR-0157: Working calendars are organization-editable runtime data — a consumer names a calendar by code or takes the organization default, otherwise it refuses; formulas and the approval clock read it in the same release

**Status**: Proposed (2026-11-19). **This record declares; it implements nothing** — no schema, no object, no code, no changeset. Three cards implement it: [#35355](https://github.com/objectstack-ai/objectstack/issues/35355), [#35356](https://github.com/objectstack-ai/objectstack/issues/35356) and [#35357](https://github.com/objectstack-ai/objectstack/issues/35357). `docs/adr/**` is a Tier H governed surface (Prime Directive #14): the maintainer's merge adopts this record, and until then every decision below is a proposal.

- **Date**: 2026-11-19
- **Card**: [#35354](https://github.com/objectstack-ai/objectstack/issues/35354) (p1), the first slice of the epic [#35340](https://github.com/objectstack-ai/objectstack/issues/35340).
- **Decided by**: the maintainer, 2026-11-19 05:47Z, on #35340, verbatim 「同意 p1」, recorded in ruling comment [`7000950747`](https://github.com/objectstack-ai/objectstack/issues/35340#issuecomment-7000950747). The sub-cards were approved at 06:03Z with 「同意」 and 「都是 p1」. The ruling's own text is the authority this record executes; where the two differ in words, the ruling wins and this record is corrected.
- **Unfreezes**: the business-hours half of #13655 (ruling record 5478756633, cited from [#13801](https://github.com/objectstack-ai/objectstack/issues/13801); #13655 itself answers 404 to this session). That half was frozen until a named external user asked. The ruling counts the pull from the platform's own suites (the hotcrm case SLA matrix, hotsrm delivery dates, the production suite) as meeting that condition. The freeze's second constraint stands and is D4 here.
- **Reverses**: the in-seat finding on #13801 (comment [`5506987580`](https://github.com/objectstack-ai/objectstack/issues/13801#issuecomment-5506987580)) that a clock marker on `timeoutHours` would be inert. That finding held only while one clock existed; with two clocks the marker has a reader (D5).
- **Builds on**: [ADR-0144](./0144-multi-currency-record-currency-dated-rates-write-time-home-projection.md) (`sys_exchange_rate`: organization-scoped runtime data that an administrator writes and that every change audits — the precedent for D1, and `ERR_HOME_CURRENCY_UNSET`, the precedent for refusing rather than guessing in D2). [ADR-0049](./0049-no-unenforced-security-properties.md) (enforce-or-remove: a calendar nobody reads, an inherited column nobody reads and a clock key with one value are all inert — D2, D4, D5). [ADR-0029](./0029-kernel-object-ownership-and-platform-objects-decomposition.md) D1, D3 and D6 (a first-party capability owns its `sys_*` objects; which package owns the two objects here is #35355's to settle against it). [ADR-0053](./0053-date-and-datetime-semantics.md) (an exception's date is a calendar day, never an instant; time-zone arithmetic goes through the shared DST-safe primitive). [ADR-0112](./0112-error-code-vocabulary-and-ledger.md) (every refusal below answers with a ledger code that the implementing card registers).
- **Amends**: no decision. The `timeoutHours` describe text, which says the platform ships no business-hours calendar, is rewritten by #35357, not here.

---

## Provenance

Three kinds of text feed this record, and each section says which kind it carries.

1. **Ruled.** The seven design points of ruling `7000950747`, restated as seven items in the Scope of #35354. [Decision](#decision) carries only these, one D-item per Scope item, in the ruling's own terms.
2. **Analysis the ruling read.** The design analysis for #35340 (project file `card-35340/design-analysis.md`, outside this repository). It supplies the context and the alternatives. A detail that appears only there is not ruled: this record lists such details under [Open questions](#open-questions), never as a decision.
3. **Readings.** Current behaviour, read on `objectstack-ai/objectstack` at `3819afec` (2026-11-19) and cited by symbol anchor (`path#symbol`). Nothing below was run.

## Context

### What the platform has today

- **No working calendar.** No object, service, formula function or spec key counts working time. The only `workingDaysBetween` in the tree is a private QA helper that rebases scenario dates (`packages/qa/scenarios/src/runner/run-date.ts#workingDaysBetween`); it skips Saturdays and Sundays and nothing else, and no runtime reads it.
- **Approval escalation counts wall-clock hours.** `timeoutHours` on `packages/spec/src/automation/approval.zod.ts#ApprovalEscalationSchema` says so in its describe text: nights, weekends and holidays count, and "the platform ships no business-hours calendar". The sweep adds the hours to the request's `created_at` as elapsed milliseconds (`packages/plugins/plugin-approvals/src/approval-service.ts#slaDueAt`). It reads the escalation from the `node_config_json` snapshot stored on each request, so a snapshot written before a new key exists can only mean what the old schema meant. The last change of a default on this block left a cutoff window behind it (`packages/plugins/plugin-approvals/src/approval-service.ts#ESCALATION_ENABLED_FLIP_CUTOFF_MS`).
- **Formulas evaluate synchronously, over pinned data.** The stdlib header (`packages/formula/src/stdlib.ts`) forbids handing a function a resolver or any callback into the host; each evaluation binds `now` and a time zone (`packages/formula/src/cel-engine.ts`). A function that needs a calendar must therefore receive it as data loaded before evaluation.
- **Pushdown refuses every function call.** The CEL-to-filter compiler lowers comparisons and a few string methods and answers `unsupported` for arithmetic and function calls (`packages/formula/src/cel-to-filter.ts#CelFilterFailReason`).
- **The precedent object.** `sys_exchange_rate` (`packages/platform-objects/src/system/sys-exchange-rate.object.ts#SysExchangeRate`) is organization-scoped, written by organization administrators, audited, and filled by hand, by import or by an app flow. The platform ships no rate feed.
- **The business unit's time zone has no reader.** `sys_business_unit.timezone` (`packages/platform-objects/src/identity/sys-business-unit.object.ts#SysBusinessUnit`) states in its own help text that it changes no date calculation today.
- **A second source of truth already exists in the UI.** The gantt view declares its own `skipWeekends` and `holidays` (`ui/packages/types/src/zod/objectql.zod.ts#ObjectGanttSchema`).

### The pull

The hotcrm case SLA matrix counts wall-clock hours and warns about it in prose (the outcome of #13801). hotsrm computes delivery dates and deadlines in hooks and formulas. The production suite schedules against working days. In China, a fixed weekly pattern cannot express 调休: make-up working Saturdays and Sundays around public holidays. Without a platform calendar each suite computes due dates its own way, and the same request shows different due times in different apps.

## Decision

Each D-item records one item of the ruling, in the ruling's own terms. Where writing the item down met a choice the ruling does not make, the item says so and points to an [open question](#open-questions); it does not pick.

### D1 — Calendars are organization-editable runtime data

Calendars are org-editable runtime data, not package metadata. Two objects:

- **`sys_work_calendar`**: the weekly pattern, its working periods per weekday written as local `HH:mm`, a required `timezone` in the `iana_time_zone` value domain, and `is_default`.
- **`sys_work_calendar_exception`**: dated `off` and `on` overrides of a calendar. One table holds public holidays, 调休 make-up workdays and plant shutdowns.

Packages reference a calendar by code and may ship seed rows. One calendar service resolves a calendar and computes with it. The precedent is `sys_exchange_rate` (ADR-0144): organization-scoped rows, written by administrators, audited.

A calendar is never package metadata: holidays change every year, and a metadata change travels through a publish. The weekly pattern sits on the calendar row and the exceptions in their own table, so a holiday is a row an administrator adds, not a release.

Not ruled, and listed: how an exception's own periods combine with the weekly pattern on its date, and whether a date may carry two exceptions ([Q3](#q3--the-shape-of-an-exception-and-of-a-period)); and whether a package's seed rows may overwrite an organization's edits on a later install ([Q6](#q6--may-a-package-seed-overwrite-an-organizations-edit)).

### D2 — Resolution: explicit code, then the organization default, then refuse

A consumer resolves its calendar in this order, and in no other:

1. the calendar code the consumer names explicitly (a formula argument, the escalation's `calendar` key);
2. the organization's default calendar (`is_default`);
3. otherwise, **refuse**.

**There is no silent fallback to wall-clock time.** A deadline computed on the wrong clock looks exactly like a right one, so an unresolved calendar is an error with a stable code, as an unset home currency is (`ERR_HOME_CURRENCY_UNSET`, ADR-0144). The implementing card registers the code in the ADR-0112 ledger.

**Business-unit inheritance is deferred.** `sys_business_unit.timezone` has no reader today; another inherited column nobody reads would be inert under ADR-0049. Regions and plants are not platform objects: a suite maps them to calendar codes and passes the code.

Not ruled, and listed: what a refusal does inside the approval sweep, which has no caller to answer ([Q2](#q2--what-a-refusal-does-in-the-approval-sweep)).

### D3 — Holiday data: entered or imported by the organization; a calendar says how far it is maintained

In the first cut, holiday and make-up-day rows are entered by the organization or imported. **A calendar records the date it is "maintained through"**, and computing past that date warns or refuses: a calendar with no exceptions entered for next year must not read as "next year has no holidays".

A CN holidays and 调休 data set comes later, as a marketplace data package. **It is never in platform core**, and the platform ships no per-country holiday data.

Not ruled, and listed: whether crossing the maintained-through date warns or refuses, and whether the answer differs by consumer ([Q1](#q1--past-the-maintained-through-date-warn-or-refuse)).

### D4 — First consumers: three formula functions and the approval clock, in the same release as the objects

The first readers are the formula functions `addWorkingDays`, `workingDaysBetween` and `addWorkingHours`, and the approval escalation's working-time clock (D5). Each is its own card. **They ship in the same release as the objects**: the #13655 constraint stands, and the calendar never ships without its formula surface. A calendar object released alone would be the inert shape ADR-0049 forbids.

How the pairing is held at release time follows the ADR-0144 D9 precedent (the epic PM's placement there, not that ruling's): each implementing pull request says it is not released alone and names its pair, and the maintainer merges Version Packages only when the set is complete (Prime Directive #15).

Not decided here: the argument semantics of the three functions (whether an interval's ends count, what a start on a non-working day means). They are public formula contract, settled by #35356 under its own contract review and pinned by its tests.

### D5 — The clock key: `escalation.clock`, default `wall_clock`, on `timeoutHours` only

The approval escalation gains `clock: 'wall_clock' | 'working_time'` and an optional `calendar` code.

- **The default stays `wall_clock`.** The sweep reads stored snapshots, and a stored snapshot carries no `clock`. Flipping the default would move the deadline of every request already open.
- **The value names avoid "calendar hours".** The current describe text uses "calendar hours" to mean wall-clock hours, and that phrase would read the other way once a working calendar exists.
- **Only `timeoutHours` gets the key now.** Every other duration key gets one only when a consumer reads it, one card each. No clock key is added to every duration key.
- **The describe text and code comment on `timeoutHours`** that say the platform ships no business-hours calendar are rewritten by #35357, with the generated schema, the reference docs and the skills teaching text.

`working_time` resolves its calendar through D2: the `calendar` code if written, otherwise the organization default, otherwise refuse.

Not ruled, and listed: whether a `working_time` deadline is computed once or recomputed on every sweep, so that a holiday entered later moves it ([Q5](#q5--is-a-working-time-deadline-fixed-or-recomputed)).

### D6 — Pushdown: working-day functions evaluate in memory only

Working-day functions evaluate in memory. **Pushdown refuses them**, as it refuses every function call today, and a lint tells the author so at authoring time. To filter on a due time, compute it at write time into a `datetime` column and compare that column with `{now}`. **No calendar math runs in SQL.**

A refused filter fails loudly, at run time. The lint exists so an author learns this when writing the expression (a list filter, a row-level-security predicate), not when it is refused.

### D7 — Time zone and periods

- **`timezone` is required** on every calendar. Setup prefills it from the organization's effective time zone; the stored value is the calendar's own, and the computation reads only that value. One organization may run plants in different zones.
- **A period that crosses midnight is refused** in the first cut. A period's end is later than its start, on the same local day. Which day a night shift belongs to is rostering, and rostering is out of scope.

Not ruled, and listed: whether a period may end at `24:00` ([Q3](#q3--the-shape-of-an-exception-and-of-a-period)), and how `addWorkingHours` counts a period on a daylight-saving transition day ([Q4](#q4--daylight-saving-days-in-addworkinghours)).

## Enforcement

| Decision | Enforced by |
|:--|:--|
| D1 objects, seed by code; D2 resolver and its refusal code; D3 maintained-through and import; D7 required time zone and the midnight refusal | [#35355](https://github.com/objectstack-ai/objectstack/issues/35355) — the two objects, the calendar service, the Setup page and the exception import |
| D4 formula functions; D6 pushdown refusal and lint | [#35356](https://github.com/objectstack-ai/objectstack/issues/35356) — `addWorkingDays`, `workingDaysBetween`, `addWorkingHours` |
| D4 approval clock; D5 the key, its default and the rewritten describe text | [#35357](https://github.com/objectstack-ai/objectstack/issues/35357) — `escalation.clock` and `escalation.calendar` |
| D4 the release pairing | all three, held as ADR-0144 D9 holds its pairs |

Each implementing change leaves this record's id in its code at the load-bearing spots (Prime Directive #13). The acceptance slice after the three is the hotcrm case SLA matrix counting against a calendar.

## Follow-ups

- **The gantt view's own calendar.** The gantt view declares `skipWeekends` and `holidays` of its own (`ui/packages/types/src/zod/objectql.zod.ts#ObjectGanttSchema`), a second source of truth beside this record's calendar. Follow-up: switch the gantt view to the platform calendar. This record changes nothing there.
- **Later slices named by the ruling**: the CN holidays and 调休 data package (marketplace, D3); business-unit inheritance (D2, once a second consumer reads a business unit's calendar); date macros in filters.

## Non-goals

Shift rostering, finite-capacity scheduling, payroll calendars and fiscal periods. Per-country holiday data in platform core. Calendar arithmetic in SQL. A clock key on every duration key. Flipping the default clock.

## Open questions

The ruling does not answer these. Each is put to the maintainer through the owning seat; the implementing card that meets one does not pick an answer on its own. Each option says what it costs; the seat's recommendation follows.

### Q1 — Past the maintained-through date: warn or refuse?

The ruling says computing past the date "warns or refuses".

- **A — refuse everywhere.** The calendar service answers a stable code for any computation whose result or range crosses the date. A formula evaluation fails; the approval sweep meets Q2. Strictest; a forgotten year-end import stops deadlines being computed at all.
- **B — warn everywhere.** The service computes with the weekly pattern alone past the date and logs a warning. Nothing stops; a deadline that crossed an unentered holiday is wrong and looks right.
- **C — refuse in formulas, warn in Setup ahead of time.** The service refuses as in A, and Setup shows a calendar whose date is near as needing maintenance, so an administrator sees it before the refusals start.

Recommendation: **C**. It keeps D2's rule that no deadline is silently computed on the wrong clock, and turns the refusal into a notice an administrator meets first.

### Q2 — What a refusal does in the approval sweep

A formula can answer an error to its caller. The escalation sweep has no caller: when a `working_time` request's calendar does not resolve (D2) or the computation is refused (Q1), the sweep must still do something with the request.

- **A — skip and report.** The sweep does not escalate the request, logs at error level with the code, and tries again on the next sweep. A request can sit past its true deadline until an administrator fixes the calendar.
- **B — also refuse at publish.** As A, and a flow whose escalation names a `calendar` code that does not resolve in the publishing organization is refused at publish. Catches the misspelled code early; cannot catch a calendar deleted after publish, so A is still needed.

Recommendation: **B**. Wall-clock escalation is not an option under D2.

### Q3 — The shape of an exception and of a period

The ruling says "dated off/on overrides" with optional periods, and refuses periods crossing midnight. It does not say:

- whether an `on` exception without periods is allowed, and whose hours it takes (a 调休 Saturday works a normal day, but the weekly pattern has no "normal day" field);
- whether an `off` exception may carry periods (a half-day holiday);
- whether one date may carry two exceptions;
- whether `24:00` is a legal period end.

- **A — an exception's periods are the date's complete working periods.** `off` never carries periods and means the whole date is off. `on` must carry its periods. A half-day holiday is an `on` row with the shortened periods. One exception per calendar and date. `24:00` is legal as an end. Every stored row says exactly what its date works; a data package's make-up days get their hours from the import, which asks the administrator which weekday to copy.
- **B — `on` without periods copies a weekday.** As A, but an `on` row may name a weekday whose periods it takes. Shorter rows; one more column, and an edit to that weekday silently changes past make-up days.

Recommendation: **A**. One rule a reader can check against the row alone.

### Q4 — Daylight-saving days in `addWorkingHours`

Periods are local `HH:mm`. On a transition day a local period can be an hour shorter or longer than its clock-face length.

- **A — count elapsed time.** Map each local period to instants with the shared DST-safe primitive (ADR-0053) and count real elapsed time; a local time that does not exist moves forward. Matches how `wall_clock` already counts elapsed milliseconds.
- **B — count clock-face time.** A 09:00–17:00 period is always eight working hours. Simpler to explain; the result instant can land an hour away from the elapsed answer.

Recommendation: **A**, with a pinned test on a spring-forward and a fall-back day. China has no daylight saving; the question matters for calendars elsewhere.

### Q5 — Is a working-time deadline fixed or recomputed?

#35357's Scope says the sweep recomputes the deadline from `created_at` on every sweep. The ruling does not say.

- **A — recompute on every sweep.** A holiday entered after a request opened moves that request's deadline. Display and sweep call one function. The escalation's audit row records the deadline as computed when it fired.
- **B — fix at creation.** Store the deadline on the request when it opens. A later holiday does not move it; the stored value can be wrong for the rest of the request's life.

Recommendation: **A**, as #35357 states. The same staleness question applies to the write-time `datetime` columns of D6: a column computed before a holiday was entered keeps its old value until the record is written again. That is the author's column, and teaching it belongs with #35356.

### Q6 — May a package seed overwrite an organization's edit?

Packages may seed calendar rows (D1), and the rows are organization-editable. The seed contract (`packages/spec/src/data/seed.zod.ts`) defaults to `mode: 'ignore'`, which inserts a missing row and leaves an existing one as it is; `upsert` overwrites on every replay.

- **A — `ignore` only for calendar rows.** A package seeds a starting calendar; after the first load the organization owns it.
- **B — the package's choice.** A package may declare `upsert` to keep its rows current, and every replay then undoes the organization's edits to them.

Recommendation: **A**. "Org-editable" means an install never takes an edit back.

## Consequences

- **Additive.** Two new objects and one optional key with an unchanged default. Every escalation stored today keeps its deadline.
- **A missing calendar is an error, not a wall-clock answer.** An organization that uses a working-time consumer must keep a default calendar, or name one at every consumer.
- **The calendar must be maintained.** The maintained-through date makes a stale calendar visible instead of quietly wrong; somebody enters next year's holidays every year until the data package exists.
- **A working-day deadline is not filterable unless stored.** Authors who need to filter or aggregate on a working-day due time compute it at write time into a `datetime` column.
- **Two calendars in the product until the gantt follow-up lands.**

## References

- Ruling [`7000950747`](https://github.com/objectstack-ai/objectstack/issues/35340#issuecomment-7000950747) on #35340; card #35354; implementing cards #35355, #35356, #35357.
- #13801 and its in-seat ruling `5506987580`; the #13655 freeze (ruling record 5478756633).
- ADR-0029, ADR-0049, ADR-0053, ADR-0112, ADR-0144.
