---
"@objectstack/spec": major
"@objectstack/metadata": patch
---

feat(spec)!: declarative `apis:` publishes again — the blanket refusal narrows to per-endpoint publish gates, and declared endpoints go LIVE (#5111, #5040 E7)

⚠️ **Read this as a security note, not a schema note.** Declarative endpoints
**execute** from protocol 17. Before this release the surface was inert end to
end — nothing mounted a declared `path`, no matcher existed, and every key
including `authRequired` parsed green and gated nothing — which is why #4936
refused a non-empty `apis:` outright. The #5040 E-series built the executor
(mount seam, endpoint matcher, policy keys, execution targets, mapping keys,
OpenAPI enrichment), so the refusal's premise is gone and keeping it would be
the lie in the other direction.

## BREAKING — the refusal narrows, and what passes it is served

`apis: [ …endpoints… ]` no longer fails wholesale. Each entry is now gated
individually, and **an endpoint that passes the gate is mounted and answers
real requests as soon as the stack is published.**

**Before you upgrade, review every historical `apis:` block** — including any
you restored, generated from an older doc, or left in place because it was
known to do nothing. Pay particular attention to any entry that explicitly
declares **`authRequired: false`**: the schema default is `true`, so an
*omission* is safe and needs no review, while an explicit `false` is the only
thing that opens **anonymous** access to that endpoint. ADR-0121 D6 now pairs
it with a mandatory armed rate limit — and "armed" means
`rateLimit: { enabled: true, … }`, because `enabled` defaults to `false`, so a
budget written without it meters nothing.

## The gates, each rejecting with its own prescription

| gate | rejected shape |
|---|---|
| **namespace** (ADR-0121 D1/D2) | a `path` that is not `/api/v1/apps/<manifest.namespace>/<subpath>`, or a stack that declares `apis:` without an explicit `manifest.namespace` (no derivation from `manifest.id`) |
| **supported subset** | `type: 'script'` / `'proxy'`; an `object_operation` missing `objectParams.object` or `.operation`; a `flow` with an empty `target` |
| **mapping** | any `transform`; an unusable `source`/`target` path (empty, empty segment `a..b`, `__proto__`/`prototype`/`constructor`); two entries whose `target`s collide (same path, or one inside another); `inputMapping` on a `find`/`get`/`delete` operation, which never reads a body |
| **policy** | `authRequired: false` without `rateLimit.enabled === true`; an armed budget with `maxRequests`/`windowMs` ≤ 0; a negative `cacheTtl`; `cacheTtl` on a non-GET method |
| **uniqueness** | two endpoints in one stack claiming the same METHOD + path (one trailing slash trimmed, the matcher's own rule) |

**FROM → TO.** `path: '/api/v1/<anything>/thing'` →
`path: '/api/v1/apps/<manifest.namespace>/thing'`, with `manifest.namespace`
declared explicitly. `authRequired: false` → either delete the key (the safe
default `true` applies) or keep it **and** add
`rateLimit: { enabled: true, windowMs: 60000, maxRequests: 100 }`. Every other
key is unchanged: the `ApiEndpoint` vocabulary is frozen — this release adds,
removes and renames nothing on it. The gates are validation logic over the keys
that already existed.

The runtime keeps its own refusals for a declaration that reached the store
without passing publish (a direct `metadata.register()`), so the two ends agree:
what publish accepts is exactly what the executor serves.

`normalizeEndpointPath` is now exported from `@objectstack/spec/api` and is the
one canonical form of a declared path — the publish gate and the endpoint
matcher (`@objectstack/metadata`) read the same rule instead of each carrying a
copy, so a stack can never publish a duplicate the matcher would silently
resolve to a single winner.
