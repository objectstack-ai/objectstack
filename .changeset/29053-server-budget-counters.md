---
'@objectstack/runtime': patch
'@objectstack/service-sms': patch
'@objectstack/service-automation': patch
'@objectstack/core': patch
---

fix(server): every budget counter holds its limit under concurrent requests, counts in a registered `cache` service, and keeps its in-process fallback bounded

Clause-②: no
Metadata-protocol: none

The rule `@objectstack/plugin-auth`'s counters already follow now holds for the server's other budget counters (ADR-0069 D2).

- **`@objectstack/runtime`: a token bucket holds its budget under concurrency inside one process.** Updates of one bucket key are serialised in the process, so the inbound limiter (`server.security.rateLimit`) and a declared endpoint `rateLimit` admit no more requests than their budget for one caller however many arrive at once. Other callers keep counting concurrently.
- **The counters count in the registered `cache`.** When a `cache` service is registered, as a value or as a factory, the runtime's inbound and endpoint buckets, the daily SMS send quota (`@objectstack/service-sms`) and the `notify` node's per-address email-field limit (`@objectstack/service-automation`) count in it. The kernel's own in-memory stand-in is not a shared store: with no cache plugin they keep their bounded per-process fallback and say so once.
- **`@objectstack/core`: the in-memory `cache` fallback stays bounded.** Entries whose time-to-live has passed leave it without having to be read again, so it holds at most about twice its live entries. Nothing live is evicted; the `ICacheService` contract is unchanged.
- **Across nodes, unchanged.** `ICacheService` has no atomic increment, so two nodes that share one cache can still over-admit slightly between them, as documented.
