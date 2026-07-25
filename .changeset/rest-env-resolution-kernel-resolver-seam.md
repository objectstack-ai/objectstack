---
"@objectstack/rest": minor
---

feat(rest): unify request→environment resolution on the host's `kernel-resolver` seam — ADR-0076 D11 step ④ (#2462)

The REST server kept its own parallel hostname/`X-Environment-Id` resolution
chain (duplicated inline in three places), while the HTTP dispatcher resolves
the same question through the host-injected ADR-0006 `kernel-resolver` seam —
so the same unscoped request could be attributed to different environments
depending on which HTTP surface served it.

`RestApiPlugin` now adapts the host's `kernel-resolver` service (registered by
the cloud runtime next to `env-registry`; no cloud-side change needed) into a
new `RestRequestEnvResolver` seam, and `resolveRequestEnvironmentId` becomes
the single entry point every per-environment decision (protocol, i18n,
exec-ctx) flows through. Where a resolver is wired, its answer — including the
session-driven fallbacks the REST chain never had — is final; the legacy
built-in chain remains for OSS single-environment boots (no resolver
registered) and as the degradation path if the resolver throws.
