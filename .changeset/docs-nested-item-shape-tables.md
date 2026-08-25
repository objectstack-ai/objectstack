---
"@objectstack/spec": patch
---

fix(spec): reference pages carry a nested item shape's `.describe()` text instead of collapsing it into a signature cell (#11601)

`build-docs.ts` renders a property whose type is an inline object as a
one-line signature — `{ label: string; icon?: string; visibleWhen?: string |
object; value?: string; … }[]` — into a table cell that has **no description
column**. Every `.describe()` an author wrote on a key of that shape was
therefore unreachable from the reference page: not truncated, not marked,
absent. `page:tabs`'s item-level `visibleWhen` carries a ~600-character
contract note whose whole point is that its evaluation environment is **not**
the page-component `visibleWhen` of the same name, and
`content/docs/references/ui/component.mdx` rendered that row with an empty
Description cell.

The loss was invisible from both sides. `check:docs` compares generated output
with committed output, so it is green forever on prose neither side contains —
measured on the tree before this change, adding a `.describe()` to a nested
item key produced a **zero-line** `gen:docs` diff.

**The population, measured on the emitted tree.** 1293 property rows across
566 published schemas and 13 of 14 categories open a nested shape; 1208 of them
have at least one key carrying describe text, 7502 described keys in total,
~473 KB of authored prose that reached no page.

**What is rendered now.** A property that opens exactly one shape, and whose
shape has at least one described key, gets a `### Nested Shape:` table directly
under the Properties table — the same position, addressing and heading level
the `### Allowed Values:` relocation has used since #6225, so the page gains no
second grammar. The heading names the shape with a TypeScript indexed accessor
(`PageTabsProps.items[number]`, `Object.fields[string]`), which is a real
spelling rather than a sigil invented for the docs.

Four bounds, each measured rather than chosen:

- **One level**, matching the `SHAPE_DEPTH_LIMIT` budget a cell already spends.
  A nested table opens no table of its own.
- **Only where there is text to publish.** A shape whose keys carry no
  describe text keeps its cell; a table there would restate the cell in more
  space.
- **A union of two or more object shapes keeps its cell.** There is no single
  "the shape of this property" to name — the same reason `formatPropertyType`
  refuses to relocate a vocabulary out of `Enum<…>[]`.
- **A nested table does not relocate vocabularies.** It is a second position
  for those keys, so it elides them the way a `{ … }` summary does. Without
  this rule the 288-member `ApiError.code` vocabulary was re-listed under every
  nested `error` shape — 20,260 bullet lines across the tree, `api/metadata.mdx`
  alone +6097.

Tombstoned keys are rendered in a nested table, unlike in the cell above it:
`retiredKey()` puts the whole `[REMOVED]` migration prescription in
`description`, and a signature has no column to carry it.

The regenerated tree is **purely additive** — 143 files, +14195 / -118 lines,
and every one of the 38177 pre-existing lines is still present byte for byte
(the 118 are re-ordering around the inserted sections, not removal).
