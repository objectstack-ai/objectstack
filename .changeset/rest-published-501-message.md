---
"@objectstack/rest": patch
---

Reworded the `501 NOT_IMPLEMENTED` message on `GET /meta/:type/:name/published` (and its
compound-name arity) to state its true post-#8278 condition. Since #8278 put the
runtime-published overlay consult ahead of this arm, the 501 no longer means "this kernel
cannot answer `/published`" — it means "nothing is runtime-published for this item, and
this kernel has no code/package store" (i.e. `metadata.getPublished()` is unavailable).
The old message ("metadata.getPublished() is not available in this kernel") overstated
that condition. Status code, `error.code`, and routing order are unchanged — only the
message text changed.
