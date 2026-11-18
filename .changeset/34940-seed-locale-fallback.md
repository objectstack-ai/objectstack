---
'@objectstack/spec': minor
'@objectstack/metadata-protocol': minor
---

feat(spec, metadata-protocol): `Seed.fallback` marks the set an organization gets when its locale matches no set of the object

Clause-②: yes (widening) — one new optional key, `fallback: true`, on a seed dataset (`SeedSchema`); a seed without it parses and loads exactly as before
Metadata-protocol: added

An app that splits a seed by language with `locale` (a `zh-CN` and an `en` set of the standard price book) used to leave an organization on any other locale (`ja-JP`, `es-ES`) with neither set. Mark one set `fallback: true` and it also loads for every resolved locale that no locale-scoped set of the same object lists:

```ts
defineSeed(PriceBook, { locale: ['zh-CN'], records: [{ name: '标准价格表' }] });
defineSeed(PriceBook, { locale: ['en', 'en-US'], fallback: true, records: [{ name: 'Standard' }] });
```

It is honoured wherever a load filters by locale: the boot seed and the dev hot reload (the app's `i18n.defaultLocale`), and the per-organization replay, marketplace install, sample-data reseed and restart heal (the locale `resolveSeedLocaleForLoad` resolves). The loader logs each fallback set it loaded, at info.

- The marker needs `locale`: `fallback: true` on a dataset with no `locale` is refused when the seed is parsed, because an unscoped dataset already loads for every locale. The published JSON Schema carries the rule as `dependentRequired`.
- A dataset with no `locale` does not count as a match: it loads beside whichever set is chosen.
- `env` is applied first; a set it scoped out neither matches nor falls back.
- At most one fallback set per object in a load: two different marked sets of one object are both skipped, with one error per object (`field: 'fallback'`) logged at warn; the object's other sets and every other object still seed. Identical copies of one set (a package's datasets merged twice) count once.
- A load with no locale (package apply, draft publish, an install no rung resolved a locale for) loads every dataset, the fallback set included, and warns as before.
