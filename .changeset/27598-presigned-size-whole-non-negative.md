---
'@objectstack/spec': minor
'@objectstack/service-storage': patch
---

fix(spec)!: `GetPresignedUrlRequestSchema.size` declares a whole, non-negative byte count, and `filename` / `mimeType` declare that they are non-empty, the accept set the presigned-upload door enforces (#27598)

Clause-②: no (narrowing) — the published declaration of the presigned-upload request body refuses a negative or fractional `size` and an empty `filename` or `mimeType`, which it admitted before. Nothing is widened and no key is added, removed or renamed.
Metadata-protocol: narrowed

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped and no metadata type or stored shape moves: a REST request declaration no metadata type embeds stops admitting a negative or fractional `size` and an empty `filename` or `mimeType`. The door already refused all but the fraction, and a fractional size never named a byte count a stored file can hold. A caller sends the file's whole byte length, name and MIME type; there is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** accept-set narrowing of a published request declaration (`@objectstack/spec/api`), read by the `POST /api/v1/storage/upload/presigned` door, codegen, the reference docs and clients.

- **Before.** `size` was any number, and `filename` / `mimeType` were bare strings, so `-1`, `1.5` and `''` parsed. The door refused a negative size and an empty name or type with a 400, but accepted a fractional size: it minted an upload URL and a pending file record that no upload could complete, because the complete door compares the held byte count, always whole, with the declared one.
- **Now.** `size` is `int().min(0)`, and `filename` / `mimeType` carry a minimum length of 1; their descriptions say so. A parse of any of those values fails on that key. The door (`@objectstack/service-storage`) also refuses a fractional `size` with `400 INVALID_REQUEST`, before any record is written, with the message `size must be the file size in bytes: a non-negative whole number, sent as a JSON number`.
- **Unchanged.** A negative, non-numeric, `NaN` or infinite size, and an empty or missing `filename` or `mimeType`, get the same 400 as before, in the same order as before. `0` is still a legal empty file. The SDK's `storage.getPresignedUrl` takes this schema's input type, which stays `number` / `string`.
- **Who sees it.** Code that parses a presigned-upload body with this schema and sent one of the refused values, a generated client that trusted the wider declaration, and a caller that sent a fractional size to the door.

**The remedy.** Send the file's length in whole bytes (`File.size` already is), and its name and MIME type; an unknown type is sent as `application/octet-stream`.
