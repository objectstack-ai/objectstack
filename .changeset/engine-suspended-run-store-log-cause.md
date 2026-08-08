---
"@objectstack/service-automation": patch
---

fix(service-automation): the last three `engine.ts` seams stop splicing a driver's failure into the log message, and two of them are re-graded `error` (#6299)

All three catches sit around the `SuspendedRunStore` driver and rendered their
failure by interpolating the thrown value's `.message` into the log MESSAGE.
`ObjectLogger.write()` adds exactly one `<ts> <LEVEL>` head per call, so a
driver error carrying newlines turned ONE record into several physical lines of
which only the first was greppable — and on the `warn` path, inside `serve`'s
boot-quiet window, `BootLogCapture.offer()` keeps only lines with a level head,
so the continuation lines were dropped outright. Measured on the restored
concatenation: a three-line driver error became 3 physical lines and the boot
filter retained 1, and that one carried no driver fact. The cause now goes to
the logger's structured slot (`describeThrownForLog`), so the record stays on
one physical line in every format. This closes the family of #5048 / #5575 /
#5636 / #5661 / #5737 / #5912 / #6230 for this file.

The level was judged per seam (#4632), not batch-copied from #6230:

- **`forgetSuspendedRun` → raised to `error`.** The hot cache is dropped before
  the store delete and this is the single choke point every consumption of a
  suspension passes through, so a failed `delete` leaves the suspension gone
  in-process and the durable row alive. Callers still report success, and the
  surviving row is re-listed and re-resumed after the next restart, running a
  continuation that already ran.
- **`cancelRun` → raised to `error`.** An unreadable store makes the failed read
  read as "no such suspended run", so the method returns `false` — which its
  contract calls idempotent success — and the cancellation is silently skipped
  while the call reads clean. The run stays parked and durably resumable.
- **`listSuspendedRunsDurable` → stays `warn`.** Nothing claimed-persisted
  failed to land: the rows are intact and still resumable by id. The listing
  degrades to the in-memory cache alone, so the message now says out loud that
  the result is short and that the caller cannot tell.

Operator-visible: two records move from stdout to stderr and from `WARN` to
`ERROR`, and all three messages are reworded to state their consequence. Log
filters or alert rules keyed on the old `warn`-level text for a failed
suspended-run delete or cancel need updating.
