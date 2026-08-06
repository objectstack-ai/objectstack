---
"@objectstack/objectql": patch
---

chore(objectql): retire `applyFormulaPlan`'s zero-caller `nowSnapshot` parameter and narrow its docstring to what actually holds (#5699)

`applyFormulaPlan` declared a fourth optional parameter `nowSnapshot?: Date`
whose only effect was `nowSnapshot ?? new Date()`. Not one of its three call
sites ever passed it — `find`, `findOne`, and the write-response hydration
`hydrateWriteFormulas` added by #5504 — so the parameter went down the
`new Date()` branch from birth. Dormant code, removed rather than archived: a
parameter that looks live is worse than no parameter, because everyone
reasoning from it concludes the caller can pin the instant, and one caller
plainly should have.

No behaviour change (the removed branch was unreachable), no public API change
(`applyFormulaPlan` is module-private and never exported).

The docstring claimed the eval context "mirrors `applyFieldDefaults`". Half of
that was true — the same keys, so `formula` and `defaultValue` expressions share
one vocabulary — and half was not: the two pin their own `now`.
`applyFieldDefaults` is handed the insert's pre-write snapshot, while
`applyFormulaPlan` reads the clock once per call, because a formula is evaluated
when a record is materialized. So inside one `insert` a `NOW()` default and a
`now()` formula observe two instants a driver round-trip apart (sub-millisecond
in practice; across a second/day boundary they can land on different calendar
days). The docstring now says so, and names #5699 as where making them share one
instant would have to be argued — it would hand the write path a determinism
guarantee the read path cannot have, which is a semantic decision, not a cleanup.

Adds the pins that the retired parameter's *appearance* was standing in for
(`engine-write-formula-hydration.test.ts`): one snapshot per call shared by every
row × every formula field, asserted by object identity on the eval context so a
per-evaluation `new Date()` fails even when the milliseconds agree, on the write
path and the read path alike; plus a tripwire that the default's instant and the
formula's instant stay independently sourced.
