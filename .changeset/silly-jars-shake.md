---
'@objectstack/objectql': patch
---

`having` now REFUSES an `$icontains` comparand that is not a non-empty string, instead of evaluating it

**Client-visible effect — two `having` filters that used to return rows now return a 400.** Both were answering the wrong thing silently:

- `having: { name: { $icontains: '' } }` matched **every** row. Every string contains the empty substring, so the predicate constrained nothing: the author wrote a constraint and got the UNFILTERED aggregate back with no error. A predicate that constrains nothing does not narrow a result set, it widens it — on a row-level-security read scope that is a permission bypass rather than a degraded filter.
- `having: { name: { $icontains: 42 } }` matched **no** rows. `StringOperatorSchema` declares `$icontains: z.string()`, so a non-string comparand was answered `false` rather than refused — the silent-wrong-answer shape `$regex` was retired over.

Both are now refused with `INVALID_FILTER` / HTTP 400 in the ADR-0112 envelope, naming the field and its position inside the clause (`having.$and[0].name.$icontains`). This is the gate the five sibling filter faces already had (`driver-memory` and `driver-sql`'s `icontainsComparandError`, and their twins); `having` was the sixth evaluation face of the same vocabulary and the only one without it.

Nothing else about `having` changes: every filter it evaluated correctly before, including every `$icontains` with a real comparand, is evaluated identically. Callers writing either of the two degenerate comparands should write the substring they meant to search for, or drop the predicate.
