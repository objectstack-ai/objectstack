// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #34200 — a `lookupFilters[].value` `{ $record: 'path' }` path must resolve
// against the record being edited: `object-field-ref-unknown`, under the family
// ruling that a misspelling is refused loudly at authoring (#19332). The parse
// judges the path's shape only (#34009); which fields it names is the object
// graph's. Measured first-party exposure at this change: zero — no example app,
// platform object, skill or docs sample writes a `$record` path. Not converted:
// which field a misspelt path meant is the author's judgement.
export const entry: SemanticMigration = {
  id: 'lookup-filter-record-path-unknown-refused',
  surface:
    'objects[].fields.<name>.lookupFilters[].value.$record of a lookup, master_detail or user field, on an object saved '
    + 'or published through the metadata doors (PUT /api/v1/meta/object/NAME, POST /api/v1/packages/PKG/publish-drafts, '
    + 'the per-item publish and the restore doors) or loaded by os validate / os build / os lint: a path whose first '
    + 'segment is not a field of the object that owns the picker field, whose hop is not a relationship field, whose '
    + 'second segment is not a field of the object that relationship references, or that takes a second hop',
  replacement:
    'A { $record } path names the record being edited: a field of the object that owns the picker field '
    + '("quote_date"), or one relationship field of it followed by a field of the object that field references '
    + '("account.cb_market"). Fix the misspelt segment; a column of the candidate row is a { $field } comparand, not '
    + '{ $record }. Refused at error as `object-field-ref-unknown` (422 INVALID_METADATA at the doors).',
  reason:
    'The { $record } shape was declared with only its spelling judged (snake_case names, at most one dot), so a path '
    + 'naming no field of the edited record, or a hop through a text field, parsed clean and was stored. The declared '
    + 'picker swaps in the value at that path before it queries, and an empty value leaves the entry out; a path the '
    + 'record does not have is always empty, so the picker would offer candidates the author meant to exclude, with '
    + 'nothing on screen saying why. The same rule already refuses a dangling lookupFilters[].field or dependsOn name. '
    + 'No first-party stack (example apps, platform objects, skills, docs samples) writes a $record path today. '
    + 'A hop to an object outside the stack (another package) is not judged. There is no mechanical rewrite: which '
    + 'field a misspelt path meant is a judgement about the object.',
  acceptanceCriteria:
    'Load every object (`os validate` or `os build`): no `object-field-ref-unknown` finding at '
    + 'fields.NAME.lookupFilters[N].value.$record. PUT /api/v1/meta/object/NAME?mode=draft&package=PKG with each such '
    + 'path naming a field of the object, or one hop to a field of the object a relationship field references, answers '
    + '200, and POST /api/v1/packages/PKG/publish-drafts publishes it.',
};
