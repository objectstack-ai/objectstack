---
'@objectstack/metadata-core': patch
'@objectstack/metadata-protocol': patch
'@objectstack/runtime': patch
'@objectstack/cloud-connection': patch
'@objectstack/spec': patch
---

feat(install): installing a package checks its declared `dependencies` first — every entry must name a package installed at a version inside its range, or one the same artifact delivers, or the install is refused `422 DEPENDENCY_MISSING` (ADR-0141 D2)

Clause-②: yes (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any metadata schema is added, removed, renamed or re-shaped: `manifest.dependencies` keeps its record shape and meaning, so there is nothing for `objectstack migrate meta` to rewrite and no tombstone. What changes is the answer the three install doors give a package whose declared dependencies the target environment does not satisfy. -->

**BREAKING** (an install-acceptance narrowing) for a package whose manifest declares a `dependencies` entry the target environment does not satisfy. The three install doors — `POST /api/v1/packages` (both its protocol arm and its no-protocol fallback), the protocol's `installPackage` called in-process, and `POST /api/v1/marketplace/install-local` — used to install such a package and let the gap surface at its first cross-app save. They now refuse the whole install, before anything is registered, written or synced, with `422 DEPENDENCY_MISSING`.

An entry `(id, range)` is satisfied when `id` is installed at a `manifest.version` inside `range`, or is delivered by the same artifact (presence only: the packages of one artifact are one tested unit). Ranges are read at exact-version granularity in npm style: `^`, `~`, `>=`, `>`, `<=`, `<`, `=`, an exact version, `x` / `*` wildcards, hyphen ranges, space- or comma-joined intersections and `||` unions. A range outside that grammar (`latest` included) or an installed version that is not `MAJOR.MINOR.PATCH` does not satisfy — the check fails closed.

The refusal names every unmet entry in one answer: `error.details.issues` carries one `AppCompatibilityCheck` issue per entry (`severity: 'error'`, `category: 'dependency_missing'`), and `error.details.unmet` the facts per entry — `packageId`, `dependency`, `range`, `found` (`absent`, `out-of-range`, `unreadable-range`, `unreadable-version` or `unreadable-declaration`) and the `installedVersion` when one is installed.

Unchanged: a package that declares no dependencies installs exactly as before; a boot never runs the check (what an install admitted stays admitted); `PATCH /api/v1/packages/:id` still applies a `dependencies` edit as given.

**What changes for you.** Install a package's dependencies, at versions inside its declared ranges, before the package itself; the refusal says which and at what range. `@objectstack/metadata-core` exports the check (`checkDeclaredDependencies`, `assertDeclaredDependencies`), its error (`DependencyMissingError`, `isDependencyMissingError`, `dependencyMissingAnswer`) and the range reader (`rangeAdmitsVersion`, `readExactVersion`, `DEPENDENCY_RANGE_GRAMMAR`). `DEPENDENCY_MISSING` is registered in the error-code ledger under `@objectstack/metadata-core`.
