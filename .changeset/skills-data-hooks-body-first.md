---
'@objectstack/skills': patch
---

docs(skills): teach the hook `body` first in `objectstack-data`'s data-hooks reference, guard nullable hook-condition and formula predicates, link Connector recipes

Clause-②: no
Metadata-protocol: none

`references/data-hooks.md` now teaches the sandboxed `body` in its schema example, its implementation section and the cross-object pattern; the inline `handler` appears only as the deprecated form (the read-masking pattern stays one, since a `body` writes back only `ctx.input`). Its `body` examples key the row on `ctx.previous.id`: a body's `ctx.input` carries `id` only when the payload does, so a bulk, by-`where` or delete dispatch would otherwise scope a write or a count to every row. Its repository table and `api.write` row drop `upsert` / `updateMany` / `deleteMany`, which a hook's `ctx.api` does not implement, and teach `update` / `delete` with `{ where, multi: true }` as the bulk form. Two hook `condition` examples and one `objectstack-formula` predicate gain the `!= null` guard the publish gate requires, and § Capabilities links the Connector recipes reference. The platform behaviour already shipped; this release only teaches it.
