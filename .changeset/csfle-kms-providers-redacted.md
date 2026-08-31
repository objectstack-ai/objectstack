---
"@objectstack/spec": patch
---

fix(spec): redact mongo CSFLE `kmsProviders` key material on datasource reads (#13602)

`redactDatasourceConfig('mongodb', …)` used to serve the CSFLE KMS secret material
inside the `options` passthrough back in cleartext with no `redactedKeys` entry:
`options.autoEncryption.kmsProviders.aws.secretAccessKey` (and `aws.sessionToken`),
`azure.clientSecret`, `gcp.privateKey`, and `local.key`. All five positions are now
on `passthroughSecretPaths`, measured against `mongodb@7.5.0` both with the optional
`mongodb-client-encryption` dependency installed (the client reads every leaf at
construction) and without it (construction throws `MongoMissingDependencyError`
before reading any of them). The same families' identity halves (`aws.accessKeyId`,
`azure.tenantId`/`clientId`, `gcp.email`) and unmeasured neighbours
(`kmip.endpoint`, `keyVaultNamespace`, `schemaMap`) stay served unchanged. An
untouched Save still round-trips byte-identically: `restoreRedactedConfig` mirrors
the redactor structurally, so the stored CSFLE config keeps working.
