---
'@objectstack/spec': patch
---

docs(spec): the `kanban.lanes` TSDoc states what the board draws

Clause-②: no
Metadata-protocol: none

The `KanbanConfigSchema.lanes` TSDoc still said the board drew one lane per option until the Console read the key. The Console reads it now, so the paragraph says what is drawn: the listed lanes and no others, in the order the author wrote them; a record whose value is not listed lands in `Uncategorized`; without the key, one lane per option in the options' own order. The `.describe()` text already said this and is unchanged. No schema or behaviour change.
