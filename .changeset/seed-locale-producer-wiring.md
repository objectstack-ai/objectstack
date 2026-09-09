---
"@objectstack/runtime": minor
"@objectstack/spec": patch
---

`AppPlugin` now supplies `SeedLoaderConfig.locale`, so the `Seed.locale` axis takes effect on the default boot path.

The locale filter axis landed complete on the consumer side: the loader reads `Seed.locale`, composes it with `env` by conjunction, and names every dataset it drops. What it never had was a **producer** — no first-party call site passed `config.locale`, so `filterByLocale` returned its input on its first line and `dataset.locale` was never read at all. Authoring the key changed nothing. That is the same shape `Seed.env` spent releases in before framework#4704.

- **The locale is resolved from the app's own `i18n.defaultLocale`** — the same envelope key, read the same way `loadTranslations` already reads it for `setDefaultLocale` — and threaded into all three `SeedLoaderRequest`s `AppPlugin` builds: the inline boot seed, the per-org replayer registered for tenant provisioning, and the dev hot-reload seeder.
- **An app that declares no locale sends no `locale` key at all**, rather than an `'en'` default. Absence is the loader's unrestricted spelling, so a stack that never opted in keeps loading every dataset exactly as before; defaulting would have turned a wiring change into a data change, silently dropping a `locale: ['zh-CN']` dataset on every stack without an `i18n` block. A blank or non-string `defaultLocale` is treated as absence for the same reason.
- **Resolved at the call sites, not inside `load()`.** The sibling `env` axis resolves itself in the loader off an ambient `NODE_ENV`; a locale has no ambient source, and the only layer that knows which locale a stack runs in is the app config the loader is never handed. So this axis needs a real producer, which is what this change is.

`SeedLoaderService#warnOnUnresolvedLocaleScope` **stays**. It is not a signpost for an unwired state that has now gone away: three of this repo's six seed-request builders are publish/install-time paths that are handed no stack config and still pass no locale, embedding hosts build their own requests, and a stack may declare no `i18n` block at all. Every one of those still reaches `load()` with locale-scoped datasets and no `config.locale`, and the warning is what keeps that loud instead of silently inert.

The liveness ledger row `seed.locale` moves `experimental` → `live` with a `producer` pointer naming this wiring, and records which call sites supply the locale and which do not rather than claiming the frontier away.

⚠️ **Release-note reconciliation, for whoever compiles this release.** The sibling changeset `seed-locale-axis.md` (from the PR that landed the consumer half) states in the present tense that no first-party call site supplies `config.locale`, that the axis is inert on the default boot path, and that the liveness ledger records `seed.locale` as `experimental`. All three sentences describe the state that changeset shipped into, and **this change ends all three**. If both land in one release, the notes must read them in order — or fold them into one entry — rather than publishing the earlier state as current. ⛔ That sibling changeset is deliberately not edited here: it accurately records what its own PR did, and release notes are compiled centrally.

⛔ Out of scope, unchanged: rows already written under a different locale stay resident. Every seed is an `upsert` and the loader only writes, so switching a stack's locale on a non-empty database does not remove the other market's rows.
