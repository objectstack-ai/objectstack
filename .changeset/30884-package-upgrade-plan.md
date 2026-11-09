---
'@objectstack/metadata-core': patch
'@objectstack/objectql': patch
'@objectstack/cloud-connection': patch
'@objectstack/cli': patch
---

feat: the package upgrade plan — one comparison of an installed package version with the incoming one, a dry run of the install door, and `os package install --dry-run`

Clause-②: yes (widening) — new exports from `@objectstack/metadata-core` (`comparePackageVersions` and its types, `typeChangeCategory`, `isEmptyPackageUpgradePlan`, `upgradePlanSeedDatasets`, `seedModeOverwritesMatchedRows`), a new `planUpgrade` method on objectql's `manifest` service, a new `dryRun` key on the `POST /api/v1/marketplace/install-local` body, a new `--dry-run` flag on `os package install`, and new `os diff` entries (declared and suspected renames, seed datasets). Nothing a request did before answers differently.
Metadata-protocol: none

**One comparison.** `comparePackageVersions(installed, incoming)` (`@objectstack/metadata-core`) lists what an upgrade from one version of a package to the next changes: objects and fields added and removed; type changes, each with the drift category `schema-drift.ts` uses (`safe`, `needs_confirm`, `destructive`); renames a field declares with `renamedFrom`; suspected renames, where one object loses a stored field and gains one with nothing linking them; and seed datasets added, removed and changed, each with its mode. A declared rename whose type changes is also listed as a type change. It is pure and decides nothing.

**What the environment knows.** The `manifest` service's `planUpgrade(installed, incoming)` (`@objectstack/objectql`) answers the comparison with two readings of the installed data: the rows holding a value in each column the upgrade removes, renames or retypes (and the rows of each object it removes), and, for each `upsert` or `update` dataset both versions declare, the rows a customer edited that the seed replay would write over. A reading that fails is `null`, never `0`.

**A dry run.** `POST /api/v1/marketplace/install-local` with `dryRun: true` answers `200` with the plan of the installed version (its ledger entry) against the one sent, and installs and writes nothing. A dry run of an `unmanaged` install or of a customization pair is refused `400 INVALID_REQUEST`, as is a `dryRun` that is not a boolean. `os package install … --dry-run` sends it and prints the plan. A runtime that predates the key ignores it and installs; the command then says so and exits 1.

**`os diff`** reads its object and field changes from the same comparison, so the CLI and an install cannot disagree. Its output for every shape it reported before is unchanged. New: a field renamed with `renamedFrom` prints as one rename instead of a removal and an addition (`renamedFrom` is new in this release), a suspected rename prints beside its removal and addition, and seed datasets print under `data`.
