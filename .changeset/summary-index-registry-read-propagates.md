---
"@objectstack/objectql": patch
---

fix(objectql): the roll-up summary index's registry read propagates, and a failed read is never cached as an empty index (#9154)

`ObjectQL.buildSummaryIndex()` opened with

```ts
try { objects = (this._registry as any).getAllObjects?.() ?? []; } catch { objects = []; }
```

and `ensureSummaryIndexes()` MEMOIZES what that build returns, stamped with the
registry's current `objectRevision`. So a read that could not run was answered
with an invented *"no object declares a roll-up"* — and then remembered as if it
had been measured. `recomputeSummaries()` consults that index after every insert,
update and delete to decide which parent roll-ups a child write must recompute,
so an empty index means no roll-up is ever recomputed: every parent summary field
keeps a stale value, nothing is logged, and every write reports success.

Two changes, because the cache is the half that made this worse than the
identical seams fixed in #9002:

- **The read propagates.** Same family as #8895 (*discriminate or propagate*) and
  #9002, same reasoning: discrimination needs a benign failure class and there is
  none — an unreadable registry is never truthfully "no roll-ups". Both halves of
  the swallow are gone, the `catch` and the optional call `?.()`, which absorbed a
  registry that does not implement `getAllObjects` at all — the structural
  omission that never throws and is therefore invisible.
- **A failed build leaves no cache entry.** `objectRevision` moves only on a
  metadata mutation (`registerObject`, `unregisterObject`,
  `unregisterObjectsByPackage`, `removeObjectOverlay`, `invalidate`,
  `invalidateAll`, `reset`) and never on a data write, so the invented emptiness
  outlived the condition that caused it — a steady-state deployment performs none
  of those, leaving every parent roll-up frozen until a restart or an unrelated
  publish. The build now runs to completion into a local before anything is
  published to the instance, the revision stamp is written last, and a throw
  clears any cached index and resets the stamp before rethrowing unchanged: the
  next call rebuilds. *A poisoned cache entry must not survive the read that
  poisoned it.*

**No shipped behaviour changes.** `SchemaRegistry.getAllObjects()` is a walk over
in-memory `Map`s calling `resolveObject()` — which returns `undefined` on every
failure branch it models — over a fold that is spreads and comparisons. No I/O,
no driver, no `throw` on the measured path, re-derived on today's tree. This is a
structural close of a fail-open shape, pinned by tests, so that the day the
registry read grows a throwing path it fails loudly instead of silently freezing
every roll-up in the deployment.
