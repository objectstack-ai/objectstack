---
'@object-ui/types': patch
---

The superseded-readings pin (objectui#9870). An entry may carry a table whose
first column is a reading it is RETIRING, and whose later columns say what
falsified it and when. The table declares that itself, in its header.

| reading below | falsified by | landed |
| --- | --- | --- |
| `ObjectKanbanSchema` declares `swimlaneWidth` | objectui#0001 — no face ever declared it; `ObjectKanbanSchema` declares `dragHandle` for that job today | 2026-09-11 |
| `SpinnerSchema` declares no `size` | objectui#0002 — `size` is declared on `SpinnerSchema`, as the protocol has it | 2026-09-12 |

A table whose header retires NOTHING is an ordinary table and asserts:

| face | what it declares today |
| --- | --- |
| the board | `ObjectKanbanSchema` declares `allowCollapse` |
| the lane | `LaneSchema` declares `laneWidth` |

And the rows of one table are not one sentence, which is what the collapse made
them:

| face | the reading |
| --- | --- |
| board | `ObjectKanbanSchema` declares `titleField` |
| lane | on `LaneSchema`, `cards` is declared |
