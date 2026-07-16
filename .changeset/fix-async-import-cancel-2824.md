---
'@objectstack/rest': patch
---

fix(import): make async import-job cancellation actually stop the worker (#2824)

Cancelling a running async import used to have no effect on a synchronous
storage driver (better-sqlite3 / wasm fallback): every `await` in the row
loop resolved as a microtask, so a 50k-row import monopolized the Node event
loop for minutes — the cancel route's HTTP handler (and every progress poll)
could never run, so the in-memory flag `shouldCancel` polls was never set.
The job then finished `succeeded` with all rows written despite the user's
cancel.

Three-part fix:

- **`runImport` yields one macrotask at every progress boundary** (every
  `progressEvery` rows), so pending I/O — the cancel request, progress
  polls, any other traffic — gets serviced during a large import. This is
  the root-cause fix; it also unblocks progress polling for the wizard.
- **The worker's `shouldCancel` now also reads the durable job row** as a
  fallback: a cancel accepted by another process (or after a restart
  dropped the in-memory flag) still stops the worker.
- **A late cancel wins the terminal state**: the worker's final patch no
  longer overwrites the cancel route's durable `cancelled` with
  `succeeded`, and a job cancelled while still `pending` doesn't start at
  all. Counts stay truthful — they reflect what was actually written.
