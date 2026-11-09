---
'@object-ui/i18n': patch
---

fix(i18n): an edit in a Chinese script the label lacks adds its own entry instead of overwriting the other script

Clause-②: no
Metadata-protocol: none

`setLocalized` and `clearLocalized` no longer treat the other Chinese script's entry as the editor's own. A `zh-Hant` (or `zh-TW`, `zh-HK`) edit of a label written as `{ en: 'Customer', zh: '客户' }` now adds a `zh-Hant` entry and keeps the Simplified text; before, it overwrote `zh` with Traditional text. A clear in that case removes nothing, because the box was showing the other script's text as a fallback. A Simplified editor over a Traditional-only map is handled the same way. Reading is unchanged: `pickLocalized` still shows the other script's entry until one of the reader's own script exists. Every other language, and every map that has an entry of the editor's script, writes exactly as before.
