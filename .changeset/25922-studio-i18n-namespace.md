---
'@object-ui/i18n': patch
---

feat(i18n): a lazy `studio` namespace for the Studio designer's strings; the `designer.*` and `perm.*` keys move into it

Clause-②: no
Metadata-protocol: none

- **New subpath `@object-ui/i18n/namespaces/studio`.** The Studio designer's two-locale string set becomes a namespace of this package, as the maintainer ruled on objectstack#25922 (6431032267, Q2 = A; kept by 6431234244). `en` is resident; `zh` is its own chunk, fetched the first time a Chinese lookup asks for it; every other language reads `en`. Exports: `studioString(key, lang)` (synchronous; answers from `en` while a catalogue is in flight), `loadStudioCatalogue(lang)`, `isStudioCatalogueLoaded(lang)`, `resolveStudioLanguage(lang)`, the `useStudioCatalogue(lang)` hook (re-renders its caller when a fetched catalogue lands), `STUDIO_NAMESPACE`, `STUDIO_FALLBACK_LANGUAGE`, `STUDIO_LANGUAGE_CODES` and the `StudioCatalogue` type. Additive: nothing existing changes.
- **First slice of the move.** Every key under `designer.*` and `perm.*` (the object/field designer and the permission designer) now lives in the namespace instead of `@object-ui/app-shell`'s private table. Studio reads the same text in `en` and `zh`; a Chinese viewer sees these labels in English for the moment the `zh` catalogue takes to load, and a non-Chinese viewer no longer downloads these keys' Chinese text with the console.
- **Not in the eager catalogue.** `locales/en.ts` gains no key, and the namespace is not one of the ten packs, so `all-locales-key-parity` does not read it; its own parity (every `en` key has a `zh` row with the same `{placeholders}`) is a test of this package.
