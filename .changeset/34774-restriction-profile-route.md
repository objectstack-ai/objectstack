---
'@objectstack/rest': patch
---

Clause-②: yes — widening: one new anonymous read-only discovery route (an open restriction profile); nothing served today changes
Metadata-protocol: none

feat(rest): a self-hosted runtime serves the restriction profile `os validate --target` reads

`GET /api/v1/discovery/restriction-profile` is now served by `@objectstack/rest`, the route `os validate --target <url>` reads, so `os validate --target` against a self-hosted runtime reads a profile instead of failing with a 404. It answers `{ success: true, data }`, where `data` is a `RestrictionProfileSchema` value: the open runtime restricts nothing, and `versions.spec` and `versions.skills` name the `@objectstack/spec` version it runs.

- It answers without a credential, as `/discovery` does and as the cloud already serves the same route (ADR-0138 D2, amended 2026-11-20: the control-plane discovery role).
- It reads no query parameter: any one is refused `400 VALIDATION_ERROR`.
- When the runtime cannot read the `@objectstack/spec` version it runs, it answers `503 SERVICE_UNAVAILABLE` and publishes no profile.
- `api.enableDiscovery: false` unmounts it together with the rest of discovery; the CLI then fails as it does for any server that does not serve the route.
- `allowedFlowNodeTypes` is a constant: the profile's whole node-type vocabulary, the approvals plugin's `approval` / `approval_revise` included. It does not say which plugins the runtime runs, so `os validate --target` does not check whether an approval flow has an executor on that runtime.
- fix(rest): the CommonJS build (`require('@objectstack/rest')`) now resolves package manifests as the ESM build does. esbuild emptied `import.meta` in that build, so `loadOpenApiSpec` could not read the static OpenAPI artifact, and the new restriction-profile route would have answered `503` there; the package now builds with tsup's `shims`.
