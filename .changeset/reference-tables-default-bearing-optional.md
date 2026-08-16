---
"@objectstack/spec": patch
---

fix(spec): reference tables stop marking `.default()`-bearing members as required, and name the default instead (#8703)

The Required column of every `content/docs/references/**` property table mirrored
the emitted JSON Schema's `required` array. `build-schemas.ts` emits the
**output** (post-parse) shape for 1458 of the 1582 published documents, falling
back to the **input** shape only when output emission throws — and in an output
shape a `.default()`-bearing member is listed in `required`, because the parse
always produces it. So the column answered "must I write this?" with `✅` for
keys the author may freely omit.

**Measured on the emitted tree: 2526 property occurrences across 529 documents**
were in `required` while carrying a `default`. `kernel/metadata-plugin.mdx` is
the specimen the card was filed on — `enableEvents`, `validateOnWrite`,
`enableVersioning`, `cacheMaxItems` and `bootstrap` all read `✅`, and all five
are omittable.

Two consequences, both fixed here:

- Reference tables are read far more often by an AI author than by a human
  (ADR-0033), and omitting optional keys is that author's normal mode. A wall of
  `✅` teaches over-specification, and buries the genuinely-required keys among
  the ones that are not.
- The same member rendered `✅` on an output-shape page and `optional` on one of
  the 124 input-shape pages, so a refactor that merely flipped a def between the
  two emission modes rewrote its whole Required column with no semantic change to
  what an author writes.

**The fix reads `default` rather than `required`**: a property carrying a
`default` is author-omittable by construction in *both* emission modes, so it now
renders `optional (default: \`false\`)` — strictly more information than either
previous cell, since the value an author gets by omitting the key was nowhere on
the page before. A structural default too wide for the cell renders
`optional (has default)` (13 cells; the budget's discontinuity is documented at
`INLINE_DEFAULT_WIDTH_LIMIT`), and a property with no default is untouched in
both directions.

**The JSON Schemas are deliberately unchanged.** `build-schemas.ts` is not
touched by this fix: the emitted artifacts keep describing the post-parse shape
and keep validating post-parse data. Only the doc renderer reads the author's
question differently. 146 reference pages are regenerated.
