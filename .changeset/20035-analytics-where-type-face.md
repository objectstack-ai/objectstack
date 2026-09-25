---
"@objectstack/service-analytics": minor
---

fix(service-analytics)!: the analytics `where` door runs the shared comparand-TYPE face on the object spelling, so a plain-object, binary, `Map`, class-instance, oversized-bigint or `undefined` comparand is refused like the `FilterArray` spelling and the engine refuse it (#20035)

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) the #7872 comparand-type transition is not on the ADR-0087 ledger: no entry names normalizeFilterComparandTypes or its accepted set, and #7872's own changeset declared no breaking change. This change adds no new transition either; it brings the analytics object-form `where`, its dataset and measure filters and the draft-data preview under the refusal that face already makes at every other door. No ledger entry could carry it: a plain object in a comparand slot has no accepted comparand it can be mechanically rewritten to, and a binary, a Map, a class instance, a bigint beyond 2^53 and undefined cannot be stored as JSON metadata at all. Which accepted comparand the author meant is an authoring decision. A bigint within 2^53 is narrowed to its number and answers the same rows. The table below records the verdict each cell had and has; it prescribes no rewrite. -->

**BREAKING**: this narrows what the analytics faces of `@objectstack/service-analytics` accept. A caller `where`, a dataset `filter` or a measure `filter` in the object spelling that carries one of the comparands below compiled before this change, at any depth under `$and` / `$or` / `$not` or inside a nested relation. It is now refused with `INVALID_FILTER` / 400, in the shared face's own message, path and prescription, before any SQL statement runs or any `engine.aggregate` call is made. It ships as `minor` under the launch-window convention for accept-set narrowings.

| comparand in an object-form `where` | before (native SQL execute) | now, on every face |
|:--|:--|:--|
| a plain object under a scalar operator: `{ stage: { $ne: { a: 1 } } }`, `$gt`, `$eq`, the LIKE family | bound as the JSON text `'{"a":1}'`; `$ne` served EVERY row, the others matched nothing; the `/analytics/sql` echo answered `DATABASE_ERROR` / 500 | refused 400: "Filter comparand at where.stage.$ne is a plain object …" |
| a plain object as a `$between` endpoint or an `$in` / `$nin` member | the endpoint was compared as JSON text; the member was refused in this package's own sentence | refused 400, in the face's sentence |
| a `{ $field: 5 }` object (a non-string `$field`) under an ordering operator | bound as JSON text (it is not a field reference) | refused 400 as a plain object |
| a binary (`Uint8Array` / `Buffer`) under `$eq` / `$ne` or as an `$in` member | bound as the JSON text `'{"0":1,…}'`, never as a blob; `$ne` served every row | refused 400 |
| a binary, a `Map` or a class instance as the implicit comparand `{ stage: VALUE }` | read as a NESTED RELATION (`stage.0 = 1 AND …`, a 500 on the native path) or refused as a zero-operator wrapper | refused 400 as the value it is |
| a `bigint` beyond ±2^53 | bound as-is, answering no row | refused 400 |
| `undefined`, implicit or under any operator, including `$null` / `$exists` | refused 400 in this package's own sentence, except `{ $null: undefined }`, which compiled to IS NOT NULL; the draft preview answered no row | refused 400, in the face's sentence |

The shared comparand-type face in `@objectstack/spec` (`normalizeFilterComparandTypes`) is the #7872 door: its accepted comparand types are `string | number | bigint | boolean | null | Date`, and it refuses everything else loudly at the compile face (maintainer ruling, 2026-08-12). `parseFilterAST` runs it on everything it returns and the ObjectQL engine's seam on every object-form `where`, so the `FilterArray` spelling of this door and the engine path already refused each row above. The object spelling now meets it too, after the comparand-shape face and before any node is built, the order `parseFilterAST` uses. Both spellings of one condition get the same refusal, byte for byte, on the native SQL execute path, the `/analytics/sql` echo, the ObjectQL engine path and the draft-data preview.

A `bigint` within ±2^53 is not refused: the face narrows it to its number, and the condition every face lowers is the narrowed one. The rows do not change on the published faces. The draft-data preview used to order a bigint as text (`{ amt: { $gt: 2n } }` lost the row holding 10); it now evaluates the narrowed number and charts the published rows.

Binary comparands are reconciled with the face rather than kept as a declared local extra of this package. Measured before this change, the `where` door never compared a binary as a blob on any face: the native path bound it as JSON text, the engine path and the `FilterArray` spelling refused it, and no producer can send one over JSON. This change does not touch the read-scope door, which refuses a binary comparand too since the read-scope lowering began running the same face (#20018), so a binary is now refused at both analytics doors.

Refusals this door already gave in its own words now read in the face's words, the same words the `FilterArray` spelling gets: an `undefined` comparand, and a plain-object `$in` / `$nin` member or LIKE-family comparand. Their verdict, code and status are unchanged. The positions the face does not judge keep this package's sentences: an array or a `{ $field }` reference as a list member or a LIKE comparand, and an `undefined` inside an array comparand or under an operator outside the vocabulary.

Who is affected: nothing in this repository's examples, seeds, docs or package sources authors any of the refused comparands. A text scan over 4013 non-test files found none, and it did find the shape in a code comment written for this change. Stored datasets, dashboard widget filters and report runtime filters in a deployment were NOT measured. Of the refused values, only the plain object can be stored as JSON.

The refusal both analytics doors give for an unbindable `$in` / `$nin` / `$between` member no longer offers "(or a binary value)" as a repair, because neither door accepts a binary any more. It now names only the accepted set; its code, status and verdict are unchanged.

Not changed: every string, number, boolean, `null` and `Date` comparand; a `{ $field }` reference in an ordering slot (served on the engine path); nested relations and dotted members; `$ne` with a list, which the shared face does not judge yet.
