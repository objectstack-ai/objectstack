---
'@objectstack/objectql': patch
---

fix(objectql): a file field reads the same whether or not the projection lists `id`

Clause-②: no
Metadata-protocol: none

A reader who may not read `sys_file` (every member whose application grants no `sys_file` read) is served a file field by the verdict of the record that owns the file, matched on that record's `id`. A read whose projection left `id` out, such as `GET /api/v1/data/OBJECT?select=FILE_FIELD`, gave that verdict no record key, so a file the reader may read came back as `{ id, metadataRefused: true }`, while `select=id,FILE_FIELD` answered the full `{ id, name, size, mimeType, url }`.

`find` and `findOne` now read `id` for any projection that names a file field and cut it back off the answer, the same way a formula's widened columns are cut. So:

- A permitted reader gets the full file value with or without `id` in `select` / `fields`, on `GET /data/:object`, `POST /data/:object/query` and `GET /data/:object/:id`.
- The answer still carries exactly the columns the caller named: no `id` is added to a row that did not ask for it.
- A reader the owning record's verdict refuses is still answered `{ id, metadataRefused: true }`, with or without `id`.
