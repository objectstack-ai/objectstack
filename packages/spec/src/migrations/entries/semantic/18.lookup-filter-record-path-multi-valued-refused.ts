// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #34378 — a `lookupFilters[].value` `{ $record: 'path' }` path must read ONE
// value of the record being edited: a path through or to a multi-valued field
// (`isMultiValueField`) is refused as `object-field-ref-unknown`, beside the
// unknown-path refusal of #34200 (`lookup-filter-record-path-unknown-refused`).
// Measured first-party exposure at this change: zero — no example app,
// platform object, skill or docs sample writes a `$record` path. Not converted:
// which single value a multi-valued path meant is the author's judgement.
export const entry: SemanticMigration = {
  id: 'lookup-filter-record-path-multi-valued-refused',
  surface:
    'objects[].fields.<name>.lookupFilters[].value.$record of a lookup, master_detail or user field, on an object saved '
    + 'or published through the metadata doors (PUT /api/v1/meta/object/NAME, POST /api/v1/packages/PKG/publish-drafts, '
    + 'the per-item publish and the restore doors) or loaded by os validate / os build / os lint: a path whose first '
    + 'segment is a multi-valued field of the object that owns the picker field (a plain path to it, or a hop through '
    + 'it), or whose leaf behind a single-valued hop is a multi-valued field of the object that hop references — '
    + 'multi-valued being a field flagged multiple: true, or a multiselect, checkboxes or tags field',
  replacement:
    'A { $record } path reads ONE value of the record being edited: a single-valued field of the object that owns the '
    + 'picker field ("quote_date"), or one single-valued relationship field of it followed by a single-valued field of '
    + 'the object it references ("account.cb_market"). To filter by a value a multi-valued field holds, copy the value '
    + 'you mean onto a single-valued field and reference that. Refused at error as `object-field-ref-unknown` '
    + '(422 INVALID_METADATA at the doors).',
  reason:
    'The { $record } comparand stands for one value and pairs only with the six scalar comparisons, but a path through '
    + 'or to a multi-valued field names a list, and the path check judged existence only, so it parsed and linted '
    + 'clean. A hop through a multiple: true lookup reaches no single row, so the picker finds no value and leaves the '
    + 'entry out without a word; a plain path to a multi-valued field hands the picker a list as the comparand of a '
    + 'scalar operator, which no declared reading answers. Either way the filter does not do what it reads as. The '
    + 'predicate is isMultiValueField, the one FieldSchema reads. No first-party stack (example apps, platform objects, '
    + 'skills, docs samples) writes a $record path today. A registry-injected column and a leaf on an object outside '
    + 'the stack are not judged. There is no mechanical rewrite: which single value the author meant is a judgement '
    + 'about the data.',
  acceptanceCriteria:
    'Load every object (`os validate` or `os build`): no `object-field-ref-unknown` finding at '
    + 'fields.NAME.lookupFilters[N].value.$record that names a multi-valued field. PUT '
    + '/api/v1/meta/object/NAME?mode=draft&package=PKG with each such path pointing at a single-valued field (or one '
    + 'single-valued hop to a single-valued field) answers 200, and POST /api/v1/packages/PKG/publish-drafts publishes it.',
};
