---
'@objectstack/cli': patch
'create-objectstack': patch
---

fix(cli): retire the scaffold's five stale `peerDependencyRules` entries on the better-auth 1.7.12 pin

Clause-②: no
Metadata-protocol: none

A project scaffolded by `objectstack init` or `npx create-objectstack` no longer carries a `peerDependencyRules.allowedVersions` block in its `pnpm-workspace.yaml`. All five entries suppressed peer mismatches that better-auth 1.7.12 no longer has: `better-auth` declares no `better-sqlite3` peer, and `@better-auth/core`, `@better-auth/oauth-provider`, `@better-auth/scim` and `@better-auth/sso` each peer `@better-auth/utils` as `^0.4.2 || ^0.5.0`, which the resolved 0.5.0 satisfies. `allowedVersions` only silences a report, so a scaffold resolves the same lockfile as before and its first `pnpm install` stays free of unmet-peer warnings. Projects scaffolded earlier can keep or delete the block; either way nothing changes.
