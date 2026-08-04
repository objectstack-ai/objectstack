---
"@objectstack/spec": patch
---

docs(spec,skills): the docs and the `objectstack-api` skill catch up with the endpoint executor (#5238)

The executor landed (#5040 E1–E8) and the blanket refusal of a non-empty `apis:`
became five per-endpoint publish gates — but three prose surfaces still told the
reader the opposite. That is worse than stale: each one is an *instruction* an
upgrading author (very often an AI maintainer with nothing but that text) would
follow away from a capability that now works.

**Two prescription texts in `packages/spec` — the shipped half of this change.**

- `App.apis`'s `retiredKey()` tombstone said the stack-level `defineStack({ apis })`
  it redirects to "is ALSO not executable in v17 (#4936) … until the endpoint
  executor ships". A tombstone that redirects somewhere has to be true about the
  place it points at; this one sent the author to a surface it called dead in the
  same sentence, so the natural next move was to keep serving the route from
  handler code. It now says the surface EXECUTES from protocol 17, names the five
  gates, and carries the two things to get right when moving a declaration up a
  level: the `/api/v1/apps/<namespace>/<subpath>` carve-out with an explicit
  `manifest.namespace` (ADR-0121 D1/D2), and `authRequired` defaulting to `true`
  with ADR-0121 D6's armed-`rateLimit` pairing on an explicit `false`. The removal
  half is untouched — `App.apis` was never read and is still gone — and #4936 is
  still named, because the history is why the redirect exists at all.
- The `defineStack({ server })` module header said #5040 "wires endpoint-level
  `rateLimit` — still unwired today". It is wired. The header now also states the
  relationship an author of the server-level budget actually needs: endpoint
  buckets are keyed in their own namespace, so the two budgets meter
  independently rather than sharing a counter.

Both feed `content/docs/references/` through `gen:docs`; those two pages move with
them and nothing else does.

**Hand-written docs.** `protocol/kernel/http-protocol.mdx` traded its "that surface
has no executor" callout for a real **Declarative Endpoints** section: the serving
chain (match → policy chain → delegation to the same pipelines the built-in routes
use), the five gates, the policy answers (401 / 429 + `Retry-After` /
`Cache-Control: private, max-age=<ttl>` on successes only), and the identity that is
easy to get wrong — an unmatched path, and a **method mismatch on a declared path**,
both keep the transport's bare `404` byte for byte, because the seam is Hono's
`notFound` and not a registered route, so there is no method set to report a `405`
over. `getting-started/quick-reference.mdx` gains the compact lookup entry.

**The `objectstack-api` skill** stopped describing `ApiEndpointSchema` as a
four-arm `type` union with a `target` and gained a section that teaches the current
capability: when `apis:` beats `contributes.routes` (and when it does not — real
handler code), the carve-out, the gates as *things to run `objectstack validate`
for* rather than texts to memorise, D6 with its `enabled === true` predicate spelled
out, and the mapping keys' minimal semantics (projection by dot path; no
`transform`; no `inputMapping` on a bodyless operation). It points at the
`declarative-apis-endpoints-live` upgrade entry rather than restating the review,
so there is one source of truth for it.

Every claim above was measured against the built spec rather than believed: the
doc example publishes, the `authRequired`-omitted shape resolves to `true`, and the
`rateLimit` written without `enabled: true` beside `authRequired: false` is refused
with its prescription. The tombstone's new text is pinned two-sided (it must say
the new thing AND must not say the retired one, with `#4936` still present) so a
regression cannot pass by emptying the message.
