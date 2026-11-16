---
'@objectstack/objectql': patch
---

Clause-②: no
Metadata-protocol: none

`ObjectQL#getCascadeDeleteObjects` remembers its answer per object name until the schema registry's `objectRevision` moves, instead of walking every registered object on each call. The metadata read serves this list beside every `object` item (`cascadeDeleteObjects`), so an app bundle request no longer repeats the walk once per object it names. The answer is unchanged: every registry change that drops the registry's merged-object cache also moves `objectRevision`, and each call still gets its own copy of the list.
