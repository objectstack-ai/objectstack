---
'@objectstack/core': patch
---

fix(core): a hook that aborts with free text answers `HOOK_ABORTED` on the import row too, not `IMPORT_ROW_FAILED`

Clause-②: no
Metadata-protocol: none

- **Before.** A sandboxed hook body that aborts with free text (`throw new Error('…')`, no `code`) answers `/api/v1/data/:object`, `/createMany`, `/api/v1/batch` and every `POST /api/v1/data/:object/batch` row with `HOOK_ABORTED` and the hook's sentence. `POST /api/v1/data/:object/import` and the async import job answered the same abort as a row `{ ok: false, code: 'IMPORT_ROW_FAILED', error: <sentence> }`, so an import client branching on the row's `code` could not tell a business rule's refusal from any other failed row.
- **Now.** The import row answers `HOOK_ABORTED` (the `UNDECLARED_HOOK_REFUSAL_CODE` the other doors read), judged by `resolveThrownHttpError`, the resolver that declares that code. The value moves, from `IMPORT_ROW_FAILED` to `HOOK_ABORTED`, on every row the core import runner builds from a write failure: the synchronous import, the async import job's stored results, the create and update halves of an upsert, and every write path (single-row, batched, partial-success).
- **Unchanged.** A code the hook declared still wins, registered or not. The row's `error` is still the hook's sentence. A body that crashed, a refusal that declared a 5xx status, a driver fault and every other row failure keep the code they had. The row's `code` is an open string in `ImportRowResultSchema`, so no schema moves, and no error code is added: `HOOK_ABORTED` is the one the ledger already registers.
