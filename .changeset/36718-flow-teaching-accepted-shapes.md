---
'@objectstack/skills': patch
'@objectstack/spec': patch
'@objectstack/trigger-schedule': patch
---

docs(skills): the automation skill, the schedule trigger README and the start-node schedule refusals spell only flow shapes the publish checks accept

Clause-②: no
Metadata-protocol: none

Ten flow checks of `os validate` and publish (`flow-schedule-timezone-missing`, `flow-condition-option-label`, `flow-node-write-unknown-option`, `flow-subflow-unknown` and the rest) landed without the text that teaches flows. Three of them are warnings and refuse nothing: `flow-schedule-timezone-missing`, `flow-subflow-unknown` (run by the CLI only) and `flow-create-update-pair`. Wording only; no schema, rule or reader changes.

- `@objectstack/spec`: the three refusals of a start node's `config.schedule` (an empty string, a typed schedule the published schema refuses, a value the readers read nothing from) now offer `{ type: 'cron', expression: '0 8 * * *', timezone: 'UTC' }` as the cron to write. They no longer offer a bare cron string or a cron object with no `timezone`, which `os validate` warns on. The typed-alias hint names `{ type: 'cron', expression: '…', timezone: 'UTC' }`. What is refused is unchanged.
- `objectstack-automation` skill: recipe 1's nightly cron states `timezone: 'UTC'`; the schedule example's comment says a cron with no `timezone` (a bare string) runs in UTC and warns, where it said a bare cron string also works; the `subflow` row says `os validate` warns `flow-subflow-unknown` on any name the stack does not hold, a correct call to another package's flow included, where it said `os validate` passes; the select-label rule says a start condition or a `fields` write that uses an option's label is refused at publish where the options are inline, where it said the flow stages clean, and says a label in a `filter` or an edge condition is never checked and silently matches nothing, where it said a `filter` fails the run. Eval 1's expected answer states the cron's `timezone`, and eval 20's states that warning. No skill file passes its token ceiling: `SKILL.md` gains one line, paid for by shorter wording and shorter table separator rows in the same file, and two node labels in recipe 1 are shortened to pay for the `timezone` key.
- `@objectstack/trigger-schedule` README: the time-relative example's cron states `timezone: 'UTC'`, and the schedule-shapes table is followed by the UTC reading and the warning.
