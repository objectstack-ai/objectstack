---
'@objectstack/skills': patch
'@objectstack/spec': patch
'@objectstack/trigger-schedule': patch
---

docs(skills): the automation skill, the schedule trigger README and the start-node schedule refusals spell only flow shapes the publish checks accept

Clause-②: no
Metadata-protocol: none

The ten publish-time flow checks (`flow-schedule-timezone-missing`, `flow-condition-option-label`, `flow-node-write-unknown-option`, `flow-subflow-unknown` and the rest) landed without the text that teaches flows. Wording only; no schema, rule or reader changes.

- `@objectstack/spec`: the three refusals of a start node's `config.schedule` (an empty string, a typed schedule the published schema refuses, a value the readers read nothing from) now offer `{ type: 'cron', expression: '0 8 * * *', timezone: 'UTC' }` as the cron to write. They no longer offer a bare cron string or a cron object with no `timezone`, which `os validate` warns on. The typed-alias hint names `{ type: 'cron', expression: '…', timezone: 'UTC' }`. What is refused is unchanged.
- `objectstack-automation` skill: recipe 1's nightly cron states `timezone: 'UTC'`; the schedule example's comment says a bare cron string, like any cron with no `timezone`, runs in UTC and warns; the `subflow` row names the `flow-subflow-unknown` warning; the select-label rule says publish and `os validate` refuse a start condition or a `fields` write that uses an option's label where the options are inline, and names what is not judged (an edge condition, a `filter`, a `picklist` field). Eval 1's expected answer states the cron's `timezone`.
- `@objectstack/trigger-schedule` README: the time-relative example's cron states `timezone: 'UTC'`, and the schedule-shapes table is followed by the UTC reading and the warning.
