---
"@objectstack/cli": patch
---

fix(cli): stop `lowerCallables` deleting the `functions` entries it does not recognise (#7318)

The map branch of the top-level `functions` lowering REBUILT the map instead of
editing it: `out` admitted an entry only in the three shapes it knew — a bare
callable, `{ handler: callable }`, or a plain string ref — and everything else
was dropped. No error, no warning, no key. Two distinct failures came out of
that one line.

**A built artifact could not be lowered again.** The already-lowered declaration
`{ handler: 'syncBilling', effect: 'writes' }` — the shape this very step emits
for a declared writer, and the one `FlowFunctionLoweredDeclarationSchema` was
added to accept in #4976 — matched none of the recognised shapes. A second pass
therefore deleted the key outright, silently un-declaring the writer the first
pass had gone out of its way to keep. Lowering is now idempotent: lower a
lowered stack and the `functions` key set and the declared entries are
unchanged, in both the map and the array spelling.

**A malformed entry was destroyed rather than reported.** The headless husk
`{ effect: 'writes' }` — a declaration for a function that is not there, which
is exactly what a plain `JSON.stringify(stack)` leaves where a declared writer
was (#6293) — reached the lowering and left it as `functions: {}`. The stack
then parsed GREEN, so `objectstack build` wrote an artifact missing the function
instead of refusing, and the evidence had been deleted before the parse could
name it.

Unrecognised entries now ride through under their own key, untouched, and
`FlowFunctionEntrySchema` decides. The husk is refused where the build actually
checks — `invalid_union` on `functions`, with the offending key nameable in the
branch tree, which `formatZodErrors` (#5341) prints in the terminal.

Nothing changes for a stack that was building correctly: bare callables, declared
callables, pre-existing string refs and the array form all lower exactly as
before. A stack that was silently shipping a `functions` map missing an entry now
fails its build, naming `functions` — which is the point.
