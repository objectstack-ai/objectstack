---
"@objectstack/platform-objects": patch
---

fix(platform-objects): the zh-CN `dashboard.sections.layout` description names what that section actually holds

`metadataForms.dashboard.sections.layout.description` served 「栅格与响应式」
("grid and responsiveness") against a source that reads "Grid sizing and refresh
cadence." The section holds `columns`, `gap`, `refreshInterval` and `header` —
there is no responsive-breakpoint input in it and never was, and the refresh
cadence the section does hold went unnamed. A zh-CN author reading the Studio
dashboard property panel was told to look for a control that does not exist and
not told about one that does. It now reads 「栅格尺寸与刷新间隔」, using this
bundle's own established terms for the two fields it covers (`columns` →
「栅格列数」, `refreshInterval` → 「刷新间隔」).

The source string has not moved since the file was created: the leaf was
mistranslated when zh-CN's values were carried in from the pre-consolidation
`metadata-translations/zh-CN.ts` overlay, while es-ES and ja-JP were translated
from the extracted English and both carry the correct sense. So this is a
translation correction, not a re-sync after a source edit — nothing else in the
bundle, the source form, or the recorded source-hash companion changes.
