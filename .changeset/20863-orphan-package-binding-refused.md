---
'@objectstack/metadata-protocol': minor
---

fix(metadata-protocol)!: a flow saved through the metadata door naming, as its base, a package this deployment has not installed is refused, instead of being stored bound to a package that does not exist (#20863)

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) No metadata changes shape and nothing an author wrote is renamed or removed, so `objectstack migrate meta` has nothing to rewrite. What moves is which flow saves the metadata door accepts: a save that names a package no installed package holds is now refused. -->

**BREAKING**: shipped as `minor` under the launch-window convention. `PUT /api/v1/meta/flow/:name` answered `200` and stored the flow live when the save named, as the package the flow belongs to, a package id this deployment has never installed. It now answers `422 WRITABLE_PACKAGE_REQUIRED`, and nothing is written, served or registered.

**What changed.** The one authoring rule every flow write door asks (`tenantAuthoredWriteRefusal`) now also judges the base a save names. After the locked-base refusal and before the provenance check, a named base must be a package the registry holds as installed: a code package, an installed package, or a tenant's own writable base created through the package door. That is the same registry read the metadata write path already resolves a base against, so no second list of packages is kept. The refusal does not depend on what the definition carries: a save with no provenance of its own and a save whose provenance names that same missing package were both stored before, and both are refused now. It applies on a single-kernel host and on an environment kernel alike.

- The code is `WRITABLE_PACKAGE_REQUIRED` / `422`, the one ADR-0070 D1 already uses for a runtime create whose base is missing or read-only. The refusal names the package id the save sent.
- **Unchanged:** a flow saved without naming a package; a flow saved into an installed package; the locked-base refusal of a shipped flow, which still answers first; every other metadata type, whose saves keep their old handling; the `/automation` create, update and clone doors, which name no package; and the server-stated rewrites of stored rows (the stored-metadata migration and package duplication), which the rule does not judge.

**What to send instead.** Save the flow into a package this deployment has installed (the package list shows them, and a base that does not exist yet is created first through the package door), or save the flow without naming a package.
