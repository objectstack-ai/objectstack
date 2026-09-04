---
'@objectstack/spec': minor
---

feat(spec): a row action gets the declarative single-record field write — `operation: 'update'` + `patch` (#14092)

The most common action in any app — set a field on the current record — had no declarative form for a ROW action while the BULK form was fully declarative: a list view's `bulkActionDefs` `{ operation: 'update', patch, visible }` runs on the data plane under the caller's own permissions with hooks and validations firing, and the identical intent on one row had to be a hand-written, system-elevated handler that re-established that authorization by hand. Maintainer ruling 2026-09-01: the row action gets the bulk def's declarative counterpart.

`ActionSchema` now accepts, mirroring the bulk vocabulary word for word and inventing no second spelling:

- `operation: 'update'` — the declarative single-record field write. One member by ruling; `'delete'` and `'custom'` are refused with the reason (a row delete is the object's own affordance; `'custom'` means "dispatch the action this def names", and on a row the action is already the action).
- `patch: Record<string, unknown>` — static field values written to the current record, merged UNDER the values `params` collects (a param of the same name wins). Passed through verbatim.
- The action's existing `params`, `visible`, `confirmText` and `undoable` keys are reused, nothing duplicated; `undoable` now has its anchor — the patch names exactly the fields whose prior values are captured.

Key shape, pinned for contract review: `operation` is a parallel key beside `type`, not a new `ActionType` member. `type` stays at its default `'script'` — the platform action route, which is where the write is performed — and answers WHERE the action dispatches; `operation` answers WHAT the platform does there. Every contradiction is refused at its own path with a prescription: any other explicit `type`, `target`, `body`, `method`, `bodyExtra`, `bodyShape`, `recordIdParam`/`recordIdField`, `onSuccess`, `opensInNewTab`/`newTabUrl` beside `operation: 'update'`; `patch` without it; `operation: 'update'` with neither `patch` nor `params`; a `list_toolbar` location (no current record). `defineStack` refuses a standalone `operation: 'update'` action that names no `objectName` (an object-embedded one is bound by the object it is written on). An inline page-element action cannot carry the keys at all.

Executor contract for the downstream halves (runtime action dispatcher, objectui row-action executor — separate cards; both keys are `planned` in the liveness ledger until they land): a single-record data-plane update of the CURRENT record executed AS THE CALLER and never system-elevated, so the caller's object/row/field permissions, the object's hooks and its validations fire exactly as for a user edit; a caller who cannot read or write the row is refused; `undoable` captures the prior values of exactly the fields written.

Pure widening: nothing that parsed before stops parsing — `operation` and `patch` were unknown keys on this strict shape, and every new refusal is keyed on one of them.
