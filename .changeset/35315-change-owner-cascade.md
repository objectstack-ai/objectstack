---
'@objectstack/spec': minor
'@objectstack/core': minor
'@objectstack/rest': minor
'@objectstack/client': minor
'@objectstack/platform-objects': patch
'@object-ui/app-shell': minor
'@object-ui/i18n': minor
---

feat: Change Owner cascade — a relationship declares `transferBehavior: 'cascade'`, and the Change Owner dialog offers it as a tick

Clause-②: yes (widening)
Metadata-protocol: added
Skills-docs: follow-up owed — skills/objectstack-data/rules/relationships.md, skills/objectstack-data/rules/field-types.md

A Change Owner can now move related records along with the record, relationship by relationship.

- **The declaration.** A `lookup` or `master_detail` field takes `transferBehavior: 'none' | 'cascade'`, beside `deleteBehavior` (omitted means `'none'`). `'cascade'` on the child's reference field to a parent says: when the parent's owner changes, the child records that point at it and are owned by the parent's previous owner may move to the new owner too. No other child records move; there is no filter key.
- **Refused where it could never act.** The key is refused on any other field type, `'cascade'` is refused on a reference to a `sys_` object, and `'cascade'` is refused on a field of an object that does not offer Change Owner itself: one that is not structurally eligible (no reassignable owner), a `controlled_by_parent` detail (its access already follows its master), or one whose `userActions.transfer` is off. Each refusal names the field and the fix.
- **The request.** `POST /api/v1/data/:object/:id/change-owner` and `POST /api/v1/data/:object/change-owner` take an optional `cascade: [{ object, field }]` naming the relationships to move along (`data.changeOwner` / `data.changeOwnerMany` in `@objectstack/client`). A relationship that does not declare `'cascade'`, or whose child does not offer Change Owner, is refused `400 VALIDATION_ERROR` before anything is written; so is a cascade with a queue target. Each cascaded record is updated as the caller, so it needs the caller's own transfer grant on the child object; every record that does not move is listed in the answer's `cascade[]` with its id, code and sentence. One call moves at most 500 related records; past that, `remaining` counts those still with the previous owner.
- **The candidates.** `GET /api/v1/data/:object/change-owner/cascades` (`data.changeOwnerCascades`) lists the relationships declared to an object whose child offers Change Owner and whose declared API exposure lets the caller `update` it.
- **The Studio.** The field form and the object form's field rows offer `transferBehavior` beside `deleteBehavior`, on `lookup` and `master_detail` fields; the row's label and help text ship in the metadata-forms locale packs of `@objectstack/platform-objects`.
- **The dialog.** For a person target, the Change Owner dialog lists those relationships on which the explain engine allows the caller the `transfer` operation, one tick each, sends the ticked ones, and draws each relationship's outcome, every record it did not move included.

A plain `owner_id` update is unchanged: the declaration is read only by the Change Owner action.
