---
'@objectstack/plugin-security': minor
---

fix(plugin-security)!: a `sys_user_position` write whose `position` names no `sys_position` catalog row is refused, instead of answering 201 over an assignment that resolves to nothing (#16712)

Clause-②: yes

<!-- adr-0087: not-required (no-migration-prescription) Nothing authorable is renamed, retired or re-typed: `sys_user_position.position` stays a `Field.text`, every object key and every stored row parse exactly as before, and no stored assignment is rewritten or refused on read, so `objectstack migrate meta` has nothing to act on. What narrows is the ACCEPT SET of one runtime write path: a non-system insert, or an update that changes `position`, whose value names no `sys_position` row is refused `400 VALIDATION_FAILED` with the envelope the row's sibling lookup columns already answer with. The refusal text names the value and its own fix, and the measured in-repo and consumer writers (hotcrm, hotclm) all write catalog names, so there is no document for a migration to act on. -->

**BREAKING** accept-set narrowing on the `sys_user_position` write path —
shipped as `minor` under the launch-window convention (`check-changeset-no-major`
refuses `major`; breaking-ness is carried by this banner and the ADR-0087
disposition, not by the level). Maintainer-confirmed ruling on #16712 (option A).

**What changed.** `sys_user_position.position` is the position's machine NAME
(`sys_position.name`), but it is declared `Field.text`, so a value naming no
catalog row — most often the position's record ID, written where its name
belongs — was stored with a `201` and then resolved to nothing: the holder got
no permission set, no sharing rule reached them, and they signed in to an app
that reads nothing, with no error anywhere. Such a write is now refused:

- `400 VALIDATION_FAILED`, one `fields[]` entry per offending value at
  `field: 'position'`, `code: 'reference_not_found'`,
  `constraint: { target: 'sys_position', targetField: 'name' }` — the same
  envelope a bad `user_id` or `organization_id` on the same row already gets.
- The message names the value and says the column takes the catalog NAME. When
  the value is the record id of a position the writer's own organization can
  see, it names that position and says to write its name.

**Which writes.** Every non-system insert (one row or a batch, refused whole),
every non-system update by id that CHANGES `position`, and every predicate
update (`multi: true`) that sets it. The check runs after authorization: a
caller who may not write the table is still refused `403` on authority and never
sees the catalog verdict.

**What did not change.**

- A **deactivated** position is still a catalog row: an assignment naming it is
  accepted and, as before, grants nothing (ADR-0049).
- **Stored rows** are untouched. An update that edits another column, or echoes
  the unchanged `position` back, is not judged, so an existing row whose name
  is no longer in the catalog stays editable.
- **System-context writes** are not judged — the seed loader (which on a fresh
  single-organization boot writes `stack.data` before the declared position
  catalog exists), invitation acceptance and the platform's own bootstraps. That
  is the same stand-down the engine's lookup check takes.
- The catalog is read across every organization: a name that ANY `sys_position`
  row carries is accepted. On a single-organization posture that is the same as
  the writer's own catalog.

**Who is affected.** A client, script or AI author that writes a position's id,
a misspelled name, or a name not yet created. The fix is the one the refusal
names: write the position's `name`, or create the position first.
