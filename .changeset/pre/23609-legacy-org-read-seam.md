---
'@objectstack/metadata-protocol': patch
'@objectstack/metadata': patch
'@objectstack/cli': patch
'@objectstack/spec': patch
---

**Shipped in 18.0.0-next.2**, whose CHANGELOG missed this entry (#23818); listed here one prerelease late.

fix(metadata-protocol,metadata): on a database the organization-ownership ceremony has not migrated, the paged family reads, `DatabaseLoader`'s count and the package rollback agree with the environment-only reads; the ceremony's apply is named with `--plan-file` (ADR-0131 D6/D7)

Clause-②: no

Every change below matters only where legacy organization rows still sit in the `sys_metadata` family, the database `os serve` refuses to start on until `os migrate organization-ownership` has verified. On a migrated or fresh database every answer is unchanged.

- **`@objectstack/metadata-protocol`: a paged read leaves the legacy rows out before the page is cut.** `auditMetaItem` (`limit`), `listCommits` (`limit`), `revertStoredPackage`'s first-active-row probe and `SysMetadataRepository.list({ limit })` used to filter a legacy organization's rows out after the limit. A page they sat in came back short, and `revertStoredPackage` answered `RESOURCE_CONFLICT` (409) "has never been published" for a package the environment had published when its first active row was an organization's. When a page holds a legacy row, the read is now repeated with those rows excluded in the query.
- **`@objectstack/metadata-protocol`: `rollbackToPackageCommit` refuses a legacy organization's commit by name.** It answered `COMMIT_NOT_FOUND` (404) for a commit that is there. It now gives `revertCommit`'s refusal: `NOT_OVERRIDABLE` (403), the same sentence, naming the commit and its organization.
- **`@objectstack/metadata`: `DatabaseLoader` counts what it reads.** `exists()` answered true for an address only a legacy organization row held, while `load()` answered null, and `queryHistory`'s `total` counted legacy history rows no page serves. Neither counts them now.
- **`@objectstack/metadata-protocol`: internal cleanup.** The organization plumbing that only ever carried the environment (`null`) is removed from the list merge and the served-row resolution. No export changes.
- **`@objectstack/spec`: wording.** The four ADR-0087 entries `18.sys-metadata{,-audit,-commit,-history}-organization-column-retired` now name the ceremony's reviewed apply, `os migrate organization-ownership --out PLAN` and then `--apply --plan-file PLAN`, which `--plan-file`'s own entry requires. No id, category, version or field the migration engine reads changes.
- **`@objectstack/cli`: wording.** `os migrate apply --allow-destructive`'s refusal on an unmigrated database now reads "a drop the organization-ownership ceremony owns, and the ceremony has not verified on this database". Its `--json` payload is unchanged.
