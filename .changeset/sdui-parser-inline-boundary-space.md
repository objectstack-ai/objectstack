---
"@objectstack/sdui-parser": patch
---

The JSX-source parser no longer deletes the space that separates a text run
from an adjacent sibling element. `parseChildren` collapsed each text run's
whitespace to a single space (correct — that is HTML's own whitespace model)
and then `.trim()`ed it (not correct — HTML collapses a whitespace run to one
space, it does not delete it), so `A <strong>x</strong> page` compiled to
`['A', {strong}, 'page']` and the words ran together wherever that tree is
rendered.

The rule now applied: collapse the run, then keep one leading space when a
sibling precedes it and one trailing space when a sibling element follows it;
at the parent's own start/end the edge space is still dropped, so
`<p>  hi  </p>` still compiles to `['hi']`. It is deliberately mechanical — it
invents no block/inline taxonomy for a schema tree that has none. Its one
bounded cost is that a whitespace-only run between two siblings survives as a
single space, so a pretty-printed `<ul>` gains one `' '` child per inter-item
gap; the tests pin that bound. This matches the rule the downstream copy of
this parser already applies, so the two agree on the tree they produce.
