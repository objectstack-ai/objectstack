---
'@objectstack/hono': minor
'@objectstack/plugin-hono-server': minor
---

fix(hono): `createHonoApp` answers an escaped throw that declares an ADR-0112 envelope as that envelope, not as `500 INTERNAL_ERROR` (#23365)

`@objectstack/hono`'s `createHonoApp` has two catch arms: the auth mount's, and
the `${prefix}/*` catch-all's around `HttpDispatcher.dispatch()`. Both answered
an escaped throw from its `statusCode` alone, so a producer that declared
`status` and a registered `code` lost both on this host. A `GET`, `PATCH` or
`DELETE` of `/data/:object/:id` for an id that names no row answered
`500 INTERNAL_ERROR` where the standalone REST server answers
`404 RECORD_NOT_FOUND`. The `/data` version refusals answered `500` too (a stale
`If-Match`'s `409 CONCURRENT_UPDATE`, and `If-Match: ""`'s
`400 VALIDATION_FAILED`), and so did an authorization-store outage
(`AuthzStoreUnavailableError`, `503 SERVICE_UNAVAILABLE`).

**What changed.** Both arms now answer a throw that carries **both** a declared
ADR-0112 status (a key of `HttpStatusErrorCodeMap`) **and** a code registered in
`ErrorCode` as that envelope. The recognition is `declaredEnvelopeForThrow`, the
rule `@objectstack/plugin-hono-server`'s direct-mount routes have used since
#16545, so the two Hono doors answer one throw alike by construction: the same
two conditions, the same 5xx disclosure filter (`looksLikeInternalErrorLeak`),
and `details` and `userMessage` forwarded only when the producer declared them.

The rule's other limbs come with it, as they did on the direct-mount door. A
validation-shaped throw answers `400 VALIDATION_FAILED` with its `fields[]`. A
driver fault the engine has already classified keeps its `500` and now carries
the code it declared instead of `INTERNAL_ERROR`. Measured: `GET /data/:object`
over an object whose table is missing answers `500 DATABASE_ERROR`, with the
same message as before.

**What did NOT change**, pinned in the same PR through a real `createHonoApp`
over the real dispatcher and protocol (`packages/qa/http-conformance`):

- a throw that is **not** such an envelope answers what it answered before. A
  bare `Error` is still `500 INTERNAL_ERROR` carrying `code` and `message`, with
  no `cause` in the body, and a throw that declares `statusCode` with no
  registered code keeps that status;
- ⛔ no error code is minted and no ledger row is added.

`@objectstack/plugin-hono-server` gains one export, `declaredEnvelopeForThrow`,
which was module-private. `createHonoApp` imports it rather than restating the
rule. Its behaviour is unchanged.

Earlier entries say a `createHonoApp` host still renders the `/data` version
refusals as `500`. This change ends that: they are answered `409` and `400` as
declared.

The `409 CONCURRENT_UPDATE` this host now answers carries `currentVersion` and
`currentRecord` in `error.details`, the two fields the standalone REST server's
`409` carries; `currentRecord` is the row as the caller reads it.

Clause-②: yes (widening)
