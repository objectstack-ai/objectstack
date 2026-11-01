---
'@object-ui/i18n': patch
---

feat(i18n)!: the record page's tab row in all ten packs; the enlarged face's Back label leaves

Clause-②: yes (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (runtime-interface-only ui/packages/i18n/src/locales/en.ts#TranslationKeys) the key type of the console's own translation catalogue: no Zod schema, no spec declaration and no stored metadata reads it, so the compiler is the channel that reaches every caller -->

The record page's tab row (record page v4) arrives in all ten packs:

- `detail.recordTabOverview`: the row's first tab, 「概览」 · Overview · 概要 · 개요 · Übersicht · Aperçu · Resumen · Visão geral · Обзор · نظرة عامة.
- `detail.recordTabs`: the row's accessible name.
- `detail.recordTabsMore`, with its plural forms: the 「+N ▾」 trigger's accessible name.
- `detail.recordTabsHidden`: the dropdown's heading over the hidden panels' tabs.

**BREAKING** (`@object-ui/i18n`, TypeScript only). The exported `TranslationKeys` (`typeof en`) loses `detail.relatedEnlargedBack`, the ‹ back line of the enlarged face that the active tab replaces. The key leaves every pack. A `t()` call that names it still compiles, because its key is a `string`, and reads the key back. Nothing replaces it: 「概览」 and Esc return.
