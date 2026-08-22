---
"@objectstack/metadata-protocol": patch
---

`backfillSeedTenancy` no longer reports `no-split` over a driver it never queried
(#10789). The boot-time seed/API tenancy repair answered `status: 'no-split'` —
*"I looked, there is no split"* — on the memory driver, having looked at nothing,
and its own `absent` branch was unreachable there despite the branch's comment
saying *"Absent on a memory engine"*.

`InMemoryDriver.execute()` logs `Raw execution not supported in InMemory driver`
and returns `null`. It neither throws nor is absent, so `resolveSeedTenancySeam`'s
shape test (`typeof d.execute === 'function'`) was satisfied and the `no-driver`
guard never fired; `normalizeRows(null)` is `[]`, which is also what a real driver
returns for a SELECT that matched nothing. Every branch of this migration reads
"no rows" as "healthy install, nothing to do", so the two collapsed into one
answer.

The migration now separates the cases the guard used to conflate: **a seam that
cannot answer is absent, not empty.** Its READ probes are held to the standard
that actually distinguishes them — a driver that answers returns a RESULT SET —
so a probe that hands back no result set reports `absent` (with a `detail` naming
the reason) instead of being read as zero rows. Nothing names a driver: any host
with the same no-op shape is covered without an allowlist to maintain. This is the
consumer-side shape #10677 / PR #10788 landed for `os migrate duplicates`, applied
to this module's own probes. No driver package was modified.

Three behaviours are deliberately unchanged:

- **A real SQL install does not move.** An empty result set is an ANSWER in every
  dialect spelling — a bare `[]`, `{ rows: [] }`, and the `[rows, fields]` tuple —
  so a healthy install still reports `no-split`. The counter-table presence probe
  is a `WHERE 1 = 0` SELECT that matches nothing by construction and runs on every
  boot, which is exactly why "no rows" must stay distinct from "no answer".
- **Write statements are not held to "must answer".** An UPDATE or DELETE does not
  return a result set on every dialect, so the repair's stamp and counter-merge
  statements stay on the bare seam.
- **A seam that THROWS keeps its behaviour.** Throwing is a driver present and
  refusing loudly, and step 1's `catch` already reported it as `absent`; only a
  seam that RETURNS a non-answer was invisible.

Boot-time behaviour is otherwise untouched: neither status logs anything, and
neither writes a ledger receipt, so a memory-driver boot logs exactly what it
logged before. What changes is the reported `status`, which is the value a caller
uses to tell "nothing to repair" from "could not look".
