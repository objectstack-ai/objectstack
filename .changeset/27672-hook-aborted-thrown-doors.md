---
'@objectstack/types': patch
'@objectstack/rest': patch
'@objectstack/runtime': patch
---

fix(types): a hook that aborts with free text answers `HOOK_ABORTED` on package publish and the runtime `/actions` doors too, not `VALIDATION_ERROR`

Clause-②: no
Metadata-protocol: none

- **Before.** Since #27597 a sandboxed body that aborts with free text (`throw new Error('…')`, no `code`) answers `/api/v1/data` with `HOOK_ABORTED`. The doors that take their code from `resolveThrownHttpError` (`@objectstack/types`) instead of from the `/data` classification still answered the same abort with the code its `400` derives, `VALIDATION_ERROR`, so a client branching on the code had to know which door the abort came through.
- **Now.** `resolveThrownHttpError` answers `UNDECLARED_HOOK_REFUSAL_CODE` (`HOOK_ABORTED`) for a sandboxed body's refusal that declared no code, at a 4xx status. It is the one constant `/data` already reads, now declared beside the resolver. The value moves, from `VALIDATION_ERROR` to `HOOK_ABORTED`, on these doors:
  - `POST /api/v1/packages/publish` (`@objectstack/rest`);
  - the runtime `/actions` doors: `POST /api/v1/actions/:object/:action`, `POST /api/v1/actions/:object/:action/:recordId`, `POST /api/v1/actions/global/:action` and `POST /api/v1/actions//:action`, for an action body's own free-text throw, a hook abort relayed through an action body, and an action body's unreadable rejection (`throw ''`, `throw Object.create(null)`) (`@objectstack/runtime`).
- **Unchanged.** A code the body declared is kept: a registered code is still its own wire `code`, and an unregistered one (a `refusals` catalogue entry) still rides `declaredCode` beside the status-derived `code`. `declaredCode` stays absent for an undeclared abort. A producer that is not a sandboxed body still derives its code from the status, a crashed body is still the sanitised `500 INTERNAL_ERROR`, and a sandboxed refusal resolved at a 5xx keeps the fault's code. `/api/v1/data` answers exactly as before.
- **Moved, not added.** No error code is added; `HOOK_ABORTED` is the one #27597 registered. `sandboxBusinessMessage` moved to its own module so the resolver can read it without an import cycle; `@objectstack/types` exports the same names as before.
