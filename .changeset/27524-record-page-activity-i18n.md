---
'@object-ui/i18n': patch
---

feat(i18n)!: 「动态」 (Activity) names the record page's stream in all ten packs; the timeline column's two keys leave

Clause-②: yes (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (runtime-interface-only ui/packages/i18n/src/locales/en.ts#TranslationKeys) the key type of the console's own translation catalogue: no Zod schema, no spec declaration and no stored metadata reads it, so the compiler is the channel that reaches every caller -->

The record page's stream is called 「动态」 in zh and "Activity" in en, in the record page's panel, its tab and the right-column switch's labels (record page v4).

- `detail.timeline` changes value in all ten packs: 动态 · Activity · アクティビティ · 활동 · Aktivität · Activité · Actividad · Atividade · Активность · النشاط.
- `detail.relatedColumn` now names the right column (「右栏」, "Right column"), and `console.shortcuts.toggleRelated` shows or hides it.
- `detail.timelineComposer` (the 动态 panel's one-line composer, 「写一条备注… @ 提到同事」) arrives in all ten packs.

**BREAKING** (`@object-ui/i18n`, TypeScript only): the exported `TranslationKeys` (`typeof en`) loses `detail.timelineFolded` and `console.shortcuts.toggleTimeline`, which named the retired timeline column and its shortcut. Both leave every pack. A `t()` call naming one still compiles, since its key is a `string`, and reads the key back. Nothing replaces them: the column is gone.
