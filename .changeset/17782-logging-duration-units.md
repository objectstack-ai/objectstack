---
"@objectstack/spec": minor
---

feat(spec)!: the four `system/logging.zod.ts` duration keys carry their unit in the key name (#17782, ruling A on #15939)

<!-- adr-0087: registered logging-durations-unit-in-key -->

**BREAKING** — the HTTP log destination's batch flush, retry backoff start and request deadline,
and the logging buffer's flush, now carry `Ms` in the key name.

| def | before | after |
|:--|:--|:--|
| `HttpDestinationConfig` | `batch.flushInterval: 5000` | `batch.flushIntervalMs: 5000` |
| `HttpDestinationConfig` | `retry.initialDelay: 1000` | `retry.initialDelayMs: 1000` |
| `HttpDestinationConfig` | `timeout: 30000` | `timeoutMs: 30000` |
| `LoggingConfig` | `buffer.flushInterval: 1000` | `buffer.flushIntervalMs: 1000` |
| values, defaults, bounds | ms; 5000 / 1000 / 30000 / 1000; positive int | **unchanged** |

## Migration

```diff
  const destination = HttpDestinationConfigSchema.parse({
    url: 'https://logs.example.com/v1/logs',
-   batch: { maxSize: 500, flushInterval: 10000 },
-   retry: { maxAttempts: 3, initialDelay: 1000 },
-   timeout: 30000,
+   batch: { maxSize: 500, flushIntervalMs: 10000 },
+   retry: { maxAttempts: 3, initialDelayMs: 1000 },
+   timeoutMs: 30000,
  });

  const logging = LoggingConfigSchema.parse({
    name: 'app_logging',
    label: 'App logging',
    destinations: [],
-   buffer: { enabled: true, size: 5000, flushInterval: 2000 },
+   buffer: { enabled: true, size: 5000, flushIntervalMs: 2000 },
  });
```

Rename the keys. Every value is the same number of milliseconds it always was, and the
5000 / 1000 / 30000 / 1000 defaults are unchanged; nothing else on either def moves.

## Why

Each key named milliseconds in a source JSDoc — "Flush interval in milliseconds", "Initial retry
delay in milliseconds", "Timeout in milliseconds" — and the JSDoc above a key is not what
`content/docs/references/**` renders; `.describe()` is, and **none of the four carried one at
all**. Measured by the `check:duration-unit-keys` census on this tree before the change, all four
read `[name: -] [prose: -]`: no unit in the key, and no published prose to supply it either. So
`content/docs/references/system/logging.mdx` printed a bare `5000` / `1000` / `30000` / `1000`,
and nothing on the page decided milliseconds from seconds. Under the #14478 rule, moving the unit
into the describe alone would itself be a violation (unit in prose, none in the name), so each key
is renamed and given the describe it never had in the same stroke. Executes director-seat ruling A
on #15939 (2026-09-11, maintainer 「同意」, decision batch #115), the per-file remediation of the
#14478 rule.

⚠️ `flushInterval` was declared **twice** on this file, in two different defs and with two
different defaults — 5000 on the HTTP destination's `batch`, 1000 on the logging `buffer`. They are
two keys, not one; each gets its own tombstone, its own registered row, and a prescription that
names its def, so an author who lands on one is not sent to the other.

The `Ms` suffix is the family's own spelling, counted in key position on this tree: 272 `*Ms:`
declarations in `packages/spec/src` against 75 `*Seconds:`. The only competing unit spellings are
3 `*MS:` and 9 `*Millis:`, and every one of them mirrors a name fixed outside this repo — MongoDB's
`maxCommitTimeMS` and `connectTimeoutMS`, node-postgres's `idleTimeoutMillis` and
`connectionTimeoutMillis` on `PoolConfigSchema` — so unlike the `Ttl`-versus-`TTL` question a
sibling round had to settle, there was no in-repo alternative to choose between. All three target
spellings were already attested as key-position `*.zod.ts` declarations before this change:
`flushIntervalMs` 1 (on `kernel/events/integrations.zod.ts`, at the same 1000 default),
`initialDelayMs` 5, `timeoutMs` 30.

## The kit

- a `retiredKey()` tombstone on each of the four old spellings, so `tsc` types it `never` and a
  value reaching the parse raises the rename prescription instead of being silently stripped — none
  of the four enclosing objects is `.strict()` (`HttpDestinationConfig` itself and its nested
  `batch` and `retry`; `LoggingConfig`'s nested `buffer`)
- the ADR-0087 D3 semantic entry `logging-durations-unit-in-key` and four
  `RETIRED_KEYS_BY_MAJOR[18]` rows, one per key. No D2 conversion: `stack.zod.ts` declares no
  logging collection and neither `LoggingConfigSchema` nor `HttpDestinationConfigSchema` is
  referenced anywhere in `packages/spec/src` outside `system/logging.zod.ts`, so the chain has no
  rehydration seam that runs on an authored logging document — the same reading
  `tenant-schema-cache-ttl-unit-in-key` recorded for its sibling key
- pin tests per key: the refusal carries the rename prescription and names the def, the suffixed
  key parses at the magnitude the retired one carried with the same default, and the describe
  publishes the unit
- exactly one authorable-surface row pair moves, and it is the one that should: that ratchet records
  top-level keys per def (`build-schemas.ts` reads `schema.properties` one level deep), and
  `HttpDestinationConfig.timeout` is the only top-level key of the four —
  `system/HttpDestinationConfig:timeout` becomes `[RETIRED]` beside a new
  `system/HttpDestinationConfig:timeoutMs`, and the `authorable-defaults/` row is renamed with it.
  The three nested keys move neither file, which is correct and not an omission
- the pinned objectui checkout is untouched by this rename: at `.objectui-sha` pin
  `53ded82bf7a494f54e344e19099dbf00854b8694` it spells `flushInterval` 0 times, `initialDelay` 0,
  `HttpDestinationConfig` 0 and `LoggingConfig` 0 across its 6409 tracked files, against lit
  controls `useState` 2304 and `timeout` 702 on the same corpus
