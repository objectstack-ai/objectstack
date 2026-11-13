---
'@objectstack/service-storage': patch
---

fix(storage): the upload-link page speaks the request's language, and its refusals read as page copy

Clause-②: no
Metadata-protocol: none

The page a `create_upload_link` link opens was English in every deployment. It is now written in the request's language: the browser's `Accept-Language`, else the workspace default (the `localization` settings), else English. Every language on the platform locale table is served, with `<html lang>`, the writing direction and the link's expiry (still UTC, and saying so) in that language.

The refusals the page shows after an upload are page copy too. The `PUT /api/v1/storage/upload-links/:token` door now answers each refusal with `error.userMessage`, written in the page's language, and the page shows that text (or its own "the upload failed" when an answer carries none). The sentence names no record, object or field, like the rest of the page: the record-lock refusal no longer reaches the person as `RECORD_LOCKED: …` with the record's title, and the read-only refusal no longer names the object and field by API name. `error.code` and the success body are unchanged. `error.message` keeps its diagnostic wording, with a producer's own code prefix stripped the way the `/api/v1/data` door strips it.
