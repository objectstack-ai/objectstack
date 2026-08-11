---
"@objectstack/spec": major
---

fix(spec): remove `FieldReferenceSchema` from the `$between` endpoints and rule `$in`/`$nin` members out (#7596)

The filter protocol declared a comparand form that **no backend has ever
implemented**, in every LIST position: both `$between` endpoints carried
`FieldReferenceSchema`, and `$in` / `$nin` were `z.array(z.any())`, which admits
a reference too. ADR-0049's enforce-or-remove shape at a declared position —
resolved by removal (maintainer ruling 2026-08-11).

Why nothing implemented it, and why that is structural rather than an oversight:

- **The in-memory evaluator cannot see a list member.** `matches-filter.ts`
  `resolveValue` reads `$field` only off a NON-array object
  (`!Array.isArray(raw) && '$field' in raw`), and `evalOp` resolves the whole
  comparand and never its members. So `$in` / `$nin` compared the raw reference
  OBJECT with `looseEq` against a stored value — never equal — and a `$between`
  endpoint became an ordering bound that is an object.
- **Both failures are SILENT on that path.** `{ amount: { $in: [{ $field:
  'budget' }] } }` matched nothing and reported nothing; the `$nin` direction
  lost an EXCLUSION the author wrote, which widens a scope rather than emptying
  it. On an RLS `check` that is a denied write, or an over-broad read, with no
  diagnostic anywhere.
- **Both SQL faces already refused these positions loudly** (`INVALID_FILTER` /
  400, naming the field, the operator and the member index — #5041 installed the
  refusal and #5222 deliberately kept it: with no correct in-memory semantics
  there is nothing for SQL to be conformance-equivalent TO).

So the declaration was honoured by nobody and refused by two backends. It now
refuses at the schema door as well, with a message an author can act on:

```
A { "$field": … } reference is not a valid $in member at index 1. No evaluation
path resolves a field reference inside a list: the in-memory evaluator
(matchesFilter) leaves the list unresolved and compares the raw reference
OBJECT, so it silently matches nothing, and both SQL drivers refuse the position
with INVALID_FILTER / 400. Write a literal value here, or move the reference to
a scalar comparison operator ($eq/$ne/$gt/$gte/$lt/$lte), whose WHOLE comparand a
{ $field } reference may be. Ruled 2026-08-11 on #7596: declared = enforced
(ADR-0049).
```

The message deliberately does NOT repeat the SQL drivers' second escape hatch
("or evaluate the rule in memory"): at a list position the memory path is the
one that answers with a wrong row set instead of an error.

**Unchanged, deliberately:** the four ordering slots and the two equality slots
still take a `{ $field }` reference as their WHOLE comparand. That is #5222's
shipped capability, and it is also what this refusal prescribes — a
column-to-column range is written as
`{ $gte: { $field: 'a' }, $lte: { $field: 'b' } }`, which every face already
answers. The evaluator (`matches-filter.ts`) is not touched.

**Member types are otherwise untouched.** `$in` / `$nin` members stay `z.any()`:
a membership list is genuinely heterogeneous and this schema is
field-AGNOSTIC — it never sees which column the list applies to, so narrowing
the member type would refuse working filters. One shape is removed, as a check
rather than as a type change.

## Upgrading

An authored filter carrying a `{ $field }` reference in an `$in` / `$nin` list
or a `$between` endpoint now fails validation instead of parsing. It never
produced a correct answer on any backend, so no behaviour that worked stops
working: rewrite it as a scalar comparison, per the message above.

**ADR-0087 conversion: not required**, and the reason is not blast radius alone.

- **No key is retired.** `$in`, `$nin` and `$between` all remain, with their
  arity and their other member types intact. A conversion layer converts old
  SHAPES to new ones; here there is no new shape to convert to.
- **No lossless transform exists (D2's own requirement).** A `{ $field }`
  endpoint has no literal equivalent — the value is a column, unknown at
  conversion time — and rewriting `{ $between: [ref, ref] }` into
  `{ $gte: ref, $lte: ref }` would not PRESERVE behaviour, it would invent it:
  the removed shape evaluated to "matches nothing" in memory and to a 400 on
  both SQL faces, so a conversion producing rows would change every existing
  answer.
- **Blast radius measured, not asserted: zero.** A whole-repo sweep for
  `$between` / `$in` / `$nin` carrying `$field` (`*.ts`, `*.tsx`, `*.md`,
  `*.mdx`, `*.json`, `*.yml`) found no template, seed, fixture, example app or
  stored metadata using the shape. Every hit was a test or a corpus entry
  pinning the REFUSAL, plus historical changelog prose. Nothing to convert, and
  no consumer can carry a working dependency on a shape that answered nothing.
