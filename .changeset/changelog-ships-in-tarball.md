---
"@objectstack/account": patch
"@objectstack/cli": patch
"@objectstack/client": patch
"@objectstack/client-react": patch
"@objectstack/cloud-connection": patch
"@objectstack/connector-mcp": patch
"@objectstack/connector-openapi": patch
"@objectstack/connector-rest": patch
"@objectstack/connector-slack": patch
"@objectstack/console": patch
"@objectstack/core": patch
"@objectstack/driver-memory": patch
"@objectstack/driver-mongodb": patch
"@objectstack/driver-sql": patch
"@objectstack/driver-sqlite-wasm": patch
"@objectstack/embedder-openai": patch
"@objectstack/formula": patch
"@objectstack/hono": patch
"@objectstack/knowledge-memory": patch
"@objectstack/knowledge-ragflow": patch
"@objectstack/lint": patch
"@objectstack/mcp": patch
"@objectstack/metadata": patch
"@objectstack/metadata-core": patch
"@objectstack/metadata-fs": patch
"@objectstack/metadata-protocol": patch
"@objectstack/objectql": patch
"@objectstack/observability": patch
"@objectstack/platform-objects": patch
"@objectstack/plugin-approvals": patch
"@objectstack/plugin-audit": patch
"@objectstack/plugin-auth": patch
"@objectstack/plugin-dev": patch
"@objectstack/plugin-email": patch
"@objectstack/plugin-hono-server": patch
"@objectstack/plugin-pinyin-search": patch
"@objectstack/plugin-reports": patch
"@objectstack/plugin-security": patch
"@objectstack/plugin-sharing": patch
"@objectstack/plugin-webhooks": patch
"@objectstack/rest": patch
"@objectstack/runtime": patch
"@objectstack/sdui-parser": patch
"@objectstack/service-analytics": patch
"@objectstack/service-automation": patch
"@objectstack/service-cache": patch
"@objectstack/service-cluster": patch
"@objectstack/service-cluster-redis": patch
"@objectstack/service-datasource": patch
"@objectstack/service-i18n": patch
"@objectstack/service-job": patch
"@objectstack/service-knowledge": patch
"@objectstack/service-messaging": patch
"@objectstack/service-package": patch
"@objectstack/service-queue": patch
"@objectstack/service-realtime": patch
"@objectstack/service-settings": patch
"@objectstack/service-sms": patch
"@objectstack/service-storage": patch
"@objectstack/setup": patch
"@objectstack/studio": patch
"@objectstack/trigger-api": patch
"@objectstack/trigger-record-change": patch
"@objectstack/trigger-schedule": patch
"@objectstack/types": patch
"@objectstack/verify": patch
"create-objectstack": patch
---

chore(packaging): CHANGELOG.md ships in every npm tarball (#4261)

The AGENTS.md post-task checklist requires breaking changesets to carry their
FROM → TO migration because "this text ships to consumers as `CHANGELOG.md`
inside the npm package and is what an upgrading agent greps after the tombstone
error." That delivery path was severed for 68 of the 69 publishable packages:
npm packs `package.json` / `README*` / `LICENSE*` unconditionally but — unlike
older npm versions — not `CHANGELOG.md`, and the canonical
`"files": ["dist", "README.md"]` whitelist never named it. Measured on npm
10.9.7: `npm pack --dry-run` on `@objectstack/types` shipped 3 files while its
70KB `CHANGELOG.md` stayed behind. Only `@objectstack/spec` listed it
explicitly.

The tombstone-error scenario is precisely the one where the repo is out of
reach — the upgrading agent has `node_modules` and nothing else — so the
migration text has to ride in the tarball. Every publishable package now
declares `CHANGELOG.md` in `files`, and the canonical whitelist is
`["dist", "README.md", "CHANGELOG.md"]`.

The other half is the gate: `check:published-files` gains a fifth invariant,
COMPLETE — a whitelist that fails to cover `CHANGELOG.md` fails the
always-required lint job, so the next package cannot silently sever the path
again. `@objectstack/spec`'s per-package EXTRA_ENTRIES exemption dissolves
into the canonical set.

Consumer-visible change: one more file per install (the package's changelog,
e.g. 70.8KB for `@objectstack/types`), and `grep -r "removed key"
node_modules/@objectstack/*/CHANGELOG.md` now finds the migration it was
promised.
