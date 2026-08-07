---
"@objectstack/spec": patch
---

fix(spec): the reference generator quotes a literal by its `typeof`, so numeric literals stop being written down as strings (#5729)

`formatType()`'s two literal branches wrapped every value in `'…'` without
looking at its type — `prop.enum.map(e => `'${e}'`)` and
`return `'${prop.const}'`` — so a **numeric** literal union was printed as a
**string** one. `FormSection.columns` is the specimen the issue was filed from:
it is declared

```ts
z.union([z.enum(['1', '2', '3', '4']), z.literal(1), z.literal(2), z.literal(3), z.literal(4)])
```

and `content/docs/references/ui/view.mdx` rendered it as
`Enum<'1' | '2' | '3' | '4'> | '1' | '2' | '3' | '4'`, where the second half is
those four `z.literal(<number>)` variants. The two halves came out
indistinguishable, so the page claimed the key takes strings only — while the
schema accepts both `2` and `'2'`.

For these pages that is a contract error, not a typo. They are the authoritative
input for an AI author (ADR-0033), and a literal union is a copy-the-spelling
surface: whatever quoting the page shows is what gets written. #5611 paid for it
directly — its `RecordDetailsProps.sections[].columns` was meant to be a numeric
literal union, the generated reference said strings, and the PR abandoned the
shape for `z.number().int().min(1).max(4)` to escape the contradiction. The
generator was defining the contract backwards.

Quoting is now decided per **value**, not per node, because JSON Schema states
member types per value and an `enum` may mix them (`z.nativeEnum({ A: 1 })`
emits a numeric `enum`): strings stay quoted, `number`/`boolean` render bare,
and `null` renders as the keyword.

Eight reference pages change, 11 lines, and in one direction only — quotes are
removed from 18 non-string literals and no string literal loses its:
`api/dispatcher`, `api/errors` (`success: false`), `data/data-engine`
(`sort: Record< string, 1 | -1 >`), `data/driver-nosql` (`projection:
Record< string, 0 | 1 >`), `data/object` (`systemFields` / `stageField: false`),
`security/explain` (`version: 1`), `ui/dashboard` (`filterBindings`) and
`ui/view` (`columns: … | 1 | 2 | 3 | 4`). Every `Enum<'a' | 'b'>` on those
pages is untouched.
