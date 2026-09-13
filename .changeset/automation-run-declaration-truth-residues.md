---
'@objectstack/service-automation': patch
---

`sys_automation_run.variables_json` states its presence discriminator in ONE direction, and a row-rebuilt snapshot no longer claims its steps are the pause's

Three corrections to text this package ships. No behaviour changes; every shape
described below is the ruled design, measured as it already is.

**`variables_json` said `⇔` where only `⇒` holds.** The field description
declared "present on a completed/failed row" and "the row's run had a pause its
resume consumed before a downstream node failed" to be equivalent. The forward
direction holds — nothing but the consumed-suspension path writes that column on
a terminal row. The reverse does not, for one shape: a run that stranded, was
restored and then finished. `recordTerminal` upserts the SAME `run_<id>` row
with all four snapshot columns explicitly `null` — deliberately, so
"restorable" cannot outlive the condition it describes — which leaves that row
equal, across every column the discriminator is read from, to the row of a run
that never paused at all. Absence means "nothing to restore now", never "this
run never had one", and the restore verb already refuses in exactly those terms:
it names the status it observed and declines to say which. The description now
says so.

**A snapshot rebuilt from a row does not carry the step log as of the pause.**
`deserializeConsumedSuspension`'s docblock said its `steps` are the log "AS OF
THE PAUSE". That is true of the engine's process-local journal copy only, which
slices `run.steps` back to the step count at the pause; the trimmed array is
never persisted. `steps` are the one field the rebuild takes from the row's own
`steps_json`, which is the terminal row's log of the WHOLE run — and both bounds
on that column keep the failure on purpose (history compaction retains every
failure; the byte cap trims the head). A row-rebuilt snapshot therefore carries
steps the pause did not have. It re-arms the same run regardless: the pause is
`nodeId` plus `variables` / `context` / `correlation`, none of which the step log
feeds.

**`recordTerminal` now names the verb that reads what it writes** — the
restore path in `engine.ts` — and the three properties of the write that are
that verb's inputs rather than local detail. Its summary line also said
"completed / failed" where the terminal vocabulary has had four members since
the fold was removed from both ends of this write.

Both falsifying shapes are pinned in `suspended-run-store.test.ts`, including the
indistinguishability itself: the restored-then-finished row and a never-paused
row compare equal across those five columns, with the same comparison separating
them while the snapshot is still there.
