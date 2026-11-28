---
'@objectstack/spec': minor
'@objectstack/rest': patch
'@objectstack/runtime': patch
'@objectstack/mcp': patch
'@objectstack/metadata-protocol': patch
'@objectstack/service-analytics': patch
'@objectstack/service-storage': patch
---

feat: an answer whose translations could not be read says so, as `translationWarning`

Clause-②: yes (widening) — `GetMetaItemsResponseSchema`, `GetMetaItemResponseSchema` and `QueryDatasetOutputSchema` gain the optional string `translationWarning`; the MCP `list_objects` and `describe_object` answers gain the same optional member, and `DiagnosedObjectListing` and the dataset tools' `DatasetToolSource` gain the optional `translationWarning` they carry it in; `DatasetToolsDeps` gains an optional `logger`
Metadata-protocol: added

When the deployment's i18n service resolves but its translations cannot be read (its `getLocales` or `getTranslations` throws), the metadata and dataset answers are served in the authored language, untranslated. Until now only `list_datasets` told the caller why; every other answer looked exactly like one for a locale with no translation. These answers now carry `translationWarning`, one fixed sentence saying the translations could not be read, beside what they serve: `GET /meta/:type` and `GET /meta/:type/:name` on both HTTP hosts (the REST server and the runtime dispatcher), the MCP `list_objects` and `describe_object` tools on both transports, and `query_dataset`. It is present only on such a fault, so an answer whose translations were read is byte for byte what it was. `list_datasets` keeps the `partial` and `warning` it already serves for the same fault. Every warning sentence here, `list_datasets`' warning when the dataset catalogue itself cannot be read, and `query_dataset`'s 503 refusal when the dataset read fails, are now the platform's client-facing failure text: a fixed sentence, with the original error in the server log only. A list answered as a bare array (a protocol that answers without the `{ type, items }` envelope) has no member to carry it; the server log says the fault either way.

Three more places read the i18n service's whole catalog with no guard, so the same fault failed them with an unhandled error:

- An object save and the stored-metadata migration (its preview and its apply pass, from the REST route, the runtime dispatcher and `os migrate meta`) read the catalog to tell a translated label a Studio session sent back from one the author typed. Both are now refused as 503 `SERVICE_UNAVAILABLE`, a declared refusal whose fixed sentence reaches the HTTP caller ("The translations could not be read, … nothing was saved or migrated. Retry once the translations can be read."), and nothing is stored; the i18n error is logged on the server. Retrying once the translations read again saves the same body. Going on without the catalog would have stored translated labels as the authored ones, or counted an echoed stored row as canonical.
- A dataset query's select-option labels and the upload page's object and field labels are now served as declared, with one `warn` line saying the translations could not be read.

Nothing to migrate.
