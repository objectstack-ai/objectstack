---
'@objectstack/runtime': patch
---

fix(runtime): `ctx.title()` in a hook body answers a title formula that reads through a lookup, as a read of the record shows it

A junction object's composed title, `record.book.title + ' · ' + record.reader.name`, is shown by every read of the record, but a hook body's `ctx.title()` answered `null` for it, and `ctx.title('<lookup field>')` answered `null` for a related record whose own title reads through a lookup.

- **`ctx.title()`** now reads the one hop the title formula reads, through the body's own `ctx.api` channel: one read per lookup the title reads through, with the caller's permissions, on the transaction the body has open. It follows the lookup's value in this write, so a `beforeInsert` names the payload's book and a `beforeUpdate` that changes `book` names the new book. A title over the record's own columns still costs no read.
- **`ctx.title('<lookup field>')`** returns the title its `findOne` served, the related record's own one-hop title included, instead of re-computing it without the hop.
- A related record the caller may not read leaves the title `null`, as the read of the same record shows no title to that caller. It is never a partial title and never the hidden name. A title that would need a second hop is `null`, as it is on a read.

What to do. Nothing. A hook that composed a junction object's title by hand can call `ctx.title()` instead.
