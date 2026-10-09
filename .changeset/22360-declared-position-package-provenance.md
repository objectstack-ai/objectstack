---
'@objectstack/plugin-security': minor
---

fix(plugin-security)!: a definition edit or delete of a position a code package declares is refused at the data door, as the metadata door already refuses it; its row now carries package provenance, and its row state stays switchable

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) No metadata moves: no spec key, authorable spelling, export, type or stored shape is added, removed, renamed or re-shaped. What changes is one column the boot seeder writes on its own rows (sys_position.managed_by, now package for a position a code package declares) and, through the system-row write gate, a runtime write door: an admin-door update of such a row's definition columns, and its delete, are refused, while a patch of its row state (active, is_default) passes. No stored row is left for `objectstack migrate meta` to convert, because the seeder corrects the stamp itself at the next boot. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id is named or touched (not registered or already-registered); and no TypeScript declaration moves (not runtime-interface-only or type-surface-only). -->

**BREAKING**: an accept-set narrowing of the `sys_position` data door, shipped as `minor` under the launch-window convention for breaking changes. It carries ADR-0131 D6 (no door edits a managed definition) and D3 (managed items are read-only and clonable).

**What was wrong.** The declared-position seeder wrote the row of a package-declared position with no provenance stamp, so the row carried the object default, `managed_by: 'admin'`, and the system-row write gate did not protect it. A Setup or data API edit of its label answered `200`, and the next boot wrote the declared label back over it with no message. The metadata door already refused the same edit with `403 NOT_OVERRIDABLE`.

**What is refused now.** A position is package-declared when the engine registry's artifact lookup answers a code package for its name, the same lookup the metadata door refuses a save from. On such a position's row, the admin door now answers `403 PERMISSION_DENIED`, with the message it already gives for a built-in position, to:

- an update that touches a definition column (`name`, `label`, `description`, `delegatable`) or any column other than the two row-state columns below. That covers single-record edits, `updateMany`, and filtered updates. Until now a label or description edit answered `200` and the next boot wrote the declaration back over it; a `delegatable` edit answered `200` and persisted.
- a delete. Until now it answered `200` and the next boot created the row again. The other lifecycle writes (transfer, restore, purge) are refused as well.

**What stays switchable.** A patch that touches only row state (`active` and/or `is_default`) still passes, so Setup's Activate, Deactivate and Set as Default keep working on a package-declared position and persist across restarts. This is the rule a packaged permission set already follows: switching it off is not an edit of its definition. A filtered update passes on the same terms, as long as its filter reaches no built-in position.

System-context writes are unchanged: the boot seeder still refreshes the row's label and description from the declaration.

**What is unchanged.**

- A position an administrator created in Setup, and a position the environment authored through the metadata door, keep an unmanaged row (`admin`) and stay editable.
- The built-in positions are refused exactly as before, a bare `active` or `is_default` patch included.
- Assigning a position to users and binding permission sets to it are writes on other rows (`sys_user_position`, `sys_position_permission_set`), and this change does not touch them.

**At the first boot after upgrading.** The existing row of each package-declared position is re-stamped `package` in place when it carries `admin`, no value, or the legacy `user`. Only `managed_by` changes: the `active`, `is_default` and `delegatable` values an administrator set before the upgrade are kept. The boot's `declared positions seeded` info line counts these rows as `restampedPackageProvenance`. The seeder matches a row by name, as its label refresh always has, so a position created in Setup whose name a package declares later becomes that package's position: its definition is refused the same way, and its row state stays switchable.

**What to do.** To change a package-declared position's label, description or `delegatable`, change it in the package and publish a new version. To have a position you can edit in Setup, clone it under a new name with the Clone Position action, bind its permission sets, and assign the clone.
