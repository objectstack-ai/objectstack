---
"@objectstack/spec": patch
---

fix(spec): the `undefined` comparand refusal prescribes the null predicate by its ruled spellings (#14426)

`parseFilterAST`'s comparand-type door refuses an `undefined` comparand at every
position. Its prescription read "Write null for the null predicate, or omit the
key" — position-agnostic advice that, followed at `{ $gt: undefined }`, produced
`{ $gt: null }`, which the 2026-09-01 ruling refuses one door over (and, at an
`$in` / `$nin` / `$between` member, produced the list shapes refused on
2026-08-31). Two loud refusals to reach one right answer.

The sentence now names the null predicate by its complete spellings —
`{"$eq": null}` / `{"$ne": null}` — or omit the key, so following it never lands
in a refusal at any position the sentence is emitted at. No accept/refuse
behaviour changes: same envelope (`INVALID_FILTER` / 400), same path, same
accepted-set and NOT-applied sentences.
