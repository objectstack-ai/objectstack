---
'@objectstack/plugin-hono-server': patch
'@objectstack/client': patch
---

fix(deps): `@hono/node-server` goes to `^2.1.3`, the first release with the GHSA-rmxm-3fg6-px4f fix (#27921)

Clause-②: no
Metadata-protocol: none

`@objectstack/plugin-hono-server` declares `@hono/node-server` as a runtime dependency, so a downstream install now resolves the patched line instead of an affected `2.1.1`. `@objectstack/client` declares the same range as a devDependency and moves in lockstep. No API, behaviour or export changes.
