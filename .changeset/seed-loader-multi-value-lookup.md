---
"@objectstack/spec": patch
"@objectstack/metadata-protocol": patch
---

fix(seed-loader): resolve natural-key ARRAYS for multi-value lookups

A `multiple: true` lookup / `user` field stores an array of ids, so its seed
value is an array of natural keys (`authors: ['Alice', 'Bob']`). Reference
resolution only ever accepted a single string: the array tripped the
"expected a natural-key string but got an object. Pass the target's `name`
value as a plain string" guard — impossible advice for a field that holds
several references — and was then DROPPED from the record. The row landed with
the whole association missing and only a warn in the log
([#3911](https://github.com/objectstack-ai/objectstack/issues/3911)).

Every element now resolves independently (in-load records first, then the
database, then pass 2), and the field lands as an array of target ids. A lone
string is accepted as one-element shorthand for the array shape the field
stores. Deferral is all-or-nothing per field — a partially-resolved array is a
corrupt association, so pass 2 re-resolves the whole authored array — and a key
that never materializes is a reported load error naming that element, not a
silent drop.

An array passed to a genuinely **single-value** reference field is still
rejected, now with advice an author can act on: declare the field
`multiple: true`, or pass one natural key.

`ReferenceResolution` (`@objectstack/spec/data`) gains an optional `multiple`
flag carrying the field's array-ness into resolution; it is additive and
defaulted-absent, so existing dependency graphs are unaffected.
