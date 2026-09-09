---
"@objectstack/rest": patch
---

`enforceBatchSize`'s docblock no longer calls the batch cap "deployment policy". It is embedder policy, and this correction narrows the claim onto what is actually reachable.

`RestServerConfig.batch.maxBatchSize` (1..1000, default 200) is the argument a host passes when it constructs the server. There is exactly one door — `createRestApiPlugin({ api })`, whose `start()` is the only non-test site that reaches `new RestServer(...)` — and neither shipped boot path opens it with a `batch` config: `os serve` forwards exactly two keys out of the stack config's `api:` block (`api.enableProjectScoping`, `api.projectResolution`), and the dev plugin calls `createRestApiPlugin()` with no config at all. So a CLI-started deployment always gets the 200 default, and no flag, config file or CLI option moves it. An operator reading the old sentence would have gone looking for a knob that is not there.

The wording now matches what `@objectstack/spec` 17 already says about the same key — `Reachability: EMBEDDER-ONLY` in the `BatchEndpointsConfigSchema` docblock and the WHO CAN WRITE THIS CONFIG header of `rest-server.zod.ts`, plus the per-key REACHABILITY row in the liveness ledger. Two wordings for one fact in two packages is how the claim survived the spec-side correction.

No behaviour change: the 1..1000 range and the 200 default are unchanged and still enforced on all five bulk routes. Hosts that construct their own `RestServerConfig` keep setting the cap exactly as before.
