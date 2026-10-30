---
'@objectstack/client': patch
---

fix(client): `storage.upload` sends `application/octet-stream` for a file of unknown type instead of an empty `mimeType` the presigned door refuses

Clause-②: no
Metadata-protocol: none

A browser `File` whose type the browser does not know carries `type === ''`. `storage.upload(file)` sent that empty string as the presigned request's `mimeType`, and `POST /storage/upload/presigned` refuses an empty `mimeType` with `400 INVALID_REQUEST`, so such a file could not be attached at all. The helper now sends `application/octet-stream` when the file has no type; a typed file keeps its own type. The door is unchanged.
