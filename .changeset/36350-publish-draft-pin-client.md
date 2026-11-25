---
'@object-ui/data-objectstack': patch
---

feat(data-objectstack): `MetadataClient.publish` sends `draftVersion`; `updateView` pins its draft write to the draft it read

Clause-②: yes (widening)
Metadata-protocol: none

`MetadataClient.publish(type, name, options)` takes an optional `draftVersion` and sends it in the publish body beside `message`, pinning the promotion to that draft (`409 METADATA_CONFLICT` when the draft moved). Omitted, the body carries no such key and the publish is unpinned, as before.

`ObjectStackAdapter.updateView` (Manage views' Rename, Pin and Set as Default) reads a pending draft through `MetadataClient.getDraft`, whose answer carries the draft's `version`, before the layered read it merges from, and writes the merged draft pinned to it (`If-Match`, or `If-None-Match: *` when the read found no draft). A draft another writer changed in between is refused `409 METADATA_CONFLICT` and `updateView` throws the refusal instead of merging over a body it never read. A server whose draft read carries no `version` gets the unpinned write it got before.
