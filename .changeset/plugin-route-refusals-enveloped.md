---
"@objectstack/plugin-hono-server": minor
"@objectstack/hono": minor
"@objectstack/cli": minor
---

fix(api): the plugin-mounted Hono error paths answer the declared envelope — six refusal bodies stop speaking the pre-#3675 dialect (#9364)

Six hand-built refusal bodies on plugin-mounted Hono routes departed from
`BaseResponseSchema`. They were invisible to every check in the repo until
#9267 added the gate's third surface, which discovers these routes by parsing
rather than by filename. This converts the **error-path** half of what that
first run measured; the bare pre-auth discovery payloads it also found are a
separate wire ruling (#9389) and are untouched here.

**If you branch on these bodies, this is the change.** Every one of them was
readable only by reaching for a key the contract does not declare, so no
consumer that followed `ApiErrorSchema` was reading them successfully in the
first place — `body.error.message` read `undefined` on all six.

`@objectstack/plugin-hono-server` — the adapter's own refusals, the answer any
host using it as its transport gets for an unmatched request or a handler that
produced nothing:

| status | was | now |
|:--|:--|:--|
| 404 unmatched path | `{ error: 'Not found' }` | `{ success: false, error: { code: 'ENDPOINT_NOT_FOUND', message: 'Not found' } }` |
| 405 method mismatch | `{ error, code, message, method, path, allowed }` | `{ success: false, error: { code: 'METHOD_NOT_ALLOWED', message, details: { method, path, allowed } } }` |
| 500 handler wrote nothing | `{ error: 'No response from handler' }` | `{ success: false, error: { code: 'INTERNAL_ERROR', message: 'No response from handler' } }` |
| 500 fallback threw | `{ error: 'Fallback handler failed' }` | `{ success: false, error: { code: 'INTERNAL_ERROR', message: 'Fallback handler failed' } }` |

The 405 is the sharpest of the four: it already carried a real semantic code,
but placed it BESIDE `error` rather than inside it, so `body.error.code` read
`undefined` while `body.code` worked — the #7035 dialect. Its `code` **value**
is unchanged (`METHOD_NOT_ALLOWED`, a `StandardErrorCode` member); only its
position moved, along with the three context keys, which are now
`error.details` — the slot `ApiErrorSchema` declares for exactly that. The
`Allow` header is unchanged and remains the primary channel for it.

`@objectstack/hono` — the shared `errorJson` helper wrote the HTTP **status**
into `error.code`, so every refusal from this mount shipped `error.code: 404`
or `500` where `ApiErrorSchema.code` declares a closed STRING vocabulary
(ADR-0112 D3/D4). It now derives the standard member for the status through
`resolveThrownHttpError` (`@objectstack/types`) — the one rule the REST and
dispatcher doors already read for this question, so this third door does not
become a fourth dialect. A 404 from this mount now carries
`error.code: 'RESOURCE_NOT_FOUND'`; the numeric status stays where it is
authoritative, on the response line.

`@objectstack/cli` — the unbound-hostname 404 from `os serve`'s
`OS_ROOT_DOMAIN` guard answered
`{ error: 'environment_not_found', message, hostname }`: a bare-string error
with two stray top-level keys, and a lowercase code where error codes are
`SCREAMING_SNAKE`. It is now
`{ success: false, error: { code: 'ENVIRONMENT_NOT_FOUND', message, details: { hostname } } }`.
The `Accept: text/html` branch still serves the styled 404 page, unchanged.

**The cross-adapter reference implementation moved with it.**
`@objectstack/http-conformance`'s zero-dependency `NodeHttpServer` mirrors the
adapter's unmatched-request bodies byte-for-byte on purpose — the whole point
of that package is proving the transport port is free of framework-isms, and
`fallback-seam.conformance.test.ts` runs the same cases against both. Leaving
it behind would have made "both adapters agree" false in the suite that exists
to assert it.

Every converted body is judged by `scripts/check-route-envelope.mjs`, whose
per-file counters for these three modules go to zero and are banked as
conformant. The literals are deliberately written INLINE at each `c.json(...)`
call rather than hoisted into shared constants: the gate reads the object
literal, and an identifier reads to it as a relayed body it must not police —
hoisting would have zeroed the counters by hiding the bodies from the scanner
instead of by conforming them.
