---
'@objectstack/spec': patch
---

`BatchUpdateRequestSchema`'s cap comment no longer calls the batch-size cap "DEPLOYMENT policy". It is embedder-only, and this correction narrows the claim onto what is actually reachable.

`packages/spec/src/api/batch.zod.ts` ships in this package's tarball (`files[]` carries `src/**/*.zod.ts`), so the sentence a reader finds beside `records` is published text. It told them the cap — `RestServerConfig.batch.maxBatchSize`, 1..1000, default 200 — was deployment policy, i.e. something an operator deploying this platform could move. No shipped boot path makes that true.

**What the comment says now.** The cap keeps its span and its default as schema facts; the reachability sentence says who can write it. A `RestServerConfig` is the ARGUMENT a host passes when it constructs the server, and there is exactly one door: `createRestApiPlugin({ api })`. Neither shipped boot path opens it with a `batch` config — `os serve` forwards exactly two keys out of the stack config's `api:` block (`api.enableProjectScoping`, `api.projectResolution`) and the dev plugin calls `createRestApiPlugin()` with no config at all. A CLI-started deployment therefore always gets the default of 200, and no flag, config file or CLI option moves it; only the embedding host reaches anywhere in the 1..1000 span.

**Nothing executable moves.** No schema key is added, removed or renamed, no accept set widens or narrows, no export changes, and no runtime behaviour is touched. `records` still carries shape only, the cap is still enforced at the route, and `.min(1)` is still absent. The diff is comment text inside one `lazySchema` factory.

**Why this shipped as its own correction.** The same false claim had four other carriers, all already corrected under the same 2026-09-07 ruling: this package's `RestServerConfigSchema` docblocks and WHO CAN WRITE THIS CONFIG header, `enforceBatchSize` in `@objectstack/rest`, and the `data-api` and `http-protocol` reference pages. This was the fifth, and it carried the exact phrase struck from `enforceBatchSize` one package over. The wording is copied from those landings rather than invented, so the five now read the same way — as does the per-key REACHABILITY row in `liveness/batch_endpoints.json`, which also ships here.

Clause-②: no — comment text only. No authorable key moves, no export is added or removed, and no accept set changes in either direction.
