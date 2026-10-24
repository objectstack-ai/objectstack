---
'@objectstack/plugin-security': minor
---

fix(plugin-security)!: an update or delete of a `controlled_by_parent` detail asks for edit access to its master on every write shape (ADR-0055 §3)

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) No metadata moves: no spec key, authorable spelling, object definition, stored row or stored shape is added, removed, renamed or re-shaped, and no exported declaration is removed or narrowed, so there is nothing for `objectstack migrate meta` to rewrite. What changes is the answer the security plugin's master-detail write gate gives for one shape of write to a `controlled_by_parent` detail: it now asks the master-edit question a by-id update or delete already asks, and refuses where that question refuses. The remedy is a grant on the master or a narrower write, never a rewrite of a package source or a stored row. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id is named or touched (not registered or already-registered); and nothing exported is removed or narrowed (not runtime-interface-only, type-surface-only or runtime-export-retired). -->

ADR-0055 §3 says editing or deleting a detail requires edit access to its master, and it names no write shape as exempt. The master-detail write gate decided one shape of write to a `controlled_by_parent` detail without asking that question. It now asks it: the gate collects the masters of the detail rows the write would reach, as the caller's own read returns them, and runs on each master the check a by-id write runs. One master the caller may not edit refuses the whole write, and nothing is written. On a write made on a user's behalf, both principals are asked, as on a by-id write.

**BREAKING** for a caller that relied on that shape to write details under a master it may not edit. Shipped as `minor` under the launch-window convention for accept-set narrowings.

- **Before.** That shape of write changed or removed details under a master the caller may not edit, bounded only by what the caller could read and, for an organization member, by the platform ownership floor.
- **Now.** It answers the refusal a by-id write of the same detail answers: `PERMISSION_DENIED` (403), naming the detail and the master-edit reason. A write whose rows all sit under masters the caller may edit lands as before and writes the same rows. A row the caller cannot read is not judged and is not written.
- **Also refused.** A caller whose read of the detail is itself refused gets that read's refusal for this shape of write, because the masters of rows it cannot read cannot be established. A write reaching more than 10,000 readable rows answers `INVALID_FILTER` (400), the refusal the same count already answers.
- **Unchanged.** Inserts and by-id updates and deletes; system contexts; the detail's read scope; the platform ownership floor; and every object that does not declare `controlled_by_parent`.

**What to do.** Grant the caller edit access on the master, or narrow the write to details under masters the caller may edit.
