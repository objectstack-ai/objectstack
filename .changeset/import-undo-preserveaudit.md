---
"@objectstack/rest": patch
---

fix(rest): undo of a historical import now preserves the audit timeline (#3549)

A `treatAsHistorical` import writes with `preserveAudit` (#3493), keeping the
original `updated_at`/`updated_by` and business `readonly` fields instead of
stamping-now / stripping them. Its undo route, however, restored the captured
pre-import snapshot with a plain write context — so the audit auto-stamp
re-wrote `updated_at`/`updated_by` to "now", silently corrupting the very
timeline the historical import had preserved.

The undo write context now mirrors the import's own: it carries
`preserveAudit` iff the job row is flagged `treat_as_historical`, so restoring
`u.before` re-writes the snapshotted audit/timestamp values verbatim. A normal
import's undo is unchanged (default stamp/strip).
