---
'@objectstack/objectql': patch
'@objectstack/metadata-protocol': patch
---

fix(search): `$search` compiles to `$icontains`, so textual matching is actually case-insensitive

`$search` was case-SENSITIVE on textual fields, contrary to three places that
all declared the opposite: the `search.cross-field-object-search` checklist item
title, `search-filter.ts`'s own docblock (*"Matching: case-insensitive"*), and
the `search-conformance` ledger row. Searching `Retail` returned "Acme Retail";
searching `retail` returned nothing.

The cause was operator choice, not operator behaviour. `fieldClausesForTerm`
emitted `{field: {$contains: term}}`, and `$contains` is contractually
case-SENSITIVE (#4706 Q2 = A) — `$icontains` is the case-insensitive one.
SQLite's `LIKE` used to fold ASCII incidentally and hid the mismatch; #6518's
`LIKE`→`GLOB` change removed that accident and exposed it.

**Nothing about either operator changed.** `$contains` remains case-sensitive
and `$icontains` remains the ASCII-folding twin; only which one `$search`
compiles to moved. Every filter backend already answers `$icontains` (#6520 /
#6682), so no driver changes were needed.

Fixed in both producers of search clauses:

- `objectql` `search-filter.ts` — per-object `find({ $search })`, for textual
  fields and for the select raw-value fallback.
- `metadata-protocol` `searchAll` — the global-search palette behind
  `GET /api/v1/search`, which built the same AND-of-OR from `$contains` under a
  comment asserting `$contains` was the case-insensitive operator.

Deliberately unchanged: the select label→value path (`optionValuesMatching`
folds in JS and emits an exact-value `$in`), and the `__search` companion
clause, which stays `$contains` because both of its sides are already lowercase.

The three declarations are reconciled with the behaviour, and the dogfood pin
that stayed green through the whole defect — its only case assertion was a
select label, which passes on a case-sensitive build — now carries the
`['name']`-narrowed lowercase-vs-capitalized assertion that catches it.
