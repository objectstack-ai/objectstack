---
"@objectstack/core": patch
---

fix(core): `successThreshold` now binds from every status that records a failure, so a declared count above 2 stops being unreachable (#11955)

`PluginHealthMonitor` consulted `successThreshold` only while a plugin's status
was `unhealthy` or `degraded`. The first success in a recovery wrote
`recovering` — a status that gate did not name — so the **second** success took
the outer `else` and went straight to `healthy` without the counter being read
at all. `failed` was in neither set either, so a plugin whose check threw
recovered on its **first** success.

The declared value was therefore capped in practice:

| Status when the successes start | Consecutive successes actually required |
| :--- | :--- |
| `unhealthy` / `degraded` | 2, whatever `successThreshold` said |
| `failed` / `recovering` | 1, whatever `successThreshold` said |

A declared `successThreshold: 5` was indistinguishable from `2`. The default is
`1`, which is exactly the value at which the defect is invisible — every
declared value above it was the one that misbehaved.

The counter is now consulted on the way out of every status that records an
observed failure — `degraded`, `unhealthy`, `failed` and `recovering` — so
`successThreshold: N` requires N consecutive successes from each of them, as
its declaration says ("Consecutive successes needed to mark healthy"). The gate
is a map that is exhaustive over `PluginHealthStatus`, so a status added to the
spec fails to compile until it is placed on one side or the other; that is what
`recovering` slipped through before.

`healthy` and `unknown` still promote on the first success, deliberately: the
count is declared as a **recovery** criterion ("Number of consecutive successes
to recover from unhealthy state") and neither of those records a failure to
recover from — `unknown` is the status `registerPlugin` writes before any check
has run.

**Behaviour change, only for configs that declare `successThreshold` above 1.**
At the default `1` every route is byte-for-byte what it was: one success has
always been enough and still is. A plugin declaring a higher count now takes
the number of consecutive successes it asked for before it is reported
`healthy`, including after a `failed` round and after an `autoRestart`.

This also makes #11852's `successCounters` reset load-bearing. That fix cleared
the counter on the thrown failure route, and could not be pinned: the counter's
only read site was unreachable with a stale non-zero value, so any test would
have passed for the wrong reason. With `failed` gated on the counter, a throw
that interrupts a recovery now demonstrably starts the count over.
