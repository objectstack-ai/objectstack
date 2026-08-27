---
"@objectstack/core": minor
---

feat(core): cache successful `sys_setting` localization reads, invalidated synchronously on write (#11966)

Leg C (ship-first) of the accepted #11633 cross-request caching design
(maintainer acceptance 2026-08-25, forks 1A / 2B / 3A / TTL-0).
`resolveLocalizationContext` re-read `sys_setting` on **every** authenticated
request to answer the same three keys — `timezone` / `locale` / `currency` —
for a workspace whose values change roughly never. That read is now cached.

**Grade: `minor`, not `patch`.** It adds a deployment variable
(`OS_LOCALIZATION_CACHE_TTL_MS`) and changes the query pattern of a shipped code
path. Not `major`: the observable contract callers actually depend on — a
settings write is visible to the very next read — is preserved, and pinned.

Caching this read was tried once before and reverted. #10221's first version
memoized every outcome for 30s and CI went red on
`analytics-timezone.dogfood.test.ts`, which writes a new org timezone and
expects the very next analytics query to bucket under it; the cache was narrowed
to memoize **failures** only. That verdict was on **TTL-only** caching and it
still stands unamended. What changed is that the process now has invalidation
seams it did not have then:

- **Primary — the settings change seam.** `SettingsService.subscribe(ns, handler)`
  dispatches synchronously and in-process from the write path, after the row is
  persisted. (⚠️ #11633 calls this a "settings change bus"; no such module
  exists — `subscribe()` is the seam. No change was needed in
  `@objectstack/service-settings`: the seam was already public and already does
  exactly this.)
- **Backstop — the engine write epoch** from #11968's substrate. Needed because
  this resolver's own fallback reads `sys_setting` *directly*, so a seeder or
  any other direct engine write emits no settings event at all. It is read
  structurally rather than imported, because `@objectstack/objectql` depends on
  `@objectstack/core` and the substrate declared `WriteEpochLike` separately for
  exactly this consumer. A peer node's hint arrives as a local bump, so an
  attached `authz.invalidated` bridge narrows cross-node convergence for free.
- **TTL** — the residual bound, for what neither seam can see. Default 30s,
  `0` disables the cache on a real path rather than a degenerate one.

Two rules carry the change and are pinned rather than merely documented:

1. **A success is cached only when the engine exposes the write epoch.** A `ql`
   with no seam is a `ql` whose writes the cache cannot observe, so rather than
   degrade to the TTL-only shape that was already reverted here once, the cache
   declines. A partial `{ current }` shape is not a seam either — a counter
   nothing can bump would read as a live invalidation source and pin the answer
   for a whole TTL.
2. **Invalidation retires success entries only.** #10221's failure memo exists
   for an environment where `sys_setting` is missing; retiring it on a write
   would restart precisely the per-request driver log spam that memo removed,
   and no write can create a missing table. It stays TTL-bound and behaves
   exactly as #10221/#11877 shipped it.

`analytics-timezone.dogfood.test.ts` is unchanged and unweakened — it is this
leg's acceptance test, and an ablation that reduces the cache to its TTL turns
it red on the same assertion the original revert was recorded against.
