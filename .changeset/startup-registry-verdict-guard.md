---
---

Tooling-only: `pnpm check:startup-registry-verdict` — startup registry reads may not record a verdict the boot can still contradict (#4777). Adds `scripts/check-startup-registry-verdict.mjs` + the shrink-only `scripts/startup-registry-verdict.baseline.json` (empty on landing), a `Lint & Type Check` step, and an AGENTS.md section. Releases nothing — no package changes.

One showcase cold start on 2026-08-03 produced three instances of one shape in three unrelated subsystems written by three people at three times: ask a registry "is X there?" while the boot is still filling it, treat the "no" as final, and **record** it — cached on the instance (#4772 plugin-auth), asserted in a `warn` (#4771 service-automation), or written to the database (#4769 objectql). The provider registers a moment later and nothing undoes the record. All three are fixed; this is what stops the class from coming back.

The gate matches the three-part shape, and part 3 is what makes it a rule rather than noise — a read-only probe stays completely legal, and the cures are never flagged: a probe deferred into a lazy accessor or a `kernel:ready` hook, a probe whose ordering an ADR-0116 declaration (`dependencies` / `optionalDependencies` / `requiresServices`) has already made final, and a verdict drawn at a declared seal (`sealNodeTypeVocabulary()`) all pass.

Its reach is stated rather than implied: it under-matches on purpose. `getService('cache')` is visible, a `resolveCacheOrFallback()` three layers down another package is not, and #4769 is invisible to it entirely — that "registry" is the `sys_migration` table in a database. This stops the bleeding; it does not cure. Whether the kernel contract should be tightened further is #4776.
