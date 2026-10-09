---
'@objectstack/plugin-security': minor
---

feat(plugin-security)!: under `single`, a position created or edited in Setup is also written to the environment ledger, and positions Setup wrote earlier are backfilled into it once (ADR-0131 D3)

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) No metadata moves: no spec key, authorable spelling, export, type or stored shape is added, removed, renamed or re-shaped, so there is nothing for `objectstack migrate meta` to rewrite. What narrows is a runtime write door: under the single posture, a sys_position create or rename whose name the metadata door refuses is now refused at the data door too, and the remedy is a different data value (the position's name), not a rewrite of anyone's code or metadata. The backfill writes environment definitions from rows; it converts no stored metadata shape. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id is named or touched (not registered or already-registered); and no TypeScript declaration moves (not runtime-interface-only or type-surface-only). -->

**BREAKING** (an accept-set narrowing), shipped as `minor` under the launch-window convention for breaking changes.

ADR-0131 D3 gives positions one home, the environment registry. Under `single`, a position an administrator creates in Setup used to be a `sys_position` row only: no environment definition, so the security catalog read did not find it. Under `single`, every Setup create, edit, rename and delete of a position now also writes the position's definition through the metadata door, at environment scope.

**What a Setup position write does now, under `single`.**

- **Create.** The row is written as before, with the same checks: a required label, the reserved built-in names, and one name per organization. The definition `{ name, label, description, delegatable }` is then saved from that row as an environment item, and the security catalog read resolves it at once. `active` and `is_default` stay on the row only.
- **Edit.** The row is updated, and the definition is saved again from it. A patch that touches only `active` or `is_default` writes the row and nothing else.
- **Rename.** The new name's definition is saved, and the old name's definition is deleted.
- **Delete.** The row is deleted, then the definition. If the definition delete fails, an error is logged that names the remedy, because the next boot would bring the position back from the surviving definition.
- **Unchanged.** Under a walled posture, every write behaves as before. System writes (the seeders and the package door) are never translated. On a kernel without a metadata door, the row is written as before. For a position a package or a built-in declares, a Setup edit is written to the row exactly as before, and nothing is written to metadata.
- **No grant changes.** Every reader still reads the row, so a user holding a position is granted exactly what they were granted before.

**What stops being accepted.** Under `single`, the data door now refuses a create, or a rename into, a position name that the metadata door refuses. The refusal is the metadata door's own: `400 INVALID_REQUEST` for a name outside the item-name grammar (uppercase, a space, a hyphen, a leading digit or underscore), or `422 INVALID_METADATA` for a name `PositionSchema.name` refuses (a single character, a dot). No row is kept. `PositionSchema` already declared such names rejected, and a position named that way could never have a definition.

- An edit of an existing row that already carries such a name is still accepted. It stays a row write, with no definition.
- **Remedy.** Name the position in lowercase `snake_case`: it starts with a letter, is at least two characters, and holds letters, digits and underscores only. For example, write `sales_manager` instead of `Sales Manager`. Then re-point any assignment that names the old spelling.

**One more refusal follows from the new definitions.** Positions, permission sets and capabilities hold one name per deployment. Once a Setup position is defined in the environment ledger, a package that registers a position under the same name is refused with `422 NAMESPACE_CONFLICT`, and the refusal names both holders. Before this change, the same registration was accepted.

**The one-time backfill.** At `kernel:bootstrapped`, under `single`, every position whose name the security catalog read does not resolve gets an environment definition from its row. This covers positions Setup wrote before this release.

- A name the environment ledger, a package or a built-in already declares is left alone.
- A name the metadata door refuses is not written. It is reported at `warn`, with its remedy, as a final class.
- If two rows of one name disagree, the name is reported at `error` and nothing is written for it.
- When every name is decided, the verdict is recorded in `sys_migration` (`adr-0131-position-environment-backfill`). If a write fails or two rows disagree, the verdict is not recorded, and the next boot runs the pass again.
