---
'@objectstack/plugin-security': patch
---

fix(plugin-security)!: a predicate update or delete of a `controlled_by_parent` detail now writes every row its caller may write by id, the rows other users created included, instead of stopping at the platform's creator-only floor

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export changes shape. What moves is which rows one predicate update or delete of a controlled_by_parent detail writes, and whether such a write is refused whole: no stored row, registry key or authored value changes, so there is nothing for a migration to rewrite and no tombstone. -->

**BREAKING: an existing flow now changes or deletes detail rows its caller did not create.** A flow's bulk update or bulk delete node, a server-side script or a hook that runs a predicate write (`update(object, data, { where, multi: true })`, `delete(object, { where, multi: true })`) on a `controlled_by_parent` detail, as an organization member who may edit the master record (or read it, where the detail declares `sharing.controlledByParent.writeRequiresMasterRead`), used to change or delete only the detail rows that member had created and answer success. It now changes or deletes every row its predicate matches that the member can read, within any row-level `update` or `delete` policy the app authored on the detail. Review any such flow that deletes by predicate before upgrading: it will delete more rows than it did.

It ships `patch` because it is a non-protocol breaking change (AGENTS.md Post-Task Checklist step 3): no schema, key or stored value moves, so `Metadata-protocol` is `none`.

- FROM: on a `controlled_by_parent` detail the predicate write kept the platform ownership floor (`owner_only_writes` / `owner_only_deletes` in `member_default`, `created_by == current_user.id`) after its master check had passed. It matched only the rows the caller created, answered success, and never judged the other rows. Measured on a 4-row detail under one master: the master's owner changed 2 rows by predicate and all 4 by id; a member holding an `edit` share on the master, and a manager holding `modifyAllRecords`, changed 0 by predicate and all 4 by id.
- TO: once the master check has passed for every master the write reaches, the write is no longer held to that floor. It changes the rows a write of each row by id would change for the same caller, and it applies to all of its matched rows or to none: a newly matched row refused by a row-level `check`, a validation rule, a hook or a `restrict` relation refuses the whole write with that refusal, and nothing is written.

**A detail that carries its own row-level write policy now writes fewer of the caller's own rows by predicate.** Where an app authors an `update` or `delete` policy with a `using` on a `controlled_by_parent` detail, a predicate write used to compose the platform floor beside that policy as one more OR term, so it also wrote the rows the caller created that the policy does not admit. The floor is no longer a term of that write, so the authored policy alone bounds it: those rows are left unwritten and the write answers success for the rows the policy admits. A by-id write of such a row was already refused, so the two now agree. A write made on another user's behalf keeps the floor and is not changed.

The fix for a caller that must keep the old outcome: narrow the predicate to the rows it means to write (add `created_by` to the `where` to keep writing only the caller's own rows), or write the rows by id to get an outcome per row. To forbid a caller from writing rows other users created on a detail, author a row-level policy on the detail; it binds every row, by id and by predicate.

This is the `controlled_by_parent` half of the predicate-write change shipped beside it: see the note "a predicate update or delete now writes the rows a Modify All holder, a non-creator owner or an edit-share target can write by id" for every other object. It follows the maintainer's ruling that a predicate write and a by-id write of such a detail agree (ADR-0055 §3 as amended 2026-11-22).

What does not change:

- A predicate write reaches only the rows its predicate matches that the caller can read, and a predicate matching more than 10,000 of them is refused before anything is written.
- It is refused whole, with `PERMISSION_DENIED` / 403 and nothing written, when it reaches a detail row under a master the caller may not edit (or may not read, where the detail declares `writeRequiresMasterRead`).
- A detail row that names no master (an optional master) is written by its owner or a Modify All holder; a predicate write that reaches such a row the caller can read and may not write is refused whole.
- A write made on another user's behalf keeps the floor for both principals, as its by-id write does.
- `sharing.controlledByParent.ownerMayEdit` widens a by-id update only: a predicate update still needs edit on the master.
- A by-id write is unchanged, and so is every predicate write on an object that is not a `controlled_by_parent` detail.
- No key, option or response member is added.

A predicate write on such a detail also asks the read door for its rows once where it asked twice: the write is scoped to the rows its master check judged, so a row that starts matching the predicate while the write is being authorized is not written.
