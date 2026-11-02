---
'@object-ui/plugin-detail': patch
'@object-ui/app-shell': patch
'@objectstack/spec': patch
---

fix(plugin-detail): the record page's highlight strip is the object's declared `highlightFields` only; the path's stage and the owner each show once, under one word for the owner (#28868)

Clause-②: no
Metadata-protocol: none

**No guessed strip.** An object that declares no `highlightFields` now has no highlight strip, so every field stays in the details body. This holds on the default record page, the phone record header and the record hover card. `deriveHighlightFields` (`@object-ui/plugin-detail`) used to pick up to six fields from a preferred-name list (`owner` / `owner_id` first, then amount, rating, industry, …) and hide them from the body. That guess is deleted. The function keeps its signature and returns the declared list minus the record's title field, at most six, or nothing. A declared strip is unchanged.

**The stage once.** When the page draws `record:path`, its `statusField` joins the body's `hideFields`, so the stage is not drawn again as a body field. The body's hide list is also cut at the six fields the strip shows: a declared entry past the sixth is now drawn by the body instead of by neither.

**The owner once, under one word.** When the strip carries `owner_id`, the meta line under the details leaves the owner out. The platform label of the injected `owner_id` column (`@objectstack/spec`'s system-field fallback) now reads 「负责人」 in zh-CN, the word the ui's `detail.owner` already used. It was 「所有者」. en (`Owner`), ja-JP (`所有者`) and es-ES (`Propietario`) already matched the ui packs. A label an author wrote is still never overridden.

**What an app sees.** An object without declared `highlightFields` loses its strip. Declare the fields the header should show: `highlightFields: ['amount', 'close_date', 'owner_id']`.
