---
'@objectstack/service-storage': patch
---

fix(storage): S3 chunked uploads find their object key in the upload session row, on any replica

Clause-②: no
Metadata-protocol: none

Chunked uploads to S3 work again. Who is affected: any deployment whose storage adapter is S3 (or S3-compatible) and whose clients upload in chunks (`POST /storage/upload/chunked`, the SDK's chunked and resumable uploads). Before this fix the first chunk answered `500` ("S3StorageAdapter: key not found for uploadId") even on a single server, and a chunk or completion served by another replica could never have found the key.

S3 addresses a multipart upload by object key and upload id, but the storage contract's chunk and completion calls carry the upload id alone, so the S3 adapter kept the key in an in-memory map filled at the start of the upload. The kernel's `storage` service is the swappable proxy, which did not forward that call, so the map was never filled; and a map in one process cannot serve another. The chunk and completion doors now read the key from `sys_upload_session.key` (the durable record the init door already writes) and hand it to the adapter before every backend call, and the proxy forwards `setUploadKey` to the active adapter.

Nothing changes for the local adapter or any adapter without `setUploadKey`, nor in the chunked-upload HTTP requests and answers. No migration: upload sessions already store their key.
