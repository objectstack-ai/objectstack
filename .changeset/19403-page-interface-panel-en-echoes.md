---
'@objectstack/platform-objects': patch
---

Decide the `page` Interface panel's en-echoes per leaf and render the decided ones in `zh-CN` / `ja-JP` / `es-ES`

`page.fields['interfaceConfig*']` and the `page.sections.interface` heading shipped their English source byte-for-byte in all three translated metadata-form catalogs — 15 keys, 30 string leaves, the panel every list page is authored on. Each leaf was judged on its own evidence rather than translated wholesale: the `view` panel is the authored twin for most of them, `Interface`, `Airtable`, the `interfaceConfig` key names, the `Grid / Kanban / Calendar` renderer tokens and the `filter-mode` option labels stay English, and `interfaceConfig.source` departs from both of this catalog's same-string precedents because it names the page's data binding rather than source code or provenance.

The verdicts and their reasons are pinned in `page-interface-panel-echo-decisions.test.ts`, whose population is derived from the `en` catalog, so a re-fill or a key added to the panel is red on the day it lands.
