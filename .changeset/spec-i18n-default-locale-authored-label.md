---
"@objectstack/spec": minor
---

feat(spec): the authored label is the default locale's text — `ResolveOptions.defaultLocale` skips the fallback chain for a default-locale request, and a chain-less caller no longer falls to a literal `en` (#15711)

<!-- adr-0087: not-required (no-migration-prescription) A published RUNTIME DEFAULT moves: the label resolvers' chain-less fallback, a literal `['en']` before this change, is now `[]`; and one OPTIONAL key is added to a plain TS options interface (`ResolveOptions.defaultLocale` in `packages/spec/src/system/i18n-resolver.ts`). No Zod schema, no authorable metadata key and no stored row changes shape, so the meta conversion tooling has nothing to touch and a registry entry would be false data in the one ledger this gate keeps true. Which TEXT answers a chain-less non-default request moves; nothing starts failing, and no source edit is prescribed: a host that wants `en` consulted declares `fallbackChain: ['en']`, which it always could. -->

**BREAKING** (launch-window convention: ships as `minor`; this entry is the signal) — the second facet of the #15711 ruling moves a published default of the `@objectstack/spec/system` label resolvers. A caller that passes no `fallbackChain` used to get a literal `['en']`; it now gets `[]`, "requested locale, then the authored label". Nothing silently falls to `en` because a literal said so: a chain is consulted only when someone declared it. In this repo the blast radius is zero production callers (the REST serving layer has declared its chain since #14882; one pin flips); out-of-repo hosts unmeasured. A host that relied on the implicit `en` declares it as `fallbackChain: ['en']`.

## The ruling (#15711, recorded 2026-09-05)

A workspace that authors its metadata labels in its default locale (`i18n.defaultLocale: 'zh-CN'`, inline `label: '填报单'`) and ships a courtesy `en` bundle used to serve `Entry Sheet` to a `zh-CN` request whenever its declared chain named `en` — a reflexive `fallbackLocale: 'en'` in an AI-authored config was enough. `os i18n check` already counted the authored text as the default locale's coverage; the runtime did not. Ruled A: **the authored label IS the default locale's text**.

- `ResolveOptions` gains an optional `defaultLocale?: string` — the deployment's default locale, the language its labels are authored in. When the requested locale names it (BCP-47 tags compare case-insensitively, the same rule `resolveBundleLocale` applies), the resolvers consult the requested locale's own bundle and then answer with the authored label; the fallback chain is not walked.
- `fallbackChain` keeps its full meaning for every non-default request: a `fr` request still walks the `fr` bundle, then the declared `en` bundle, then the authored label.
- A bundle entry for the default locale still wins when one is shipped, so `os i18n extract --locales=zh-CN` keeps working — optional now, not required.
- `II18nService.getDefaultLocale()` documents that it is also what the serving layer threads into `ResolveOptions.defaultLocale`; `@objectstack/rest` passes it through its single `translateOptionsFor` seam (that package's own changeset).

Unchanged: `os i18n check`; both boot paths (`os serve` and the dev plugin still collapse the declaration to `fallbackLocale || defaultLocale || 'en'` before constructing the service); every request whose locale is not the default.

Not taken, ruled out on the card: the rule living only in `packages/rest` (every other host would re-implement it and spec could not pin it); requiring every supported locale to ship a bundle (a generated bundle that duplicates the app's own source text, the stale-translation class already closed); documenting the divergence.
