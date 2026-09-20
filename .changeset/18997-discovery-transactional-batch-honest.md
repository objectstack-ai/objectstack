---
"@objectstack/metadata-protocol": patch
---

`/discovery` advertises `capabilities.transactionalBatch` from the predicate the atomic-batch refusal already trusts, so the advertisement and the 501 stop disagreeing (#18997).

`getDiscovery()` derived the bit from the ENGINE alone — `typeof this.engine?.transaction === 'function'` — while `runAtomicBatch` refuses `batchData({ atomic: true })` with `501 NOT_IMPLEMENTED` on `engineCanRollBack(engine)`, which asks the DEFAULT DRIVER as well. `engine.transaction` is a function on every real engine, so the advertisement answered `true` for compositions that then 501 — and the 501's own remedy text sends the caller to that very bit ("probe `capabilities.transactionalBatch` on /discovery first"). The prescribed remedy routed the caller to a signal that was wrong in exactly the case the remedy exists for.

**What a consumer sees.** Two compositions, measured separately, stop advertising `true` and now advertise `false`:

- **(a) a default driver with no `beginTransaction` at all** — pre-existing, not introduced by #18063;
- **(b) a default driver that inherits `beginTransaction` and declares `supports.transactionsUnsupported`** — the population #18063 added; the shipped example is `TursoDriver` on its remote transport.

Both already answered `501 NOT_IMPLEMENTED` to an atomic batch, so nothing that was accepted becomes refused. A client that read `true` and proceeded was taking the 501; it now reads `false` and takes its non-atomic fallback ahead of the failure — which is what probing the capability was for. A client that hard-asserts `transactionalBatch === true` at startup against such a composition fails at startup instead of at the first atomic batch.

Unchanged in the other direction, and pinned so that "honest" cannot decay into "always `false`": a composition whose default driver **can** roll back still advertises `true`, and so does a host whose driver registry is not inspectable (test doubles, metadata-only hosts), where the engine-level probe is all there is. Measured over all 16 compositions of the four inputs the two predicates read: 0 go `false` → `true`, 3 go `true` → `false`.
