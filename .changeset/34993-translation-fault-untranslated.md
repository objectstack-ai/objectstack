---
'@objectstack/rest': patch
'@objectstack/runtime': patch
'@objectstack/mcp': patch
'@objectstack/service-analytics': patch
---

Clause-②: yes (widening)
Metadata-protocol: none

fix(i18n, mcp): a translation fault serves the untranslated text with a warning instead of failing the read

When the i18n service resolves but its `getLocales` or `getTranslations` throws, the shared `/meta` translator (`translationBundleOf`, `@objectstack/rest`) now answers it as no bundle: the text is served untranslated and the server log says so at `warn` (`The translations could not be read (…), so labels and descriptions are served untranslated.`). Before, the translation rejected, so `GET /meta/:type` and `GET /meta/:type/:name` answered 500, the MCP object tools failed, `list_datasets` answered `datasets: []` with `partial: true`, and `query_dataset` refused 503 on both MCP transports.

Now `list_datasets` keeps every dataset, in its authored text, with `partial: true` and that sentence as its `warning`; `query_dataset` answers. A dataset host's `loadDatasets` may return `{ items, warning }` without `partial`: a whole read the tools say something about, which `query_dataset` does not refuse. The translator's sources take an optional `reportTranslationFault(warning)` to carry the sentence on an answer.
