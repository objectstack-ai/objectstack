---
"@objectstack/spec": major
---

refactor(spec)!: remove `connector.rateLimitConfig` and the whole outbound rate-limit shape — the engine never existed (#4911, ADR-0049)

`ConnectorSchema.rateLimitConfig` let an author declare an outbound throttle for
their connector — `strategy`, `maxRequests`, `windowSeconds`, `burstCapacity`,
`respectUpstreamLimits`, `rateLimitHeaders` — and nothing anywhere applied it.
This is not the ordinary declared-but-unread case; it is a step worse:
**there is no outbound rate-limiting engine to wire it to.** The only token
bucket the platform owns is `packages/runtime/src/security/rate-limit.ts`, and it
is INBOUND — the dispatcher calls `consume(key)` on a request fingerprint and
answers 429. No connector provider (`connector-rest`, `connector-openapi`,
`connector-mcp`, `connector-slack`) reads the key, and no seam exists that could.

So a well-formed, schema-validated block told the author they had capped their
call rate against a third party's quota, and capped nothing — the false-compliance
class ADR-0049 exists for. With no implementation and no committed roadmap,
`experimental` would be a promise nobody made; **absent** is the honest
disposition. The vocabulary comes back *with* the engine, in one change
(implementation-first — the #4834 / PR #4878 ruling for the plugin-runtime family).

FROM → TO:

| Removed | Replacement |
| :--- | :--- |
| `connector.rateLimitConfig` (key) | **none** — delete it; throttle at the connector provider or upstream gateway |
| `ConnectorRateLimitConfigSchema` / `ConnectorRateLimitConfig` | **none** — importing either is TS2305 in v17 |
| `RateLimitStrategySchema` / `RateLimitStrategy` | **none** — the enum had no other consumer |

**Do NOT substitute `shared`'s `RateLimitConfig`.** That is the INBOUND limiter
(`enabled` / `windowMs` / `maxRequests`) and caps the calls others make to *us* —
the opposite direction. #4684 split the two names for exactly this confusion; the
conversion deliberately does not rewrite one into the other, because that would
silently change behaviour rather than losing a no-op.

The retirement kit:

- **Tombstone.** `ConnectorSchema` is not `.strict()`, so a plain delete would be
  a silent strip (ADR-0104). `retiredKey()` makes the removal audible in the two
  channels an upgrading author hits — `tsc` (the key types `never`) and the parse
  (the prescription itself). It reaches `stack.connectors[]` and
  `DeclarativeConnectorEntry`, which is `ConnectorSchema.superRefine(…)`.
- **ADR-0087 D2 conversion + D3 chain step** (`connector-rate-limit-config-removed`,
  `retiredFromLoadPath`): `os migrate meta --from 16` deletes the key from author
  sources and stored rows replay clean. A lossless delete — the block never had an
  effect to lose.
- **The shape goes with the key.** `ConnectorRateLimitConfigSchema` and the
  `RateLimitStrategySchema` enum it embedded had no other consumer, and an
  exported schema with no consumer reads as a capability to whoever finds it
  (#3950).
- **#4684's rename is absorbed.** `integration/RateLimitConfig` →
  `integration/ConnectorRateLimitConfig` and this retirement landed in the same
  unreleased major; composed they are a plain delete, so the `RENAMED_DEFS` entry
  is removed rather than pointing at a def this build no longer emits.
- Baselines updated deliberately: `json-schema.manifest.json` (−2 defs),
  `authorable-surface.json` (−6 def lines; `Connector` /
  `DeclarativeConnectorEntry` gain `… [RETIRED]`), `api-surface.json` (−4
  exports). `api-surface-signatures.json` is unchanged by construction — it hashes
  each `defineX` parameter as TypeScript *prints* it, a reference
  (`z.input<typeof ConnectorSchema >`), so key-level narrowing never reaches it.

No runtime behaviour changes — that impossibility is the reason for the removal.
