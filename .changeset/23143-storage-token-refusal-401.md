---
'@objectstack/service-storage': patch
---

fix(service-storage): a presigned token the local adapter refuses answers `401 INVALID_TOKEN` on both raw byte routes, never a `500`

Clause-②: no

`PUT` and `GET /api/v1/storage/_local/raw/:token` are the local adapter's presigned byte routes. Each now answers every token it will not honour with `401 INVALID_TOKEN`, the status, code and message (`Invalid or expired token`) the error catalog already published for this code. The four cases are a malformed token, a forged one, one minted for the other verb, and an expired one.

- **Before:** a malformed token, or one minted for the other verb, answered `500 INTERNAL`, which reads as a server fault. A forged or an expired token answered `403`, with a message naming which check failed. A genuine fault whose text happened to contain "expired" or "signature" was answered as a refused token.
- **Now:** every refusal gets the same status, code and message, so the answer never tells a forger whether the signature or the expiry failed. Any other failure behind a valid token is still `500 INTERNAL`, whatever its text says.
- **Unchanged:** a valid token's upload or download, the `501 NOT_IMPLEMENTED` answer when no adapter can verify tokens, and every other storage route.

What changes for you: a stale or tampered signed URL now answers `401` where it answered `403` or `500`. To recover, request a fresh URL (`GET /api/v1/storage/files/:fileId/url`, or a new presigned upload). The SDK's `storage.upload` and the console's upload adapter only check that the response is OK, so neither needs a change.
