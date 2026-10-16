---
'@objectstack/spec': patch
---

Component-member read points, part 1 of 3: the doc comments in the first half of `src/ui/component.zod.ts` no longer cite objectui files, lines or commits as read points.

Clause-②: no

- The doc comments of the `ComponentPropsMap` rows from the `page:*` and `record:*` blocks through the `element:*` and `action:*` rows, object-grid, object-metric and the first part of object-kanban now say "read points recorded in `liveness/page.json`, row `regions`". The per-hop re-read chains are removed. What each record claims about the renderer is kept in the shorter comment.
- `liveness/page.json`, row `regions`, gains one evidence list in its `note`: 120 entries spelled `COMPONENT.member: objectui @SHA FILE#SYMBOL`. The list asserts no verdict, so component-level liveness stays unclassified. All three parts of this change carry the same list.
- No schema, type, export, default, accept or refuse change. No `.describe()` text changed.
