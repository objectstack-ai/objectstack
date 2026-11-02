---
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol): a plain clone no longer reports the source's empty read-only columns as dropped fields

Clause-②: no
Metadata-protocol: none

`cloneData` copied every column of the source into the insert, read-only ones included, even where the source held no value. The engine's read-only strip judged each such column a caller-supplied key and reported it, so a clone with no `overrides` of a row whose read-only column was empty answered `droppedFields` naming that column, and the REST `X-ObjectStack-Dropped-Fields` header repeated it. Nothing had been sent and nothing was lost, but the console announced "fields dropped" on every such clone.

The clone now leaves a read-only column whose source value is empty (`null`) out of the copy. The stored row is the same as before: the strip removed that key from a non-system caller anyway, and the insert's defaults treat an explicit `null` exactly as an omitted key. What still reports:

- a read-only column the source holds a VALUE in is still copied, stripped and reported, body and header, so the caller reading the default back is told why;
- a read-only field set through `overrides` is still stripped and reported, whatever the source held.
