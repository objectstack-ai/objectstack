---
"@objectstack/rest": patch
---

fix(rest): one error envelope across the three `/security/suggested-bindings` routes (#7981)

`registerSecurityEndpoints` answered **three mutually incompatible error
envelopes**, decided only by which arm refused — on three routes a single client
calls in sequence (list → confirm / dismiss):

| arm | shape |
|:---|:---|
| validation refusals (repeated query param, unknown `?status`) | `{ error: { code, message } }` — ADR-0112 |
| security service not registered (`respond501`) | `{ code, message }` — no `error` wrapper at all |
| thrown service error, 403 / 404 / 409 / 500 (`handleError`) | `{ code, error: '<message>' }` — `error` a bare string |

So `body.error.code` — the one position [ADR-0112](docs/adr/0112-error-code-vocabulary-and-ledger.md)
D5 declares for the semantic code — read `undefined` on two arms out of three,
and the two it failed on include the one carrying the typed `PERMISSION_DENIED`
403 / `SUGGESTION_NOT_FOUND` 404 / `SUGGESTION_STATE` 409 codes the routes' own
docblock advertises, i.e. the arm a consumer is most likely to branch on. None of
the three was wrong on its own; they were wrong as a set, which is the class no
per-arm review catches.

All three now emit the ADR-0112 body `{ error: { code, message } }` through one
shared helper, so "the arms agree" is a property of the code rather than of three
literals that happen to match. The bare-string `error` is specifically the dialect
retired from this file's `/meta` 501 refusals in #7035; this finishes that
convergence for the security family. The shape is taken from the sibling arm in
the same file rather than re-derived from the ADR, so the region converges instead
of acquiring a fourth reading.

**This is a wire shape change, and the bare-string `error` field is its
wire-visible half.** A caller that read `body.error` as a human-readable string on
a 403 / 404 / 409 / 500 from these three routes now finds an object there, with
that text at `body.error.message`; a caller that read the semantic code at the
top-level `body.code` now finds it at `body.error.code`. Neither the codes
themselves nor any HTTP status moves — `NOT_IMPLEMENTED` and `VALIDATION_ERROR`
remain the standard catalog's members for 501 / 400, the thrown arm still passes
the service's own `err.code` through, and nothing in `packages/spec` changes.

Unchanged: every success path (200 with `{ data }`), the 501 duck-type check on a
security service that predates this surface, the status→arm mapping, and the
500-character cap on an unexpected fault's message.
