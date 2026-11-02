---
'@object-ui/i18n': patch
---

refactor(i18n)!: the designer's version-history label leaves every pack

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (runtime-interface-only ui/packages/i18n/src/locales/en.ts#TranslationKeys) the key type of the console's own translation catalogue: no Zod schema, no spec declaration and no stored metadata reads it, so the compiler is the channel that reaches every caller -->

`@object-ui/plugin-designer` no longer ships a version-history panel, so nothing reads `designer.versionHistory` any more. The key now leaves all ten packs (ar, de, en, es, fr, ja, ko, pt, ru, zh) and the designer's internal English fallback map.

**BREAKING** (`@object-ui/i18n`, TypeScript only): the exported `TranslationKeys` (`typeof en`) loses `designer.versionHistory`. A `t()` call that names it still compiles, since its key is a `string`, and reads the key back. Nothing replaces it; the fix is to delete the reference.

| Removed key | Replacement |
|:---|:---|
| `designer.versionHistory` | none: the version-history panel is retired |

The other `designer.*` keys (`undo`, `redo`, `canvasMinimap`) are unchanged.
