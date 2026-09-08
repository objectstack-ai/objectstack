---
"@objectstack/spec": minor
---

A blueprint nav entry can say WHICH view it opens: `viewName` is added to `BlueprintNavItemSchema` and, in lockstep, to the strict mirror's `StrictNavItem` (required-but-nullable, per the strict convention).

Without it the shape could only say which OBJECT an entry opens, so a model that had just designed a kanban and wanted it in the menu had one move left: emit a SECOND entry at the same `target` and carry the intent in `label`/`icon` alone. Both entries then opened the object's default view, and the consumer derived both ids from the target, so they collided — the user clicked 「工单看板」 and got the list, with nothing to see anywhere (the target object really exists, so a dangling-target lint has nothing to say). The runtime nav item could always express this — `ObjectNavItemSchema.viewName` is "Default list view to open" — so the gap was the blueprint's alone, and the model's duplicate entry was the reasonable move under the expressiveness it was given.

`viewName` is deliberately NOT `.regex(SNAKE_CASE)` on either side, unlike `target`. A view answers to two interchangeable spellings — the bare key a blueprint's `views[].name` carries and the qualified `<object>.<key>` a staged view record's `name` carries — and consumers normalize between them. Constraining the leaf would make one spelling legal to GENERATE and illegal to APPLY, the failure mode that once refused an already-approved blueprint wholesale.

The key-parity pin between the strict mirror and the lenient schema is widened a level further out — fields → objects → NAV ITEMS — so the next nav-level divergence fails a test rather than shipping as "the lenient side accepts a key no proposal can contain".
