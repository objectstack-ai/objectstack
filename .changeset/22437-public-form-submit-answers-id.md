---
'@objectstack/rest': patch
---

fix(rest): an anonymous public-form submit answers the created record's id, and nothing the insert stored

Clause-②: no

`POST /api/v1/forms/:slug/submit` used to answer `201` with the protocol's whole create answer, `{ object, id, record, droppedFields? }`. The `record` was the row as stored after the insert pipeline. So the anonymous caller was shown every field it never sent: a `defaultValue`, a field a `beforeInsert` or `afterInsert` hook stamped, and a value a hook running elevated (`runAs: 'system'`) derived from existing records the caller's grant may never read. The form's field whitelist filtered what the caller could write. Nothing filtered what it was then shown.

The answer is now the created id alone:

```json
{ "id": "r7p8cUZoBJbFWudt" }
```

- **Still `201`**, as a bare JSON object with no envelope. The created id stays at the top-level `id`, where the console's public form page reads it, so its confirmation and `redirect` behaviors keep working.
- **What the submitter typed is not echoed back either.** The caller already holds it. On the console's `redirect` behavior, a `{{record.field_name}}` token over a submitted field still resolves from the submitted values, and `{{record.id}}` from the answer. A token over a field only the server fills in now resolves empty. That value is exactly what this change stops serving.
- **The write is unchanged**: the same whitelist, the same server-managed anchors stripped, the same grant, the same hooks. Only the answer shrank.

**If your host read the record off this answer**, read it through an authenticated read instead: `GET /api/v1/data/:object/:id` with the id from the answer, as a principal allowed to see that record.
