---
"@objectstack/spec": patch
"@objectstack/objectql": patch
---

Correct the `HookContext.input` contract table on `input.options`: during
`before*` the slot holds the CALLER's engine options bag (`where` and `multi`
included), not `DriverOptions` — the engine merges the driver-facing keys onto
it only after the handlers return. The table's two `before` rows said
`DriverOptions`, a type that declares neither key, which reads as "a hook can
see no predicate at all"; the composed `ast` is what hooks cannot reach, while
the caller's raw predicate is right there and is an upper-bound approximation of
the row set (middleware only narrows) — the safe direction for the fail-closed
guards built on it. Pinned with a positive assertion in
`hook-input-shape-contract.test.ts`.
