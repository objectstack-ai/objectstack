---
'@objectstack/plugin-sharing': patch
---

fix(plugin-sharing)!: the write gate judges by id exactly the writes the engine runs by id

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) a runtime authorization answer moves: no metadata key, accepted value or stored row changes, so `os migrate meta` has nothing to rewrite -->

The sharing write gate now takes its by-id or bulk branch from the engine's own dispatch decision for the write's options. A write the engine runs by id is judged by id, as before. Every other write is one the engine runs as a predicate, an `$in` or `$eq` on `id` included, and it meets the bulk write scope: it writes the rows the caller may update or delete, leaves the others as they were, and answers no error.

A member's multi-row delete or update of rows it owns, on a `private` or `public_read` object with an `owner_id`, now lands where it answered 403 FORBIDDEN.

A call the engine refuses at dispatch (for example a scalar `where.id` beside another key without `multi: true`, or a payload `id` beside a `where` predicate) now gets the engine's own refusal, the answer a system caller gets, instead of this gate's 403 first. It is refused either way and nothing is written.

**BREAKING** for a caller of a multi-row (`multi: true`) update or delete in one of two shapes, both of which the engine runs as a predicate and the gate now judges as one:

- a `where` that carries a scalar `id` beside another key;
- an `id` that is falsy (`''` or `0`).

Such a write meets the bulk write scope instead of the by-id judgment:

- a row the caller may not write is left as it was, and the write answers no error where it answered 403 FORBIDDEN;
- a row the caller may write only because an application row-level policy widens the sharing scope for it (the by-id judgment's deferral to such a policy) is no longer written by these two shapes, as for every other predicate write.

To write such a row, address it by id alone (`where: { id }`, or the payload `id`): that write is judged by id, as before.
