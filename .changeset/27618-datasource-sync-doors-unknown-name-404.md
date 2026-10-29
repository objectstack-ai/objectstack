---
'@objectstack/service-datasource': patch
'@objectstack/rest': patch
---

fix(service-datasource, rest): the datasource Sync doors and their federation twins answer a name that no saved datasource has `404 RESOURCE_NOT_FOUND`, as `GET /api/v1/datasources/:name` does, instead of a `400` federation refusal

Clause-②: no
Metadata-protocol: none

- **Before.** `GET /api/v1/datasources/:name/remote-tables`, `POST /api/v1/datasources/:name/object-draft`, and the federation twins under `/api/v1/datasources/:name/external/` (`GET tables`, `POST tables/:remote/draft`, `POST tables/:remote/import`, `POST refresh-catalog`) answered a name that resolves no saved datasource `400 EXTERNAL_DATASOURCE_ERROR` (`EXTERNAL_IMPORT_ERROR` for the import) with "has no datasource definition, so nothing declares it a federation source …". That reads as a malformed request, or as advice to re-declare the datasource `external`, when the datasource does not exist.
- **Now.** They answer `404` with `error.code` `RESOURCE_NOT_FOUND` and the message `GET /api/v1/datasources/:name` gives for the same name (`Datasource "NAME" does not exist.`). In process, `ExternalDatasourceService.listRemoteTables`, `generateObjectDraft`, `importObject` and `refreshCatalog` throw that `404` error for such a name. Every by-name datasource door now spells this answer through one helper.
- **Unchanged.** A datasource that exists and is not a federation source (a managed one, or the platform's primary datasource) is still refused `400` with the door's code and its reason.
