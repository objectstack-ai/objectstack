---
'@objectstack/plugin-security': minor
---

fix(plugin-security)!: a write to a `controlled_by_parent` detail asks for edit access on every master it involves (ADR-0055 §3)

ADR-0055 §3 says editing, deleting or creating a detail requires edit access to its master, and it reads a create's master from the master id in the incoming body. A write to a `controlled_by_parent` detail can involve more than one master, and for one shape of write the master-detail write gate asked the master-edit question of one of them only. It now asks it of every master the write involves, with the same check and in the same order as before for the one it already asked. One master the caller may not edit refuses the whole write, and nothing is written. On a write made on a user's behalf, both principals are asked, as on every other detail write.

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) No metadata moves: no spec key, authorable spelling, object definition, stored row or stored shape is added, removed, renamed or re-shaped, and no exported declaration is removed or narrowed, so there is nothing for `objectstack migrate meta` to rewrite. What changes is the answer the security plugin's master-detail write gate gives for one shape of write to a `controlled_by_parent` detail: it now asks the master-edit question of every master that write involves, and refuses where that question refuses for any of them. The remedy is a grant on the master or a narrower write, never a rewrite of a package source or a stored row. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id is named or touched (not registered or already-registered); and nothing exported is removed or narrowed (not runtime-interface-only, type-surface-only or runtime-export-retired). -->

**BREAKING** for a caller that relied on that shape of write landing while one of the masters it involves is a master the caller may not edit. Shipped as `minor` under the launch-window convention for accept-set narrowings.

- **Before.** That shape of write was decided on one of the masters it involves, and landed when the caller could edit that one, whatever the other.
- **Now.** It answers the refusal a write under the other master answers: `PERMISSION_DENIED` (403), naming the detail and the master-edit reason. A write whose masters the caller may all edit lands as before and writes the same rows. A write that reaches no row involves no master and is not refused.
- **Unchanged.** Inserts and deletes; every write that involves only the master its rows already sit under; system contexts; the detail's read scope; the platform ownership floor; and every object that does not declare `controlled_by_parent`.

**What to do.** Grant the caller edit access on every master the write involves, or keep the write within masters the caller may edit.
