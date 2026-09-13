---
"@objectstack/spec": minor
---

feat(spec)!: the five `system/metrics.zod.ts` durations carry their unit in the key name (#17783, ruling A on #15939)

<!-- adr-0087: registered system-metrics-jsdoc-durations-unit-in-key -->

**BREAKING** — the five metrics durations whose unit was stated only in a source JSDoc now carry
it in the key name, and each published `.describe()` states it too.

| def | before | after |
|:--|:--|:--|
| `MetricDefinition` | `summary.maxAge: 600` | `summary.maxAgeSeconds: 600` |
| `ServiceLevelObjective` | `errorBudget.burnRateWindows[].window: 3600` | `errorBudget.burnRateWindows[].durationSeconds: 3600` |
| `MetricExportConfig` | `interval: 60` | `intervalSeconds: 60` |
| `MetricsConfig` | `collectionInterval: 15` | `collectionIntervalSeconds: 15` |
| `MetricsConfig` | `retention.period: 604800` | `retention.durationSeconds: 604800` |

Every value is seconds, exactly as before, and every default (600, 3600 as authored, 60, 15,
604800) is unchanged.

## Migration

```diff
  summary: {
-   maxAge: 600,
+   maxAgeSeconds: 600,
  }

  errorBudget: {
-   burnRateWindows: [{ window: 3600, threshold: 14.4 }],
+   burnRateWindows: [{ durationSeconds: 3600, threshold: 14.4 }],
  }

  exports: [{
    type: 'prometheus',
-   interval: 60,
+   intervalSeconds: 60,
  }],
- collectionInterval: 15,
+ collectionIntervalSeconds: 15,
  retention: {
-   period: 604800,
+   durationSeconds: 604800,
  },
```

Rename the keys. Nothing else on these four defs moves, and the three same-named objects on this
file — `MetricAggregationConfig.window`, `ServiceLevelIndicator.window` and
`ServiceLevelObjective.period` — are untouched.

## Why

Each key named its unit in a source JSDoc — "Max age of observations in seconds", "Window size in
seconds", "Export interval in seconds", "Collection interval in seconds", "Retention period in
seconds" — and nowhere else. Four of the five carried no `.describe()` at all and the fifth read
"Window size", so the text `content/docs/references/system/metrics.mdx` publishes named no unit:
600, 3600, 60, 15 and 604800 are each a plausible number of seconds and a plausible number of
milliseconds, and nothing on the page decided between them. Executes director-seat ruling A on
#15939 (2026-09-11, maintainer 「同意」, decision batch #115), the per-file remediation of the
#14478 rule — under that rule, moving the unit into the describe alone is itself a violation (unit
in prose, none in the name), so each key is renamed and its describe corrected together.

Three of the five new names are deliberately **not** the mechanical suffix, and this file supplied
the reason for each:

- `burnRateWindows[].window` → **`durationSeconds`**, not `windowSeconds`. It is the fourth window
  length on this file, and #15679 already settled that a window length here reads `durationSeconds`
  so the measurements read alike. `windowSeconds` would stutter against the enclosing
  `burnRateWindows` array — the same objection #15679 recorded against `window.windowSeconds` — and
  on this tree `windowSeconds` is not an authorable key at all: its only key-position occurrence is
  an alias-map entry in `ServerRateLimitConfigSchema` that maps the spelling *away* to `windowMs`.
- `retention.period` → **`durationSeconds`**, not `periodSeconds`. `period` is calendar vocabulary
  elsewhere in this spec (`ServiceLevelObjective.period.type` selects rolling or calendar,
  `PluginRegistryEntry.pricing.billingPeriod` is monthly or yearly), so `periodSeconds` would have
  kept the ambiguous half of the name — the same objection #15679 raised against `sizeSeconds`.
- `collectionInterval` → **`collectionIntervalSeconds`**, keeping the qualifier, because
  `MetricExportConfig.intervalSeconds` is a different cadence one def over that this same change
  creates.

The two mechanical spellings are attested: `maxAgeSeconds` is the token
`AccessControlConfig.maxAgeSeconds` already carries after this same rule renamed it on
`system/object-storage.zod.ts`, and it keeps the `age` stem that the sibling `ageBuckets` counts
buckets of; `intervalSeconds` is the token four seconds-valued cadences already carry. Counted in
key position across `packages/spec/src`, the seconds suffixes run `Seconds` 40, `Sec` 1, `S` 0.

## The kit

- a `retiredKey()` tombstone on each old spelling, so `tsc` types it `never` and a value reaching
  the parse raises the rename prescription instead of being silently stripped (none of the five
  enclosing shapes is `.strict()`)
- the ADR-0087 D3 semantic entry `system-metrics-jsdoc-durations-unit-in-key` and five
  `RETIRED_KEYS_BY_MAJOR[18]` rows. No D2 conversion: `stack.zod.ts` declares no metrics collection
  and none of these defs is a stored metadata row — the reading
  `system-metrics-window-durations-unit-in-key` already recorded for this file
- pin tests per key: the refusal carries the rename prescription and is not an `unrecognized_keys`
  issue, the suffixed key parses at the magnitude the retired one carried with the same default,
  and each describe publishes the unit
- two authorable-surface rows move, three do not: that ratchet records **top-level** keys per def,
  so `MetricExportConfig:interval` and `MetricsConfig:collectionInterval` become `[RETIRED]` beside
  their suffixed rows (and their `authorable-defaults` rows move with them), while
  `summary.maxAge`, `burnRateWindows[].window` and `retention.period` are nested and move nothing
