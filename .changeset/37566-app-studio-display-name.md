---
'@objectstack/platform-objects': patch
'@object-ui/i18n': patch
---

feat(studio): the Studio app is named 应用搭建 in a Chinese interface and App Studio in every other

Clause-②: no
Metadata-protocol: none

Display text only (ADR-0084, the position amendment): the Studio app's label is now "App Studio" (`STUDIO_APP.label`), its `zh-CN` translation 应用搭建 and its `zh-Hant` translation 應用搭建; every other locale pack, which kept the English product name, now reads "App Studio". Each pack's recorded source hash for the label moves with it, so the translations are served rather than replaced by the English source. The console's `console.studio.title` (the Studio crumb, and the key the Studio brand reads) follows in all eleven UI packs.

Unchanged: the app's name `studio`, the `/studio` address, permission names such as `studio.access`, and every package and API name. Sentences that mention Studio elsewhere in the UI are not reworded by this change.
