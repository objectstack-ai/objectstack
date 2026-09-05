---
"@objectstack/spec": minor
"@objectstack/core": patch
---

feat(spec)!: the fourteen `kernel/` duration keys carry their unit in the key name (#15678, ruling B on #14478)

<!-- adr-0087: registered kernel-event-bus-retention-unit-in-key, kernel-package-lifecycle-durations-unit-in-key, kernel-plugin-health-report-durations-unit-in-key, kernel-plugin-security-durations-unit-in-key, kernel-startup-orchestrator-durations-unit-in-key -->

**BREAKING** — fourteen published `kernel/` duration keys are renamed and
tombstoned. Shipped as `minor` under the repo's launch-window convention for
breaking changes; the hand-migration prescriptions are registered under protocol
major 18. Maintainer ruling B on #14478 (2026-09-02, decision batch #43,
「同意」).

`check:duration-unit-keys` makes a duration-shaped `z.number()` carry its unit
in the key NAME, never only in its `.describe()` prose, and grandfathers no
existing offender. Stack card 1/6 (#15676) landed the rule's two structural
exemptions and card 2/6 (#15677) cleared `api/`; this card clears `kernel/`.
Measured with the gate itself: `src/kernel/**` goes from 14 offenders to **0**,
and the whole-tree count falls **36 → 22**.

## FROM → TO

| key | replacement | unit |
|:--|:--|:--|
| `EventPersistence.retention` | `retentionDays` | days |
| `EventSourcingConfig.retention` | `retentionDays` | days |
| `UpgradePlan.estimatedDuration` | `estimatedDurationSeconds` | seconds |
| `PluginHealthReport.metrics.uptime` | `uptimeMs` | milliseconds |
| `PluginHealthReport.metrics.responseTime` | `responseTimeMs` | milliseconds |
| `SandboxConfig.process.timeout` | `timeoutMs` | milliseconds |
| `KernelSecurityPolicy.authentication.tokenExpiration` | `tokenExpirationSeconds` | seconds |
| `KernelSecurityPolicy.auditLog.retention` | `retentionDays` | days |
| `PluginSecurityManifest.vulnerabilityDisclosure.responseTime` | `responseTimeHours` | hours |
| `PackageDependencyResolutionResult.resolvedIn` | `resolvedInMs` | milliseconds |
| `MultiVersionSupport.rollout.duration` | `durationMs` | milliseconds |
| `StartupOptions.timeout` | `timeoutMs` | milliseconds |
| `PluginStartupResult.duration` | `durationMs` | milliseconds |
| `StartupOrchestrationResult.totalDuration` | `totalDurationMs` | milliseconds |

**Every value is unchanged** — only key names move, and every default moves with
its key (`StartupOptions` still defaults to 30000, `EventSourcingConfig` to
365). Every old spelling is a `retiredKey()` tombstone, so it fails `tsc` at the
authoring site (input type `never`) and fails the parse with the rename
prescription rather than a bare unrecognized-key error.

## ⚠️ Two collisions this rename removes — check these by hand, not by search-and-replace

**`responseTime` meant two different units on two kernel shapes.** On
`PluginSecurityManifest.vulnerabilityDisclosure` it is HOURS (how fast a
publisher promises to answer a vulnerability report); on
`PluginHealthReport.metrics` the identical bare name is MILLISECONDS. So
`responseTime: 24` was a day on one shape and a fortieth of a second on the
other, with nothing at the authoring site to tell them apart. They land on
`responseTimeHours` and `responseTimeMs` respectively — do not let one
find-and-replace rewrite both.

**`uptime` is milliseconds here and SECONDS on `GET /health`.** That collision
was already costing prose: the protocol lifecycle page carried a standing
paragraph whose only job was telling the two apart. `metrics.uptime` becomes
`metrics.uptimeMs`; the seconds-valued `uptime` of the HTTP health body is a
separate, unchanged surface and must not be renamed with it.

A third split worth reading before you migrate: `estimatedDurationSeconds: 120`
is two MINUTES while `durationMs: 3600000` is one HOUR. Three adjacent
measurements of the same package install carried two different units, and no
parse can catch a value moved between them — both bounds accept any
non-negative integer.

## Dispositions — five semantic entries, no D2 conversion

Justified per key rather than defaulted, and this card's answer is uniform:
**none of the fourteen gets an ADR-0087 D2 conversion.** A D2 conversion runs
over a stack document, and `stack.zod.ts` declares no `eventBus`, `startup`,
`upgrade` or plugin-security root — none of these twelve defs is a stack
collection member or a registered metadata kind stored as a `sys_metadata` row,
so the conversion chain has no seam that would see one. They are host
construction arguments (`EventBusConfig`, `StartupOptions`, `SandboxConfig`,
`MultiVersionSupport`), package artifacts (`PluginSecurityManifest`) and
runtime-emitted measurements (`PluginHealthReport`, `PluginStartupResult`,
`StartupOrchestrationResult`, `UpgradePlan`,
`PackageDependencyResolutionResult`). Each therefore carries a **semantic**
entry, which is the disposition `kernel/HealthStatus:timestamp` already holds on
one of these very files (`epoch-instant-keys-renamed`, card 1/6) and what ruling
B prescribes for a key that is not authorable metadata. All fourteen are
registered by exact key in `RETIRED_KEYS_BY_MAJOR`.

## Keys deliberately left alone

`EventSourcingConfig.snapshotRetention` is a COUNT of snapshots and
`MultiVersionSupport.rollout.percentage` is a proportion — neither is a
duration, so neither has a unit to carry and both keep their names.
`RuntimeConfig.resourceLimits.timeout` names no unit anywhere in its prose, so
it is outside the gate's population and outside this rename; a pin test asserts
that, so a later sweep cannot read the four security renames as "every timeout
on that file".

## Readers moved in the same PR, at the same magnitude

`@objectstack/core`'s health monitor (`metrics.uptimeMs: Date.now() -
startTime`), the kernel and contracts test suites, and the hand-written
`content/docs/protocol/kernel/lifecycle.mdx`, whose `uptime` paragraph now
states the collision the rename removes.

⚠️ `packages/core/src/plugin-loader.ts` declares its OWN local
`PluginStartupResult` interface — a different type, carrying `startTime` rather
than any duration key. It is not a reader of this schema, it is untouched by
this rename, and the divergence between the two shapes is tracked separately.
