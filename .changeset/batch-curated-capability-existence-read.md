---
'@objectstack/plugin-security': patch
---

Seed the curated platform capabilities with ONE batched existence read, and stop
rewriting rows that already match

`bootstrapSystemCapabilities` built its whole definition set in memory and then
issued a separate `SELECT … WHERE name = ? LIMIT 1` per definition, followed by
an `UPDATE` that fired whether or not `label`/`description` had changed. On a
local file database that loop is invisible; on the remote libsql/Turso database
every hosted environment runs, each leg is its own sequential HTTP request,
competing for the same boot request budget as everything else. On a stock
installation that is 8 reads plus 8 writes, every `kernel:ready`, to store bytes
already there.

The curated half's existence read is now one batched `$in`, and the reconcile is
equality-gated. On a steady-state rebuild the curated half costs **1 round trip**
instead of 16, and the write gate sits after the derived-ownership guard, so it
removes the redundant `UPDATE` from **both** halves.

**The #8470 predicate travels inside the batched query, not applied to its
answer.** The curated half does not ask "is there a row with this name" — it asks
for the platform's own organization-less row (`managed_by: 'platform'` +
`organization_id: null`), and since `sys_capability.name` became unique per
ORGANIZATION those are different questions. Batching the wide question and
filtering afterwards reads every organization's row for every curated name — a
set bounded only by the number of organizations — against a page capped at one
row per name, so the page truncates, and a truncated page reads as "absent",
which inserts. Both harms are pinned as tests rather than argued: without the
predicate the shared name resolves to an organization's row, and two curated
names whose platform rows demonstrably exist come back absent.

**An unreadable database now declines instead of guessing.** Hoisting a read out
of a loop changes what a failure means: per item a failed read fell through to an
insert the unique index refused, for that one name; batched, one failure speaks
for the whole set. `unknown` is therefore never read as "absent" — the affected
definitions are left entirely alone, counted in the new `unreadable`, and warned
once. This also retires a misdiagnosis: an unreadable database used to make this
half attempt an insert per curated name and then report a `blockedCurated`
collision for each, describing a blocking row nobody ever saw.

`CapabilitySeedResult` gains `unchanged` and `unreadable`. Reporting "wrote
nothing because nothing differed" separately from "wrote nothing because the
writes stopped working" is what keeps the round-trip count from being satisfiable
by an implementation that simply stopped reconciling.

**The derived half keeps its per-item read**, and not because it is the smaller
one — it is the half that grows. Its lookup is cross-organization by
construction, and `skippedAuthored` and the `platformStampedInOrg` anomaly signal
are computed from the lowest-id row installation-wide; narrowing it to the
platform bucket answers a different question and would silently reverse part of a
maintainer ruling, while batching it unnarrowed needs an unbounded read. Filed
rather than taken.

No speedup is claimed. The hosted boot-curve rig lives in another repository and
its axes are permission sets / positions / objects, not this one. What is
established here is the round-trip count and the identity of the row each leg
reads and writes, both pinned in-repo.
