---
'@objectstack/rest': patch
---

fix(rest): the import template (`GET /api/v1/data/:object/export?template=true`) is gated by the import door's permissions, not the export's

Clause-②: no

The template carries no records — only the columns the caller may write, one
example row and an instructions sheet — so it answers to whoever may import, and
the export permission (`allowExport`) neither admits nor refuses it:

- A caller with the create permission on the object gets the template, with or
  without `allowExport`.
- A caller without the create permission gets `403 PERMISSION_DENIED`, with or
  without `allowExport`.
- An object whose `enable.apiMethods` exposes neither `create` nor `update`
  answers `405 OBJECT_API_METHOD_NOT_ALLOWED`, as `POST /api/v1/data/:object/import`
  does. An object that exposes `create` without `list` serves the template.
- Without `template=true` the export is unchanged: the same two export checks
  and the same bytes.

To let a role download the template, grant it create on the object.
