---
"@objectstack/spec": minor
---

feat(spec)!: declare the duration rule's two structural exemptions on the schema — a shared `EpochMs` instant and a `.meta({ externalVocabulary })` marker (#15676, ruling B on #14478)

<!-- adr-0087: registered epoch-instant-keys-renamed -->

**BREAKING** — four published epoch-instant keys are renamed and tombstoned.
Shipped as `minor` under the repo's launch-window convention for breaking
changes; the hand-migration prescription is registered under protocol major 18.
Maintainer ruling B on #14478 (2026-09-02, decision batch #43, 「同意」).

`check:duration-unit-keys` makes a duration-shaped `z.number()` carry its unit
in the key NAME, because two sibling keys both spelled `ttl` in different units
are indistinguishable at the authoring site. Ruling B exempts two structural
classes from it, and is explicit about the mechanism: both are **declared on the
schema, never in a gate ledger**. This change lands both declarations and
applies them.

## 1. Epoch instants — the shared `EpochMs` schema

`EpochMs` (`@objectstack/spec/shared`) is a `z.number().int()` describing
milliseconds since the Unix epoch. A key whose value IS that schema is an
INSTANT, and the gate recognises it structurally — nothing anywhere names the
exempt keys.

An instant reads to the rule exactly like an offending duration (a bare name
plus a describe that says "milliseconds"), but renaming it the way the rule
prescribes would resolve the wrong confusion. Measured on this package's own
authorable surface: all 51 distinct keys ending in `Ms` are durations
(`timeoutMs`, `backoffMs`, `latencyMs`, `uptimeMs`) and all 51 distinct keys
ending in `At` are instants (`createdAt`, `expiresAt`, `lastUsedAt`). Spelling
an instant `*Ms` would move it INTO the family the rule exists to separate it
from. So the six instants take `EpochMs`, and the four whose name was bare take
the `*At` convention.

### FROM → TO

| Schema | Wrote | Write instead |
| :-- | :-- | :-- |
| `api/WebSocketEvent` | `timestamp` | `occurredAt` |
| `api/SimplePresenceState` | `lastSeen` | `lastSeenAt` |
| `kernel/KernelContext` (and `TenantRuntimeContext`) | `startTime` | `startedAt` |
| `kernel/HealthStatus` | `timestamp` | `checkedAt` |

```ts
// before
const ctx: KernelContext = { instanceId, mode: 'production', version, cwd, startTime: Date.now(), features: {} };
// after — the value is unchanged; only the key name and the declared schema move
const ctx: KernelContext = { instanceId, mode: 'production', version, cwd, startedAt: Date.now(), features: {} };
```

Each old key is tombstoned with `retiredKey()`, so it fails `tsc` at the
construction site and fails the parse with the rename prescription rather than
being silently stripped. `kernel/ServiceMetadata.registeredAt` and
`kernel/ScopeInfo.createdAt` were already correctly named and only change
schema — they are not retirements and need no edit.

⚠️ `api/PresenceState.lastSeen` (`api/realtime-shared.zod.ts`) is a **different**
key holding an ISO-8601 datetime string. It is untouched; do not rename it with
its neighbour.

**One tightening.** `WebSocketEvent.timestamp` and `SimplePresenceState.lastSeen`
were declared bare `z.number()`, and `EpochMs` is `z.number().int()`, so a
fractional epoch that used to parse at those two sites is now refused.
`Date.now()` has always satisfied it. The other four already declared `.int()`.

## 2. External-standard mirrors — `.meta({ externalVocabulary })`

A key whose name is fixed outside this repo carries
`.meta({ externalVocabulary: '<the standard>' })`. The marker rides
`z.toJSONSchema` verbatim (the channel `xRef` / `xExpression` already use), the
gate honours it, and **the reference page publishes it**: the description cell
now reads `… in seconds (unit per HTTP Cache-Control \`max-age\` (RFC 9111 §5.2.2.1))`.
Publishing it is what makes the exemption honest — the gate exists because a
bare `maxAge` publishes a naked number to a reader who cannot see the source.

Eleven keys are marked: the three HTTP `Cache-Control` directives, the two CORS
`Access-Control-Max-Age` config keys, the two S3 presigned-URL `expiresIn` keys,
the three better-auth forwarded options, PostgreSQL's `statement_timeout` and
the DNS record `ttl`. No authorable key is renamed or re-typed by this half.

⛔ Neither exemption is a pass on lying: a marked key still fails
`name-unit-contradicts-prose`, and an `EpochMs` key whose describe names a unit
other than milliseconds fails the new `instant-unit-contradicts-schema`.
