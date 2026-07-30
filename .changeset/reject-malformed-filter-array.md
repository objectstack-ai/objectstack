---
"@objectstack/metadata-protocol": minor
---

fix(metadata)!: a `$filter` array that is not a filter AST is rejected, not passed through (#4121)

`isFilterAST` was being read as a *conversion* gate: an array it refused was
assigned to `options.where` unconverted, leaving each backend to make sense of a
value the protocol had already decided it could not parse.

Item 2 of #3948, filed as error-locality work. The investigation found it is
more than that.

**It closes the last silently-unfiltered shape.** #3948 made the drivers throw
on a bare triple with an unknown operator and on any element that is neither a
join keyword nor a condition array. What it could not reach is a lone `['and']`
or `['or']`: the driver sets its join mode, matches no element, emits **no
predicate**, and returns every row. `isFilterAST` refuses it (a logical node
needs `length >= 2`), so it arrived as an opaque `where` and no driver-side
check applied. That is now a 400.

**For every other shape this is not a narrowing.** driver-sql throws on all of
them, driver-memory throws, driver-mongodb reaches its own parser and fails at
the server. Rejecting at the protocol changes *which* error the caller sees, not
*whether* there is one — and the message is in the request's own vocabulary
(`unrecognised operator "not in"`, `element 1 is number`, plus the recognised
operator list) rather than a driver's internal builder state.

Scoped narrowly, because the regression to fear is rejecting something valid:

- only `Array.isArray(filter)` values are in scope — a `where` **object** is
  untouched, including `$and`/`$or`/`$gte` shapes;
- an empty `[]` is left alone: it means "no filter", and every path already
  treats it that way;
- `isFilterAST` accepts nested arrays, so `[[a,'=',1],[b,'=',2]]` and
  `['and', […], ['or', …]]` keep converting. A naive "arrays are suspect" rule
  would have broken exactly those, which is why the accepted shapes are pinned
  by more tests than the rejected ones.

Errors carry `status: 400` and `code: 'INVALID_FILTER'`, matching the
`UNSUPPORTED_QUERY_PARAM` convention alongside.

Verified: 12 new tests driving the real `findData` normalisation, not a
re-implementation of its rule — six for shapes that must keep converting, six
for shapes that must be rejected, including the exact message text. Reverting the
change fails six of them. Full `@objectstack/metadata-protocol` suite: **122
tests across 19 files**, green.
