---
"@objectstack/spec": minor
---

feat(spec)!: the fifteen `system/` duration keys carry their unit in the key name (#15679, ruling B on #14478)

<!-- adr-0087: registered system-cache-durations-unit-in-key, system-collaboration-durations-unit-in-key, system-failover-health-check-interval-unit-in-key, system-metrics-window-durations-unit-in-key, system-object-storage-durations-unit-in-key, system-registry-config-durations-unit-in-key, system-tracing-span-duration-unit-in-key, system-worker-queue-rate-limit-duration-unit-in-key -->

**BREAKING** — fifteen published `system/` duration keys are renamed and
tombstoned. Shipped as `minor` under the repo's launch-window convention for
breaking changes; the hand-migration prescriptions are registered under protocol
major 18. Maintainer ruling B on #14478 (2026-09-02, decision batch #43,
「同意」).

`check:duration-unit-keys` makes a duration-shaped `z.number()` carry its unit
in the key NAME, never only in its `.describe()` prose, and grandfathers no
existing offender. Stack card 1/6 (#15676) landed the rule's two structural
exemptions, card 2/6 (#15677) cleared `api/` and card 3/6 (#15678) cleared
`kernel/`; this card clears `system/`. Measured with the gate itself:
`src/system/**` goes from 15 offenders to **0**, and the whole-tree count falls
**22 → 7**.

## FROM → TO

| key | replacement | unit |
|:--|:--|:--|
| `CacheTier.ttl` | `ttlSeconds` | seconds |
| `CacheAvalanchePrevention.circuitBreaker.resetTimeout` | `resetTimeoutSeconds` | seconds |
| `CollaborationSessionConfig.idleTimeout` | `idleTimeoutMs` | milliseconds |
| `CollaborationSessionConfig.snapshot.interval` | `intervalMs` | milliseconds |
| `FailoverConfig.healthCheckInterval` | `healthCheckIntervalSeconds` | seconds |
| `MetricAggregationConfig.window.size` | `durationSeconds` | seconds |
| `ServiceLevelIndicator.window.size` | `durationSeconds` | seconds |
| `ServiceLevelObjective.period.duration` | `durationSeconds` | seconds |
| `AccessControlConfig.maxAge` | `maxAgeSeconds` | seconds |
| `StorageConnection.timeout` | `timeoutMs` | milliseconds |
| `RegistryUpstream.syncInterval` | `syncIntervalSeconds` | seconds |
| `RegistryUpstream.timeout` | `timeoutMs` | milliseconds |
| `RegistryConfig.cache.ttl` | `ttlSeconds` | seconds |
| `Span.duration` | `durationMs` | milliseconds |
| `QueueConfig.rateLimit.duration` | `durationMs` | milliseconds |

**Every value is unchanged** — only key names move, and every default moves with
its key (`CacheTier` still defaults to 300, `CollaborationSessionConfig` to
300000, `FailoverConfig` to 30, `RegistryUpstream.timeoutMs` to 30000,
`RegistryConfig.cache.ttlSeconds` to 3600). Bounds move with their keys too, so
`syncIntervalSeconds` still refuses anything under 60 and `timeoutMs` anything
under 1000. Every old spelling is a `retiredKey()` tombstone, so it fails `tsc`
at the authoring site (input type `never`) and fails the parse with the rename
prescription rather than a bare unrecognized-key error.

## ⚠️ Two `maxAge` keys, opposite sides of the line — do not harmonise them

`AccessControlConfig.maxAge` (bucket CORS) is **renamed** to `maxAgeSeconds`.
Its twin `shared/CorsConfig.maxAge` (HTTP CORS) is **not**, and keeps its bare
name under an `externalVocabulary` marker.

The asymmetry is the whole point. Every bucket-CORS standard the first value is
forwarded to already spells the unit — S3 `MaxAgeSeconds`, GCS `maxAgeSeconds`,
Azure `MaxAgeInSeconds` — so marking that key would have exempted a *deviation
from* the cited standard rather than a mirror of it. The Fetch response header
the second mirrors, `Access-Control-Max-Age`, genuinely carries no unit token.
A find-and-replace across both leaves no gate red: the marker exempts the twin
either way. A pin test in `object-storage.test.ts` is the only guard.

## ⚠️ `window.size` becomes `durationSeconds`, not the mechanical `sizeSeconds`

The gate prints `sizeSeconds` for the two `window.size` keys, and that name is
wrong on its face. `size` means a byte or row count everywhere else in this spec
— `CacheTier.maxSize` is megabytes, `RegistryConfig.cache.maxSize` is bytes, and
`MetricExportConfig.batch.size` on the very same file is a record count — so
`sizeSeconds` would have kept the misleading half of the name and bolted a unit
onto it. `windowSeconds` was rejected for a plainer reason: the parent key is
already `window`, so it would read `window.windowSeconds`.

`durationSeconds` names what the number is, and the file supplied its own
precedent: `ServiceLevelObjective.period.duration` already called a period
length a duration. After the rename all three read alike. The prescription says
so explicitly, so the next author does not read the departure as a slip and
"correct" it back to the mechanical name.

## Dispositions — eight semantic entries, no D2 conversion

Justified per key rather than defaulted, and this card's answer is uniform:
**none of the fifteen gets an ADR-0087 D2 conversion.** A D2 conversion runs
over a stack document, and `stack.zod.ts` declares no `cache`, `collaboration`,
`disasterRecovery`, `metrics`, `objectStorage`, `registry`, `tracing` or
`worker` root — none of these twelve defs is a stack collection member or a
registered metadata kind stored as a `sys_metadata` row, so the conversion chain
has no seam that would see one. They are host configuration (`CacheTier`,
`FailoverConfig`, `StorageConnection`, `RegistryUpstream`, `RegistryConfig`,
`QueueConfig`), call arguments (`CollaborationSessionConfig`) and
runtime-emitted measurements (`Span`). Each therefore carries a **semantic**
entry, which is what ruling B prescribes for a key that is not authorable stack
metadata. All fifteen are registered by exact key in `RETIRED_KEYS_BY_MAJOR`,
nested spellings included.

## Keys deliberately left alone

`FailoverConfig.dns.ttl` is a declared `externalVocabulary` mirror of the DNS
resource-record TTL field (RFC 1035 §4.1.3) and keeps its bare name.
`CacheAvalanchePrevention.lockout.lockTimeoutMs` was already correct — and it is
milliseconds where its `resetTimeoutSeconds` sibling is seconds, so the two must
not be migrated as if they were one unit. `MetricExportConfig.batch.size` is a
record count and `QueueConfig.rateLimit.max` is a task count: neither is a
duration, so neither has a unit to carry. `ServiceLevelObjective.errorBudget`'s
burn-rate `window` and the OpenTelemetry exporter `timeout` name no unit
anywhere in their prose, so both are outside the gate's population entirely.
Pin tests assert each of these, so a later sweep cannot read this card as
"every duration-shaped number on these files".
