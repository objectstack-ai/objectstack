---
'@objectstack/plugin-security': patch
---

fix(plugin-security)!: an insert that names a master under a `controlled_by_parent` declaration whose one master reference is `readonly` or `system` is refused (ADR-0055 §1)

Clause-②: no (narrowing)

Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No metadata moves: no spec key, authorable spelling, object definition, stored row or stored shape is added, removed, renamed or re-shaped, and no exported declaration is removed or narrowed, so there is nothing for `objectstack migrate meta` to rewrite. The declaration this refusal names is one the parse already refuses, and `os migrate meta --stored` already lists a stored one under `cbp-master-relation-tiers-retired`. What changes is the answer the security plugin's master-detail write gate gives to one write: an insert that names a master under that declaration, on an object that reached the registry without the parse, is refused. The remedy is the parse's own, a change to the declaration, never a rewrite of a package source or a stored row by a migration. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id is registered or amended here (not registered or already-registered); and nothing exported is removed or narrowed (not runtime-interface-only, type-surface-only or runtime-export-retired). -->

**BREAKING** for a caller that relied on such an insert landing. A non-protocol change, shipped as `patch`.

ADR-0055 §1 derives a `controlled_by_parent` detail's access from exactly one required `master_detail` field that every write of a detail supplies. The parse refuses that master when it is declared `readonly: true` or `system: true`, so an object with it reaches the runtime only through a door that does not parse: a raw `registerObject` or `registerApp`, a `defineStack` call with `strict: false`, or a stored object the boot registers under its `[metadata_spec_invalid]` diagnostic. On such an object the security plugin's write gate let an insert that named a master through, and the detail could be stored without the master its access derives from, readable by nobody, while the insert reported success.

- **Before.** An insert naming a master under that declaration was written.
- **Now.** It answers `INVALID_METADATA` (422) and writes nothing, single and batch creates alike. The message is the parse's own refusal of the declaration, prefixed with the write it refused, so it names the object, the field, each flag and the fix.
- **Unchanged.**
  - The rows already stored: the gate still derives their read access from that field, they keep their master, and updates and deletes of them are answered as before.
  - An insert that names no master, which still answers `MISSING_REQUIRED_FIELD` (422).
  - System contexts, every object declared with an ordinary required master, and every object that does not declare `controlled_by_parent`.

**What to do.** Fix the declaration as the parse says: remove `readonly: true` and `system: true` from the master reference and declare it as an ordinary required field. If the rows must outlive their parent, the object is not a detail: give it its own `sharingModel` (`private`, `public_read` or `public_read_write`).
