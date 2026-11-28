---
'@objectstack/metadata-protocol': patch
'@objectstack/rest': patch
---

perf(metadata-protocol): a by-name `form` read and an anonymous form-door request read the `view` list once and each type's stored rows once

Clause-②: yes (widening) — ObjectStackProtocolImplementation.readFormRequest
Metadata-protocol: none

The effective `form` read resolves over both types (ADR-0159 D5): the generic `form` list, the projection of the `view` list, and the cross-type resolution over the stored rows of both types. Those readings asked for the same stored rows separately, and an anonymous form door made five protocol calls (the `view` list, the `form` list, the unreadable bodies and both per-package layers), each reading the rows again. With the overlay row cache off, a by-name `form` read read the `form` and `view` rows twice each, and a form-door GET read the `view` list twice, the `view` rows five times and the `form` rows three times.

- **`@objectstack/metadata-protocol`.** The effective `form` read now reads through one request scope: each stored row set (per type and package binding) and each flattened list is read once per request, and nothing is kept past the request. A new server-only extension, `readFormRequest(read)`, runs `read` as one request's reading: the `getMetaItems`, `getMetaItemsPerPackage` and `getUnreadableFormBodies` calls inside it share that one scope, each answering what it answers on its own.
- **`@objectstack/rest`.** The form doors (`GET /forms/:slug`, `POST /forms/:slug/submit`) make their five reads inside `readFormRequest` when the protocol serves it, and as before otherwise.

Every answer is unchanged: the same items, in the same order, from the same served-row order. Nothing to migrate.
