---
'@objectstack/spec': minor
---

spec: the genuine duration rows declare their unit — `DurationMs` / `DurationSeconds` and two `externalVocabulary` mirrors (#18124)

**BREAKING** — three keys that accepted any `number` now accept whole, non-negative numbers only. No key is renamed, added or removed, and no exported symbol moves.

Step ③ of ruling A on #18115. Step ① added the closed duration vocabulary and step ② taught `check:duration-unit-keys` to read it; this converts the rows the census found carrying a genuine duration with its unit written down in no channel a reader can reach.

**Six rows declare the unit on the value**, by adopting `DurationMs` / `DurationSeconds` (`@objectstack/spec/shared`) and stating the unit in the describe the reference page renders:

- `API.BaseResponse.meta.duration` — milliseconds
- `Kernel.HotReloadConfig.shutdownTimeout` — milliseconds
- `System.MetricAggregationConfig.window.slideInterval` — seconds
- `System.MetricsConfig.retention.downsampling[].resolution` — seconds
- `System.MetadataLoadResult.loadTime`, `System.MetadataSaveResult.saveTime` — milliseconds

**Two rows declare it by mirror**, with `.meta({ externalVocabulary })` plus the unit in the describe, because the key name is fixed outside this repo and renaming it would break the correspondence that makes it readable:

- `Kernel.KernelSecurityPolicy.cors.maxAge` — seconds, per CORS `Access-Control-Max-Age` (WHATWG Fetch). This is the same declaration its twin `CorsConfig.maxAge` already carried.
- `System.AuthConfig.session.updateAge` — seconds, per better-auth `session.updateAge`. Its sibling `session.expiresIn` already carried the marker; this closes the pair.

**What an author must change: nothing, unless they were writing a fraction or a negative span.** Only `meta.duration`, `loadTime` and `saveTime` change what they accept — each was a bare `z.number()` and is now `z.number().int().nonnegative()`. `shutdownTimeout` declared `.int().min(0)` and `slideInterval` / `resolution` declared `.int().positive()`; all three keep their floor, so their accepted set is byte-for-byte what it was and only their description is new. The two mirror rows keep their types untouched.

Every unit is a measurement of the row's producer, printed in the PR body per row, never a reading of the key name.

Clause-②: no (narrowing)
<!-- adr-0087: not-required (no-migration-prescription) No key is renamed, removed or retired, so there is no FROM to TO mapping an upgrader could be given: the three narrowing rows refuse only a fraction or a negative span, and every measured producer already writes a whole, non-negative count. -->
