---
'@objectstack/spec': minor
---

fix(spec)!: the flow parse refuses a start node's `config.filter` beside `config.timeRelative`, and a `config.schedule` the schedule readers cannot use

Clause-②: yes (narrowing) — `FlowSchema` refuses two start-node `config` shapes it accepted before, at every door that parses a flow; `@objectstack/spec/automation` also exports `flowStartConfigRefusals`, `flowStartScheduleReadsNothing` and the `FlowStartConfigRefusal` type.
Metadata-protocol: narrowed
Skills-docs: none — `skills/**` and `content/docs/**` teach `timeRelative.filter` inside the descriptor and typed `{ type: 'cron', expression }` schedules, which this accepts. The generated `skills/objectstack-automation/references/_index.md` gains the source files the flow closure now reaches (`system/job.zod.ts` and its imports).

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed or renamed: FlowNodeSchema.config stays an open record, and the parse now refuses two shapes on it. The filter arm refuses an undeclared key on that open-record config: the published time-relative descriptor declares filter inside timeRelative and nowhere else, so filter beside timeRelative was never a declared shape and no protocol step migrates from it (the #4277 class). The schedule arm refuses values the published ScheduleSchema refuses, or that the schedule reader reads nothing from. Each refusal message names the cure at the refused key. -->

**BREAKING** accept-set narrowing of `FlowSchema` (every door that parses a flow: `defineStack`, `os validate` / `os build`, the metadata save door including drafts, publish, and the automation engine's registration).

- **`config.filter` beside `config.timeRelative`.** Before, it parsed and nothing read it: the time-relative sweep reads its row filter from `timeRelative.filter`, so the flow launched for every record in the date window. Now it is refused at `nodes[i].config.filter`, when `config.timeRelative` is an object (the start node the engine routes as a sweep); a `timeRelative: null` start node is not judged.
- **A `config.schedule` the readers cannot use.** Both readers (the schedule trigger, and the time-relative sweep's cadence) pass it through `normalizeSchedule`. When that reads nothing, a schedule flow stays unbound (one warn in the server log) and a sweep falls back to daily 08:00 UTC. Now, at `nodes[i].config.schedule`:
  - an object carrying `type` is judged against the published `ScheduleSchema` (the discriminant, a cron `timezone` that is an IANA zone, a positive integer `intervalMs`, an ISO `at`), and then for being readable at all (a cron `expression` written as an envelope is not). The schema does not declare the aliases `cron` and `every` on a typed object, so the two typed aliases the reader happens to bind today, `{ type: 'cron', cron }` and `{ type: 'interval', every }`, are refused too, and the refusal names the declared spelling (`expression`, `intervalMs`). Neither occurs in objectstack or hotcrm;
  - any other value is refused only when the reader reads nothing from it (an empty string, `{}`, `{ cadence: 'daily' }`, a number, an array, a non-positive interval);
  - accepted as before: a bare cron string, and the untyped aliases the reader takes (`{ cron }`, `{ expression }`, `{ every }`, `{ intervalMs }`, `{ at }`).
- **One reading, pinned.** `flowStartScheduleReadsNothing` mirrors `normalizeSchedule` branch for branch, and `@objectstack/trigger-schedule` pins the two equal over every form either side distinguishes.

**What an author does.** Nothing for a sweep whose filter sits inside `timeRelative`, or a schedule that binds today in a form the published schema declares. For a refused shape, the parse refusal names where the key belongs, or the schedule spellings the readers take.
