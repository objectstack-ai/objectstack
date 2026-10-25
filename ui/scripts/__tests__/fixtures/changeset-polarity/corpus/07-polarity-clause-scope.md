---
'@object-ui/types': patch
---

The clause-scope pin (objectui#9754). Polarity belongs to the CLAUSE that
carries the declaration verb, not to the sentence that happens to contain it.
There is no mirror entry for this node today, so nothing validates it, and
`ObjectKanbanSchema` declares `cardTitle` for the card head.

The coordinated shape, where one sentence asserts one key and denies another:
`ObjectKanbanSchema` declares `columns` and no `titleField`.

And the reading that must SURVIVE the repair, or false positives were merely
traded for false negatives: `ObjectKanbanSchema` declares no `allowCollapse` on
the surviving face.
