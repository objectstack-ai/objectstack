---
"@objectstack/spec": minor
---

feat(spec): type `KnowledgeRefreshPolicy.cron` with the shared cron dialect — `CronExpressionInputSchema`, a describe that promises what the parse enforces (#14825)

**BREAKING** accept-set narrowing and parsed-shape change on a published
authorable key, shipped as `minor` under the repo's launch-window convention
for breaking changes.

`KnowledgeRefreshPolicySchema.cron` (`refresh.cron` on a knowledge source) was
a bare `z.string()` under a doc comment promising a 5-field cron expression —
a constraint nothing checked (ADR-0049 declared ≠ enforced). It now carries
`CronExpressionInputSchema`, the cron-dialect input the spec's other
cron-shaped fields already use (`ScheduledExport.schedule.cronExpression`,
`ScheduleState.cronExpression`, `Connector.schedule`).

What changes for authored metadata, measured rather than assumed:

- A bare non-empty string is still the shorthand — `refresh: { cron: '0 3 * * *' }`
  keeps parsing; stored `sys_metadata` rows re-parse unchanged.
- The expression envelope `{ dialect: 'cron', source }` is now accepted too.
- An **empty string** is now refused (`invalid_union` at `refresh.cron`); it
  named no schedule before, so the only remedy is to delete the key.
- The **parsed** value is now the `{ dialect: 'cron', source }` envelope
  rather than the bare string — the same shape the three sibling cron fields
  produce. Zero readers of the parsed value were measured in `objectstack` and
  the pinned `objectui` (`service-knowledge` reads only `refresh.onRecordChange`;
  it never schedules the cron).
- `KnowledgeRefreshPolicyParsed` and `KnowledgeSourceParsed` are new exported
  aliases naming the parsed state (ADR-0122); the bare `KnowledgeRefreshPolicy`
  / `KnowledgeSource` aliases stay the author state and still accept a string.

What the schema now promises is exactly what the parse enforces: a non-empty
string or an expression envelope, normalized to the envelope. Cron **syntax**
is not judged at parse time by the shared dialect — `'not a cron'` normalizes
like any other string, and the syntax verdict (5- or 6-field, or an `@yearly`…
`@reboot` alias) is the `cron` dialect engine's when the expression is
evaluated. The describe says so instead of restating "5-field", and the pin
file records the measured behaviour so a later change to the shared dialect
surfaces here.

<!-- adr-0087: not-required (no-migration-prescription) No authorable key is removed, renamed or re-homed and the bare-string shorthand keeps parsing byte-identically, so `objectstack migrate meta` has nothing to rewrite and no tombstone exists; the one newly refused input, an empty string, never named a schedule and has no conversion target; the parsed-side envelope has zero measured readers in objectstack and the pinned objectui. -->
