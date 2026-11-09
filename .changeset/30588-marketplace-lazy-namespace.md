---
'@object-ui/i18n': patch
'@object-ui/app-shell': patch
---

perf(i18n, app-shell)!: the marketplace pages' strings leave the eager language packs for a lazy `marketplace` namespace

Clause-②: yes (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (runtime-interface-only ui/packages/i18n/src/locales/en.ts#TranslationKeys) the key type of the console's own translation catalogue: no Zod schema, no spec declaration and no stored metadata reads it, so the compiler is the channel that reaches every caller -->

The console loads one language pack eagerly, `en`, and its chunk had grown to 59,951 of the 60,000 gzipped bytes its ceiling allows. About 3 KB of it was the `marketplace.*` group, read only by the two marketplace pages, which are lazy routes. That group now lives in `@object-ui/i18n/namespaces/marketplace`: ten catalogues, one per built-in language, each its own chunk, fetched when a marketplace page opens. The console's `en` chunk reads 57,010 bytes.

- **The pages wait for their text.** App-shell's marketplace catalogue and package pages render their load skeleton until the catalogue for the console's language (and `en`, the fallback) has arrived, and again after a language switch, so a visitor never sees English in a translated console or a raw key. A catalogue that cannot be fetched shows the console's own "Something went wrong" with Try again, which fetches it again.
- **`useMarketplaceNamespace()`** (from the new subpath) is the hook behind that frame: it answers `loading`, `ready` or `failed` with a `retry()`, merges the catalogues into the page's i18next instance without overwriting a host's own `resources`, and uses a catalogue already made resident by `registerBuiltInLocales()` without fetching it.
- **What stays in the packs.** Studio's packages page, outside the marketplace route, draws marketplace installs with the same components: their keys (`marketplace.installedAdditiveNote`, `marketplace.notLoaded.*`, `marketplace.action.uninstall`, `marketplace.action.uninstalling`, `marketplace.action.details`, `marketplace.uninstall.confirm`, `marketplace.uninstall.confirmNotLoaded`, `marketplace.uninstall.successInList`, `marketplace.uninstall.successNotLoaded`, `marketplace.install.dependencyMissing.*` and `marketplace.install.protocolCheckSkipped.*`) stay in every pack.
- **Every string still in every language.** No text changed. `@object-ui/i18n/locales` (the all-ten door) hands out each language complete, its pack merged with its namespace catalogue, so key parity and `registerBuiltInLocales()` still cover the moved keys.

**BREAKING** (`@object-ui/i18n`, TypeScript and the pack modules): the package entry's `en`, the exported `TranslationKeys` (`typeof en`) and the pack modules `@object-ui/i18n/locales/<code>` no longer hold the moved `marketplace.*` keys. A `t()` call that names one still compiles, since its key is a `string`. A component outside app-shell's marketplace pages that reads one of those keys calls `useMarketplaceNamespace()` and renders it once the answer is `ready`; code that reads the catalogue objects directly reads them from `@object-ui/i18n/locales`, whose ten languages are complete.
