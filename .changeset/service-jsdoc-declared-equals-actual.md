---
"@objectstack/service-cache": patch
"@objectstack/service-job": patch
---

fix(services): two published `.d.ts` JSDoc comments stop describing behaviour their code does not have — `MemoryCacheAdapter` eviction is FIFO, not LRU, and `recordRuns` is an on/off switch, not a retention cap (#9611)

Both comments are emitted by `tsup` into each package's built `index.d.ts`, so they
are **the editor tooltip an npm consumer sees** — the same "published documentation
asserting behaviour the runtime does not have" class as #9517 and #9532, in a third
channel that no gate reads. No runtime behaviour changes in either package; this is a
patch because the corrected text only reaches consumers through a release.

**1. `MemoryCacheAdapter` — "LRU-style eviction" was never LRU.**

The class comment advertised `TTL-based expiry and LRU-style eviction`. The eviction
path takes `this.store.keys().next().value` — the first key in `Map` insertion order —
and `get()` returns `entry.value` without ever deleting and re-setting the key, so a
read does not move an entry back. Nor does an overwrite: `Map.set` on a key already
present keeps its original insertion slot. Eviction has therefore always been
**oldest-inserted (FIFO)**, which is a materially different hit-rate profile from the
one the tooltip promised anyone sizing a cache.

The comment was corrected rather than the code, deliberately: `maxSize` defaults to `0`
(unlimited), so the eviction path is off by default and nothing shipped is getting FIFO
where it expected LRU, and there is no measured pull for LRU. Minting a real behaviour
change to make a stale sentence true inverts the fix — the defect is that the
documentation lies, not that the cache is wrong. (A real LRU already exists in the repo,
`packages/metadata/src/utils/lru-cache.ts`, for the callers that need one.)

Four tests now pin the corrected sentence so it stops being an unenforced claim. Each is
written as a **discriminator against LRU**: it reads (or overwrites) the oldest entry
before overflowing the cache and then asserts that entry was evicted anyway — a hot key
dies on age, an untouched newer key survives. The pre-existing eviction tests could not
tell the two policies apart, which is how the wrong comment sat green.

**2. `DbJobAdapterOptions.recordRuns` — the comment described a different field.**

`/** Soft cap on sys_job_run rows recorded per job (defaults to none — handled by
retention jobs) */` made three claims and the code contradicts all three: the field is a
`boolean`, not a count; it defaults to `true`, not "none" (`args.options?.recordRuns ??
true`); and it gates whether a `sys_job_run` row is written at all, rather than being
trimmed later by retention. The sentence reads as if it belongs to the numeric
`JobRunRetention` knob that ADR-0057 retired — a copy-paste that outlived its source.

The consequence the new wording keeps in sight: **a reader who sets `recordRuns: false`
expecting "no cap" gets run history switched off.** The replacement states the real
meaning (one row per attempt, inserted at start and updated on settle, default `true`)
and both things that are *not* affected by the flag — the `sys_job` row's own
`last_status` / `run_count` / `failure_count` counters, which `bumpJob` updates
regardless, and `replay()`, which writes its synthetic `trigger: 'replay'` row without
consulting the flag at all.
