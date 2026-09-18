---
"@objectstack/spec": minor
---

feat(spec): refuse unknown keys inside a rate-limit budget — `RateLimitConfigSchema` goes strict, so one declaration stops answering for two doors

**BREAKING** accept-set narrowing on a published spec schema, landing after the
v17.0.0 cut (the lockstep launch-window convention ships it as `minor`).

Clause-②: yes (widening)

<!-- adr-0087: not-required (no-migration-prescription) this change retires NO key. The budget vocabulary is byte-identical and only the unknown-key POSTURE moves, from strip to reject, on one of its two mounts. Nothing exists for `objectstack migrate meta` to rewrite, because an undeclared key was never honoured: it was dropped at parse, so neither the inbound token bucket (`@objectstack/runtime` `security/inbound-rate-limit.ts`), nor the endpoint policy chain, nor the publish gate ever read one — measured with the gate's own instrument, which reports this def as accepting the key and returning a document without it. There is no single FROM/TO rule a ledger entry could state either, since what is now refused is an open set of author typos rather than a renamed key. The upgrade channel is the schema rejection itself, which is strictly more specific than any ledger line: it names the offending key at the author's own path and carries either the canonical spelling or the wrong-layer pointer. This is the same disposition, on the same stored metadata type, that #5384 took one level up when it closed `ApiEndpointSchema` itself; the `declarative-apis-endpoints-live` entry that governs this surface is already registered for protocol 17 and needs no change here. -->

`ServerRateLimitConfigSchema` was declared
`strictObject({ … guidance: { keyBy, store } }, RateLimitConfigSchema.shape)` —
built from the OPEN schema's own shape object. One declaration therefore answered
for TWO emitted defs with opposite doors: `system/ServerRateLimitConfig` refused
an undeclared `keyBy` and handed back the prescription, while
`shared/RateLimitConfig` — the same shape, mounted bare on `apis[].rateLimit` —
accepted the key and dropped it in silence. Both guidance entries prescribed to
nobody there. A misspelled budget was the same story one key over:
`windowSeconds: 60` parsed green and metered the 60000 ms default, a
thousandfold miss on the one key whose job is to bound spend, reported as
success.

**What is refused:** any key the budget does not declare, wherever it is mounted,
with a message naming the surface and the offending key. A near miss carries the
declared spelling (`window` / `windowSeconds` are answered with `windowMs`;
`max` / `maxRequest` / `limit` with `maxRequests`). `keyBy` and `store` keep
their wrong-layer prescriptions — the limiter's key is the resolved principal
falling back to the caller IP, and its counters live in the kernel `cache`
service (ADR-0069 D2) — and those two now reach the author on both mounts
instead of one.

**What stays accepted:** every declared key, byte-identically, with the same
defaults. `server.security.rateLimit` keeps its two bounds checks
(`maxRequests > 0`, `windowMs > 0`) and answers exactly as before. The published
JSON Schema, the authorable surface and the API surface are all unchanged —
`check:authorable-surface`, `check:api-surface` and `check:docs` pass with no
regeneration, because in `io: 'output'` zod already emitted
`additionalProperties: false` for the stripping shape too.

**Breaking for metadata that was already silently broken.** An `apis[].rateLimit`
carrying an undeclared key now fails `objectstack validate`, `objectstack build`
and the metadata write path instead of publishing with the key discarded.
Measured blast radius before landing: every shipped `rateLimit` block writes
only declared keys — three in `content/docs/`, one in `skills/objectstack-api`,
and none at all in `examples/`, the `os init` templates or the
`create-objectstack` blank template, which declare no budget.

