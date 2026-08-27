---
"@objectstack/objectql": minor
"@objectstack/core": minor
"@objectstack/service-cluster": minor
"@objectstack/runtime": minor
"@objectstack/plugin-security": patch
---

feat(engine,core,cluster): the authorization-cache invalidation substrate — an engine-seam write epoch, the `authz.invalidated` channel, and a non-optional boot-time posture statement (#11968)

The substrate step (§10.3) of the accepted #11633 cross-request caching design
(maintainer acceptance 2026-08-25, Fork 2 → B). It ships the invalidation
machinery once, before the grants cache (#11967) that will consume it, so that
leg does not carry it. **Nothing here caches anything.**

- **`ObjectQL.writeEpoch`** — a monotonic counter advanced by the engine
  middleware seam on every `insert` / `update` / `delete`, ahead of the whole
  chain (and so ahead of any `isSystem` bypass a middleware applies). It
  generalises the private counter `@objectstack/plugin-security` has carried
  since #10757: the mechanism was always the engine's, and hoisting it lets a
  second consumer share **one** signal instead of minting a parallel one that
  watches a different set of writes. A seam rather than a list of call sites,
  because a forgotten call site fails as silent over-permission and writing
  through the engine is the only way to write at all — including better-auth's
  own adapter.
- **`authz.invalidated`** — one new channel on the existing `IPubSub`, bridged
  in the shape `MetadataClusterBridgePlugin` already uses. ⭐ **The TTL a
  consuming cache carries is the correctness contract; this channel is not.** No
  shipped driver delivers better than at-most-once (`cluster.mdx` §4.2), so a
  missed message is *expected*, the bridge stays out of the write path (a
  publish failure is logged and swallowed, never awaited by the writer), and the
  channel only moves the *typical* convergence from one TTL to one network hop.
  That statement lives in the code at the channel, where a consumer reads it.
- **The boot-time posture statement** — non-optional by the ruling. Whenever a
  grants cache is enabled (`OS_AUTHZ_GRANTS_CACHE_TTL_MS` > 0) and there is no
  cross-node invalidation bus, the deployment is told so at `warn`, every boot,
  naming the window it accepted and the remedy. It is a statement, not a
  refusal: a TTL-bounded per-process cache is a legitimate configuration. It is
  said out loud because a silently-absent invalidation bridge is how a security
  control gets disabled with nobody noticing (#4785). The in-process `memory`
  driver counts as **no** bus — a cluster service exists on the shipped default
  while fanning out to nobody, which is the case a "is a cluster service
  registered?" check answers `yes` to and is wrong about.

**Runtime behaviour is unchanged.** With no cache consumer the epoch has zero
subscribers, so nothing is published and nothing is invalidated; with the
shipped default TTL of `0` the bridge attaches nothing and logs nothing above
`debug`. The one composition change worth naming: `Runtime` now registers
`AuthzClusterBridgePlugin` **unconditionally**, including under `cluster: false`
— that is not an oversight, it is the loudest case the posture check has, and
skipping it there would put the statement's absence exactly where the missing
bus is.

`@objectstack/plugin-security` is a `patch`: its permission-set memo now reads
the engine's epoch when the wired engine exposes one and keeps its private
counter otherwise (test doubles, embeddings). The covered set of writes is
identical — the plugin's own middleware was already global — and it is now
identical *by construction* rather than by two files agreeing on which
operations count.
