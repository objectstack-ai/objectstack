---
'@objectstack/rest': patch
---

fix(rest): a cached `GET /meta/object/:name` that carries `disabledActions` is answered `304 Not Modified` again when nothing changed

Clause-②: no
Metadata-protocol: none

The default cached object read serves `disabledActions` beside the item: the names in `item.actions` that the deployment's activation ledger switches off. That list used to be kept out of the ETag, so every such read was answered `200` with the full body and never `304`, and on a default deployment, where the ledger is attached, revalidating an object definition saved nothing.

The switched-off list is now part of the object read's ETag. An unchanged object with an unchanged set of switched-off actions is answered `304` on revalidation. When an administrator turns an action off or on under Setup › Packaged automation, the ETag changes and the next revalidation is answered `200` with the new list. `[]` and an absent key give different ETags, so a ledger being attached or detached also changes it. An object with no `disabledActions` key keeps exactly the ETag it had before. The response body is unchanged.
