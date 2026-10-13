---
"@objectstack/runtime": patch
---

fix(runtime): the `/meta/<objectName>` legacy object exit asks the read gate before it serves the schema (#22639)

Clause-②: no

- The runtime dispatcher's one-segment `/meta/<objectName>` exit, reached when a host's protocol has no type catalogue and no list for the segment, served the object schema through the field mask alone. It now asks the shared `/meta` read gate first, as every other object exit does, so an object's own `listViews` entries whose `requiredPermissions` the caller does not hold are not served there either. A caller who may edit the object still reads them all.
