---
"@objectstack/spec": patch
---

fix(spec): reference pages carry every variant's `.describe()` text when a property opens more than one object shape (#12316)

The designed-and-measured remainder of #11601. #12309 gave a property that
opens exactly ONE nested object shape a `### Nested Shape:` table, and refused
a property whose type is a union of TWO OR MORE object shapes — there was no
single "the shape of this property" for a heading to name, and naming one
would have meant a variant index, i.e. a second addressing notation. Those rows
kept the collapsed signature cell, and the cell has no description column, so
their nested `.describe()` text stayed exactly as unreachable as #11601 found
it.

**The population, re-measured on `origin/main@7bd6447`.** 28 of the 8604
rendered property rows open two or more shapes, and **all 28** carry describe
text on at least one variant: `ui/App.navigation`,
`ui/NavigationArea.navigation` and `ui/NavigationContribution.items` with nine
variants each, `data/ConditionalValidation.then` / `.otherwise` and
`system/CRDTMergeResult.state` with five, `system/ChangeSet.operations` /
`.rollback` with seven, down to four two-variant rows. The census is unchanged
from the one #11601 recorded when it deferred them.

**What is rendered now.** One sub-table per variant, each under the same
`### Nested Shape:` heading in the same position — no new grammar, and no new
heading level, so the single-h1 invariant and the module-header numbering are
untouched. The accessor gains a SELECTOR segment, spliced in where the union
sits in the wrapper stack rather than appended to the finished path, so
`StateMachine.on[string][option 3][number]` reads left to right as *the record
value, its third option, an element of it* — the reading `[string][number]`
already had.

Two spellings, in preference order:

- **`[type='sidebar']`** where the union has a discriminant — a key every
  shape-bearing variant pins to a *different* literal. It states what the
  author writes to select that variant, in the same `formatLiteral` spelling
  the Type cell prints two lines above, and it is stable: reordering the union
  or adding a tenth variant moves no existing heading and breaks no existing
  anchor. 22 of the 28 rows have one.
- **`[option 2]`** for the six that do not — deliberately the word the union
  branch has printed under `### Union Options` since long before this, rather
  than a bare `[2]`, which in a stack of `[number]`/`[string]` segments would
  read as a tuple index into the property's own type. It counts position in the
  union *including* arms that open no shape, so the number is checkable against
  the `string | { … } | { … }[]` cell the table sits under.

The distinctness half of the discriminant test is load-bearing: a union whose
arms pin the same `const` has no discriminant by this rule, because answering
one would emit two identical headings — two identical anchors on one page, the
defect the `Schema.key` qualification exists to prevent.

Every bound #11601 set still holds. Depth stays at `SHAPE_DEPTH_LIMIT = 1` —
what was lifted is the multi-shape *refusal* at level 1, not the budget, so a
shape nested inside a variant is exactly as unreachable as it was inside a lone
shape. "Only where there is text to publish" is now decided **per variant**,
which is the same rule one level finer: `ui/FormView.submitBehavior` opens four
shapes and one carries prose, so it gets one table, not four. And a variant
table still relocates no vocabulary — it is a third position for those keys.

A property opening exactly one shape gains no selector segment, because the
stamp is conditioned on the union's own yield and not on the row's: all 1469
single-shape headings #11601 published are byte-identical. The regenerated tree
is **purely additive** — 15 files, **+1397 / -0** lines, no reordering.
