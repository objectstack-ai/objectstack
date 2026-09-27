---
'@objectstack/spec': patch
---

fix(spec): the `ComponentPropsMap` objectui read-point records are re-measured at the live pin and now assert it (#18459)

Clause-②: no

`packages/spec/src` carries READ-POINT RECORDS: docblocks that say "this key is
LIVE, and here is the objectui `file:line` that reads it". A record anchors
itself to the objectui tree its numbers were counted in, and
`check:objectui-pin-citations` recognises two spellings for that anchor — an
ASSERTING one (`.objectui-sha` = `<sha>`, checked against the pin file on every
run, so a pin bump reds on it) and a HISTORICAL one (`.objectui-sha` pin
`<sha>`, a dated record that a later bump does not falsify, and that nothing
re-checks).

Eleven records — ten in `src/ui/component.zod.ts`, one in its sibling test —
were in the historical spelling naming the RETIRED pin `53ded82b`, although
every one of them is a live read-point record whose whole purpose is to stay
re-checkable. Each was re-READ
against objectui at `87af769e9a3e` and converted to the asserting spelling, so
the next pin bump fails on them instead of carrying them.

**The drift was real, not hypothetical, and three anchors could not have been
repaired by refreshing numbers:**

- `ObjectMap.tsx`'s array-shorthand head inside `getDataConfig` is DELETED
  (objectui#8348); an authored `data` array now reaches that renderer through
  the React props channel alone, never through the record-source ladder.
- `ObjectTree.tsx`'s `?? schema.titleField` rung is DELETED (objectui#8841).
  The flat-spelling prescription that names `titleField` stays TRUE on its
  other half — `ListView`'s flatten still resolves `treeCfg.titleField` into
  `labelField` before emitting — and that is now what the record cites.
- `object-kanban`'s navigation read no longer carries the `(schema as any)`
  cast the record quoted, while its `object-calendar` twin still does.

A fourth is a count rather than an anchor: the `plugin-tree` registry shell's
`ElementDataSourceGate` control reading. It was re-taken at BOTH ends of the hop
by ONE method — occurrences of that identifier in each control's own
`src/index.tsx` — and nothing moved: 3 each for `plugin-map`, `plugin-gantt`,
`plugin-grid` and `plugin-calendar`, 0 for `plugin-tree`, at
`87af769e9` and at `53ded82bf` alike, so the ZERO that discriminates is the
whole reading. The `7 each` the record used to carry is reproducible at neither
pin by that method, nor by a whole-package count (7 / 5 / 11 / 5). ⛔ A count is
a reading only with its METHOD beside it — without one, re-stating the carried
number is exactly what survives a re-measure.

`plugin-timeline/src/renderer.tsx:1215` is at the same number with the same
content at both pins — and it is not alone there:
`plugin-timeline/src/index.tsx:333` (`limit: 'limit',`), an anchor of that same
record, is too, read by the same method at both pins. Which is exactly why a
number that did not move is no more a reading on its own than one that did.

Three further records in the same blocks cited an objectui sha WITHOUT naming
`.objectui-sha`, so they sat outside the gate's population entirely — neither
asserting nor historical, simply unseen. They are re-measured and spelled so
the gate can see them.

**Why `Clause-②: no`.** Every changed line is a comment. No schema, describe
string, export, key or refusal text moves, so no input's accept/reject verdict
can change; `check:generated` reports all fifteen spec artifacts up to date
with nothing to regenerate. It ships as a `patch` rather than as no changeset
because the bytes are published: `src/ui/component.zod.ts` ships verbatim under
this package's `files[]` entry `src/**/*.zod.ts`, measured against the packed
tarball with a positive and a negative control.
