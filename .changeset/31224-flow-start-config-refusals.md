---
'@objectstack/spec': minor
---

fix(spec)!: the flow parse refuses a start node's `config.filter` beside `config.timeRelative`, and a `config.schedule` the schedule readers cannot use

Clause-②: yes (narrowing) — `FlowSchema` refuses two start-node `config` shapes it accepted before, at every door that parses a flow; `@objectstack/spec/automation` also exports `flowStartConfigRefusals`, `flowStartScheduleReadsNothing` and the `FlowStartConfigRefusal` type.
Metadata-protocol: narrowed
Skills-docs: none — `skills/**` and `content/docs/**` teach `timeRelative.filter` inside the descriptor and typed `{ type: 'cron', expression }` schedules, which this accepts. The generated `skills/objectstack-automation/references/_index.md` gains the source files the flow closure now reaches (`system/job.zod.ts` and its imports).

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed or renamed: FlowNodeSchema.config stays an open record, and the parse now refuses two shapes no reader honoured. A start-node filter beside timeRelative was read by nothing, and a schedule the reader reads nothing from (or one the published ScheduleSchema refuses) never bound as written, so there is no rewrite that keeps what the author meant in every case; each refusal names the fix. -->

**BREAKING** accept-set narrowing of `FlowSchema` (every door that parses a flow: `defineStack`, `os validate` / `os build`, the metadata save door including drafts, publish, and the automation engine's registration).

- **`config.filter` beside `config.timeRelative`.** Before, it parsed and nothing read it: the time-relative sweep reads its row filter from `timeRelative.filter`, so the flow launched for every record in the date window. Now it is refused at `nodes[i].config.filter`. **FROM** `config: { timeRelative: { … }, filter: { status: 'active' } }` **TO** `config: { timeRelative: { …, filter: { status: 'active' } } }`.
- **A `config.schedule` the readers cannot use.** Both readers (the schedule trigger, and the time-relative sweep's cadence) pass it through `normalizeSchedule`. When that reads nothing, a schedule flow stays unbound (one warn in the server log) and a sweep falls back to daily 08:00 UTC. Now, at `nodes[i].config.schedule`:
  - an object carrying `type` is judged against the published `ScheduleSchema` (the discriminant, a cron `timezone` that is an IANA zone, a positive integer `intervalMs`, an ISO `at`), and then for being readable at all (a cron `expression` written as an envelope is not);
  - any other value is refused only when the reader reads nothing from it (an empty string, `{}`, `{ cadence: 'daily' }`, a number, an array, a non-positive interval);
  - accepted as before: a bare cron string, and the untyped aliases the reader takes (`{ cron }`, `{ expression }`, `{ every }`, `{ intervalMs }`, `{ at }`).
- **One reading, pinned.** `flowStartScheduleReadsNothing` mirrors `normalizeSchedule` branch for branch, and `@objectstack/trigger-schedule` pins the two equal over every form either side distinguishes.

**What an author does.** Nothing for a sweep whose filter sits inside `timeRelative`, or a schedule that binds today. For a refused shape: move the filter into `timeRelative.filter`; write the schedule as a cron string or one of `{ type: 'cron', expression, timezone? }`, `{ type: 'interval', intervalMs }`, `{ type: 'once', at }`.
