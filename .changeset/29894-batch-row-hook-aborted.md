---
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol): a hook that aborts with free text answers `HOOK_ABORTED` on the per-object batch row too, not `VALIDATION_ERROR`

Clause-②: no
Metadata-protocol: none

- **Before.** Since #27597 (and #27672) a sandboxed hook body that aborts with free text (`throw new Error('…')`, no `code`) answers `/api/v1/data/:object`, `/createMany` and `/api/v1/batch` with `400 HOOK_ABORTED` and the hook's sentence. `POST /api/v1/data/:object/batch` answered the same abort as a row `{ code: 'VALIDATION_ERROR', message: <sentence> }`: the row mapper (`toRowApiError`) derived the code from the `400` the doors serve, so a bulk client branching on the code read a business refusal as malformed input.
- **Now.** The row answers `HOOK_ABORTED` (the `UNDECLARED_HOOK_REFUSAL_CODE` the other doors read). The value moves, from `VALIDATION_ERROR` to `HOOK_ABORTED`, on every row that shares the mapper: `POST /api/v1/data/:object/batch` with `operation` `create`, `update`, `upsert` or `delete`, in every mode (plain, `atomic`, `continueOnError`), and the per-row results of `updateManyData` / `deleteManyData`.
- **Unchanged.** A code the hook declared still wins (a registered code is its own row code; an unregistered one still gets the code its status derives). The row's `message` is still the hook's sentence and `httpStatus` is still absent when the body declared no status. A crashed body and a non-sandbox producer answer as before. No error code is added; `HOOK_ABORTED` is the one #27597 registered.
