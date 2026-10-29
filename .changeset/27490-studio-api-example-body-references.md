---
'@object-ui/app-shell': patch
---

fix(app-shell): the Studio API tab's example body leaves out `owner_id` and optional reference fields, so the copied Create and Update calls are accepted

Clause-②: no
Metadata-protocol: none

The API tab of an object in Studio showed an example body that put the id `"related_record_id"` into every reference field, and added the platform's `owner_id` whenever there was room. That id names no record, so the copied Create (`POST`) and Update (`PATCH`) cURL were refused `400` with `reference_not_found` on nearly every object.

- **Left out of the body:** every optional reference field (`lookup`, `master_detail`, `user`, `tree`) and every field the platform adds (`system: true`, such as `owner_id`, which the platform fills in when it is left out). The note under the body names them with the other optional fields not shown.
- **A required reference** is still in the body, because a create without it is refused. Its value is now a placeholder in the same form as the cURL's `<token>`, naming the object whose record id goes there, such as `<id of a showcase_project record>`.
- **Unchanged:** the other fields, their sample values, the order (required fields first) and the cap of eight fields.
