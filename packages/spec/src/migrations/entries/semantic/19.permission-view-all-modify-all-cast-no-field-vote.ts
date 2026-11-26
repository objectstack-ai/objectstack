// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// The field-axis split's step 3 (ruling of record 6912661484, letter A): View
// All and Modify All stop voting on fields, and `viewAllFields` is the one
// "every field" bit. The D2 conversion
// `permission-view-all-fields-beside-record-bypass` writes `viewAllFields: true`
// beside the two bits in a SOURCE that predates the switch, which keeps every
// field read they cast; this entry names what changes anyway, and what a
// deployment owes for the permission sets it STORES, which the conversion never
// rewrites (ruling of record 7177446075, option A: stored sets are read with
// the 19 meaning). No `relevantWhen`: a stack with no authored permission set
// can still run against stored ones, so the operator check is always listed.
export const entry: SemanticMigration = {
  id: 'permission-view-all-modify-all-cast-no-field-vote',
  surface:
    'security.permission.objects.*.viewAllRecords and .modifyAllRecords (ObjectPermissionSchema), the `*` '
    + 'entry included — their field vote; and security.permission.objects.*.viewAllFields beside them',
  replacement:
    'Add `viewAllFields: true` to every `objects` entry (the `*` entry included) that carries '
    + '`viewAllRecords: true` or `modifyAllRecords: true` and should still read every field of its object. FROM '
    + '`objects: { crm_lead: { allowRead: true, viewAllRecords: true } }` (read every field of `crm_lead`, '
    + 'including one another set hides) TO `objects: { crm_lead: { allowRead: true, viewAllRecords: true, '
    + 'viewAllFields: true } }`. Beside Modify All the set\'s own `readable: false` row now hides its field '
    + 'from the set\'s holders even with the bit: delete that row where they should still read the field. The '
    + 'edit is not restored by any bit, for a field another set locks or a field the set\'s own field row '
    + 'names without `editable: true` (an omitted `editable` is `false`): grant it with an explicit '
    + '`editable: true` field row in the set that should edit it.',
  reason:
    'From protocol 19 View All (`viewAllRecords`) and Modify All (`modifyAllRecords`) widen RECORDS only and '
    + 'cast no field vote. Until 19 View All voted every field of the object readable and Modify All voted '
    + 'every field readable and editable, so one set\'s bit re-opened a field another set hid with '
    + '`readable: false` and unlocked a field another set locked with `editable: false`. Reading every field '
    + 'is now `viewAllFields: true`, which votes read on every field of the object (fields added later '
    + 'included) and never votes edit.\n\n'
    + 'What changes: (1) a set holding View All or Modify All on an object, without `viewAllFields`, no '
    + 'longer reads a field another set hides; (2) Modify All no longer votes an edit, so a field another set '
    + 'locks stays locked for its holders, and so does a field the set\'s own field row names without '
    + '`editable: true` (an omitted `editable` is `false`), with no second set involved; no bit restores that '
    + 'edit, the built-in admin sets '
    + '(`admin_full_access`, `organization_admin`) included: they keep reading every field through the '
    + '`viewAllFields: true` on their `*` entry, and no longer edit a field a set they also hold locks; '
    + '(3) a set\'s own `readable: false` rows bind beside its own Modify All, as they already bound beside '
    + 'its own View All (with `viewAllFields` a field row of the same set beats it); (4) explain no longer '
    + 'reports a row-conditioned field lock as "superseded" by the Modify All field vote: the lock binds per '
    + 'row for every caller; (5) in `@objectstack/lint` the warning `security-superuser-field-mask-inert` '
    + 'is retired, since a set\'s own rows now bind beside its own View All or Modify All, and '
    + '`security-cross-set-field-reopen` reports only a field one set hides that another set\'s '
    + '`viewAllFields` re-opens. What does not change: which RECORDS the bits reach, the row-level bypass '
    + 'every sharing and RLS reader folds through, and any field no set names, which still follows the '
    + 'object grant.\n\n'
    + 'SOURCE permission sets: `os migrate meta --from 18 --write` adds `viewAllFields: true` beside every '
    + 'such bit (the D2 conversion `permission-view-all-fields-beside-record-bypass`), so their field reads '
    + 'are kept. The conversion replays only there: it is a default flip, retired from the load path, so the '
    + 'authoring funnel skips it, and the artifact-ingestion door and every stored-row read '
    + '(`applyConversionsToStoredItem`) refuse it by id.\n\n'
    + 'STORED permission sets (Studio-saved, in `sys_metadata`): they are NOT rewritten on upgrade and are '
    + 'read with the 19 meaning, by maintainer ruling. Studio\'s permission matrix has no `viewAllFields` '
    + 'control today (it keeps the key when it saves a set that already carries it), so restore a stored '
    + 'set\'s reads by adding `viewAllFields: true` to its entry through the metadata API. No command lists '
    + 'the affected stored sets yet. The error direction is fewer fields seen, never a field opened.',
  acceptanceCriteria:
    'Before or after moving a deployment to protocol 19, the one-step check, for every permission set in '
    + 'source and every one stored in the deployment: the set is '
    + 'affected when one of its `objects` entries, the `*` entry included, has `viewAllRecords: true` or '
    + '`modifyAllRecords: true` and no `viewAllFields`. For each such entry whose holders should still read '
    + 'every field of the object, add `viewAllFields: true`. Beside View All that restores every read. Beside '
    + 'Modify All it does not restore a field the same set\'s own `readable: false` row hides: that row now '
    + 'hides the field from the set\'s holders, so delete it where they should still read the field. Sets in '
    + 'source: run `os migrate meta --from 18 --write`, which adds the bit to every such entry, then delete it '
    + 'where the set should NOT read fields another set hides. Stored sets: they are not rewritten and read '
    + 'with the 19 meaning; add the bit to each affected entry through the metadata API (Studio has no '
    + 'control for it today). Then, where a Modify All holder must still EDIT a field, add an explicit '
    + '`editable: true` field row in the set that should edit it: for a field another set locks, and for a '
    + 'field the set\'s own field row names without `editable: true` (an omitted `editable` is `false`), '
    + 'which loses its edit beside Modify All with no second set involved. A set whose entry lacks the '
    + 'bit only sees fewer fields after the upgrade: no field that was hidden opens, and a set whose object '
    + 'has no field row in any set changes nothing at all. `os validate` reports '
    + '`security-cross-set-field-reopen` on a field one set hides that another set\'s `viewAllFields` '
    + 're-opens, so a bit added where the hide was meant is visible there.',
  // The edits this entry judges: every `viewAllFields: true` that conversion
  // writes keeps a read; the criteria above say when to delete it instead.
  conversionIds: ['permission-view-all-fields-beside-record-bypass'],
};
