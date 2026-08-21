---
"@objectstack/objectql": patch
---

The Archiver resolves its window through ADR-0057 P4 governance (#10528).
`LifecycleService.archiveObject` read `archive.after` — and, since #10347,
`ttl.expireAfter` — straight off the declaration, so for any object declaring
`lifecycle.archive` an operator's settings override was silently ignored, a
registered `LifecycleRetentionFloor` was never evaluated, and per-tenant windows
did not apply.

This was not a forgotten call. `reapObject` **returns** into `archiveObject` for
any object declaring `archive`, so the three `effectiveWindowMs` resolutions on
the reap path sat on a branch archive-declaring objects skip entirely — which is
why the divergence was total rather than partial, and why threading an override
into the cutoff alone would still have left floors and tenant windows unreached.

All three legs now run, through the same resolver the Reaper uses:

- a per-object `retention_overrides` entry beats the declaration, on the key that
  matches which window the selection picked — `expireAfter` for a ttl-selected
  archive, `maxAge` for an age-selected one;
- an override below a registered floor is rejected (the declared window stands),
  logged at `error` naming the registrar, consequence and fix, and recorded in
  `report.floorViolations` — the leg whose absence was *silent*, since an empty
  `floorViolations` is indistinguishable from a healthy sweep. A *declared*
  archive window below a floor is reported the same way and still enforced;
- tenant-scoped windows issue one candidate read per overriding tenant, then one
  global pass covering everyone else including NULL-org rows — the shape `reap()`
  already used, with tenant overrides going through the same floor.

Unchanged on purpose: #10347's cutoff **selection** (a declared `ttl` still
decides which rows move, on `ttl.field`); the retain-first posture (no archive
datasource ⇒ `archive-pending`, hot-delete only what the cold store took); the
per-batch abort checks, now the first act of every pass; and the cold-side
`archive.keep` prune, which bounds the archive rather than the hot store and has
no settings key. An object with no override and no floor sweeps exactly as
before, as one pass over exactly the predicate it ran before.
