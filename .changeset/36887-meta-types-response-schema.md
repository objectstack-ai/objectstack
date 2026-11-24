---
'@objectstack/spec': minor
---

fix(spec): `GetMetaTypesResponseSchema` declares every member `GET /meta/types` serves on an entry

Clause-②: yes (widening: the published response schema declares four members the route already serves)
Metadata-protocol: added

Each `/meta/types` entry has always carried `schemaId`, `schema` (the type's JSON Schema), `form` (its Studio editor layout) and, when the type has any, `actions`, but the wire schema declared none of them, so a typed client and the published JSON Schema could not see them. They are declared now: `schemaId` as a string, `schema` as a JSON Schema record, `form` as a `FormView` and `actions` as `Action[]`, each optional except `schemaId`, as the route serves them. Nothing the server sends changes. Because `form` and `actions` carry defaults, the response now has a parsed shape, named `GetMetaTypesResponseParsed`.
