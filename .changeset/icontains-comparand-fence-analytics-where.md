---
"@objectstack/service-analytics": patch
---

fix(service-analytics): fence `$icontains` comparands on the analytics `where` door (#7693)

`$icontains` was the one text-pattern operator the #5234 comparand fence never
covered on the analytics `where` door. It arrived after the fence: #6520 added
it to `filter-normalizer.ts`'s `MONGO_TO_CUBE_OP` and gave `read-scope-sql.ts`'s
arm its `assertRenderableText` call, but not the entry in `comparand-shape.ts`'s
`TEXT_PATTERN_OPERATORS` — the set the `where` door's shape gate reads. So one
operator had **two answers inside one package**. Measured on `origin/main` @
`b54aaab`:

| filter | analytics `where` door | `read-scope-sql` |
|---|---|---|
| `{name: {$contains: {foo: 1}}}` | REFUSED (`INVALID_FILTER` / 400) | REFUSED (`READ_SCOPE_COMPILE_FAILED` / 500) |
| `{name: {$icontains: {foo: 1}}}` | **compiled** — `NativeSQLStrategy` bound `'%[object Object]%'` | REFUSED |

The compiled statement was the #5234 defect verbatim: a parameterised,
syntactically perfect `LIKE` pattern nobody wrote, which a row whose text really
is `[object Object]` matches. `driver-sql`'s own `TEXT_PATTERN_OPERATORS` has
listed the operator since #6520, and #7158 closed the same gap at objectql
`having`; this closes the third and last face.

**What changes for a caller.** A malformed `$icontains` comparand — an object, a
`{$field}` reference, or an array — on the `/analytics` `where` door is now
refused with `INVALID_FILTER` / 400 and the same sentence `$contains` gets,
instead of compiling into a pattern that matches the wrong rows. A well-formed
comparand is untouched: strings, numbers, `null`, booleans and `Date`s compile
exactly as before, ASCII fold and metacharacter escaping included. The
read-scope door is unchanged — it already refused these shapes.

Held by `__tests__/cross-field-reference-refusal.test.ts`, where #7598's
RECORDED GAP pin is flipped to assert the refusal and the shared `#5222` corpus
is now driven whole (its `$icontains` case no longer has to be filtered out),
and by the fifth member added to the LIKE-family loops in
`__tests__/comparand-shape-refusal.test.ts`. Reverse-verified against the whole
package: deleting the entry turns exactly those five `where`-door cells red and
leaves every read-scope and narrowness control green.
