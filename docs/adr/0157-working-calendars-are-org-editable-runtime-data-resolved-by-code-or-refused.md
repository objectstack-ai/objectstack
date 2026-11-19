# ADR-0157: Working calendars are organization-editable runtime data — a consumer names a calendar by code or takes the organization default, otherwise it refuses; formulas and the approval clock read it in the same release

**Status**: Accepted (2026-11-19) — maintainer ruling on [#35340](https://github.com/objectstack-ai/objectstack/issues/35340), comment [`7000950747`](https://github.com/objectstack-ai/objectstack/issues/35340#issuecomment-7000950747), verbatim 「同意 p1」 (D1–D7), and the maintainer's rulings on the six questions the first draft left open (D8–D13): ruling record [`7003541720`](https://github.com/objectstack-ai/objectstack/issues/35354#issuecomment-7003541720) on [#35354](https://github.com/objectstack-ai/objectstack/issues/35354) for Q1 and Q2, 「不算，并提前提醒」, and ruling record [`7003566086`](https://github.com/objectstack-ai/objectstack/issues/35354#issuecomment-7003566086) on #35354 for Q3 to Q6, 「每条写全时段」 and 「全按推荐」. `docs/adr/**` is Tier H (Prime Directive #14): this record lands by an authorised approval and the maintainer's merge. **This record declares; it implements nothing** — no schema, no object, no code, no changeset. Three cards implement it: [#35355](https://github.com/objectstack-ai/objectstack/issues/35355), [#35356](https://github.com/objectstack-ai/objectstack/issues/35356) and [#35357](https://github.com/objectstack-ai/objectstack/issues/35357).

- **Date**: 2026-11-19
- **Card**: [#35354](https://github.com/objectstack-ai/objectstack/issues/35354) (p1), the first slice of the epic [#35340](https://github.com/objectstack-ai/objectstack/issues/35340).
- **Decided by**: the maintainer, 2026-11-19 05:47Z, on #35340, verbatim 「同意 p1」, recorded in ruling comment [`7000950747`](https://github.com/objectstack-ai/objectstack/issues/35340#issuecomment-7000950747). The sub-cards were approved at 06:03Z with 「同意」 and 「都是 p1」. The ruling's own text is the authority this record executes; where the two differ in words, the ruling wins and this record is corrected.
- **Open questions ruled**: the maintainer, 2026-11-19 08:11–08:13Z, on the seat's decision cards. Q1 and Q2 are recorded in ruling record [`7003541720`](https://github.com/objectstack-ai/objectstack/issues/35354#issuecomment-7003541720) (pick 「不算，并提前提醒」); Q3 to Q6 in ruling record [`7003566086`](https://github.com/objectstack-ai/objectstack/issues/35354#issuecomment-7003566086) (picks 「每条写全时段」 and 「全按推荐」). They are D8 to D13.
- **Unfreezes**: the business-hours half of #13655 (ruling record 5478756633, cited from [#13801](https://github.com/objectstack-ai/objectstack/issues/13801); #13655 itself answers 404 to this session). That half was frozen until a named external user asked. The ruling counts the pull from the platform's own suites (the hotcrm case SLA matrix, hotsrm delivery dates, the production suite) as meeting that condition. The freeze's second constraint stands and is D4 here.
- **Reverses**: the in-seat finding on #13801 (comment [`5506987580`](https://github.com/objectstack-ai/objectstack/issues/13801#issuecomment-5506987580)) that a clock marker on `timeoutHours` would be inert. That finding held only while one clock existed; with two clocks the marker has a reader (D5).
- **Builds on**: [ADR-0144](./0144-multi-currency-record-currency-dated-rates-write-time-home-projection.md) (`sys_exchange_rate`: organization-scoped runtime data that an administrator writes and that every change audits — the precedent for D1, and `ERR_HOME_CURRENCY_UNSET`, the precedent for refusing rather than guessing in D2). [ADR-0049](./0049-no-unenforced-security-properties.md) (enforce-or-remove: a calendar nobody reads, an inherited column nobody reads and a clock key with one value are all inert — D2, D4, D5). [ADR-0029](./0029-kernel-object-ownership-and-platform-objects-decomposition.md) D1, D3 and D6 (a first-party capability owns its `sys_*` objects; which package owns the two objects here is #35355's to settle against it). [ADR-0053](./0053-date-and-datetime-semantics.md) (an exception's date is a calendar day, never an instant; time-zone arithmetic goes through the shared DST-safe primitive). [ADR-0112](./0112-error-code-vocabulary-and-ledger.md) (every refusal below answers with a ledger code that the implementing card registers).
- **Amends**: no decision. The `timeoutHours` describe text, which says the platform ships no business-hours calendar, is rewritten by #35357, not here.

---

## Provenance

Three kinds of text feed this record, and each section says which kind it carries.

1. **Ruled.** The seven design points of ruling `7000950747`, restated as seven items in the Scope of #35354. [Decision](#decision) carries only these, one D-item per Scope item (D1–D7), in the ruling's own terms, and the maintainer's rulings on the six questions the first draft left open (D8–D13), records `7003541720` and `7003566086` on #35354.
2. **Analysis the ruling read.** The design analysis for #35340 (project file `card-35340/design-analysis.md`, outside this repository). It supplies the context and the alternatives. A detail that appears only there is not ruled: this record lists such details as [open implementation points](#open-implementation-points), never as a decision. The seat's decision analysis of the six questions (project file `objectstack-seat5/area-ux/data-1/decision-adr0157-q1-q6.md`) is text of this kind too: D8–D13 carry only what the two ruling records say.
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

Each D-item records one item of the ruling, in the ruling's own terms. Where writing an item down met a choice the first ruling did not make, the choice went to the maintainer as an open question; D8–D13 record those rulings, and each of D1–D7 names the D-item that completes it.

### D1 — Calendars are organization-editable runtime data

Calendars are org-editable runtime data, not package metadata. Two objects:

- **`sys_work_calendar`**: the weekly pattern, its working periods per weekday written as local `HH:mm`, a required `timezone` in the `iana_time_zone` value domain, and `is_default`.
- **`sys_work_calendar_exception`**: dated `off` and `on` overrides of a calendar. One table holds public holidays, 调休 make-up workdays and plant shutdowns.

Packages reference a calendar by code and may ship seed rows. One calendar service resolves a calendar and computes with it. The precedent is `sys_exchange_rate` (ADR-0144): organization-scoped rows, written by administrators, audited.

A calendar is never package metadata: holidays change every year, and a metadata change travels through a publish. The weekly pattern sits on the calendar row and the exceptions in their own table, so a holiday is a row an administrator adds, not a release.

Completed by D10 (an exception row carries its date's full working periods, one row per date) and D13 (package seed rows follow the existing seed contract).

### D2 — Resolution: explicit code, then the organization default, then refuse

A consumer resolves its calendar in this order, and in no other:

1. the calendar code the consumer names explicitly (a formula argument, the escalation's `calendar` key);
2. the organization's default calendar (`is_default`);
3. otherwise, **refuse**.

**There is no silent fallback to wall-clock time.** A deadline computed on the wrong clock looks exactly like a right one, so an unresolved calendar is an error with a stable code, as an unset home currency is (`ERR_HOME_CURRENCY_UNSET`, ADR-0144). The implementing card registers the code in the ADR-0112 ledger.

**Business-unit inheritance is deferred.** `sys_business_unit.timezone` has no reader today; another inherited column nobody reads would be inert under ADR-0049. Regions and plants are not platform objects: a suite maps them to calendar codes and passes the code.

Completed by D9 (what a refusal does inside the approval sweep, which has no caller to answer).

### D3 — Holiday data: entered or imported by the organization; a calendar says how far it is maintained

In the first cut, holiday and make-up-day rows are entered by the organization or imported. **A calendar records the date it is "maintained through"**, and computing past that date warns or refuses: a calendar with no exceptions entered for next year must not read as "next year has no holidays".

A CN holidays and 调休 data set comes later, as a marketplace data package. **It is never in platform core**, and the platform ships no per-country holiday data.

Completed by D8 (crossing the maintained-through date refuses, and Setup gives notice ahead of time).

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

Completed by D9 (the sweep when the due time cannot be computed) and D12 (the `working_time` deadline is recomputed on every sweep).

### D6 — Pushdown: working-day functions evaluate in memory only

Working-day functions evaluate in memory. **Pushdown refuses them**, as it refuses every function call today, and a lint tells the author so at authoring time. To filter on a due time, compute it at write time into a `datetime` column and compare that column with `{now}`. **No calendar math runs in SQL.**

A refused filter fails loudly, at run time. The lint exists so an author learns this when writing the expression (a list filter, a row-level-security predicate), not when it is refused.

### D7 — Time zone and periods

- **`timezone` is required** on every calendar. Setup prefills it from the organization's effective time zone; the stored value is the calendar's own, and the computation reads only that value. One organization may run plants in different zones.
- **A period that crosses midnight is refused** in the first cut. A period's end is later than its start, on the same local day. Which day a night shift belongs to is rostering, and rostering is out of scope.

Completed by D10 (`24:00` is a legal period end) and D11 (a daylight-saving transition day counts elapsed time).

### D8 — Past the maintained-through date: refuse, and give notice ahead of time (Q1 = C)

Ruled in record [`7003541720`](https://github.com/objectstack-ai/objectstack/issues/35354#issuecomment-7003541720), Q1 letter C.

- **A computation whose result or span crosses a calendar's maintained-through date is refused**, with a stable code. There is no fallback to the weekly pattern alone, and none to wall-clock time (D2).
- **Setup gives notice ahead of time**: it marks a calendar whose maintained-through date is near as needing maintenance, before refusals start. How far ahead is #35355's default.
- **A formula due date that meets the refusal is blank**, never a guess from the weekly pattern. On a read this is what a failed formula evaluation already looks like: the field reads blank and the engine logs one line naming the object, the field and the error (`packages/objectql/src/engine-formula-fault-log.test.ts`). The customer sees a blank cell, not an error page. Precedent: a missing exchange rate refuses and stores no fallback value (ADR-0144 D5).
- **A write-time computed due-date column (D6) that meets the refusal** is not settled here; see [Open implementation points](#open-implementation-points).

### D9 — The approval sweep skips, retries and shows why; the publish-time lint checks static errors only (Q2 = C)

Ruled in record [`7003541720`](https://github.com/objectstack-ai/objectstack/issues/35354#issuecomment-7003541720), Q2 letter C.

- **When the sweep cannot compute a `working_time` due time** (no calendar resolves under D2, or D8 refuses the computation), it does not escalate the request and tries again on the next sweep. Once an administrator fixes the calendar, the next sweep recovers with no other step.
- **Where the due time is displayed, it shows 「日历算不出」 with the reason**: the calendar was not found, or it is not maintained to that date.
- **The publish-time check covers static authoring errors only**, such as a `calendar` code written without `clock: 'working_time'`. It does not check whether the named calendar exists: calendars are per-organization runtime data, and the approval lint is a pure function of the stack (`packages/lint/src/validate-approval-approvers.ts`). #35357's Scope sentence that a `working_time` escalation with no resolvable calendar "is a lint/validation error" is read under this decision.
- Not chosen: skip and log only (A); a publish-time check that the calendar exists (B). Refusing at submit time was not offered: together with D8 it would block every approval whose deadline crosses the year end until the next year's holidays are entered.

### D10 — An exception row carries its date's full working periods (Q3 = A)

Ruled in record [`7003566086`](https://github.com/objectstack-ai/objectstack/issues/35354#issuecomment-7003566086), pick 「每条写全时段」, Q3 letter A.

- **An `off` row has no periods** and means the whole date is off.
- **An `on` row must carry that date's full working periods.** A half day is an `on` row with shortened periods. An `on` row never borrows a weekday's periods: with borrowing, a later edit to that weekday would silently rewrite past make-up days.
- **One row per calendar and date.**
- **`24:00` is a legal period end**, validated by the calendar itself, because the platform's time parser refuses a zone-naive `24:00` (`packages/core/src/utils/import-coerce.ts`). A period's end is later than its start (D7).

### D11 — A daylight-saving transition day counts elapsed time (Q4 = A)

Ruled in record [`7003566086`](https://github.com/objectstack-ai/objectstack/issues/35354#issuecomment-7003566086), pick 「全按推荐」, Q4 letter A.

- **Working hours are counted as elapsed time.** Each local period is mapped to instants and its real duration counted, as `wall_clock` counts elapsed milliseconds. On a transition day a period can be an hour shorter or longer than its clock-face length.
- **Local times convert to instants only through the shared DST-safe primitive** (ADR-0053). A local time the zone skips, or one it passes twice, resolves the way that primitive already does and pins in its tests, to the earlier candidate instant (`packages/core/src/utils/datetime.ts#zonedWallClockToUtcMs`). Working calendars add no rule of their own.
- China has no daylight saving; only calendars whose periods cover a transition hour see a difference.

### D12 — A working-time deadline is recomputed on every sweep (Q5 = A)

Ruled in record [`7003566086`](https://github.com/objectstack-ai/objectstack/issues/35354#issuecomment-7003566086), Q5 letter A. It is the approved Scope of #35357: "recompute each sweep rather than storing it".

- **The `working_time` due time is recomputed from `created_at` on every sweep and never stored.** A holiday entered after a request opened moves that request's deadline. The displayed due time and the sweep use one function, as the wall-clock due time does today (`packages/plugins/plugin-approvals/src/approval-service.ts#slaDueAt`).
- Current behaviour, not a ruling: escalation stays single-shot, as today. A request already escalated is not escalated again, or recalled, when its calendar changes: the sweep skips any request that already carries an `escalate` action (`packages/plugins/plugin-approvals/src/approval-service.ts#ApprovalService.runEscalations`).

### D13 — Calendar seed rows follow the existing seed contract (Q6)

Ruled in record [`7003566086`](https://github.com/objectstack-ai/objectstack/issues/35354#issuecomment-7003566086), pick 「全按推荐」: no new rule.

- **No calendar-specific seeding rule.** The seed contract stands as ruled in record `6631016988` on #30081 (`packages/spec/src/data/seed.zod.ts`): a seed is create-only by default, so an organization's edits survive a replay, and a row is overwritten only when the package declares `mode: 'upsert'`.
- Whether the later CN holidays data package declares `upsert`, to correct rows it has already landed, is that package's card to decide with its real data.

## Enforcement

| Decision | Enforced by |
|:--|:--|
| D1 objects, seed by code; D2 resolver and its refusal code; D3 maintained-through and import; D7 required time zone and the midnight refusal; D8 the refusal past maintained-through and the Setup notice; D10 the exception row shape and period validation; D13 seeding under the existing seed contract | [#35355](https://github.com/objectstack-ai/objectstack/issues/35355) — the two objects, the calendar service, the Setup page and the exception import |
| D4 formula functions; D6 pushdown refusal and lint; D8 a refused formula due date reads blank; D11 elapsed counting, with pinned spring-forward and fall-back tests; open implementation point 1 | [#35356](https://github.com/objectstack-ai/objectstack/issues/35356) — `addWorkingDays`, `workingDaysBetween`, `addWorkingHours` |
| D4 approval clock; D5 the key, its default and the rewritten describe text; D9 skip, retry, the displayed reason and the static-only lint; D11 elapsed counting; D12 recompute on every sweep | [#35357](https://github.com/objectstack-ai/objectstack/issues/35357) — `escalation.clock` and `escalation.calendar` |
| D4 the release pairing | all three, held as ADR-0144 D9 holds its pairs |

Each implementing change leaves this record's id in its code at the load-bearing spots (Prime Directive #13). The acceptance slice after the three is the hotcrm case SLA matrix counting against a calendar.

## Follow-ups

- **The gantt view's own calendar.** The gantt view declares `skipWeekends` and `holidays` of its own (`ui/packages/types/src/zod/objectql.zod.ts#ObjectGanttSchema`), a second source of truth beside this record's calendar. Follow-up: switch the gantt view to the platform calendar. This record changes nothing there.
- **Later slices named by the ruling**: the CN holidays and 调休 data package (marketplace, D3); business-unit inheritance (D2, once a second consumer reads a business unit's calendar); date macros in filters.

## Non-goals

Shift rostering, finite-capacity scheduling, payroll calendars and fiscal periods. Per-country holiday data in platform core. Calendar arithmetic in SQL. A clock key on every duration key. Flipping the default clock.

## Open implementation points

The maintainer ruled every open question of the first draft (D8–D13). Two implementation points remain. Neither is a maintainer question: the card named settles each under its own contract review, and this record does not decide them.

1. **A write-time computed due-date column that meets a D8 refusal** (#35356's contract review): the write fails, or the column is stored blank. A formula read is already settled by D8: blank, plus one log line, not an error.
2. **A blank maintained-through date** (#35355): whether the field is required, and what a blank means. Under D3 a blank must not read as "no holidays from here on".

## Consequences

- **Additive.** Two new objects and one optional key with an unchanged default. Every escalation stored today keeps its deadline.
- **A missing calendar is an error, not a wall-clock answer.** An organization that uses a working-time consumer must keep a default calendar, or name one at every consumer.
- **The calendar must be maintained.** The maintained-through date makes a stale calendar visible instead of quietly wrong; somebody enters next year's holidays every year until the data package exists.
- **A working-day deadline is not filterable unless stored.** Authors who need to filter or aggregate on a working-day due time compute it at write time into a `datetime` column.
- **An unmaintained calendar blanks deadlines.** From the day a deadline's span crosses the maintained-through date, formula due dates read blank and working-time escalations wait with 「日历算不出」 until an administrator extends the calendar (D8, D9). The longer a suite's typical span, the earlier in the year this starts; the Setup notice exists for it.
- **Calendar edits move open deadlines.** Under D12 a holiday added later pushes an open request's deadline out, and a holiday removed or a period lengthened brings it in, so the next sweep may escalate several requests at once.
- **Two calendars in the product until the gantt follow-up lands.**

## References

- Ruling [`7000950747`](https://github.com/objectstack-ai/objectstack/issues/35340#issuecomment-7000950747) on #35340; card #35354; implementing cards #35355, #35356, #35357.
- Ruling records [`7003541720`](https://github.com/objectstack-ai/objectstack/issues/35354#issuecomment-7003541720) (Q1, Q2) and [`7003566086`](https://github.com/objectstack-ai/objectstack/issues/35354#issuecomment-7003566086) (Q3–Q6) on #35354; the seed contract ruling `6631016988` on #30081.
- #13801 and its in-seat ruling `5506987580`; the #13655 freeze (ruling record 5478756633).
- ADR-0029, ADR-0049, ADR-0053, ADR-0112, ADR-0144.
