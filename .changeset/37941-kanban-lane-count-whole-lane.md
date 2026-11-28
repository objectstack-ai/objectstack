---
'@objectstack/spec': patch
---

docs(spec): a lookup-lane board's lane `count` is the whole lane's, not the page's

Clause-②: no
Metadata-protocol: none

The `KanbanLaneSummarySchema` doc comment and the `kanban.summary` describe said that a list view board whose lanes come from a lookup field counts the one page it was handed. Since objectstack#37327 that board reads each lane's record count from the same grouped read its `sum`, `avg`, `min` and `max` ride, so a foot `count` shows the whole lane, as the lane header does; only a source that cannot answer that read leaves the page's count, marked `+`. The text now says so, and the generated reference page follows. No schema shape changes.
