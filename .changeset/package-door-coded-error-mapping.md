---
"@objectstack/types": minor
"@objectstack/rest": patch
"@objectstack/runtime": patch
---

fix(rest,runtime,types): the direct-mount package door answers a coded refusal with its own status and code (#8016)

**This changes HTTP status codes on a live surface.** Requests to
`/api/v1/packages` that today come back `500 INTERNAL_ERROR` will come back as
the refusal they always were — `409 DESTRUCTIVE_CHANGE` for an uninstall that
would drop data, `400`/`403` for a coded refusal thrown from below. A client
that keys on `500` to decide "the platform is down, retry later" for these
routes must key on the `code` instead. No route, path, verb or success body
changes.

`/api/v1/packages` has two HTTP transports. The runtime dispatcher's
(`packages/runtime/src/domains/packages.ts`) reads a thrown error's own
`.status` and `.code` and answers with them. The direct-mount REST registrar
(`packages/rest/src/package-routes.ts`) had **four** catch-alls that answered
`sendError(res, 500, 'INTERNAL_ERROR', …)` regardless — and that registrar
mounts *first* in the production stack, so the status-blind answer was the one
production actually returned. `packageService.publish`, `packageService.delete`
and `protocol.deletePackage` all execute inside those blocks, and
`@objectstack/metadata-protocol` throws coded, status-carrying refusals from
that call path. So a caller who was **refused** was told the platform had
**broken**: the wrong class of answer, a retry that cannot succeed, and the one
field a client can branch on dropped.

The four sites now leave through one shared exit. The mapping is not
reimplemented here — that is how the two doors diverged in the first place. It
moved to `resolveThrownHttpError` in **`@objectstack/types`** (alongside the
`sendOk`/`sendError` envelope writer and `looksLikeInternalErrorLeak`, for the
same reason: it is a property of the HTTP boundary, not of one router), and the
dispatcher's `HttpDispatcher.errorFromThrown` is now its other caller. It could
not live in `@objectstack/runtime`: that package depends on `@objectstack/rest`,
so the import can only point one way.

The rule, unchanged from what the dispatcher always applied:

- **status** — the producer's `.status`, then `.statusCode` (both spellings are
  produced in this repo), then `400` for a record-validation failure, then the
  caller's fallback.
- **code** — `VALIDATION_FAILED` for a validation failure, then the thrown
  `.code` **when it is a member of the declared ADR-0112 vocabulary**
  (`StandardErrorCode ∪ ERROR_CODE_LEDGER`), then the code the status derives.
  An unregistered code no longer reaches `error.code` on the dispatcher door
  either; it would have failed envelope parse, which is ADR-0112's closed
  vocabulary working rather than a dialect leaking onto the wire.
- **the 500 survives** — a throw declaring neither status nor a registered code
  is a genuine fault and still answers `500 INTERNAL_ERROR`.

`validation-failure.ts` moved from `@objectstack/runtime` to
`@objectstack/types` for reachability and is re-exported from its old module
path; every existing import site is unchanged.

Unchanged and deliberately so: this REST door still ships a 5xx message
verbatim, where the dispatcher withholds one that looks like an internal leak
(`looksLikeInternalErrorLeak`, #3867). That asymmetry predates this fix and is
filed separately.
