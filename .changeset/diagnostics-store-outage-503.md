---
"@objectstack/metadata-protocol": patch
---

fix(metadata-protocol): `getMetaDiagnostics` stops publishing an unreadable metadata store as "0 problems" (#8855)

<!-- adr-0087: not-required (no-migration-prescription) One `catch` inside one
method is narrowed from untyped to "rethrow the 503 the producer already
classified". No authorable key is added, renamed, retired or tombstoned, no
stored shape changes, and the response type is byte-identical — so there is
nothing for a conversion entry to convert. -->

`GET /api/v1/meta/diagnostics` sweeps every metadata type and publishes four
numeric facts about the corpus. Its per-type read was wrapped in an **untyped**
`catch` that `continue`d, and the comment above it named a benign reason ("type
not listable in this kernel scope") that is genuinely real. The catch took
everything else with it — including the one error the callee exists to raise.

`getMetaItems` classifies a failed `sys_metadata` read by error **type** and
throws a 503 (`SERVICE_UNAVAILABLE`) for every read failure that is not "the
table has not been provisioned yet" — the discrimination #5532 introduced so an
outage would stop looking like emptiness. `getMetaDiagnostics` caught that 503
back into emptiness one layer up, then published the emptiness as a **number**.

**Measured on `origin/main` @ `8664a2c99` before the fix**, prediction written
down first and matched exactly. With an engine whose every read rejects:

```
[outage: connect ECONNREFUSED 10.0.0.5:5432]     RESOLVED
  total=0  scannedTypes=26  scannedItems=0  Object.keys(stats).length=0
[benign: SQLITE_ERROR: no such table: sys_metadata]  RESOLVED
  total=0  scannedTypes=26  scannedItems=0  Object.keys(stats).length=26
```

Two user-visible harms from one `catch`, and the benign run is what makes them
legible — it is the same payload minus the `stats`:

- `stats[t]` is never written, so an unreadable type is **absent** from the
  response rather than zero. The Studio directory tile the field's own doc names
  loses the type, byte-shaped like an environment that declares none of it.
- `total` counts entries that **failed validation**, and a store nobody can read
  contributes none — so the endpoint whose whole job is reporting problems
  answered `total: 0` at the exact moment it could read nothing. Green was the
  failure mode.

`scannedTypes` reported the full 26 in both runs: it is computed from the intent
(`targetTypes.length`, fixed before the loop) and never decremented on
`continue`.

**The fix narrows the catch; it does not delete it.** A 503 arriving from the
read is rethrown **unchanged** and the sweep fails loudly (ADR-0110 D3: a miss
and an outage are different facts with opposite dispositions). Every other
failure still skips that one type, so a kernel scope that cannot enumerate one
type does not fail the whole governance sweep.

**No response field was added.** A per-type degradation marker would be a
public-surface addition, and the payload type is unchanged.

The envelope is **propagated, not rebuilt**: re-running the driver-error
classification here would re-wrap an already-shaped 503 in a second one and
displace the driver error riding as `cause` — the object `logWithheldServerFault`
prints for the operator. The REST boundary needs no change: the handler already
routes thrown errors through `handleRouteError`, which preserves the 503.

The pin carries the discriminating control in the same file: an unprovisioned
`sys_metadata` still answers benignly with every type present at `count: 0`, a
type that is genuinely not listable is still skipped at the cost of one type,
and a healthy store still counts its rows — while the outage cases throw. "0
problems" is the right answer in the benign cell, and it is exactly the answer a
blanket change would have kept producing in the wrong one.
