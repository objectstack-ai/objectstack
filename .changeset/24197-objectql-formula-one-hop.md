---
'@objectstack/objectql': minor
---

feat(objectql)!: a formula field reads one hop through a reference field — `record.book.title` on a loan now reads the book's title instead of `null`

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) No spec key, stored shape or authorable spelling is added, removed or renamed. A formula field that reads `record.LOOKUP.FIELD` now computes; before, it read null on every row. The narrowing is in what a formula over a reference evaluates to in two shapes that never computed a value for a set reference (a second hop, and a reference read both through and as a plain value): both now read null on every row with a reported reason, so there is nothing stored for `objectstack migrate meta` to rewrite. -->

The read path (`find`, `findOne`, and the record a create or update hands back) now preloads the related fields a formula names ONE hop through a lookup or master-detail field, before it computes the formula. A junction object's composed title, `record.book.title + ' · ' + record.reader.name`, shows both names.

- **How it reads.** One batched read per reference field per page of rows, never one per row, naming only `id` and the related fields the formulas name. The loader is the one validation rules already use for `record.LOOKUP.FIELD`. The row a read returns still holds the foreign key; only the formula sees the related record.
- **As whom.** The hop is read under the reader's own permissions (row-level and field-level security, the organization wall). A related record the reader may not see reads as not found, and a related field it may not see reads as empty, so a formula never shows the reader a value they could not read directly.
- **When there is no related record.** A reference to a record that is not found, or that the reader may not read, leaves the formula null and reports why, naming the related object and field. An empty reference is evaluated: write `record.reader.?name.orValue('—')` to give the formula a value while the reference is empty.
- **One hop only.** A second hop (`record.book.shelf.code`) and a reference read both through and as a plain value are not evaluated: the field reads null and the reported reason uses the same wording the lint uses. A formula on the related object that reads a hop of its own reads null on a hop read, so two objects whose titles read each other terminate.
- **Sorting and search.** A formula value is stored nowhere, so a formula title still cannot be sorted by (`400 INVALID_SORT`) or searched, as before.

What to do. Nothing for a formula that reads its own fields. A formula that reads through a reference now shows a value. One that reads two hops should read a field stored on the related object instead.
