---
'@objectstack/driver-sql': minor
---

fix(driver-sql): the varchar differ now expects what `createColumn` would actually emit, instead of a different rule (#12732)

The managed-schema drift differ's varchar-length branch expected
`varchar(field.maxLength)` for any bounded field, over a **pre-existing**
column dialect `postgres`/`mysql` enforce. `SqlDriver.createColumn` does not
build that for every bounded field — and disagreed with the differ in two
measured directions:

**An already-serving deployment stopped booting.** An UNKEYED, bounded
text-family field (`text` / `richtext` / `signature` / `markdown` / …)
reported `narrow_varchar` at severity `error`, category `destructive` — the
one category `runArtifactBootMigrationGate` refuses a boot for — demanding
the column be narrowed to a shape `createColumn` would never build: unkeyed,
it leaves the column TEXT (`keyableTextLength` returns `null` unkeyed). The
trigger was an ordinary, correct-looking edit: adding `maxLength: 50` to a
legacy `varchar(255)` text column. The divergence changed no behaviour at
all — the write seam already enforces the declared bound — so the refusal
was over nothing.

**A `safe`, dev-auto-reconcilable finding planned DDL MySQL refuses
outright.** A base string-family field (`email` / `url` / `password` / …)
bounded past `SqlDriver.MAX_VARCHAR_CHARS` (16383) reported `widen_varchar`
at `warning`/`safe`, planning `ALTER … varchar(100000)` — `ERROR 1074 Column
length too big` on MySQL, while Postgres accepted it: the dialect-divergent
enforcement this package's conformance matrices exist to close.
`declaredVarcharLength` returns `null` above the ceiling for the same reason
`createColumn` never emits that DDL.

This guard had already been patched at the call site three times for the
same defect class (#11431 for `multiple: true`; #11794/#11875 for genuine
TEXT columns) — each time by adding one more condition. This is that defect
arriving a fourth time, through a column spelled `varchar` because an older
release created it. Rather than a fourth patch, the branch now asks
`SqlDriver.varcharColumnChars(field, keyed)` — the emitter's own read-only
mirror of `createColumn`'s switch, already pinned against `columnInfo()` for
every `FieldType` — what width `createColumn` would actually build. `null`
means "the emitter would not make this a varchar," and the branch does not
fire. Keyedness (`indexedKeyColumns()`, #11374) is threaded from
`SqlDriver.detectTableDrift` into `diffManagedTable`, since a KEYED bounded
text-family field legitimately takes `varchar(maxLength)` — the fix
suppresses the false positive, not the branch itself; a keyed field over the
same shape still reports.

Graded `minor` rather than `patch`, mirroring the sibling drift-op change for
#12121 in the opposite direction: an already-serving deployment that
currently fails to boot over Case A will boot after this upgrade, and a
`widen_varchar` currently eligible for dev auto-reconcile over Case B will no
longer be planned — both are user-visible behaviour changes for an existing
deployment (`os migrate plan`, `os migrate apply`'s counts, the boot-time
`[schema-drift]` warn), not merely an internal correctness detail. `diffManagedTable`'s exported args object gains two **optional** parameters
(`keyedColumns`, `varcharColumnChars`); omitting either keeps the pre-#12732
behaviour unconditionally; this is additive to the object type and — unlike
#12121's `DriftOp` union member — does not add a case any consumer's
exhaustive switch must handle, so it is not itself a reason to grade higher
than `minor`. Nothing is removed, renamed, or newly rejected, so this is not
a breaking change. The category question (whether Case A's `destructive`
should become a report) is deliberately **not** addressed here: the fix
makes the false-positive stop firing entirely, so there is nothing left to
downgrade, and downgrading it as a separate act would be gate-weakening the
triage seat did not authorise.
