---
"@objectstack/spec": minor
---

fix(spec)!: the filter doors refuse the three shapes they already declared refused — a scalar operator's array, an `icontains` comparand the conformance table rejects, and an ungated `defaultFilters` (#19514)

**BREAKING** — three accept-set narrowings on published authoring surfaces, each pulling the door back to what this package already declared somewhere an author's parse never reached. Shipped as `minor` under the repo's launch-window convention for accept-set narrowings. Stored metadata carrying any of these shapes keeps loading and keeps rendering exactly as it does today; what changes is that RE-SAVING it is refused, at the key that carries the mistake. The hand-migration prescriptions are registered under protocol major 18 as `view-filter-rule-scalar-operator-array-refused`, `filter-icontains-comparand-refused-at-parse` and `object-grid-default-filters-rule-array`.

Direction set by objectui#9050's ruling C′, quoted untranslated: 「the differences are the protocol's to close」.

## 1. A scalar operator carrying an ARRAY is refused

`ViewFilterRuleSchema.value` has carried this sentence in its published description since the operator/value coupling landed: *the accepted SHAPE depends on the operator: `in` / `not_in` take an array, `between` takes exactly [min, max], **every other operator takes a scalar**.* The refinement that implements the coupling returned early for every operator that was neither a list operator nor `between`, so from the day the coupling landed until this change the entire scalar class was declared and not judged.

⚠️ **This reverses a reading the code recorded**, and the reversal is the substance. The scalar-operator array was listed as deliberately accepted because it *"lowers to a bare `{ field: value }` deep-equality comparand, which every backend answers"*. The backends a lowered view rule reaches are **four**, and at this release they do not agree — so each is named, in the present tense (how each cell was measured, and which were not, is stated under the table):

| backend | what it does with the lowered `{ tags: ['a'] }` |
|:--|:--|
| the SQL family: `driver-sql`, the `driver-turso` / `driver-sqlite-wasm` drivers built on it, and turso's remote transport | **REFUSES** — the bare `{ field: value }` loop asserts the comparand against its own scalar-operator set, an array is none of the six accepted comparand types (`a string, number, bigint, boolean, null or Date`), and it comes back as the withheld `INVALID_FILTER` / 400 envelope |
| `driver-memory` | **REFUSES** — the same shape in the same envelope |
| `@objectstack/formula` | **EXCLUDES** — `matchesFilterCondition` answers `false` for every row, a row whose stored value IS `['a']` included |
| `driver-mongodb` | **ANSWERS** — `translateFilter` passes the array through unchanged and the engine's shared comparand doors pass the shape, so the server applies MongoDB's equality rule for an array operand: a row matches when its stored array **equals** `['a']` **or holds `['a']` as an element**, and a row storing the scalar `'a'` does not (mingo 7.2.4, over `['a']`, `'a'`, `['a', 'b']`, `['b', 'a']`, `[['a'], 'x']`, `[['a']]` and `'b'`, selects `['a']`, `[['a'], 'x']` and `[['a']]`); a live `mongod` is NOT MEASURED |

How each cell was measured. Run for this change on the lowered `{ tags: ['a'] }`, each beside a scalar and an `$in` control: `driver-sql` on SQLite, `driver-memory`, the formula matcher, `driver-mongodb`'s `translateFilter`, and mingo 7.2.4 for MongoDB's rule. Run in this change's review: `driver-sql` on a live PostgreSQL 16 (refused before any SQL statement was emitted), `driver-sqlite-wasm`, and turso's remote transport over the repository's libsql stub. ⚠️ NOT MEASURED: MySQL, a live Turso server, and a live `mongod` — the MongoDB row is read at the driver's compile face, at the engine's shared comparand doors and through mingo.

