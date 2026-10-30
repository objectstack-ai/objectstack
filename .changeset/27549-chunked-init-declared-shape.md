---
'@objectstack/service-storage': patch
---

fix(service-storage): the chunked-upload init door parses its body with `InitiateChunkedUploadRequestSchema`, so a `totalSize` that is not a positive whole number and a `chunkSize` below the declared minimum are refused instead of minting a session that can never complete

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) A REST request body is refused at the chunked-upload init door when it does not parse with the spec schema it already declares (`InitiateChunkedUploadRequestSchema`, unchanged): no key of any metadata schema is removed, renamed or re-shaped, no export, type or error code is removed or renamed, and the refusal reuses the existing 400 INVALID_REQUEST envelope. There is nothing for `objectstack migrate meta` to rewrite and no tombstone. -->

**BREAKING** (an accept-set narrowing), shipped as `patch`: nothing a metadata author writes changes (`Metadata-protocol: none`), so the level follows the kind, and the banner and the ADR-0087 disposition stay.

**FROM.** `POST /api/v1/storage/upload/chunked` checked `totalSize` for truthiness only and read the rest of the body as sent:

- A negative `totalSize` such as `-5` answered `200` and minted a session with `totalChunks` of `-0`, so every chunk was then refused and the upload could never complete. A numeric string such as `"100"` was stored on the pending `sys_file` row as sent, and a fraction was accepted.
- A `chunkSize` below 5242880 (5 MiB, the declared minimum) was silently clamped up to 5242880; `null` was read as omitted, and a non-numeric one produced a `NaN` chunk count.
- `bucket` and `metadata` were stored whatever their type.

**TO.** The body is parsed with `InitiateChunkedUploadRequestSchema` before the `sys_file` row, the backend multipart and the upload-session row:

- `totalSize` must be a whole number of at least 1, sent as a JSON number.
- `chunkSize`, when sent, must be a whole number of at least 5242880, sent as a JSON number; a smaller one is refused, not clamped. An omitted `chunkSize` keeps the declared default of 5242880, so `totalChunks` for a valid body is unchanged.
- `bucket`, when sent, must be a string, and `metadata`, when sent, an object of string values.
- Anything else answers `400 INVALID_REQUEST` naming each failing field, and neither row is written. A missing `filename`, `mimeType` or `totalSize` and an off-vocabulary `scope` keep their existing `400` answers.

**Fix.** A client that sent a smaller `chunkSize` sends 5242880 or more, or omits it. A client that sent `totalSize` as a string sends the JSON number. The SDK's `storage.initChunkedUpload` takes the schema's own input type, so a typed caller already sends an in-schema body; no Console path calls this door.
