---
"@objectstack/spec": minor
---

feat(spec)!: the four `system/tracing.zod.ts` duration keys carry their unit in the key name (#17785, ruling A on #15939)

<!-- adr-0087: registered system-tracing-otel-exporter-durations-unit-in-key -->

**BREAKING** — the OTel exporter deadline, the batch processor's two knobs and the background
span-export period now carry `Ms` in the key name.

| | before | after |
|:--|:--|:--|
| `OpenTelemetryCompatibility.exporter` | `timeout: 10000` | `timeoutMs: 10000` |
| `OpenTelemetryCompatibility.exporter.batch` | `exportTimeout: 30000` | `exportTimeoutMs: 30000` |
| `OpenTelemetryCompatibility.exporter.batch` | `scheduledDelay: 5000` | `scheduledDelayMs: 5000` |
| `TracingConfig.performance` | `exportInterval: 5000` | `exportIntervalMs: 5000` |
| values, defaults, bounds | ms; 10000 / 30000 / 5000 / 5000; `int().positive()` | **unchanged** |

## Migration

```diff
  const otel = OpenTelemetryCompatibilitySchema.parse({
    exporter: {
      type: 'otlp_grpc',
-     timeout: 10000,
+     timeoutMs: 10000,
      batch: {
-       exportTimeout: 30000,
-       scheduledDelay: 5000,
+       exportTimeoutMs: 30000,
+       scheduledDelayMs: 5000,
      },
    },
    resource: { serviceName: 'api-server' },
  });

  const tracing = TracingConfigSchema.parse({
    name: 'default_tracing',
    label: 'Default Tracing',
-   performance: { exportInterval: 5000 },
+   performance: { exportIntervalMs: 5000 },
  });
```

Rename the keys. Every value is the same number of milliseconds it always was, the
10000 / 30000 / 5000 / 5000 defaults are unchanged, and nothing else on either def moves.

## Why

Each key named milliseconds in a source JSDoc — "Timeout in milliseconds", "Export timeout in
milliseconds", "Scheduled delay in milliseconds", "Background export interval in milliseconds" —
and the JSDoc above a key is not what `content/docs/references/**` renders; `.describe()` is.
Measured on this tree: all four carried **no `.describe()` at all**, so the published reference
row for each was a bare integer with no unit anywhere on the page. That is a strictly worse
channel than the unit-in-prose shape #14478 already refuses — here the reference reader had no
prose to misread. All four magnitudes read plausibly in both units (10000, 30000, 5000, 5000),
and an operator who reads seconds sets an exporter deadline 1000x short. Executes director-seat
ruling A on #15939 (2026-09-11, maintainer 「同意」, decision batch #115), the per-file
remediation of the #14478 rule, and closes the last of that ruling's seven cards.

The suffix is the family's own spelling, counted in key position across `packages/spec/src`:
281 `*Ms` declarations over 42 distinct names, `timeoutMs` 65 of them and `intervalMs` 14,
against **0** key-position `timeoutSeconds`. The Delay-plus-`Ms` pairing is likewise already
attested (`maxDelayMs`, `initialDelayMs`, `retryDelayMs`, `delayMs`, `debounceDelayMs`) with no
competing `scheduledDelay` spelling anywhere. This file is milliseconds throughout and its own
landed precedent is `Span.duration → durationMs` (#15679) — the opposite of the sibling metrics
card, whose rows were seconds.

`exporter.timeoutMs` and `exporter.batch.exportTimeoutMs` deliberately sit one nesting level
apart. The pair pre-exists the rename: the `batch` sub-object is the OpenTelemetry batch span
processor's own four knobs (max batch size, max queue size, scheduled delay, export timeout)
beside the exporter's own request deadline. Renaming either to something more distinctive would
depart from the vocabulary this shape mirrors, and the nesting already disambiguates every read
point — `exporter.timeoutMs` versus `exporter.batch.exportTimeoutMs`.

## The kit

- a `retiredKey()` tombstone on each old spelling, so `tsc` types it `never` and a value
  reaching the parse raises the rename prescription instead of being silently stripped. Neither
  `OpenTelemetryCompatibilitySchema` nor `TracingConfigSchema` nor any object nested inside them
  is `.strict()`, so `unrecognized_keys` was never the alternative — a bare deletion would have
  landed a default on an exporter deadline and a background export period
- the ADR-0087 D3 semantic entry `system-tracing-otel-exporter-durations-unit-in-key` and four
  `RETIRED_KEYS_BY_MAJOR[18]` rows. No D2 conversion: `stack.zod.ts` declares no tracing
  collection, no metadata-type binding or manifest embed carries either def, and a tracing
  configuration is never a stored `sys_metadata` row — so the chain has no seam that runs on
  them, the same reading `system-tracing-span-duration-unit-in-key` recorded for the other key
  on this file
- pin tests: a refusal pin per row asserting the issue **code** (never a bare `toThrow()`) and
  the FROM → TO prescription, an acceptance pin at each retired key's magnitude with the same
  default, a bounds pin, and a describe pin proving the unit now reaches the published channel
- the `authorable-surface` / `authorable-defaults` ratchets move **nothing**, and that is the
  correct outcome rather than an omission: those artifacts record top-level keys per def
  (`build-schemas.ts` reads `schema.properties` one level deep) and every one of these four is
  nested
- `Span.duration → durationMs`'s own entry is untouched — a predecessor's scoped record stays
  true, and this round's entry opens by saying how it relates to it
