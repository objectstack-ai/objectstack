---
'@objectstack/cli': patch
'@objectstack/service-storage': patch
---

fix(cli,service-storage): the Console document's `connect-src` names the store the server presigns browser uploads to

Clause-②: yes (widening)
Metadata-protocol: none

With S3 or an S3-compatible store (R2, MinIO), the Console uploads a file by `PUT`ting it straight to the URL `POST /api/v1/storage/upload/presigned` answers, on the store's host. The Console document's content-security-policy did not name that host, so the browser refused every such upload with `TypeError: Failed to fetch`.

- **`@objectstack/service-storage`.** `S3StorageAdapter.getPresignedUploadOrigin()` answers the origin every presigned upload URL carries. It signs a probe upload with the same client options as every real presign, so a virtual-hosted bucket (`BUCKET.ENDPOINT-HOST`), a region-templated AWS host and a path-style endpoint come out exactly as the upload URL carries them. Signing is local and uses fixed probe credentials, so it never reaches the network or the AWS credential chain. `SwappableStorageService.getPresignedUploadOrigin()` answers the active adapter's origin, or `undefined` for an adapter without one (the local adapter's uploads go to the server itself).
- **`@objectstack/cli`.** The Console mount reads that origin off the kernel's `storage` service on every document and adds it to `connect-src`, after the error-reporting origin and before `OS_CONSOLE_CSP_CONNECT_SRC`. A storage settings change that swaps the adapter is followed on the next document, with no restart. Local storage, no storage service, or a store whose endpoint the presigner refuses adds nothing. The last case logs one `warn` that names the remedy. `OS_CONSOLE_CSP_CONNECT_SRC` still adds an operator's extra sources, and a deployment that named its store there as a stop-gap can drop it.
