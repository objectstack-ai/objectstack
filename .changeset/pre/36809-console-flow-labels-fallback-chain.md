---
'@objectstack/spec': minor
'@objectstack/runtime': minor
'@object-ui/i18n': minor
'@object-ui/app-shell': minor
'@object-ui/plugin-detail': minor
'@object-ui/console': minor
---

feat(i18n): console flow labels follow the server's declared fallback chain

Clause-②: yes (widening)
Metadata-protocol: added
Skills-docs: none — the new member is a response field the console reads, not something a metadata author writes; no skills/ page teaches `GET /i18n/locales` or how the console resolves flow labels

- **`GET /api/v1/i18n/locales` names the declared fallback chain.** `GetLocalesResponseSchema` (`@objectstack/spec/api`) gains an optional `fallbackChain: string[]`, and the runtime's `/i18n` domain fills it from the i18n service's `getFallbackLocale()` (the stack's `i18n.fallbackLocale`, else its `defaultLocale`), the same accessor the server's metadata translations hand the spec resolvers as `ResolveOptions.fallbackChain`. A service that declares no fallback (no accessor, or an empty answer, such as the core in-memory provider) serves no member. Nothing existing changes meaning.
- **The console loads the fallback locale's flow translations.** The console's language loader reads the chain and `sourceLocale` beside the active language's bundle and, unless the language is the authored one, fetches each fallback locale's bundle and keeps its `flows` group (`withDeclaredFlowsFallback`, `@object-ui/i18n`).
- **Flow labels walk the same locales as the server.** `activeFlowsBundle` returns the fallback locales' rows too, and the new `flowsResolveOptions` hands the spec resolvers `{ locale, fallbackChain, defaultLocale }`. The flow runner (flow name, field copy, option labels), the flow designer and docs viewer (`flowLabelTranslations`, `useFlowLabelTranslations`, which take the declared options) and the stage-change confirm now read a declared fallback locale's text for a label the active language lacks, before the authored label. A stack that declares no fallback keeps "requested locale, then the authored label".
