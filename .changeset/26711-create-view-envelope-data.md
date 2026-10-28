---
'@object-ui/data-objectstack': patch
---

`ObjectStackAdapter.createView` no longer adds a top-level `data` to a ViewItem envelope (`{ name, object, viewKind, config }`). `data` belongs inside `config` there, and the platform's `view` write door now refuses a top-level key the envelope does not declare (objectstack#26711), so such a create was refused naming `data`. Before, the door dropped the key and the view saved. A flat list view still gets its default `data`, where that shape declares it. The console's own create flow writes through `createRuntimeMetadata` and was not affected.

Clause-②: no
Metadata-protocol: none
