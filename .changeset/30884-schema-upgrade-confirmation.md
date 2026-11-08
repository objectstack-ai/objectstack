---
'@objectstack/spec': patch
'@objectstack/cloud-connection': patch
'@objectstack/cli': patch
---

feat(cloud-connection)!: a managed upgrade that renames or retypes a stored field is refused until it is declared or confirmed

Clause-②: yes (narrowing) — a managed re-install through install-local that installed before is refused `409 SCHEMA_UPGRADE_CONFIRMATION_REQUIRED` when its package upgrade plan lists an undeclared suspected rename or a `needs_confirm` / `destructive` type change, and `501 NOT_IMPLEMENTED` when it declares a field rename (`renamedFrom`) this runtime cannot carry yet. The widening half: the error-code ledger registers `SCHEMA_UPGRADE_CONFIRMATION_REQUIRED` under `@objectstack/cloud-connection`, install-local takes `confirmSchemaUpgrade`, and `os package install` and `os deploy` take `--confirm-upgrade`.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped and no export is removed: the refusal judges two package bodies at the install door, so there is nothing for a migration to rewrite and no tombstone. The way through is a token the refusal itself prints. -->

**BREAKING** accept-set narrowing at the install-local door (`POST /api/v1/marketplace/install-local`, `@objectstack/cloud-connection`) for a managed re-install over an installed package.

Before any write, after the access upgrade check, the door compares the installed version (its ledger entry) with the incoming one through `comparePackageVersions` (`@objectstack/metadata-core`), the comparison the dry run and `os diff` read:

- **A suspected rename** (in one object, a stored field removed while a stored field is added, with no `renamedFrom` linking them) or **a type change** the drift categories call `needs_confirm` (both columns stored) or `destructive` (the new type stores no column) answers `409 SCHEMA_UPGRADE_CONFIRMATION_REQUIRED`. `error.details.findings` names each with a one-line `describe` (and, when the runtime's `manifest` service answers `planUpgrade`, the rows the installed column holds); `error.details.findingSet` is the token. The same request with `"confirmSchemaUpgrade": "<findingSet>"` installs, as the additive schema sync leaves the fields, and the ledger entry records `schemaUpgradeConfirmation` (the token, who, when). A token from another finding set is refused again with the fresh one. A type change riding on a declared rename is judged on its own.
- **The installed side** is the ledger entry's body; an orphaned install (the registry still serves the package, the ledger holds no record) is compared against the body the registry serves. When there is no installed body to compare — the ledger file will not parse, or neither the ledger entry nor the orphan's registry row carries a body — the same `409` names that as its one finding (`installed_record_unreadable` with the file and the cause, or `installed_record_missing`), and its token admits the re-install, which rewrites the record; a rename the incoming version declares still answers the `501` below.
- **A declared rename** (`renamedFrom` on a field of the new version) answers `501 NOT_IMPLEMENTED`, naming each rename: this runtime cannot yet move a renamed field's values to its new key, and no token answers it.
- A `safe` type change (the installed field had no stored column), a removed field or object and a seed dataset change are refused by nothing; `dryRun: true` reports them.

A first install, an `unmanaged` install and a re-install whose plan lists none of these answer as before.

**Migration.** A package author whose upgrade is refused either declares the rename on the new field — `renamedFrom: ['<old key>']` — and rebuilds, or confirms the findings as listed: `os package install <artifact> --confirm-upgrade <findingSet>` (`os deploy --confirm-upgrade <findingSet>` against a self-hosted runtime), or `"confirmSchemaUpgrade": "<findingSet>"` in the install-local body. A host that calls install-local itself reads `error.details.findingSet` off the 409 and sends it back. Preview the refusal first with `os package install <artifact> --dry-run`.
