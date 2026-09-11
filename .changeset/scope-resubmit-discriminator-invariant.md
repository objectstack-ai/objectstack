---
'@objectstack/plugin-approvals': patch
---

Correct the `resolveRecordedContinuation` discriminator's stated invariant in
`approval-service.ts` to what was measured. The comment claimed the
`action: 'resubmit'` audit row was "at most one per request"; a `resubmit` whose
own resume strands opens no next round, so the row stays `returned` and a second
`resubmit` after `restoreConsumedSuspension` lands a second such row. The
comment now records that more than one row can exist, states why the read is
correct anyway (it is a presence check with `limit: 1`, deciding identically on
one row or two), and points at the pin that measured it.

Prose only — no behaviour change, no door narrowed, no guard touched. The audit
trail's one-row-per-advancement shape is accepted residue; requiring one row per
advancement is a separate change.
