---
'@objectstack/cli': patch
---

feat(cli): the Console's content-security-policy lets a PDF preview frame the file from the deployment's S3 store

Clause-②: no
Metadata-protocol: none

On a deployment that stores files in S3 or an S3-compatible store (R2, MinIO), the Console document's `frame-src` now names that store's origin beside `'self'`, so the in-page file preview can show a PDF from its signed download link. It is the same origin `connect-src` already names for presigned uploads: the store signs uploads and downloads on one origin. Nothing wider is added: not the hosts named in `OS_CONSOLE_CSP_CONNECT_SRC`, never a scheme or a wildcard. With local storage, or when the storage service cannot name its origin, `frame-src` stays as before (left to `default-src 'self'`, or `'self'` plus the Turnstile frame while that challenge is on).

The storage service's answer is now accepted only as an exact `http(s)` origin: an answer that is a scheme alone, a wildcard, a path or a WebSocket source is left out of both `connect-src` and `frame-src` and reported once, where `connect-src` used to take it. The storage adapters that ship answer an origin, so no deployment changes.
