---
"@objectstack/metadata-protocol": minor
---

fix(metadata-protocol): refuse the quoted-empty `If-Match` entity-tag instead of silently disabling optimistic concurrency (#13576)

**BREAKING** accept-set narrowing at the guarded-write door, shipped as
`minor` under the repo's launch-window convention for breaking changes.

`If-Match: ""` — a syntactically legal RFC-7232 entity-tag with an EMPTY
opaque value — was silently accepted as "no version token supplied", which
**skipped the optimistic-concurrency guard entirely** on both `PATCH
/data/:object/:id` (via `If-Match` or the body's `expectedVersion` field) and
`DELETE /data/:object/:id` (via `If-Match` or the query's `expectedVersion`).
`normaliseVersionToken` strips the RFC-7232 quotes off the token and only
*then* checks emptiness, so `'""'` (2 chars, non-empty) passed every upstream
truthiness gate only to normalise to `''` one layer down — the exact falsy
value every caller's own `if (!token) return` reads as "the client sent
nothing". It was the one token shape that opted OUT of the guard instead of
failing it: a garbage-but-nonempty token (`v2`) has always failed *toward*
`409 CONCURRENT_UPDATE`, the safe direction for a concurrency primitive —
`""` failed toward silent, unguarded acceptance instead.

**What changes.** Both doors now refuse `expectedVersion`/`If-Match: ""` at
ingress with `400 VALIDATION_FAILED`:

> expectedVersion (If-Match) is the empty entity-tag `""`. An empty version
> token can never match any stored version, so this is almost certainly a
> client defect rather than a real concurrency check — send the real version
> token you read (e.g. the record's `updated_at`), or omit If-Match /
> expectedVersion entirely to perform an unguarded write.

**What does NOT change** (both explicitly pinned as regression controls):
omitting `If-Match`/`expectedVersion` entirely is still a legal **unguarded**
write (opt-in semantics, unaffected) — including a bare unquoted empty string
or whitespace-only value, which is not the malformed shape and stays
opted-out; and a garbage-but-nonempty token (`v2`) still fails toward `409
CONCURRENT_UPDATE`, unchanged.

**Why 400 rather than 409** (a fail-closed alternative was considered and
rejected — maintainer ruling, 決裁批 #20 ①, 2026-08-31): a 409 would still
have collapsed two different facts into one answer — "you lost a race"
(retry-actionable) and "you sent a token that can never carry a version"
(a client-side bug, not a race). 400 keeps the two legible, which is the
entire point of refusing the *shape* rather than failing the comparison.
`""` is syntactically legal per RFC 7232 §2.3 (`*etagc` — zero or more —
permits an empty opaque-tag); this refusal is a deliberate platform CONTRACT
choice ("an empty tag can never match ⇒ it is necessarily a client defect"),
not a syntax verdict.

**Who this affects.** Measured: the first-party Console never sends this
shape — `occVersionOf` (`plugin-form/src/occSave.tsx`) and its
`InlineEditSaveBar` counterpart in `objectui` only forward a **truthy**
`updated_at` string as `ifMatch`, and the `@object-ui/data-objectstack`
adapter only sets the `If-Match` header when `options.ifMatch` is itself
truthy — an empty value never reaches the wire on any first-party path. The
exposure was to third-party and hand-rolled clients sending the RFC-7232
empty-tag shape, which previously got an unguarded write where they asked for
a guarded one.