**None of the four reads the array as the scalar the operator declares.** Today three return no rows for it — the SQL family and `driver-memory` with a 400, the formula matcher with a silent exclusion that, unlike a 400, reads as a true statement about the data. `driver-mongodb` returns rows — but for a different predicate, and only on an array-valued field, so it too reads as a true statement about data the rule never asked for (a live `mongod` is NOT MEASURED). Earlier releases are a separate question, and only partly measured: `driver-memory` refuses the shape from 17.4.0, while its published 17.3.0 returned the row stored as `['a']` (run in this change's review; which other rows it selected, nested arrays included, is NOT MEASURED); whether any earlier SQL-family release answered the shape is NOT MEASURED.

Two carve-outs are kept and pinned, because a narrowing that runs past the query path is the mirror-image defect: an **omitted** value still parses (`value` is optional), and the four **valueless** operators (`is_empty` / `is_not_empty` / `is_null` / `is_not_null`) still accept anything in the value position — they take their direction from the operator NAME, the lowering discards the value, and the ObjectUI client deliberately sends a truthy placeholder there.

## 2. The `icontains` comparands the platform's own table declares refused

`@objectstack/spec/data`'s `FILTER_TEXT_CASES` declares two REJECTION rows for the case-insensitive contains operator — an **empty** comparand and a **non-string** one, each `code: 'INVALID_FILTER'`. All five driver packages run both rows in their own suites, and the drivers re-run for this change — `driver-sql` on SQLite, `driver-memory`, `driver-mongodb`'s `translateFilter` — each refuse both comparands with `INVALID_FILTER` / 400; the formula matcher does not refuse them, it answers `false` for every row. Nothing applied them at parse, on either vocabulary, so the protocol declared the refusal and then admitted the document that would hit it. Both doors now refuse: the `$` dialect's `FilterConditionSchema` and the view vocabulary's `icontains` arm.

The predicate is **derived from the table, not transcribed beside it** — both doors call the published `isRefusedTextComparand` and `textComparandRefusalReason`, so a row added to `FILTER_TEXT_CASES` reaches both doors with no edit at either, and the reason an author reads at authoring time is byte-identical to the one three shipped consumer faces already show at query time. Scope is the one operator the table writes rows for: `$contains`, `$startsWith`, `$endsWith`, `$like` and `$ilike` are untouched, because widening by analogy is the table's decision and not a door's.

One asymmetry between the two vocabularies, and it is a fact about them rather than an extra rule: a view rule's `value` is optional, so an **absent** comparand is left unjudged there; the `$` dialect has no absent, so an explicit `undefined` in a comparand slot is the refused non-string shape.

## 3. `object-grid`'s `defaultFilters` carries `filter`'s declaration

The key is described as *"Legacy base-filter fallback, read only when `filter` is absent"* — the same value in the same role as `filter`, read through the same lowering sink. `filter` converged on the `ViewFilterRule` array with the rest of its family; this key was not named by that ruling and kept `z.unknown()`, so the block had one declared door and one undeclared door onto one seam, and the parse receipt said nothing about what the grid would then do with the value. In the objectui version this release pins (`.objectui-sha` pin `87af769e9a`), `ObjectGrid` lowers `defaultFilters` through `toFilterNode` whenever `filter` lowers to nothing, and what that does depends on the shape:

- the **record form** and the **AST tuple array** are lowered and **applied** as declared;
- a **bare string** or a **number** is **dropped** without a word, so the grid sends no filter and lists its rows unfiltered;
- a **list of malformed rules** is **refused** — on the wire with 400 `INVALID_FILTER`, or by the client before any request for the value shapes it judges itself.

⛔ **Narrowed, not retired.** Refusing the key outright is a removal of an accepted shape and needs its own ruling. The deprecation already stated in the description is unchanged: prefer `filter`.

## FROM → TO

| you wrote | write instead |
|:--|:--|
| `{ field: 'tags', operator: 'equals', value: ['a'] }` | `{ field: 'tags', operator: 'equals', value: 'a' }` — or `operator: 'in'` if membership was meant |
| `{ field: 'name', operator: 'icontains', value: '' }` | delete the condition — every value contains the empty substring |
| `{ field: 'name', operator: 'icontains', value: 42 }` | `value: '42'`, if a substring match on those two characters was really meant |
| `{ name: { $icontains: '' } }` | delete the condition |
| `{ name: { $icontains: 42 } }` | `{ name: { $icontains: '42' } }` |
| `defaultFilters: { status: 'active' }` | `defaultFilters: [{ field: 'status', operator: 'equals', value: 'active' }]` — better, move it to `filter` and delete the key |
| `defaultFilters: [['owner_id', '=', '{current_user_id}']]` | `defaultFilters: [{ field: 'owner_id', operator: 'equals', value: '{current_user_id}' }]` |

Each refusal carries its own prescription at the key that raised it, so `os validate` / `os lint` make the sweep mechanical rather than by eye. What the rewrite changes on the page differs by row, so read them apart:

- **The scalar-operator array.** At this release the SQL family and `driver-memory` answer it with a 400 and the formula matcher excludes every row; `driver-mongodb` returns the rows whose stored array equals the value or holds it as an element (a live `mongod` is NOT MEASURED). How releases before this one answered it is set out in § 1 and is only partly measured. Re-check what each view is supposed to show rather than assuming the old result set was correct.
- **The two `icontains` comparands.** At this release each of the five driver packages answers both with a 400 and the formula matcher excludes every row; how earlier releases answered them is NOT MEASURED.
- **`defaultFilters`.** The record form and the AST tuple array were applied as declared in the pinned objectui, so for them the rewrite is a spelling change. A bare string or a number was dropped, so that grid has been listing its rows unfiltered — decide which rows it should show before writing the rule. Beside a non-empty `filter`, deleting `defaultFilters` is the whole migration; beside `filter: []` the grid reads `defaultFilters`, so move its rules onto `filter` rather than deleting them.

The one to read closest is a one-element array: its two corrected spellings — `value: 'won'` on `equals`, and `operator: 'in'` with `value: ['won']` — select the same rows, so the result set cannot tell you which the metadata meant, and only the author knows.

## Who is affected, measured

Nothing in this repository authored any of the three shapes. Two fixtures pinned the old accept set and were re-judged rather than rewritten by rote: one asserted that a scalar-operator array parses (it pinned the reading paragraph 1 reverses), and one parsed an ObjectQL AST tuple array on `defaultFilters` to prove the key is HONOURED — that subject survives, on the rule array, with the tuple array's refusal pinned beside it. The full `@objectstack/spec` suite is green, and `check:api-surface` reports no export moved: no symbol is added, removed or renamed by this change.

Clause-②: no (narrowing) — no key is added, removed or renamed, no exported symbol moves, and no new published vocabulary is introduced (the two operator sets the refusals name are the ones already exported, and the two the checks needed for themselves are deliberately module-private). Every one of the three accept sets narrows back to what this package had already declared: a published `.describe()` for the first, a published conformance table for the second, and the sibling key's own declaration for the third.

<!-- adr-0087: registered view-filter-rule-scalar-operator-array-refused, filter-icontains-comparand-refused-at-parse, object-grid-default-filters-rule-array -->
