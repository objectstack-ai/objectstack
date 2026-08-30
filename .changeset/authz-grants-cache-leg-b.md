---
"@objectstack/core": minor
"@objectstack/plugin-security": patch
"@objectstack/service-automation": patch
---

feat(core): cross-request authorization grants cache — leg B of #11633 (#11971)

`resolveUserAuthzGrants` can now cache its resolved envelope across requests,
governed by `OS_AUTHZ_GRANTS_CACHE_TTL_MS`. **The default is `0` — the cache is
OFF and the shipped behaviour is unchanged** (Fork 4 of the accepted #11633
design): a deployment that enables it accepts the configured staleness window
explicitly, and the boot-time posture statement says so out loud when no
cross-node invalidation bus is attached.

With the cache on:

- **Coarse write-invalidation (Fork 1A).** Any engine write to a watched
  authorization object (`sys_member`, `sys_user_position`,
  `sys_user_permission_set`, `sys_position`, `sys_position_permission_set`,
  `sys_permission_set`, `sys_user`) retires every entry on the writing node —
  a grant/revoke/role change is observed by the very next request there, by
  invalidation and not by TTL. `metadata.changed` and peer-node
  `authz.invalidated` hints retire wholesale via the engine write epoch.
  `sys_session` is deliberately not watched (its once-a-minute
  `last_activity_at` cadence would turn the cache into a non-cache).
- **Expiry-boundary rule.** Entries expire at `min(ttl, nextBoundary)`, where
  `nextBoundary` is the earliest upcoming ADR-0091 `valid_from`/`valid_until`
  among the rows consulted — a validity window flipping is a permission change
  with no write anywhere, so the timer is the only mechanism for that class.
- **Ruled bypass list.** The permission explainer
  (`plugin-security` `buildContextForUser`) and `runAs:'user'` automation runs
  (`service-automation`) always resolve fresh, and never populate the cache.
- The TTL remains the correctness contract; the `authz.invalidated` bus only
  narrows the typical cross-node window (no shipped driver exceeds
  at-most-once delivery).
