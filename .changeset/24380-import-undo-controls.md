---
'@objectstack/rest': minor
---

fix(rest)!: an import undo runs under the object's hooks, record-change triggers and state machine for every caller but the system principal, and reports each row a control refuses instead of counting it as reverted

Clause-②: yes (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) Nothing an author writes, and no stored shape an author owns, is added, removed, renamed or converted: the change is which controls the undo route's reversal writes run under, plus one key added to the route's answer. No spec key, export or error code is removed or renamed, and the job row's columns are unchanged (its undo log stays the engine-owned json column it was), so there is nothing for `objectstack migrate meta` to rewrite. The remedy is a run-time one, stated below. -->

**BREAKING** (the import undo door takes fewer controls off its writes, and claims less: `POST /api/v1/data/import/jobs/:jobId/undo` keeps `skipAutomations` and `skipStateMachine` on its reversal writes for the system principal alone, so every other caller's undo, administrators included, runs under the object's metadata-bound hooks, record-change triggers and `state_machine` rule; and an undo that leaves any row unreverted now answers `success: false` and leaves the job unstamped, where it answered `success: true` and stamped it reverted), shipped as `minor` under the launch-window convention for breaking changes. The cost is named, not hidden: undoing an ordinary import may fire record-change automation again (a notification, an approval re-opening on a restored amount), which is the app's declared behaviour for those writes. If a row now stays unreverted, read its entry in `failures`, resolve what refuses it on the app (complete the approval, reopen the record) and undo the job again, which retries only the rows that remain; a reversal that must skip the controls runs in-process as the system principal.

The same rule now holds at every import door: only the system principal may take an app's declared controls off a write. The import doors already refused a caller-chosen opt-out from everyone else; the undo door chose its skips itself, for every caller, and no longer does.

**What changes.** The undo's deletes (of the records the job created) and restores (of the fields it updated) are written as `ExecutionContext.isSystem` decides: the system principal keeps `skipAutomations` and `skipStateMachine`; every other caller writes with neither. A reversal that a hook, the state machine, a record lock or anything else refuses is caught for its row and never swallowed:

- the answer lists it in a new `failures` array, one `{ id, action, code, error }` per row, where `action` is `delete` or `restore` and `code` / `error` are what the single-record write door answers the same error with (a hook's refusal reads in the hook's own sentence); `failed` is its length and `success` is `false`;
- the job's stored undo log is rewritten to exactly the unreverted rows, each refusal beside them under `failures`, and `reverted_at` is not stamped. The job stays `undoable`, and undoing it again retries only those rows, never one already reverted. `reverted_at` (`revertedAt` on the job's progress and history) now means every row was reverted.

**What stays as it was.** An undo that no control refuses reverts every row and answers as before, with `failures: []`. A historical job (`treatAsHistorical`) keeps `preserveAudit` on its undo for every caller. The job-row write that records the outcome stays engine-owned (ADR-0103). The 404, 409 `ALREADY_REVERTED` and 422 `NOT_UNDOABLE` answers are unchanged, and the import doors and their opt-out gate are untouched.
