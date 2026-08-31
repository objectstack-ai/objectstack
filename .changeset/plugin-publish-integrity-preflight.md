---
"@objectstack/cli": patch
"@objectstack/core": patch
---

`os plugin publish` now verifies the artifact's own declared `manifest.integrity` digests before uploading, and refuses the publish on a digest mismatch, a declared entry with no file, or a packaged file the map does not declare (an absent map still publishes — the field is optional). The pure checker, `verifyIntegrity`, lives in `@objectstack/core` beside the artifact-signature contract. Unpack-time re-verification remains the cloud control plane's obligation (#11331) and is not changed by this release.
