---
'@objectstack/spec': patch
---

The spec's objectui citations, and the shipped description text that names the `.objectui-sha` pin (the `FormField.span` describe and six migration-entry descriptions), are re-measured against the new console pin, objectui `47b1f0bb7174`.

Clause-②: no

Every anchor was mapped through the objectui diff `f0268ad78485..47b1f0bb7174`: 129 paths over 14 commits, none deleted or renamed. Two files a record cites changed on the hop, each for objectui#11865 (a picker drawn with the shared `Select`): `ObjectGrid.tsx` gained one import line and redrew its grouped pager's rows-per-page picker, and `ListView.tsx` redrew its "Color by field" and rows-per-page pickers. Every cited line in those two files moved with its text byte-identical, so the nine records that cite them are re-pointed, and each hop sentence says by how much. The other 34 records cite only files that are byte-identical across the hop, and each gains a hop sentence that says so.

No record says anything false at the new pin, so no reading is rewritten.

The `FormField.span` describe changes its sha only: `WIDE_FIELD_TYPES`, the field-type alias table and `spanLadderFor` are byte-identical at the new pin. The six migration entries' corpus counts were re-taken with `git grep -o -F`, the method that reproduces every `f0268ad78485` number. The corpus is now 8281 tracked files. Every token an entry counts as zero still reads zero: none of them occurs on a line the hop adds or removes. The controls moved with the corpus, for example `objectstack` from 17956 to 17980 and `timeout` from 1658 to 1674.

No key, default, enum member or export moves.
