---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

fix(app-shell): Setup → Datasources names the objects that still use a datasource, in the console's language, before and after its delete

Clause-②: yes (widening)
Metadata-protocol: none

- **The confirm.** Opening a datasource's delete reads object metadata and lists every object whose `datasource` names it (label, with the name beside it when they differ). While any is listed, the confirm says the datasource cannot be deleted yet and that each object must be deleted or moved to another datasource first. With none, or when the read fails, the confirm is unchanged.
- **The refusal.** A `400` from `DELETE /api/v1/datasources/:name` re-reads that list. When objects still name the datasource, the toast says, in the console's language, that it was not deleted, which objects still use it, and what to do next. Any other failure, and a `400` with no bound object, keep the server's message in the existing frame. No server text is matched.
- **The widening.** Three new `studio` namespace rows in `@object-ui/i18n` (en and zh): `engine.datasource.deleteBoundBody`, `engine.datasource.deleteBoundRefused` and `engine.datasource.boundObjectSeparator`.
