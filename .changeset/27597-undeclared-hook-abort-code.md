---
'@objectstack/spec': patch
'@objectstack/types': patch
'@objectstack/rest': patch
---

fix(rest): a hook that aborts with free text answers the data door with `HOOK_ABORTED` instead of no `code`

Clause-②: yes (widening)
Metadata-protocol: none

- **Before.** A sandboxed hook body that aborted a write with free text (`throw new Error('…')`, no `code`, no `refusals` catalogue) answered `/api/v1/data` with `400 {"error":"…","object":"…"}` and no `code`, the one refusal on that door a client could not branch on.
- **Now.** The same abort answers `400 {"error":"…","code":"HOOK_ABORTED","object":"…"}`; a body that declared a 4xx `status` (or `statusCode`) keeps that status and gains the same code. `HOOK_ABORTED` is registered in the ADR-0112 ledger under `@objectstack/types` (`@objectstack/spec`), stamped by `mapDataError`'s sandbox unwrap door and its wrapper fallback (`@objectstack/types`, exported as `UNDECLARED_HOOK_REFUSAL_CODE`) and by the route door's declared-status passthrough (`@objectstack/rest`).
- **Moved.** The same undeclared abort also changes value on doors that already carried a code, from the status-derived `VALIDATION_ERROR` to `HOOK_ABORTED`: the nested refusal envelopes of the sharing rules routes (`POST /api/v1/sharing/rules`, `DELETE /api/v1/sharing/rules/:idOrName`, `POST /api/v1/sharing/rules/:idOrName/evaluate`), the security suggested-bindings routes (`POST /api/v1/security/suggested-bindings/:id/confirm`, `…/dismiss`, `…/reopen`), the approvals request routes (`POST /api/v1/approvals/requests/:id/approve`, `…/reject`, `…/recall`, `…/reassign`, `…/comment`, `…/remind`, `…/request-info`, `…/resubmit`, `…/revise`), and each row of the `failures` list that `POST /api/v1/data/import/jobs/:jobId/undo` returns.
- **Unchanged.** A refusal that declared a code keeps it: a `refusals` catalogue entry still answers `declaredCode` beside the status-derived `code`, and a registered code a body throws is still its own wire `code`. A non-hook producer that declared no code still gets none, and a crashed body is still the sanitised `500 INTERNAL_ERROR`. The server log line for the abort is not changed here.
