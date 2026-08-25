---
"@objectstack/core": patch
---

fix(core): `autoRestart` now fires for a health check that throws or times out, not only for one that returns a failure (#11852)

`PluginHealthMonitor.performHealthCheck` reaches its failure handling by two
disjoint routes, and only one of them could ever restart the plugin.

A check that **returned** a failure (`false` or `{ status: 'unhealthy' }`)
incremented `failureCounters`, cleared `successCounters`, and — once
`failureThreshold` consecutive failures accumulated — consulted `autoRestart`
and restarted the plugin. A check that **threw** took a separate `catch` block
that incremented `failureCounters` and stopped there: it never cleared
`successCounters` and never read `autoRestart`. Because `raceCheckTimeout`
rejects rather than resolving, every `timeout` overrun lands in that `catch`,
so a plugin that hung was marked `failed` and never restarted no matter how
many rounds passed or what `autoRestart` said. The severer of the two failure
modes was the one that could not trigger recovery.

Both routes now funnel into one `recordFailedRound` step that owns the
counters, the `failureThreshold` comparison and the `autoRestart` decision, so
a thrown or timed-out check is restart-eligible on exactly the same terms as a
returned failure.

The per-route *status* label is deliberately unchanged: a throw is still the
separate `failed` status applied immediately with no threshold, as
`content/docs/protocol/kernel/lifecycle.mdx` documents. Only the counters and
the restart decision are shared — those are what `failureThreshold` and
`autoRestart` declare, and neither names a route.
