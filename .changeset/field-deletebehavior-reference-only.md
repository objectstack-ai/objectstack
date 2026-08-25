---
"@objectstack/spec": minor
---

feat(spec): materialize `deleteBehavior` only on reference field types (#9784)

`FieldSchema` no longer materializes the `deleteBehavior: 'set_null'` default
onto non-reference field types (`text` / `datetime` / `number` / every other
non-relational type, `user` included). The key has no meaning there — the
engine's `cascadeDeleteRelations` reads it exclusively on `master_detail` /
`lookup` fields carrying a `reference` — yet the materialized default shipped
in every built app artifact, where a parse-time default becomes an apparent
explicit declaration downstream (the #4447 shadowing mechanism) and reads as
meaningful to AI authors browsing the artifact.

What changes and what does not:

- **Bare non-reference fields** parse to output that **omits** `deleteBehavior`
  (previously: `deleteBehavior: 'set_null'` materialized on every type). Built
  artifacts thin accordingly — measured on the showcase app: 210 fields, the
  key drops from 206 fields to 16.
- **`lookup` and `tree`** keep materializing `set_null` byte-identically, at
  shape position.
- **`master_detail`** keeps omitting it (the #9689 idempotent-materialization
  ruling, unchanged).
- **The accept-set is untouched**: an authored `deleteBehavior` on any field
  type parses exactly as before and round-trips verbatim, so artifacts built
  by earlier versions (which carry the materialized key on every field) remain
  fully legal inputs. `parse(parse(x))` holds across the boundary.

No authored metadata needs any change: no key is removed, renamed or
re-shaped, and no authoring spelling that parsed before is refused now.
