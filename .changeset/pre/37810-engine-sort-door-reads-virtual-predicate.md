---
'@objectstack/objectql': patch
---

refactor(objectql): the engine's own sort door judges a computed field type by the spec's predicate, as the Data API's door does

Clause-②: no
Metadata-protocol: none

`ObjectQL.find` and `ObjectQL.findOne` refuse an order by a field whose type is computed on read (`400 INVALID_SORT`), for callers that reach the engine directly, such as hooks and flows. The engine decided "computed on read" from a `formula` literal of its own. The Data API's sort door and the sortability projection served on `GET /meta/object/:name` decide it from `@objectstack/spec/data`'s `isVirtualSearchField`. The engine door now reads that predicate too.

Nothing changes for a caller: the spec's set holds `formula` and nothing else, so every sort is accepted or refused as before, with the same code, status and message. What changes is what happens when a computed type is added to the spec's `SEARCH_VIRTUAL_TYPES`: an in-process `find` is refused together with the Data API, instead of sending the order to a driver that has no column for it and returning the rows unsorted.

What to do: nothing.
