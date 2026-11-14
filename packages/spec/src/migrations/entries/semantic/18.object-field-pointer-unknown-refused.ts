// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// An object's title pointer (`nameField`, and the deprecated `displayNameField`
// alias) and each `activityMilestones[].field` must name a field the object
// has, or a column the registry injects on it: `object-field-ref-unknown`,
// under the family ruling that a misspelling is refused loudly at authoring
// (#19332). Not converted: which field a misspelt name meant is the author's
// judgement, and the platform does not guess.
export const entry: SemanticMigration = {
  id: 'object-field-pointer-unknown-refused',
  surface:
    'object.nameField, object.displayNameField and object.activityMilestones[].field on an object saved or '
    + 'published through the metadata doors (PUT /api/v1/meta/object/NAME, POST /api/v1/packages/PKG/publish-drafts, '
    + 'the per-item publish and the restore doors) or loaded by os validate / os build / os lint: a name that is '
    + 'neither a field of the object nor a column the platform injects on it',
  replacement:
    'Point the key at a field the object declares, or at a column the platform injects on it (`id`, `created_at`, '
    + '`updated_at`, `owner_id` on an owned object, `organization_id` on a tenant object), spelled exactly: the name is '
    + 'read as a record key, so a dotted path is one name no field carries. Drop the key, or the milestone, when no '
    + 'field is meant. Refused at error as `object-field-ref-unknown` (422 INVALID_METADATA at the doors).',
  reason:
    'Each key is a bare string the schema cannot judge, and the doors stored and published a name the object does '
    + 'not have. A title pointer that names no field titles every record by its id (the console shows Record #ID, '
    + 'and the activity timeline labels the record by its id); a milestone whose field names no field never '
    + 'transitions, so it never fires. The same rule already refused a dangling highlightFields, redactFields or '
    + 'index column. A pointer the object already holds is not judged again on a re-save of another item; the '
    + 'object\'s own next save, publish or restore is refused until the name is fixed. There is no mechanical '
    + 'rewrite: which field a misspelt name meant is a judgement about the object.',
  acceptanceCriteria:
    'Load every object (`os validate` or `os build`): no `object-field-ref-unknown` finding at `nameField`, '
    + '`displayNameField` or `activityMilestones[N].field`. PUT /api/v1/meta/object/NAME?mode=draft&package=PKG '
    + 'with each such pointer naming a field of the object answers 200, and POST /api/v1/packages/PKG/publish-drafts '
    + 'publishes it.',
};
