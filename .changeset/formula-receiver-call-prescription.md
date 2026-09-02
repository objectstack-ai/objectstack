---
"@objectstack/formula": patch
---

fix(formula): a stdlib function written as a method gets the bare call shape, not the dialect (#14203)

`validateExpression` refused `record.name.upper()` correctly and then handed the
author the generic dialect trailer — "`predicate`s are bare CEL (e.g.
`record.rating >= 4`)" — advice that cannot succeed on a source that already IS
bare CEL and parses fine. The third instance of the same defect family as the
`bounds` class (#7073) and the unknown-name class (#13821), and the one neither
of them could cover: #13821's arm fires only when the name is ABSENT from
`CEL_STDLIB_FUNCTIONS`, and `upper` is present, so this class had no
prescription at all. The name is right; the call SHAPE is wrong.

It is a high-frequency AI-author mistake, not an exotic one: method-call syntax
is what almost every other language uses for string operations, so a generator
that knows `upper` exists reaches for `record.name.upper()` before
`upper(record.name)`. The remedy is one sentence and it is mechanical — the
correct spelling is derivable from the fault itself:

```
invalid CEL predicate: found no matching overload for 'dyn.upper()'

>    1 | record.name.upper()
         ^ — `upper` is callable bare, not as a method — a CALL-SHAPE fault, not
a dialect mistake, so re-spelling the expression will not fix it. Write
`upper(record.name)` instead. The callable names this platform advertises for
authoring (the `functions` list `introspectScope` returns,
`CEL_STDLIB_FUNCTIONS`) take their subject as an argument; only cel-js's own
receiver methods (`record.name.split(',')`) are written after a dot.
```

The spelling is assembled from the SOURCE, because cel-js's message names the
receiver's TYPE (`dyn.upper()`) and never the author's expression. When the
receiver is not a plain dotted chain (`record.tags[0].upper()`,
`(a + b).upper()`, `'lit'.upper()`) the message names the call shape —
`upper(…)` with the receiver as its first argument — rather than inventing a
spelling it cannot derive.

The arm is keyed on membership of the bare-callable catalog plus the
environment's own record of the receiver form, never on the call shape alone.
Two classes therefore keep exactly the behaviour they had:

- the 33 receiver-only names cel-js registers (`split`, `map`, `getFullYear`)
  are correct ONLY after a dot — `record.name.split(',')` type-checks and never
  reaches this arm;
- the seven advertised names registered BOTH ways (`contains`, `endsWith`,
  `matches`, `size`, `startsWith`, `string`, `trim`) keep the existing trailer
  when a receiver call of them faults, because the fault there is the arguments
  (`record.name.contains()`), and a bare rewrite would fault just as hard.

No change to `CEL_STDLIB_FUNCTIONS`, to the registered environment, or to what
`validateExpression` accepts: the receiver call was refused before this change
and is refused after it. Only the sentence the author is told to act on changes.
