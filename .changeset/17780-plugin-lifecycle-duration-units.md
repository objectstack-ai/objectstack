---
"@objectstack/spec": minor
"@objectstack/core": minor
---

feat(spec)!: the three `kernel/plugin-lifecycle-advanced.zod.ts` duration keys carry their unit in the key name (#17780, ruling A on #15939)

<!-- adr-0087: registered kernel-health-check-and-hot-reload-durations-unit-in-key -->

**BREAKING** — the health-check period, the health-check deadline and the hot-reload debounce
now carry `Ms` in the key name.

| | before | after |
|:--|:--|:--|
| `PluginHealthCheck` | `interval: 30000` | `intervalMs: 30000` |
| `PluginHealthCheck` | `timeout: 5000` | `timeoutMs: 5000` |
| `HotReloadConfig` | `debounceDelay: 1000` | `debounceDelayMs: 1000` |
| values, defaults, min bounds | ms; 30000 / 5000 / 1000; min 1000 / 100 / 0 | **unchanged** |

## Migration

```diff
  const health = PluginHealthCheckSchema.parse({
-   interval: 30000,
-   timeout: 5000,
+   intervalMs: 30000,
+   timeoutMs: 5000,
  });

  hotReload.registerPlugin('my-plugin', {
-   debounceDelay: 1000,
+   debounceDelayMs: 1000,
  });
```

Rename the keys. Every value is the same number of milliseconds it always was, and the
30000 / 5000 / 1000 defaults are unchanged; nothing else on either def moves.

## Why

Each key named milliseconds in a source JSDoc — "Health check interval in milliseconds",
"Timeout for health check in milliseconds", "Debounce delay before reloading (milliseconds)" —
and the JSDoc above a key is not what `content/docs/references/**` renders; `.describe()` is.
Measured by the `check:duration-unit-keys` census on this tree, all three read
`[name: -] [prose: -]`: no unit in the name and none in the published prose either.
`interval` was the sharpest of the three — its describe carried one unit-shaped token, the
parenthetical "(default: 30s)", naming SECONDS for a value the schema bounds and defaults in
MILLISECONDS. Executes director-seat ruling A on #15939 (2026-09-11, maintainer 「同意」,
decision batch #115), the per-file remediation of the #14478 rule.

The suffix is the family's own spelling, counted on this tree: 100 key-position `*Ms`
declarations across `packages/spec`, `timeoutMs` 29 of them and `intervalMs` 3.
`debounceDelay` takes the plain suffix rather than a shortened form because it is the only
debounce-shaped key spelling in the repo (no `debounceMs` variant anywhere) while the
Delay-plus-`Ms` pairing is already attested (`maxDelayMs`, `initialDelayMs`, `retryDelayMs`,
`delayMs`) — so unlike the `Ttl`-versus-`TTL` question the sibling round settled, there was no
competing family spelling to choose between.

## The kit

- a `retiredKey()` tombstone on each old spelling, so `tsc` types it `never` and a value
  reaching the parse raises the rename prescription instead of being silently stripped —
  neither `PluginHealthCheckSchema` nor `HotReloadConfigSchema` is `.strict()`, and here the
  stripped value would land on a `setInterval` period, a race deadline and a `setTimeout` delay
- the ADR-0087 D3 semantic entry `kernel-health-check-and-hot-reload-durations-unit-in-key` and
  three `RETIRED_KEYS_BY_MAJOR[18]` rows. No D2 conversion: neither def is an authorable
  surface — both are library parameters a host passes to `PluginHealthMonitor` /
  `HotReloadManager` in TypeScript — so the chain has no seam that runs on them, the same
  reading `plugin-auto-restart-never-reinitialised` and `hot-reload-watch-placeholder-retired`
  recorded for keys on these two defs
- `@objectstack/core` moves with the rename: `PluginHealthMonitor` and `HotReloadManager` read
  the suffixed keys, and each class's registration-time refusal table gains a row so a host
  still passing an old spelling is answered with an ADR-0112 `VALIDATION_ERROR` / 400 naming
  the rename, rather than getting `undefined` where a duration belongs
- pin tests on both schemas and both classes: the refusal carries the rename prescription, the
  suffixed keys parse at the magnitude the retired ones carried with the same defaults, and the
  describes publish the unit. The two minimum-bound pins were rewritten rather than left: spelled
  through the bare keys they would have stayed green off the tombstone's refusal instead of the
  bound, so they now assert the `too_small` issue code on the suffixed keys
- `HotReloadConfig.shutdownTimeout` is deliberately NOT renamed with them — its JSDoc reads
  "Graceful shutdown timeout" and names no unit anywhere, so it is the unit-nowhere shape the
  #14478 gate leaves outside its verdict, not part of this row set
