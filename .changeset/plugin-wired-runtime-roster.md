---
'@objectstack/spec': minor
---

Add `PLATFORM_PLUGIN_WIRED_RUNTIMES` (and its row type `PlatformPluginWiredRuntime`) to the kernel platform-capability module: a companion provenance roster, keyed by npm package name, for the out-of-repo runtimes that reach the kernel through app `plugins[]` wiring rather than through a `requires` capability token — today `@objectstack/organizations` (loaded by `serve` off the resolved tenancy posture) and `@objectstack/security-enterprise` (which also backs the `hierarchy-security` token). The token-keyed `PLATFORM_CAPABILITY_PROVIDERS` map structurally cannot describe a package that backs no token; this roster makes "is this out-of-repo package real, and where does it ship from?" machine-readable for that population. Provenance only — it adds no capability token, changes no `requires` resolution, and encodes no posture-to-token semantics; drift tests pin the two rosters to agree wherever they name the same package.
