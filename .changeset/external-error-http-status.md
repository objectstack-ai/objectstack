---
"@objectstack/spec": patch
---

fix(spec): the external-federation error family declares its HTTP status, so a write refusal stops leaking as a bare 500 (#7739)

A write to a read-only federated external object was refused correctly on the
server — `ExternalWriteForbiddenError` names the datasource, its `schemaMode`,
and both flags that would be required, and nothing is applied (the gate throws
before the driver is reached) — but it reached the client as a bare
**500 INTERNAL_ERROR with no `code`**, indistinguishable from the server
falling over.

The `code` existed the whole way down: `EXTERNAL_WRITE_FORBIDDEN` is registered
in the ADR-0112 error-code ledger. What the error did not carry was an HTTP
**status**, and no HTTP exit can invent one — so the refusal fell past every
structured branch of the REST boundary, matched no message heuristic, and left
through the terminal sanitised 500 that drops the `code` with it.

**The whole family now declares its status, in one table.** New export
`EXTERNAL_ERROR_HTTP_STATUS` (`@objectstack/spec/shared`) maps every
`EXTERNAL_ERROR_CODES` member to the status it is reported with, and each of
the three error classes carries the corresponding value as `status`:

| code | status | why |
| --- | --- | --- |
| `EXTERNAL_WRITE_FORBIDDEN` | **403** | a policy refusal — the identical body succeeds once `datasource.external.allowWrites` and `object.external.writable` are both on, so 400/422 ("fix your request") would be a lie and 409 promises a retry that cannot help |
| `EXTERNAL_SCHEMA_MODE_VIOLATION` | **403** | the same sentence about DDL: `schemaMode !== 'managed'` forbids it, and no rewritten request changes that |
| `EXTERNAL_SCHEMA_MISMATCH` | **503** | not the caller at all — the deployment's metadata and the remote table diverged, only an operator can reconcile them, and it may clear (the reading `ERR_DATASOURCE_UNAVAILABLE` already gets) |

Declared at the **producer** rather than in a REST error map, because every
HTTP exit in the framework already resolves `status` then `statusCode` —
`mapDataError`'s `declaredHttpStatus`, `resolveErrorResponse`,
`HttpDispatcher.errorFromThrown`, `dispatcher-plugin.errorResponseBase`,
`endpoint-executor`, `domains/actions`, `plugin-hono-server`. One table fixes
every door at once; a branch in the REST server would have fixed one and left
the runtime dispatcher, the endpoint executor and the CLI answering 500 for the
same throw. `satisfies Record<ExternalErrorCode, number>` makes a future gate
that adds a code without a status a compile error, so the family cannot
silently re-acquire a member that leaks as a 500.

**What callers see now.** `POST /api/v1/data/<external_object>` against a
read-only federated object answers `403` with `code:
"EXTERNAL_WRITE_FORBIDDEN"` and the refusal detail naming both flags to set,
instead of `500` with no `code`. Behaviour is unchanged — nothing was applied
before and nothing is applied now; only the envelope was wrong.
