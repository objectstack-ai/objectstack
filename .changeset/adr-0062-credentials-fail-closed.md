---
"@objectstack/service-datasource": minor
---

feat(datasource): fail-closed credential resolution at connect (ADR-0062 Phase 2, D3)

`DatasourceConnectionService` now treats a declared `external.credentialsRef` as
**fail-closed**: the credential must resolve to a cleartext secret (via the
host's `SecretBinder` over `ICryptoProvider`) *before* the driver is built. An
absent secret store, or a ref that cannot be resolved/decrypted (missing
`sys_secret` row, rotated key, or a throwing resolver), leaves the datasource
**unconnected with a clear message** — never a silent build-without-secret that
would connect with no/wrong auth or fail later with a confusing driver error.

The same policy as connect failures applies: a code-defined `external` datasource
with `validation.onMismatch: 'fail'` auto-connected at boot fails fast (bricks
boot); runtime-admin create/update + boot rehydration degrade-with-warning. Code-
and runtime-origin secrets converge on the one connection path (the same
`SecretBinder` is threaded through the shared service). New `failed-credentials`
connect status.
