---
'@objectstack/plugin-hono-server': minor
---

fix(plugin-hono-server): an escaped throw that declares an ADR-0112 envelope is answered as that envelope, not as a bare `500 INTERNAL_ERROR "No response from handler"` (#16545)

`HonoHttpServer.wrap()` is the seam **every direct-mount route passes** — `get` /
`post` / `put` / `delete` / `patch` each register `this.wrap(handler)`, and
`IHttpServer` is how `service-datasource`, `packages/rest` and the dispatcher
bridge all mount. Until now a throw that escaped a route handler was answered
there as `500 { code: 'INTERNAL_ERROR', message: 'No response from handler' }`,
with the thrown value discarded — so a producer that had *declared* its refusal
lost both halves of the declaration on the way to the caller.

The measured case: `service-datasource`'s `requireDatasourceAdmin` re-raises
`AuthzStoreUnavailableError` (declared `status: 503`, declared `code:
SERVICE_UNAVAILABLE`) when the authorization store cannot be read — deliberately,
per the #13279 ruling that an unreadable store licenses no verdict. The operator's
outage reached the caller as a generic fault naming the wrong component: the
declared code never arrived, and the message said "No response from handler".

**What changed.** An escaped throw carrying **both** a declared ADR-0112 status
(a key of `HttpStatusErrorCodeMap`) **and** a code registered in `ErrorCode`
(`StandardErrorCode` ∪ `ERROR_CODE_LEDGER`) is now rendered as that envelope,
with the producer's `details` and `userMessage` channels forwarded. The status
and code are read through `resolveThrownHttpError` — the one rule the REST
registrar and the dispatcher already share — so this seam agrees with the other
doors by construction rather than by a second ladder.

**What did NOT change**, pinned in the same PR:

- an escaped throw that is **not** such an envelope answers exactly the bytes it
  answered before — 500, no cause in the body. A partial declaration (status but
  no code, code but no status), an unregistered code, and a status ADR-0112 does
  not declare all take that arm;
- a handler that simply wrote nothing is untouched;
- a handler that **wrote and then threw** keeps what it wrote;
- the `notFound` fallback seam still answers `Fallback handler failed` — a
  fallback that threw is a broken consumer, not a refusal it declared;
- ⛔ no error code is minted and no ledger row is added. A code on this path that
  is not registered is a ledger gap under the #16404 ruling, and takes the
  unchanged 500 arm rather than being registered in passing.

The 5xx disclosure filter every door emitting a thrown message already runs
(`looksLikeInternalErrorLeak`, #3867 / #8086) is applied here from this seam's
first day: a driver dump on a declared 5xx is withheld, where the old bare 500
disclosed nothing at all. The escaped-throw diagnosis (#5848) still fires exactly
once at `error`, and now names the answer that was really sent instead of
claiming an opaque 500.

⚠️ **Known-unreached door, stated rather than left silent.** A route mounted
through `getRawApp()` funnels through neither `wrap()` nor any registrar wrapper,
so it is **not** repaired by this change and still answers a non-envelope
`text/plain` 500. That is out of this card's scope by the `domain:cli` seat's
ruling and is filed separately.
