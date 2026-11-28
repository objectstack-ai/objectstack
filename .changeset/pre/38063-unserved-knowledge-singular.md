---
'@objectstack/objectql': patch
---

fix(objectql): the boot warning for one knowledge_source item with no knowledge service says the item is not loaded

Clause-②: no
Metadata-protocol: none

With exactly one `knowledge_source` item and no `knowledge` service registered, the warning read "it is loaded, indexed or searched", the opposite of the fact. It now reads "it is not loaded, indexed or searched". The plural wording ("none is loaded") is unchanged. Nothing to migrate.
