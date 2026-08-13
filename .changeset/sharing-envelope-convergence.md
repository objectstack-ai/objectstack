---
"@objectstack/rest": patch
"@objectstack/spec": patch
---

fix(rest): one error envelope across the record-sharing family (#8111)

`registerSharingEndpoints` — `GET/POST /data/:object/:id/shares` and
`DELETE /data/:object/:id/shares/:shareId` — answered two retired dialects across
its nine refusal arms: the 501 was flat `{ code, message }`, and the five mapped
verdicts (400 / 403 / 404 / 409 / 422) plus the three verb-specific 500s were
`{ code, error: 'a bare string' }`. So `body.error.code`, the one position
ADR-0112 D5 declares, read `undefined` on all nine — while the adjacent
`/security` registrars, converged in #7981 and #8073, already answered the
declared shape.

Every arm now emits `{ success: false, error: { code, message } }` through the
shared `sendError` from `@objectstack/types` — the same builder every conformant
route module writes through — so the family agrees by construction rather than by
nine literals happening to match.

No status code moves and no code VALUE changes. One code did change status in the
REGISTRY rather than on the wire: the 409 arm's `CONFLICT` was registered in
neither `StandardErrorCode` nor `ERROR_CODE_LEDGER`, so `ApiErrorSchema` — whose
`code` is a closed enum — would have rejected that body. It is now registered
under `@objectstack/rest`, keeping the emitted value byte-identical; consolidating
it onto the standard catalog's `RESOURCE_CONFLICT` would change what clients read
and is filed separately for the maintainer.

The `CODE:` message prefix the service uses to signal its verdict is untouched: it
is a server-internal service→REST derivation, stripped before the response is
written and never present on the wire, so no consumer can read it (censused at
claim). `ObjectStackClient` reads both envelopes' declared spots
(`errorBody?.code ?? errorBody?.error?.code`, and a bare-string limb for the
message), so `client.shares.list()`, `.grant()` and `.revoke()` keep throwing
identical `err.code`, `err.message`, `err.httpStatus`, `err.category`,
`err.retryable` and `err.fields` — re-measured against these call paths rather
than inherited from #7981 or #8073. `err.details` does change on every refusal:
its last fallback is the whole response body, and the body is what moved.
