---
'@objectstack/service-storage': patch
---

fix(service-storage): presigned S3 uploads no longer bake the CRC32 of an empty body into the signed URL (#21147)

Clause-②: no

`S3StorageAdapter.getPresignedUpload()` handed the browser a URL carrying
`x-amz-sdk-checksum-algorithm=CRC32&x-amz-checksum-crc32=AAAAAA==`. `AAAAAA==`
is the CRC32 of an empty body: the AWS SDK's default (`WHEN_SUPPORTED`) stamps a
checksum into every `PutObjectCommand` it prepares, and a presign prepares the
command before any byte exists. A store that enforces a query-signed checksum
against the uploaded body refuses every presigned browser upload with a checksum
mismatch, while server-side `upload()` keeps working. Hosted R2 does not enforce
it, which is why this stayed quiet; self-hosted deployments on other
S3-compatible stores may.

The adapter's `S3Client` now sets `requestChecksumCalculation` and
`responseChecksumValidation` to `WHEN_REQUIRED`. None of the commands the adapter
issues is checksum-required, so the presigned PUT URL carries no `x-amz-checksum-*`
or `x-amz-sdk-checksum-algorithm` parameter, and a presigned GET URL no longer
carries `x-amz-checksum-mode=ENABLED`.

Two server-side effects of the same setting, measured against a loopback server:
`upload()` and multipart `uploadChunk()` no longer send the client-computed
`x-amz-checksum-crc32` header (the SigV4 `x-amz-content-sha256` payload hash is
unchanged), and `download()` no longer asks the store for, or validates, a
response checksum. Both were added only by the SDK's default change; the older
behaviour is restored. SDKs older than the flexible-checksum release ignore the
two options.
