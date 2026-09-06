---
"@objectstack/service-automation": patch
---

fix(service-automation): evict a suspension consumed by another replica, so the run listings stop reporting phantoms (#15832)

`AutomationEngine` had exactly one eviction site for its `suspendedRuns`
map, inside `forgetSuspendedRun` — and that runs in whichever process
**consumes** the suspension. In a multi-replica deployment that is routinely
not the process that parked it: replica A parks a run, replica B resumes it,
and nothing ever removes A's entry. There is no invalidation channel from B
to A.

The card that found this located the leak on `resumeInternal`'s
`claim.kind === 'lost'` branch, which returns before that choke point. That
branch does leak, but it is not the common shape: the **no-race** variant
leaks identically — A parks, only B ever resumes, A never attempts a claim
and there is no `'lost'` anywhere in the sequence — so an eviction hung on
`'lost'` alone would have left the ordinary deployment untouched.

The retained snapshot was **not only memory**. Two readers handed it back:
`listSuspendedRuns()` (synchronous, cache-only, and the one listing on the
`AutomationService` spec contract) and `listSuspendedRunsDurable()` (which
deliberately appends map entries the durable list lacks). Once the other
replica **completed** the run, both reported a phantom — a finished run
listed as suspended, whose `getSuspendedScreen()` answers `null`, so a
consumer that listed and then opened got an entry it could not act on.

An entry is now dropped whenever this process holds a store-authoritative,
per-id "no row" answer for it: the strict loader's store miss (which reaches
`resume`, `hasSuspendedRun`, `cancelRun` and `getSuspendedScreen`), a lost
advance claim, and a bounded per-id reconcile for the map-only entries of
`listSuspendedRunsDurable()`.

**Nothing here moves the cache-only listing's contract.** The fix only ever
*removes* entries. The spec says `listSuspendedRuns()` lists "the currently
suspended (paused) runs awaiting a resume"; the engine's own docblock adds
only that it may OMIT runs (those parked in a previous process lifetime),
because it reads the cache alone. Under-reporting is therefore already
inside the declared latitude, and over-reporting was never inside the
promise. Neither listing becomes store-backed, and `listSuspendedRuns()`
stays synchronous.

Three shapes are deliberately **never** evicted, each pinned by a control:
no store attached (the map IS the authority); a run whose durable save
failed (`cacheOnlySuspensions` — the store was never handed the row, so its
silence says nothing about it); and a store read that THROWS (an outage
means the run's existence is unknown, not gone). A failed `list()`
enumeration likewise triggers no per-id reconcile — during an outage that
would ask about every live run in the process.

**Residual, stated rather than implied.** Eviction is demand-driven: a
phantom is cleared when this process next obtains the per-id answer for that
run — any `resume` / `hasSuspendedRun` / `getSuspendedScreen`, or a
`listSuspendedRunsDurable()` reconcile. A process that never looks at the
run again keeps the entry until it does. With no invalidation channel
between replicas, closing that last gap needs either a background sweep or a
store-backed listing, and both are decisions above this change; the boundary
is pinned by a `RESIDUAL` test rather than left to be discovered.

Note 2 of the same card — the `'unsupported'` branch deciding on the shape of
a value the conditional delete has **already** been issued to obtain — is
**not** addressed here: its honest fix is a declared return contract for the
engine's multi-row delete, which lands in another package.
