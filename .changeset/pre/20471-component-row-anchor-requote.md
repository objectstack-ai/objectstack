---
'@objectstack/spec': patch
---

The `action:group`, `action:menu` and `element:repeater` read-point records are re-measured at the objectui pin and quote the line they cite

Clause-②: no

The docblocks of `action:group`, `action:menu` and `element:repeater` in `src/ui/component.zod.ts`
cited objectui lines that had moved without any gate noticing: the two containers' anchors by 3 to 8
lines since objectui#11638, every repeater anchor by 28 lines since objectui#11168 slice 2, and the
repeater's `data-objectstack` filter and sort anchors since earlier pins. Each is now re-pointed at
the pin this package builds against (`a58626c88`), as are `action:button`'s `static-params.ts`
citation and the `element:definition-list` registration notes, which said the registration
publishes the strings `'1'` / `'2'` and marks `items` required (it no longer does either). Each of
the three rows now quotes the first line of its props-read site (the member forward of the two
containers, the `readProps` call of the repeater), so a pin bump that moves or changes one of those
lines fails `check:objectui-pin-citations`. All six rows of that section now carry a quote. Comment
text only: no schema, key, type or export changes.
