---
'@objectstack/plugin-security': minor
---

fix(plugin-security)!: a batch create of a `controlled_by_parent` detail asks for edit access on the master of every row it names, and an update no longer empties a detail's master reference (ADR-0055 §1, §3)

ADR-0055 §3 says creating, editing or deleting a detail requires edit access to its master, and it reads a create's master from the master id in the incoming body. A batch create carries one body per row. The master-detail write gate read a create's master only from a body that is a single record, so a batch create asked about no master at all. That covers the engine's array insert and `insertMany`, and the bulk-create and import doors that call them. The gate now asks about the master of every row the batch names, with the same check a single create runs, once per master and in row order. One master the caller may not edit refuses the whole batch, and nothing is written. On a write made on a user's behalf, both principals are asked, as on every other detail write.

ADR-0055 §1 derives a detail's access from exactly one required master. For a master reference that required-field validation does not judge, an update whose body set the reference to null landed. It stored a detail that no principal's read can match. The gate now refuses it as it already refuses a create that names no master.

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) No metadata moves: no spec key, authorable spelling, object definition, stored row or stored shape is added, removed, renamed or re-shaped, and no exported declaration is removed or narrowed, so there is nothing for `objectstack migrate meta` to rewrite. What changes is the answer the security plugin's master-detail write gate gives for two shapes of write to a `controlled_by_parent` detail: a batch create now asks the master-edit question of the master each of its rows names, and refuses where that question refuses for any of them; and an update that empties a master reference required-field validation does not judge is refused. The remedy is a grant on the master, a batch kept within masters the caller may edit, or a master reference kept populated, never a rewrite of a package source or a stored row. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id is named or touched (not registered or already-registered); and nothing exported is removed or narrowed (not runtime-interface-only, type-surface-only or runtime-export-retired). -->

**BREAKING** for a caller that relied on either write landing. Shipped as `minor` under the launch-window convention for accept-set narrowings.

- **Before.**
  - A batch create of a detail landed whatever masters its rows named, including masters the caller may not edit.
  - An update that set a master reference, of a kind required-field validation does not judge, to null landed and stored the null.
- **Now.**
  - That batch create answers the refusal a single create of the offending row answers: `PERMISSION_DENIED` (403), naming the detail and the master-edit reason. The partial-success `insertMany` refuses the whole call rather than reporting that row.
  - A batch whose rows' masters the caller may all edit lands as before and writes the same rows.
  - That update answers `MISSING_REQUIRED_FIELD` (422) and writes nothing. Where required-field validation does judge the reference, it still answers the update, as before.
- **Unchanged.**
  - Single creates, and every update and delete that does not empty the master reference.
  - A row naming no master, which the same rules as before answer.
  - System contexts, the detail's read scope and the platform ownership floor.
  - Every object that does not declare `controlled_by_parent`.
  - The import door degrades a refused batch to one create per row. There, the rows under masters the caller may edit still land, and the other row is refused on its own.

**What to do.** Grant the caller edit access on every master a batch names, or keep each batch within masters the caller may edit. To move a detail to another master, write that master's id, never null.
