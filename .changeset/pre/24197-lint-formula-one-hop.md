---
'@objectstack/lint': minor
---

feat(lint)!: a formula field's `expression` is judged on the one-hop line — one hop through a reference passes, a second hop is refused

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) No spec key, stored shape or authorable spelling is added, removed or renamed. The field-formula pass now refuses two expression shapes it accepted before, and the runtime never computed a value for either over a set reference: a read two hops through references, and a reference read both through and as a plain value. Nothing stored changes, so there is nothing for `objectstack migrate meta` to rewrite. -->

The field-formula pass now passes `traversalHydration` for a formula `expression`, because the engine's formula read path loads one hop through a reference field.

- `record.book.title + ' · ' + record.reader.name` passes, as before. It now also computes at run time.
- `record.book.shelf.code` (two hops) is refused. The refusal names the field and says a formula resolves one hop.
- `record.reader == null ? '—' : record.reader.name` (the reference read both through and as a plain value) is refused. The refusal names `record.reader.?name.orValue('—')`, the read that gives an empty reference a value.

What to do. Read a field stored on the related object instead of a second hop, and replace a null test on a reference with the optional read.
