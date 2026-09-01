---
"@objectstack/formula": patch
---

fix(formula): an unknown-function refusal names the function and points at the callable set (#13821)

`validateExpression` refused an unknown CEL function correctly and then handed
the author a prescription that could not succeed: "`predicate`s are bare CEL
(e.g. `record.rating >= 4`)" — advice to write bare CEL, on a source that
already is bare CEL and parses fine. An unknown-function fault is graded `type`
by the engine's own `check()`, so it fell through `bracesHint` (null, no brace)
and out to that generic dialect trailer.

This is the second leg of the repair #7073 / PR #7209 made for the `bounds`
class, for the same reason `boundsHint`'s doc-comment gives: an author who obeys
the last sentence they were given — an LLM author above all — rewrites the
dialect, learns nothing, and comes back with the same unresolvable name. The
last sentence pointed at the one thing that was already correct.

The `type` class now gets its own prescription, which **names the function that
did not resolve** and points at the callable set `introspectScope` publishes:

```
invalid CEL predicate: found no matching overload for 'dyn.nosuchmethod(string)'

>    1 | record.x.nosuchmethod('a')
         ^ — `nosuchmethod` is not a callable name here — a NAME fault, not a
dialect mistake, so re-spelling the expression will not fix it. The callable
names this platform advertises for authoring are the `functions` list
`introspectScope` returns (`CEL_STDLIB_FUNCTIONS`) — pick one of those, or
precompute the value in a stored field and reference that field instead.
```

The front half is unchanged: it is cel-js's own vocabulary and matches the
runtime fault exactly. Only the trailer after the dash is new. `CEL_STDLIB_FUNCTIONS`
itself is untouched, and the message names no member count — what the catalog
contains is being adjudicated separately, and a sentence asserting a size would
be falsified by that ruling.

**The did-you-mean suggestion is thresholded, and the threshold is the point.**
Against this catalog the shared `nearestName` budget answers
`nearestName('can', CEL_STDLIB_FUNCTIONS)` with `'min'` — two edits on a
three-character name, a jump from a permission verb to a numeric function. That
suggestion is worse than silence: an author who takes it writes
`min(object, verb)`. This class therefore narrows locally to at most one edit per
three characters of the longer name, keeping the case that makes suggesting
worthwhile (`isBlnk` → `isBlank`) and refusing the measured hazard (`can` → no
suggestion). Both cases are pinned. The shared `nearestName` budget is unchanged,
so field-name suggestions are unaffected.

Message-only. The refusal fires on exactly the same inputs it did before — no
rule id, severity, match set or gate behaviour changed. Faults in the `type`
class that name no unresolvable call keep the existing trailer: an operator or
ternary mismatch (`1 + 'a'`), and a real function handed arguments no overload
accepts (`upper(1, 2)`, which produces the same cel-js message shape) — calling
`upper` "not a callable name" would replace a useless sentence with a false one.
