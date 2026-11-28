// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #34562 — a `lookupFilters[].value` `{ $record: 'path' }` path must read ONE
// value of the record being edited: a path whose head, or whose leaf behind a
// single-valued hop, is a structured field (`STRUCTURED_JSON_TYPES`) names a
// list or an object rather than one value, and is refused as
// `object-field-ref-unknown`, beside the multi-valued refusal of #34378
// (`lookup-filter-record-path-multi-valued-refused`).
// Measured first-party exposure at this change: zero — no example app,
// platform object, plugin or skill writes a `$record` path to such a field.
// Not converted: which single value a structured path meant is the author's
// judgement.
export const entry: SemanticMigration = {
  id: 'lookup-filter-record-path-structured-refused',
  surface:
    'objects[].fields.<name>.lookupFilters[].value.$record of a lookup, master_detail or user field, on an object saved '
    + 'or published through the metadata doors (PUT /api/v1/meta/object/NAME, POST /api/v1/packages/PKG/publish-drafts, '
    + 'the per-item publish and the restore doors) or loaded by os validate / os build / os lint: a path whose first '
    + 'segment is a structured field of the object that owns the picker field, or whose leaf behind a single-valued hop '
    + 'is a structured field of the object that hop references — structured being a member of STRUCTURED_JSON_TYPES '
    + '(json, composite, repeater, record, location, address, vector)',
  replacement:
    'A { $record } path reads ONE value of the record being edited: a single-valued, scalar field of the object that '
    + 'owns the picker field ("quote_date"), or one single-valued relationship field of it followed by a scalar field '
    + 'of the object it references ("account.cb_market"). To filter by a value a structured field holds, copy the value '
    + 'you mean onto a single-valued field and reference that. Refused at error as `object-field-ref-unknown` '
    + '(422 INVALID_METADATA at the doors).',
  reason:
    'The { $record } comparand stands for one value and pairs only with the six scalar comparisons, but a '
    + 'structured field holds a list or an object rather than one value (an address, a location, a JSON document, a '
    + 'list of rows), and the path check judged existence and multi-valuedness only, so such a path parsed and '
    + 'linted clean. Read from code: the picker would compare that list or object as one value under a scalar '
    + 'operator, which no declared reading answers, so the filter does not do what it reads as. The set is '
    + 'STRUCTURED_JSON_TYPES from @objectstack/spec/data, which the cross-field comparison classes already place in '
    + 'the list-or-object family with no comparison class. A hop THROUGH a structured field was already refused as '
    + 'not a relationship. No first-party stack (example apps, platform objects, plugins, skills) writes such a '
    + 'path today. A registry-injected column and a leaf on an object outside the stack are not judged. There is no '
    + 'mechanical rewrite: which single value the author meant is a judgement about the data.',
  acceptanceCriteria:
    'Load every object (`os validate` or `os build`): no `object-field-ref-unknown` finding at '
    + 'fields.NAME.lookupFilters[N].value.$record that names a structured field. PUT '
    + '/api/v1/meta/object/NAME?mode=draft&package=PKG with each such path pointing at a single-valued scalar field (or '
    + 'one single-valued hop to one) answers 200, and POST /api/v1/packages/PKG/publish-drafts publishes it.',
};
