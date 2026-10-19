---
'@objectstack/spec': minor
---

fix(spec)!: `UndoImportJobResponseSchema` requires `failures`, one entry per row an import undo did not revert, and the `skipAutomations` describe names no import-undo exception

Clause-②: yes (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) No authored key and no stored shape moves: `failures` is a key on the import undo's HTTP answer, which the server builds and no author writes or stores; the job row keeps its columns, its undo log stays the engine-owned json column it was, and the other edits are describes and TSDoc. No spec key, export or error code is removed or renamed, so there is nothing for `objectstack migrate meta` to rewrite. -->

**BREAKING** (`UndoImportJobResponseSchema` accepts fewer answers: `failures` is required, so a response parsed with the schema is refused without it, and code that constructs an `UndoImportJobResponse` must set it, `[]` on a full revert; readers of `client.data.undoImportJob` are unchanged and gain the key), shipped as `minor` under the launch-window convention for breaking changes.

`UndoImportJobResponseSchema` gains a required `failures`: one `{ id, action, code, error }` entry per row an import undo did not revert, `action` being `delete` or `restore`, and an empty array when every row was reverted. It is required rather than optional so a server that does not report its unreverted rows is off-contract instead of silently spec-valid. The `success` describe now says it is `false` when any row is listed there, and `failed` counts those entries. `revertedAt` on `ImportJobProgressSchema` and `ImportJobSummarySchema` now says it is set only once every row of the job is reverted; an undo that left rows unreverted sets nothing, and the job stays undoable for them.

The `skipAutomations` describe on the hook context's `session` no longer names the import undo as a case that skips an app's controls for any caller. It names the system principal's import and undo, and says the import undo door is not an exception: only the system principal may take an app's declared controls off a write, and any other caller's undo runs under the object's hooks, record-change triggers and state machine. The `ExecutionContext` TSDoc for `skipAutomations` says the import runner sets it from its caller's `runAutomations: false`, which the import doors admit over HTTP from the system principal alone while an in-process caller of the runner passes its own setting, and that the import undo sets it only when the system principal undoes a job; the `skipStateMachine` TSDoc says the same of the undo.
