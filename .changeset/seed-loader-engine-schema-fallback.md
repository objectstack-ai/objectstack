---
"@objectstack/metadata-protocol": patch
---

fix(seed-loader): resolve lookup/master_detail references for objects that only live in the engine registry (marketplace installs)

`SeedLoaderService.buildDependencyGraph` consulted only `metadata.getObject()`
when building the reference graph. Marketplace-installed packages register
their objects through the `manifest` service straight into the ObjectQL
registry — after the boot-time `bridgeObjectsToMetadataService` pass — so the
metadata service never lists them. The reference graph came back empty for
those objects and every lookup / master_detail seed value was written
verbatim: `crm_contact.crm_account` held the authored natural key
(`"Acme Corporation"`) instead of the target record's id.

The damage compounded under RLS: `crm_contact` declares
`sharingModel: controlled_by_parent`, whose row filter compiles to a join on
the parent reference. With every reference dangling, the join matched nothing
and the whole object went invisible to everyone — platform admins included —
while the rows sat in the table (REST list `total=0`, single GET 404).

The loader now falls back to the engine's own schema registry
(feature-detected `engine.getSchema()`, which the ObjectQL engine exposes)
whenever the metadata service has no definition for a seeded object. The
metadata service remains the preferred source; engines without a schema
registry keep the old behavior.
