---
'@objectstack/core': patch
'@objectstack/plugin-security': patch
'@objectstack/lint': patch
'@objectstack/spec': patch
---

fix(core, plugin-security, lint)!: a permission set's own field-mask row binds its own holders over that set's View All vote

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no stored permission set is rewritten. What moves is one answer of the field-permission merge for a set that already declares both the View All bit and the field row, so there is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** for the holders of a permission set that grants View All (`viewAllRecords`) on an object and declares `readable: false` on a field of that object in its own `fields`. Per ADR-0066 D2 ⑧ as amended on 2026-11-15 (the maintainer's ruling on the card), that row wins over the same set's View All field vote: the set casts no read vote on the field, so a caller whom no other set serves the field to does not read it. Every reader of the field merge answers the same: the data doors, through `PermissionEvaluator.getFieldPermissions`, and the `fields` slot of `/auth/me/permissions`. Until this release the set's own View All voted the field readable, so the row bound none of the set's holders (the ADR's note of 2026-11-02).

**Not moved.** Another set's View All or Modify All on the object still makes the field readable (and, under Modify All, editable) for a caller who holds both sets. A View All set still votes on every field it does not mask itself. An omitted `readable` parses to `true` and is not a mask. View All never granted an edit, so an edit lock beside it binds as before. Modify All is unchanged: a set holding `modifyAllRecords` on the object votes `readable: true` and `editable: true` on every field of it, its own rows included. The row-level bypass is untouched.

**Who moves:** an administrator whose set pairs View All on an object with its own `readable: false` row for a field of that object, and whose holders are expected to keep reading the field. The row now hides the field from them, as it reads. Where the field is meant to be read, the row is the thing to delete. No default permission set the platform ships carries the pair.

`@objectstack/lint`: `security-superuser-field-mask-inert` reports only a row that its own set's Modify All unbinds (a `readable: false`, an edit lock, or both). A `readable: false` beside the set's own View All is no longer reported, because it binds. The finding's `userTextParams` no longer carry `bypass` (Modify All is the only bypass the rule reports), and its message, hint and user sentence name Modify All. `security-controlled-by-parent-master-reference-hidden` is skipped only beside Modify All and is reported beside View All, and the roll-up source visibility rule reads a View All set's own mask as hiding the field. The rule ids are unchanged.

`@objectstack/spec`: the doc comment above `FieldPermissionSchema` states the exception. No schema, description or generated artifact changes.
