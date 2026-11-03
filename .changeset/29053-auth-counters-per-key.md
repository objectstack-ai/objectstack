---
'@objectstack/plugin-auth': patch
---

fix(plugin-auth): a rate limit admits no more than its limit inside one process, and the auth counters count in a registered `cache` service

Clause-②: no
Metadata-protocol: none

- **A limit holds under concurrency inside one process.** Updates of one counter key are now serialised in the process: a fixed-window limit of `max` admits at most `max` requests per window for one key however many arrive at once, and every request is counted. This holds in the per-process store and in the kernel `cache` alike. It covers better-auth's sign-in and sign-up rate limits (`rateLimit.customStorage`), the counters of the exported `cacheSecondaryStorage()` adapter, the signed-out invitation preview, and every other caller of `incrementFixedWindow` (`@objectstack/plugin-auth/rate-limit-storage`). The per-number OTP send budget follows the same rule: one number is granted no more sends than its cooldown and hourly cap allow. Other keys keep counting concurrently.
- **The counters count in the registered `cache`.** When a `cache` service is registered, as a value or as a factory, the rate limits, the OTP send budget and the invitation preview count in it. They fall back to a per-process store only when none is registered, and say so once. The service is resolved through the kernel the plugin context hands out (`getKernel().getServiceAsync`), or through `getService` on a host without service factories (`LiteKernel`).
- **Across nodes, unchanged.** `ICacheService` has no atomic increment, so two nodes that share one cache can still over-admit slightly between them (ADR-0069 D2), as documented. That is still strictly better than counting per node.
