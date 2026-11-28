---
'@objectstack/spec': patch
'@objectstack/rest': patch
'@objectstack/runtime': patch
'@objectstack/mcp': patch
'@objectstack/metadata-protocol': patch
'@objectstack/service-analytics': patch
'@objectstack/service-storage': patch
---

feat: an answer whose translations could not be read says so, as `translationWarning`

Clause-②: yes (widening) — `GetMetaItemsResponseSchema`, `GetMetaItemResponseSchema` and `QueryDatasetOutputSchema` gain the optional string `translationWarning`; the MCP `list_objects` and `describe_object` answers gain the same optional member, and `DiagnosedObjectListing` and the dataset tools' `DatasetToolSource` gain the optional `translationWarning` they carry it in
Metadata-protocol: none

When the deployment's i18n service resolves but its translations cannot be read (its `getLocales` or `getTranslations` throws), the metadata and dataset answers are served in the authored language, untranslated. Until now only `list_datasets` told the caller why; every other answer looked exactly like one for a locale with no translation. These answers now carry `translationWarning`, the server's sentence naming the reason, beside what they serve: `GET /meta/:type` and `GET /meta/:type/:name` on both HTTP hosts (the REST server and the runtime dispatcher), the MCP `list_objects` and `describe_object` tools on both transports, and `query_dataset`. It is present only on such a fault, so an answer whose translations were read is byte for byte what it was. `list_datasets` keeps the `partial` and `warning` it already serves for the same fault. A list answered as a bare array (a protocol that answers without the `{ type, items }` envelope) has no member to carry it; the server log says the fault either way.

Three more places read the i18n service's whole catalog with no guard, so the same fault failed them with an unhandled error:

- An object save reads the catalog to tell a translated label a Studio session sends back from one the author typed. It now refuses the save as 503 `SERVICE_UNAVAILABLE`, naming the reason, and stores nothing; retrying once the translations read again saves the same body. Saving without the catalog would have stored translated labels as the authored ones.
- A dataset query's select-option labels and the upload page's object and field labels are now served as declared, with one `warn` line saying the translations could not be read.

Nothing to migrate.
