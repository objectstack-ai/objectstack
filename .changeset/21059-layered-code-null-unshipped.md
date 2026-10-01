---
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol): the layered read's code layer is empty for an item no package ships, whether or not a stored copy of it has been loaded into the registry (#21059)

Clause-②: no

The layered read, `GET /api/v1/meta/:type/:name/layers`, reports an item's code layer as the packaged definition, and as empty when no package ships the item and it exists only as a stored customization. For an item no package ships, it answered that correctly only until the stored copy had been loaded into the in-memory registry, for example by a restart's startup load or by a list read. After that, the code layer answered the stored copy, and the lock and provenance flags were derived from it. So the same read of the same item gave two answers, depending on what had been loaded.

The code layer now skips a stored copy the registry holds, using the tenant-authorship mark the startup load already puts on every stored copy it registers. An item no package ships has an empty code layer before and after the load, and its flags come from the stored layer both times. This includes a stored copy whose own content claims a package's provenance: a claim is not a packaged definition. The deprecated layers flag on the by-name read, `GET /api/v1/meta/:type/:name`, answers the same.

Packaged items keep their packaged code layer. An item registered at runtime with no package keeps its code layer, as before. The stored rows are not changed.
