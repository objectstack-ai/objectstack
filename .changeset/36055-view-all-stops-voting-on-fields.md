---
'@objectstack/core': major
'@objectstack/plugin-security': major
'@objectstack/lint': major
'@objectstack/spec': major
'@objectstack/scenarios': patch
'@objectstack/cli': patch
'@objectstack/service-automation': patch
---

feat(security)!: View All and Modify All stop opening fields; `viewAllFields` is the one "every field" bit

**BREAKING** (19.0.0): View All (`viewAllRecords`) and Modify All (`modifyAllRecords`) widen records only. They no longer cast a field vote, so a field that a permission set hides (`readable: false`) or locks (`editable: false`) stays hidden or locked for their holders. Reading every field of an object is `viewAllFields: true` on that object's entry; it votes read, never edit.

Clause-②: yes (narrowing)
Metadata-protocol: semantic

<!-- adr-0087: registered permission-view-all-fields-beside-record-bypass -->

FROM → TO:

- `objects.<name>: { viewAllRecords: true }` read every field of the object another set hides → it reads none of them. TO keep that read: `{ viewAllRecords: true, viewAllFields: true }`.
- `objects.<name>: { modifyAllRecords: true }` read and edited every field, the set's own rows included → it reads and edits only what the field rows allow. TO keep the read: `{ modifyAllRecords: true, viewAllFields: true }`. The edit of a field some set locks is not restored by any bit: grant it with an explicit `editable: true` row in the set that should edit it.
- The same holds on a `'*'` entry.

**Check your permission sets in one step.** A permission set is affected when one of its `objects` entries, the `'*'` entry included, has `viewAllRecords: true` or `modifyAllRecords: true` and does not have `viewAllFields: true`. For each such entry, add `viewAllFields: true` to it if the set should still read every field of that object. Nothing else is needed for the read: with the bit, the set reads what View All read before. (Beside Modify All, the set's own `readable: false` rows now bind; before, Modify All overrode them.)

- Sets in your source: `os migrate meta --from 18 --write` adds `viewAllFields: true` beside every such bit (ADR-0087 conversion `permission-view-all-fields-beside-record-bypass`).
- Sets saved in a running deployment (Studio-saved, stored in `sys_metadata`): they are **not** rewritten on upgrade, and from 19 they are read with the new meaning. Studio's permission matrix has no control for `viewAllFields` (it keeps the key when it saves a set that already carries it), so add it to the set's entry through the metadata API.

The error direction is safe: an unconverted set sees **fewer** fields after the upgrade, never more. No field that was hidden opens. A set whose object has no field row in any set changes nothing at all, because a field no set names already follows the object grant.

Also in this change:

- The built-in admin sets (`admin_full_access`, `organization_admin`) already carry `viewAllFields: true` on their `'*'` entry, so they still read every field. They no longer edit a field that another set they hold locks.
- Explain no longer reports a row-conditioned field lock as "superseded by the Modify All Data field vote": the lock binds per row for every caller.
- `@objectstack/lint`: the warning `security-superuser-field-mask-inert` is retired, since a set's own field rows now bind beside its own View All or Modify All. `security-cross-set-field-reopen` now reports only a field one set hides that another set's `viewAllFields` re-opens. `security-controlled-by-parent-master-reference-hidden` and the roll-up source-visibility rules now judge a mask beside Modify All like any other mask.
- `@objectstack/core`: `superuserFieldVote` is replaced by `viewAllFieldsReadVote(sets, object, field)`, which answers whether a set's `viewAllFields` reads the field. `holdsSuperuserBypass` is unchanged and answers the record bypass only.
- `@objectstack/scenarios`: the persona-grant scoring no longer treats Modify All as overriding a field lock.
- `@objectstack/cli` and `@objectstack/service-automation`: test comments only, restated for the 19 meaning.
