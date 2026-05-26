---
"@objectstack/service-ai": patch
"@objectstack/runtime": patch
---

Fix peer-dependency version range from `workspace:*` to `workspace:^` to avoid
forced major bumps in fixed-group releases. `workspace:*` expands to an exact
version on publish; any minor bump of the peer then falls out of range and
triggers a semver-major bump on the dependent. `workspace:^` expands to `^x.y.z`
which correctly accepts minor bumps.

Affects:
- `service-ai` peer on `@objectstack/embedder-openai`
- `runtime` peer on `@objectstack/driver-turso`
