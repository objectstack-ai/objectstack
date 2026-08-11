---
"@objectstack/runtime": patch
---

fix(runtime): stop the dispatcher answering a permission denial's internal authorization payload (#7450)

`plugin-security`'s object gate attaches
`{ operation, object, positions, permissionSets }` to every
`PermissionDeniedError`. The two HTTP transports disagreed about what to do with
it. `@objectstack/rest`'s `mapDataError` never reads `error.details` — its 403
body is `{ error, code, object? }`, and the `object` on it is the one the ROUTE
named. The dispatcher's `dispatch()` catch spread the whole payload
(`{ code: 'PERMISSION_DENIED', ...(e.details ?? {}) }`), and `buildApiError`
puts everything that is not the `code` on the wire as `error.details`.

Per the maintainer's 2026-08-11 ruling the two transports now agree on REST's
shape: **message + code + the route-derived object**. `positions` and
`permissionSets` are server-side diagnostics and are no longer serialized; the
full withheld payload is written to a server log line instead, so a false
denial is still diagnosable.

**The object is derived from the request path, not from `error.details`.** This
is the part an "allowlist `operation` + `object`" reading gets wrong.
`ObjectQL.cascadeDeleteRelations` re-enters `delete()` for every child of the
row being deleted, so a child's own trip through the security middleware throws
with `details.object` set to the CHILD. Forwarding that field would have reached
the ruled field set and still answered the API name of an object the caller
never addressed. The dispatcher now reads no field of `error.details` at all:
`object` comes from `cleanPath`, exactly as REST takes `req.params.object`, and
a denial on a route whose path names no object carries no `object` — REST's
`...(object ? { object } : {})` behaviour.

**Also fixed, and required for the above to have any effect on the wire.** The
domain-registry branch of `dispatch()` returned its handler's promise without
awaiting it. In an async function a bare `return <promise>` settles outside the
enclosing `try`, so a domain handler's rejection never reached that method's
`catch` — and every domain that can raise an object-gate denial (`/data` among
them) resolves through that branch, which made the `PERMISSION_DENIED` branch
unreachable in practice. Denials escaped to the Hono catch-all instead, which
answered `{ error: { message, code: 403 } }`: a numeric `code`, the shape
`error-envelope.ts` exists to prevent, with no `PERMISSION_DENIED` string for a
client to branch on. The branch now awaits, so a `/data` denial answers the
ruled envelope. Non-denial errors are unaffected — the catch rethrows them and
they reach the adapter exactly as before.

**Wire-visible.** A consumer reading `error.details.positions`,
`error.details.permissionSets` or `error.details.operation` off a dispatcher 403
no longer receives them, and `error.details.object` is now the object the
request addressed rather than whichever object the gate refused. A `/data`
denial's `error.code` is now the string `PERMISSION_DENIED` rather than the
number `403`.
