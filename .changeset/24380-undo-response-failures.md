---
'@objectstack/spec': minor
---

Clause-②: yes (widening)

`UndoImportJobResponseSchema` gains `failures`: one `{ id, action, code, error }` entry per row an import undo did not revert, `action` being `delete` or `restore`. The `success` describe now says it is `false` when any row is listed there, and `failed` counts those entries. `revertedAt` on `ImportJobProgressSchema` and `ImportJobSummarySchema` now says it is set only once every row of the job is reverted; an undo that left rows unreverted sets nothing, and the job stays undoable for them.

The `skipAutomations` describe on the hook context's `session` no longer names the import undo as a case that skips an app's controls for any caller. It names the system principal's import and undo, and says the import undo door is not an exception: only the system principal may take an app's declared controls off a write, and any other caller's undo runs under the object's hooks, record-change triggers and state machine. The `ExecutionContext` docs for `skipAutomations` and `skipStateMachine` say the same.
