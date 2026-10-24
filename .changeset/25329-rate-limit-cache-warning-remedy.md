---
'@objectstack/plugin-auth': patch
---

fix: the degraded rate-limit warning names the remedy that boots: a shared `ICacheService` registered as `cache`

Clause-②: no
Metadata-protocol: none

With no `cache` service registered, the lazy counter store falls back to a per-process store and logs one warning. That warning told a multi-node deployment to use "Redis via @objectstack/service-cache". But `CacheServicePlugin` throws at `init` when `adapter: 'redis'` is set, so an operator who followed it got a boot failure.

The warning now names the working path: an `ICacheService` backed by a store every node reaches, registered as the `cache` service (`ctx.registerService('cache', impl)`). It no longer names a bundled adapter, so the text cannot go stale when one ships. The ADR-0069 D2 reference and the per-caller impact suffix are unchanged. The same applies to every counter built on `createLazyCounterStore`: better-auth's rate limit, the per-number OTP send budget, the SMS quotas and the runtime's inbound and endpoint limiters.
