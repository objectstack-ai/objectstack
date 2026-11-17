---
'@objectstack/mcp': patch
---

fix(mcp): stdio `list_datasets` localizes the dataset catalogue for the workspace default locale

Clause-②: no
Metadata-protocol: none

Over the stdio transport, `list_datasets` and `query_dataset` read the saved datasets untranslated. A workspace whose default locale is `zh-CN` therefore saw English member labels over stdio, and a term that equals a zh-CN bundle label (for example 总金额) matched nothing. The same workspace over HTTP, with no `Accept-Language`, showed the zh-CN labels and matched the term as `label`.

The stdio bridge now localizes the dataset list with the same translator the HTTP door uses (`translateMetaList` from `@objectstack/rest`), for the i18n service's default locale. That is what the HTTP door answers when a call carries no locale, and it is the only locale a stdio session speaks (ADR-0149 D2). A host with no i18n service, or one whose i18n service cannot be resolved, keeps today's untranslated list. Matching is unchanged: a term still matches the label in the locale the catalogue is served in.

`@objectstack/mcp` now depends on `@objectstack/rest`.
