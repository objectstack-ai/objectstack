---
'@objectstack/spec': patch
---

`ComponentPropsMap['object-grid'].exportOptions` names all five members the renderer reads, not two

The entry is `z.unknown()`, so nothing about this key is parsed, refused or
stripped: a member that does not exist draws no error and has no effect, and a
member that does exist cannot be discovered from the schema. That makes the
`.describe()` string the entire account of the key's shape rather than a summary
of an enforced one — and it projects straight into
`content/docs/references/ui/component.mdx`, which is what an author (or a
generating model, ADR-0033) reads.

It named two members, `formats` and `streaming`. The only renderer reads five.

Measured at the `.objectui-sha` pin `53ded82bf7a494f54e344e19099dbf00854b8694`
— objectui `packages/plugin-grid/src/ObjectGrid.tsx`, through the
`schema.exportOptions` expression and the `exportConfig` local bound to it, with
objectui's own scanner (`ObjectGrid.exportOptionsKeys.test.ts`, whose
comment/string stripping is what stops a prose mention of a key being counted as
a read): `formats` 2 read sites, `streaming` 2, `maxRecords` 1,
`includeHeaders` 1, `fileNamePrefix` 1, and an absent-name control
(`zzzNotAMember`) 0 on the same instrument — which is what makes those five
counts readings rather than a matcher that matches anything. The same instrument
answers the same five, with the same per-member counts, at objectui
`3fbdd4a2dae1`, so the set is not an artefact of the pin's age.

The three missing members are `maxRecords`, `includeHeaders` and
`fileNamePrefix`. An author reading the old string learned that
`exportOptions` takes `{ formats, streaming }` and had no way to reach the other
three short of reading the renderer's source — the shape objectstack#8010
closed for this same key one layer out, when `streaming` was read for releases
while no schema declared it.

⛔ The key is unchanged: it stays `z.unknown()` and no accept set moves in either
direction. Giving `exportOptions` a real shape is a separate and much larger
change with its own review requirements; this is the docs half only.

The new list is not restated in prose that can drift on its own. A pin holds the
describe string's member enumeration equal to the members
`ListViewExportOptionsSchema` declares — the spec's own five-key declaration of
this same authoring block, reached through `ListViewSchema.exportOptions`'s
object branch and itself derived from that same read set. Both spellings reach
one renderer, so narrowing or widening the declared block now reds the
`z.unknown()` prose instead of leaving it quietly behind: the declared side has
parse failures to catch drift, this side had nothing. The pin also records that
the key is unvalidated today, so the day it grows an accept set is a deliberate
decision rather than a silent one.

`content/docs/references/ui/component.mdx` is regenerated from the string
(`gen:schema` then `gen:docs`) and carries the same one-line change.
