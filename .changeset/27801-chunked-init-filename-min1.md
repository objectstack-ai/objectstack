---
'@objectstack/spec': patch
---

fix(spec)!: `InitiateChunkedUploadRequestSchema.filename` and `.mimeType` declare that they are non-empty, as the chunked-upload init door has always required (#27801)

Clause-②: no (narrowing) — the published declaration of the chunked-upload init body refuses an empty `filename` or `mimeType`, which it admitted before. The door already refused both with a 400; nothing is widened and no key is added, removed or renamed.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped and no metadata type or stored shape moves: a REST request declaration no metadata type embeds stops admitting an empty `filename` or `mimeType`, values the chunked-upload init door already refused. A caller sends the file's name and MIME type; there is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** accept-set narrowing of a published request declaration (`@objectstack/spec/api`), read by the `POST /api/v1/storage/upload/chunked` door, codegen, the reference docs and clients.

- **Before.** `filename` and `mimeType` were bare strings, so `''` parsed, and the published JSON Schema admitted an empty value that the door refuses.
- **Now.** Both carry a minimum length of 1, and their descriptions say non-empty. A parse of an empty `filename` or `mimeType` fails on that key.
- **Unchanged.** The door answers an empty or missing `filename` or `mimeType` with `400 INVALID_REQUEST` and the same message as before, ahead of the scope check, and writes no row. A whitespace-only value is still admitted by both.
- **Who sees it.** Code that parses an init body with this schema and sent an empty name or type, or a generated client that trusted the wider declaration. The SDK's `storage.initChunkedUpload` takes this schema's input type, which stays `string` for both keys.

**The remedy.** Send the file's name and MIME type; an unknown type is sent as `application/octet-stream`.
