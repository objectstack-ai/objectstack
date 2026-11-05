---
'@object-ui/i18n': patch
'@object-ui/components': patch
'@object-ui/console': patch
---

feat(i18n)!: the Console's language packs are the platform locale table's, keyed by its tags, and Traditional Chinese (`zh-Hant`) ships, generated from Simplified (#30511)

Clause-②: yes (narrowing) — widens: a `zh-Hant` pack (the `zhHant` export of `@object-ui/i18n/locales`, the `@object-ui/i18n/locales/zh-Hant` module), the `resolveBuiltInLanguage` export of `@object-ui/i18n`, and every stored or browser code the platform locale table reads as one of its tags (`zh-TW`, `zh-HK`, `zh-MO` → `zh-Hant`; `zh`, `zh-CN`, `zh-SG` → `zh-Hans`; `pt` → `pt-BR`). Narrows: the Simplified Chinese and Portuguese packs are keyed `zh-Hans` and `pt-BR`, no longer `zh` and `pt`, in `builtInLocales`, `BUILT_IN_LANGUAGE_CODES`, `getLoadedBuiltInLocales()` and `getAvailableLanguages()`, and their modules `@object-ui/i18n/locales/zh` and `@object-ui/i18n/locales/pt` are `@object-ui/i18n/locales/zh-Hans` and `@object-ui/i18n/locales/pt-BR`.
Metadata-protocol: none
Skills-docs: follow-up owed — `skills/objectui/guides/i18n.md` (its "Built-in locales" list names ten packs, with `zh` and `pt`)

<!-- adr-0087: not-required (no-migration-prescription) No metadata changes shape: no spec key, object definition, stored row or authorable spelling is added, removed or renamed, so `objectstack migrate meta` has nothing to rewrite and no ledger entry could project. The FROM/TO lines below are source rewrites for TypeScript and JavaScript consumers of `@object-ui/i18n`'s `./locales` subpath (two members of `builtInLocales`, two modules). That is the class `runtime-export-retired` exists for, but it reads a package's root entry only and refuses a subpath operand, and the root entry retires nothing here; so this category is held, and the gap is named here rather than left to the detector. -->

**BREAKING** for code that reads a built-in pack by its old key or module path.

- **Why.** The Console's packs follow the platform locale table (`PLATFORM_LOCALES` in `@objectstack/spec/system`, ruling F of #29349) instead of a list of their own: one pack per table tag, keyed by the tag, in the table's order. A language the table gains is a pack the parity and drift suites demand on the run that first sees it.
- **Traditional Chinese.** `src/locales/zh-Hant.ts` is generated from `zh-Hans.ts` by `pnpm --filter @object-ui/i18n gen:zh-hant` (OpenCC `s2twp`, pinned, with the phrase rules of the www.objectos.ai converter) and is never edited by hand; a package test fails when it is not what the generator writes. It carries no `console.ai.*` gate-only outbound keys, exactly as the other non-gate packs.
- **Stored codes keep working.** A `sys_user.locale` value, a saved device language or an `Accept-Language` tag written before the table is read through the table's aliases: `zh-CN` still renders Simplified Chinese, `pt` Portuguese (Brazil), and `zh-TW` / `zh-HK` / `zh-MO` now render Traditional Chinese instead of Simplified. `loadBuiltInLocale`, `isBuiltInLanguage` and i18next's fallback chain accept every alias.
- **Studio.** The Studio namespace still ships `en` and `zh` only; a `zh-Hant` reader sees its Simplified catalogue there.

The fix, for code that names a pack:

- FROM `builtInLocales.zh` TO `builtInLocales['zh-Hans']`
- FROM `builtInLocales.pt` TO `builtInLocales['pt-BR']`
- FROM `import zh from '@object-ui/i18n/locales/zh'` TO `import zh from '@object-ui/i18n/locales/zh-Hans'`
- FROM `import pt from '@object-ui/i18n/locales/pt'` TO `import pt from '@object-ui/i18n/locales/pt-BR'`
- FROM comparing a code from `BUILT_IN_LANGUAGE_CODES`, `getAvailableLanguages()` or the keys of `getLoadedBuiltInLocales()` with `'zh'` or `'pt'` TO comparing `resolveBuiltInLanguage(code)` with `'zh-Hans'` or `'pt-BR'`
