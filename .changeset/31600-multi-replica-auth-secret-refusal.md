---
'@objectstack/cli': patch
---

feat(cli)!: a declared multi-replica `os start` on the redis cluster driver refuses to boot without `OS_AUTH_SECRET`, instead of minting a sign-in secret of its own on each replica

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no stored row changes shape: what moves is whether `os start` generates a sign-in secret at boot for one deployment topology, and the refusal is a boot-time error that names its own remedy. Nothing at rest records the choice, so there is nothing for a migration to rewrite. -->

**BREAKING** for a deployment that declares several replicas (`OS_EXPECT_MULTI_NODE=true` or `OS_CLUSTER_REPLICAS` above 1) over the redis cluster driver (`OS_CLUSTER_DRIVER=redis`) and sets no `OS_AUTH_SECRET`. `os start` used to generate a sign-in secret into each replica's own `<home>/auth-secret`, so a session signed on one replica was refused on the others. It now exits 1 before generating anything, with one line naming `OS_AUTH_SECRET` and how to generate it.

The fix: generate one value and set the same `OS_AUTH_SECRET` on every replica, e.g. `OS_AUTH_SECRET=$(openssl rand -hex 32)`. A deployment that ran on a generated secret keeps its users' sessions by setting `OS_AUTH_SECRET` to the contents of the `auth-secret` file one replica already holds.

Unchanged: a single node (no replica declaration) keeps generating and reusing `<home>/auth-secret` exactly as before, on any cluster driver; a replica declaration over any other cluster driver keeps its current boot; and an `OS_AUTH_SECRET` (or its legacy names, or `--auth-secret`) set on every replica boots as before.
