---
'@objectstack/rest': patch
'@objectstack/runtime': patch
'@objectstack/mcp': patch
'@objectstack/service-analytics': patch
---

Clause-②: yes (widening)
Metadata-protocol: none

fix(i18n, mcp): a translation fault serves the untranslated text and the fault is logged, instead of failing the read; `list_datasets` is flagged `partial` with a `warning`, while REST `/meta`, the MCP object tools and `query_dataset` log only

When the i18n service resolves but its `getLocales` or `getTranslations` throws, the shared `/meta` translator (`translationBundleOf`, `@objectstack/rest`) now answers it as no bundle: the text is served untranslated and the server log says so at `warn` (`The translations could not be read (…), so labels and descriptions are served untranslated.`). Before, the translation rejected, so `GET /meta/:type` and `GET /meta/:type/:name` answered 500, the MCP object tools failed, `list_datasets` answered `datasets: []` with `partial: true`, and `query_dataset` refused 503 on both MCP transports.

Now `list_datasets` keeps every dataset, in its authored text, with `partial: true` and that sentence as its `warning`; `query_dataset` answers. A dataset host's `loadDatasets` may return `{ items, warning }` without `partial`: a whole read the tools say something about, which `query_dataset` does not refuse. The translator's sources take an optional `reportTranslationFault(warning)` to carry the sentence on an answer.

fix(mcp): `?locale=` reaches the MCP labels, and the dataset tools answer in one language

The HTTP MCP door now reads a `?locale=` query parameter as the `/meta` doors do (after `Accept-Language`, before the i18n default), for the object and dataset labels and the app-docs tools; it read headers only, though its docblock promised both. The dataset executor (`createDatasetTools`) takes an optional `translationLocale` dependency, the locale its `loadDatasets` translated the rows for, and reads labels and composes `nextStep` and `sourceLine` in it first. Both MCP transports pass it, so a call with no `Accept-Language` (common for MCP clients, and every stdio call) no longer mixes labels in the i18n default with sentences in the workspace locale.
