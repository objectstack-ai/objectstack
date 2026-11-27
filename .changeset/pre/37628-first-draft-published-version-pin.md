---
'@objectstack/metadata-protocol': patch
'@objectstack/runtime': patch
---

Clause-②: no
Metadata-protocol: none

A first draft save of a published item, pinned with the `version` a read of the published row served, is accepted. With no draft row at the address yet, the save door compared the token with the draft head, which is `null`, so every such save was refused `409 METADATA_CONFLICT` ("current is null") and the caller had to drop the pin to get through. The token is now compared with the published head the draft would replace; on a match the draft is written as a first draft, and the repository's lock still refuses a draft another caller wrote in between. A published row that changed since the read is still refused `409 METADATA_CONFLICT`, now naming its current version, which a retry may send. Every draft save door goes through this one comparison: the MCP `save_metadata_draft` tool's `ifMatch`, and `If-Match` on the `/meta` draft save that Studio and REST clients use.

The MCP authoring tools say so (`@objectstack/runtime`): `get_metadata_item` states that a read with `state` answers the `version` that `save_metadata_draft` takes as `ifMatch` and a read without `state` answers none, and `ifMatch` states that the save is refused when the pending draft, or the published item while it has no draft, changed since.
