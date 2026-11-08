---
'@objectstack/metadata-core': patch
'@objectstack/cloud-connection': patch
'@objectstack/spec': patch
---

feat(metadata-core): export the schema upgrade verdict and its finding set token, so a host's install door forwards the platform's own verdict

Clause-②: yes (widening) — `@objectstack/metadata-core` gains exports and nothing else: `schemaUpgradeVerdict`, `installedRecordUnavailableVerdict`, `schemaUpgradeFindingSet`, `SCHEMA_UPGRADE_CONFIRMATION_REQUIRED`, `SCHEMA_UPGRADE_CONFIRMATION_STATUS`, `SCHEMA_UPGRADE_TOPIC`, `SCHEMA_UPGRADE_CONFIRMED_CATEGORIES` and the types `SchemaUpgradeFinding`, `SchemaUpgradeUnavailableFinding` and `SchemaUpgradeVerdict`. No request, answer, key or code changes on any door.
Metadata-protocol: none

The verdict that decides which findings of a package upgrade plan stop a managed upgrade until the installer confirms them (a suspected rename; a type change in the `needs_confirm` or `destructive` drift category, on a declared rename too) and the token that confirmation must echo were private to the install-local door. They now live in `@objectstack/metadata-core` beside `comparePackageVersions`, and the install-local door imports them. A host that installs a package version from its own stored versions, such as the hosted control plane installing into an environment, applies the same rule and mints the same token, so the same pair of versions is refused with the same findings and the same token whichever door installs it.

- **`@objectstack/metadata-core`:** the exports above. `schemaUpgradeVerdict(packageId, plan)` answers `{ findings, findingSet }`; `installedRecordUnavailableVerdict(packageId, finding)` is the verdict of a door with no installed side to compare (one confirmable finding, never "no finding"), the finding's sentence being the door's own.
- **`@objectstack/spec`:** one `PROVENANCE_WAIVERS` entry: `SCHEMA_UPGRADE_CONFIRMATION_REQUIRED` is now defined in metadata-core and still registered under `@objectstack/cloud-connection`, the package whose door puts it on the wire (the `UPDATE_ID_MISMATCH` shape). No row is added or moved.
- **`@objectstack/cloud-connection`:** the install-local door's `409 SCHEMA_UPGRADE_CONFIRMATION_REQUIRED` refusal, its findings, its sentences and its token are unchanged. The token for a given plan is byte-identical before and after, pinned by a test with values the door's own digest minted.
