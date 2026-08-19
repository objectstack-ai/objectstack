---
"@objectstack/observability": patch
---

docs(observability): record what a zero on `cache_*` MEANS — "no configured consumer", not "no cache activity" (#9954)

`SEMCONV` declares the `cache_*` families as a stable namespace explicitly so
hosts can wire alerts and dashboards against it. An operator who does that gets
a flat zero on `cache_lookups_total` in a default install — and nothing in the
declaration or the operator docs said why, so the only available readings were
"0% hit rate" or "the adapter is broken". Both are wrong.

**Nothing about emission changes.** The path is proven working: #9832 wired the
cache adapter to the host's registry and #9951 pins a real lookup observing
`cache_lookups_total{adapter=memory,result=miss}`. The zero is *true*; what it
failed to communicate is its cause.

The cause, re-measured on `origin/main` rather than taken from the card: no
consumer of the `cache` service is unconditional. Every production consumer is
a rate-limit or budget counter store, and each is gated on a declaration
somebody has to write:

- `packages/plugins/plugin-auth/src/auth-plugin.ts` — better-auth's per-IP
  counters, reached only when `rate_limit_max` or `rate_limit_window_seconds`
  is explicitly supplied in auth settings.
- `packages/runtime/src/dispatcher-plugin.ts` — the inbound rate limiter and
  the declarative per-endpoint buckets. Both register *nothing at all* when no
  budget is declared (`createInboundRateLimitMiddleware` returns `null`;
  `limiterFor` returns `null` on an endpoint with no armed `rateLimit`), so an
  unmetered deployment never reaches the cache.
- the per-number OTP send budget, reached only on an SMS send path.

Declare none of them — the default slate — and the family sits at 0 while the
server handles traffic normally.

So the annotation states the invariant rather than a roster: *every* consumer
is an explicitly-declared rate-limit/budget counter store. That sentence stays
true when another conditional consumer is added, and goes false exactly when an
unconditional one appears — which is when it should be revisited.

This is the mirror image of the HTTP note that landed alongside it: there a
zero means "not instrumented"; here a zero is a true count of a service nothing
asked anything of. The two are deliberately worded so they cannot be read as
the same statement.
