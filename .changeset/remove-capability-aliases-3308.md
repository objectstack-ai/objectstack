---
"@objectstack/spec": minor
"@objectstack/cli": minor
---

feat(spec)!: remove deprecated `aiStudio`/`aiSeat` capability aliases (#3308)

**BREAKING** (shipped as minor per the launch-window convention). The one-cycle
deprecation window from #3265 is over: the legacy camelCase `requires` spellings
`aiStudio`/`aiSeat` are no longer canonicalized to `ai-studio`/`ai-seat` — they
are now plain unknown tokens, rejected by `defineStack` like any other typo.

- Removed exports `DEPRECATED_PLATFORM_CAPABILITY_ALIASES` and
  `canonicalizePlatformCapability` from `@objectstack/spec`; `isKnownPlatformCapability`
  no longer canonicalizes.
- `defineStack` no longer rewrites aliases (the `canonicalizeStackRequires` pass
  is gone); the serve resolver no longer canonicalizes raw-artifact `requires`.

Migration: use the canonical kebab-case tokens `ai-studio` / `ai-seat`. All
first-party configs were migrated in #862/#863; only stacks still carrying the
legacy spelling are affected. Cloud's `objectos-runtime` (pinned to an older
framework) follows on its next `.framework-sha` bump.
