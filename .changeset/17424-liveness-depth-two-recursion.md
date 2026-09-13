---
'@objectstack/spec': patch
---

The liveness ledger's published README no longer declares a one-level drill — the walk follows a nested `children` map as deep as the ledger declares, and says so

`check-liveness.mts` read `led.children[ck]` and never recursed into a child's
own `children`. A `children` map written at **depth two** was therefore accepted
by the file format and then ignored in silence: no evidence path resolved, no
key reported unclassified, no container reconcile, and no line of output saying
any of it was missing. Because the enforce-or-remove channel acts on this gate's
`dead` verdicts, a silently skipped subtree could retire a key that was alive.

The walk now descends as far as the ledger nests, the reverse (orphan) direction
follows it down, and a drilled child that is itself a container owes the same
declared disposition — drilled, deferred or recorded — that its top-level peers
already owed. `MAX_DRILL_DEPTH` is a tripwire rather than the working limit:
every key below it is reported **UNCLASSIFIED**, which fails the gate, because a
depth limit the instrument does not announce would rebuild the same defect one
level lower.

**No verdict moved.** Before and after: live 850, planned 10, dead 93,
experimental 5, live-elsewhere 1 — the full per-type `byStatus` map is
byte-identical. Nothing flipped to or from `dead`, so no retirement is in
question. What did move is the census the gate publishes about its own
completeness: 54 containers became visible at once, every one of them already
riding on a blanket verdict below a drilled container where a one-level walk
could not see it. Three are genuinely classified elsewhere (`app/navigation`'s
NavigationItem keys) and resolve as deferrals; the other 51 are recorded debt.

**Why this carries a changeset rather than `skip-changeset`.** The tool, its
tests and its baseline all live under `packages/spec/scripts/`, which is absent
from the package's published `files[]` — measured at 0 entries in the packed
tarball, against `liveness/` ships at 38 as the lit positive control. But
`files[]` ships the `liveness` directory whole, and `liveness/README.md` is the
ledger's authoring contract: its "Granularity — drill one level" section is what
an author reads before writing a `children` map, and that sentence is now wrong.
The published bytes that change are that section, the depth rule that replaces
it, and the re-stated census. No ledger verdict file changed.
