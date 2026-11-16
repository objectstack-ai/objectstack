---
'@objectstack/skills': patch
---

docs(skills): an `async` after-hook on a write event starts after the commit and is dropped on rollback; an `async` `afterFind` starts at dispatch

Clause-②: no
Metadata-protocol: none

`skills/objectstack-data/references/data-hooks.md`, the **Transaction** row of Before vs After Hooks: an `async: true` hook on `afterInsert` / `afterUpdate` / `afterDelete` starts once the outermost transaction commits and never runs if it rolls back, a failed commit included; on `afterFind` it starts as the read is dispatched; outside a transaction it starts at once. The row used to say "in the background, after commit" for every event and did not say the hook is dropped on rollback. Best Practices gains one DON'T: do not react to a refused or rolled-back write from an `async: true` hook, which never runs then; use a blocking hook. Two eval cases exercise it: a background `afterInsert` that must not announce an order that did not survive, and a request for a background hook that records a failed insert. The file pays by dropping two restatements (the "Update by id" paragraph, which repeated its row of the `ctx.api.object` method table, and the sentence above the `body` vs `handler` table, which repeated the table), so its token ceiling does not move. No schema or runtime change.
