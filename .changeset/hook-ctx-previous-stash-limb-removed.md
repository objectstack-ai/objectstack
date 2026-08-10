---
'@objectstack/trigger-record-change': patch
---

record-change trigger: drop the `ctx.__previous` stash fallback — read the engine's declared `ctx.previous` only

Behaviour is unchanged: the limb guarded against a producer that no longer
exists. `plugin-audit`'s `captureBefore` was the **only** writer of
`ctx.__previous` in the repo, and #6656 retired it, so `buildContext`'s

```ts
ctx.previous ?? (ctx as { __previous? }).__previous
```

had a second operand nothing could ever bind. The engine is the single producer
of the pre-image and it binds the declared key ahead of every dispatch — by-id
update (`engine.ts:7010`, immediately before the `beforeUpdate` dispatch at
`:7012`), by-id delete (`bindPreImage`, `engine.ts:7869`, called at `:7897`
before the `beforeDelete` dispatch at `:7899`), and each per-row context of a
predicate write (`engine.ts:1746` after-phase, `:1825` before-phase) —
#5272 / #5574 / #5846.

Removed rather than kept "for safety", under ADR-0049 enforce-or-remove and
PD #12: a fallback with zero producers is a second de-facto contract waiting to
be rediscovered. The consequence is deliberate and stated here rather than left
to be found — **a future producer of `ctx.__previous` is now silently ignored**;
the declared way to hand this consumer a pre-image is `ctx.previous`.

The test that fed the limb synthesised `__previous` in its own body, which is
what kept the dead limb looking live (#4984). It is replaced by the inverted pin
the deletion actually needs — the same treatment the `doc` alias got in #5671 —
so restoring the limb goes red instead of unnoticed.
