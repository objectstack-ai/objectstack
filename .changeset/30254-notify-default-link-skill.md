---
'@objectstack/skills': patch
---

docs(skills): a `notify` node that writes no link opens the record that started the run

Clause-②: no
Metadata-protocol: none

- **Before.** The `objectstack-automation` skill's `notify` example commented its click-through keys as "a PAIR, else dropped", so a record-triggered flow's notification looked like it linked nowhere unless the author wrote `sourceObject` + `sourceId: record.id`.
- **Now.** The example says what the runtime does: a node that writes none of `sourceObject`, `sourceId` and `actionUrl` links to the run's trigger record when it has one (a record change other than a delete, a time-relative sweep's row, an action started on a record). An explicit pair or `actionUrl` wins; half a pair is still dropped; a run with no trigger record links nowhere. A new eval asks for a record-triggered notification that opens its record and expects no source keys written.
- No schema, key or behaviour changes.
