---
"@objectstack/spec": major
---

refactor(spec)!: retire `HttpServerConfigSchema` — nine documented keys with zero readers AND no way to write them (#4938)

`system/http-server.zod.ts` declared `HttpServerConfigSchema` with nine keys —
`port`, `host`, `cors`, `requestTimeout`, `bodyLimit`, `compression`,
`security`, `static`, `trustProxy`. `authorable-surface.json` listed all nine
and `content/docs/references/` rendered them as protocol documentation. Both
halves of the contract were empty:

- **Zero runtime readers.** No package in any repo (objectstack / cloud /
  objectui) ever parsed a document with this schema or read a key off it. The
  only non-spec mentions were "Used by:" comments in `shared/http.zod.ts`
  pointing back at it.
- **Zero authoring entry** — worse than the ordinary declared-but-unread
  defect. `stack.zod.ts` had no `server:` key, `config-schema.json` had no
  `HttpServerConfig`, and no settings manifest carried it, so the configuration
  the docs promised could not even be written down, let alone take effect.

What actually decides these things is three *other* shapes: the CLI `serve`
arguments, the Hono adapter's `ObjectStackHonoOptions`, and
`DispatcherPluginConfig.securityHeaders`. `HttpServerConfigSchema` was
unacquainted with all three. Per ADR-0049 enforce-or-remove, and the 2026-08-04
ruling on #4938, the unreachable face is removed.

FROM → TO, per retired key:

| removed | what to do instead |
|---|---|
| `HttpServerConfig.port` / `.host` | the deployment owns the socket — `objectstack serve -p <port>` / `PORT` |
| `HttpServerConfig.static` | the transport plugin's `staticMounts` |
| `HttpServerConfig.cors` | the transport adapter — `OS_CORS_ORIGIN` / `OS_CORS_CREDENTIALS` / `OS_CORS_MAX_AGE` |
| `HttpServerConfig.security.helmet` | the dispatcher plugin's `securityHeaders` (on by default) |
| `HttpServerConfig.security.rateLimit` | `defineStack({ server: { security: { rateLimit } } })` — LIVE since #5006 |
| `HttpServerConfig.trustProxy` | `defineStack({ server: { trustProxy } })` — LIVE since #5006 |
| `HttpServerConfig.requestTimeout` / `.bodyLimit` / `.compression` | nothing consumes them; they return with an executor or not at all |

Two of the nine were **activated** rather than lost: #5006 mounted
`security.rateLimit` and `trustProxy` on the deliberately narrow
`StackServerConfigSchema`, which grows one key at a time, each arriving with its
consumer. `cors` is registered as the FIRST per-key admission candidate for that
shape — embedding (`example-embed-objectql`) is a real scenario — and will
arrive the #4910 way, key and executor together, rather than sitting on the
export surface as a dead declaration in the meantime.

The retirement kit:

- **No `retiredKey()` tombstone, deliberately** — route 3 of the retirement
  playbook ("nothing parses it"), the shape #4834 / PR #4878 used for the kernel
  plugin-runtime family. A tombstone is a message to whoever writes the key, and
  the only surface on which anyone can write a server key is
  `StackServerConfigSchema`; it is `strictObject` and already rejects all seven
  by name. Those prescriptions were refreshed from "not authorable — no runtime
  reads it" to name the retirement and its replacement.
- **No ADR-0087 D2 conversion**, for the same reason: there is no author source
  to rewrite, because the shape was never reachable from an authoring surface.
  The channel for code consumers is `api-surface.json` (which lost all three
  `HttpServerConfig*` entries) feeding the release-time `spec-changes.json`
  diff, plus this changeset.
- Baselines updated deliberately: `json-schema.manifest.json` (−1, the #2978
  ratchet fired first and demanded it), `authorable-surface.json` (−9, allowed
  by the #4650 gate's path 3 "def no longer emitted by this build"),
  `api-surface.json` (−3). Reference docs and the strictness-ledger counts
  regenerated.
- **The container, not the file.** `RouteHandlerMetadata` (consumed by
  `packages/rest`) and `MiddlewareType` / `MiddlewareConfig` (consumed by
  `packages/runtime`) stay, as do `CorsConfigSchema`, `RateLimitConfigSchema`
  and `StaticMountSchema` in `shared/http.zod.ts` — each has live consumers
  outside the retired shape, so none of them was orphaned by it.

No runtime behaviour changes — that impossibility is the reason for the removal.
