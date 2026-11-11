---
'@object-ui/i18n': patch
'@object-ui/console': patch
---

perf(i18n, console)!: the console's Developer pages and its Connect an AI assistant strings load on demand, off the English pack every page load pays for

Clause-②: yes (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (runtime-interface-only ui/packages/i18n/src/locales/en.ts#TranslationKeys) the key type of the console's own translation catalogue: no Zod schema, no spec declaration and no stored metadata reads it, so the compiler is the channel that reaches every caller -->

The `console.developer.*` and `connectAgent.*` groups left the language packs (all eleven) for a new lazy namespace, `@object-ui/i18n/namespaces/developer`: one partial pack per platform locale table tag, fetched when a surface that reads them mounts and merged into the page's i18next instance. Call sites are unchanged — they still ask `t('console.developer.…')` / `t('connectAgent.…')` of the default namespace. The readers are the console's four Developer pages (API console, flow runs, public forms, integrations), the Connect an assistant page's widget and the AI Assistants tab of a user record; each renders under a frame that shows a skeleton until its strings are in, never English in a translated console nor a raw key.

The marketplace namespace and the new one share one runtime, `createPackNamespace` (`@object-ui/i18n`'s `namespaces/packNamespace.ts`); `@object-ui/i18n/namespaces/marketplace`'s exports are unchanged.

Every string is still in every language and no text changed: `@object-ui/i18n/locales` (the all-packs door) hands out each language complete, its pack merged with every namespace catalogue, so key parity and `registerBuiltInLocales()` still cover the moved keys.

**BREAKING** (`@object-ui/i18n`, TypeScript and the pack modules): the package entry's `en`, the exported `TranslationKeys` (`typeof en`) and the pack modules `@object-ui/i18n/locales/<code>` no longer hold the `console.developer.*` and `connectAgent.*` keys. A `t()` call that names one still compiles, since its key is a `string`. A component outside the console's Developer pages and app-shell's connect widgets that reads one of those keys calls `useDeveloperNamespace()` (from `@object-ui/i18n/namespaces/developer`) and renders it once the answer is `ready`; code that reads the catalogue objects directly reads them from `@object-ui/i18n/locales`, whose languages are complete.
