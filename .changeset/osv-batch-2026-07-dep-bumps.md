---
"@objectstack/create-objectstack": patch
"@objectstack/metadata": patch
---

chore(deps): OSV security batch — bump tar to ^7.5.21 (GHSA-r292-9mhp-454m) and
js-yaml to ^5.2.2 (GHSA-pm4m-ph32-ghv5)

Both are declared-range bumps to the patched releases, so downstream installs
resolve the fixed versions from the published manifests, not just this
workspace's lockfile. The same batch clears the remaining transitive advisories
(next 16.2.11 in apps/docs; workspace overrides for brace-expansion, sharp,
react-router, @sveltejs/kit, @hono/node-server) — those live in pnpm-workspace.yaml
and the private docs app, which do not ship.
