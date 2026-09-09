---
'@objectstack/spec': patch
---

fix(spec): project a union branch-by-branch, so five filter operators reach a published reference page

`z.toJSONSchema()` refuses a whole schema the moment ONE node in it has no JSON
form, and `build-schemas.ts` applied that refusal per SCHEMA. `orderingComparandSchema`
is `z.union([z.number(), z.date(), z.string(), FieldReferenceSchema])`, so four
`data/filter.zod.ts` exports emitted nothing at all — and `$gt`, `$gte`, `$lt`,
`$lte` and `$between` reached no reference row. Not a blank Description cell: no
section. The ~2000 characters of `.describe()` on those slots — the #5685 comparand
contract, the #6571 endpoint contract, and the `{ "$gte": "2026-01-01" }` shape the
platform's own date-macro resolver produces — reached no reader.

The generator now makes a third attempt when both strict directions refuse: it
projects with Zod's `unrepresentable: 'any'`, marks every node that came back with
no structural keyword, and DROPS the marked ones that are direct members of an
`anyOf` / `oneOf`. That is not a narrowing. These artifacts describe JSON
documents, a JSON document cannot carry a `Date` INSTANCE, so the set of JSON
documents that union accepts is unchanged by the drop.

⛔ A marked node anywhere else — an object property, a record value, an array item
— refuses the projection and the export is skipped with the message Zod threw, so
this cannot change WHY anything is skipped. Five exports leave
`unemitted-schemas.baseline.json` (23 → 18): the four filter exports, plus
`data/Hook`, whose only unprojectable member was the deprecated inline-function
handler branch — that puts 22 `data/Hook:` authorable keys under the key ratchet
for the first time.

Published artifacts gain `json-schema/data/{ComparisonOperator,FieldOperators,
NormalizedFilter,RangeOperator,Hook}.json`, each carrying an
`x-unprojectable-branches` record naming exactly which branch the projection
dropped and where.
