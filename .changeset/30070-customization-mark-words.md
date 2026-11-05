---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

fix(app-shell): Studio's rails mark a customized row with the word 定制 / Customized and an added row with 新增 / Added, no fill, instead of a filled square with a glyph that read as an add button (#30070)

Clause-②: yes (widening) — new studio i18n key `engine.customizationMark.customizedShort` (en, zh)
Metadata-protocol: none

The compact customization mark the pillar rails draw (and the Interfaces rail's navigation-override mark, which wraps it) now prints one short coloured word with no background. Its tooltip and accessible name are unchanged: the full text ("已定制（HotCRM）") followed by the sentence naming the customization package. It is not a control: a click on it is a click on its row.
