// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #33072: an accept-set narrowing of the runtime `object_extension` publish
// door. `os build` and `os validate` judge the computed fields an
// `objectExtensions` entry adds (`object-extension-computed-field-expression-judged`);
// the door that publishes an extension at runtime (Studio's add-field on a
// `.custom` pair, `PUT /api/v1/meta/object_extension/TARGET`, an MCP or AI
// author) ran no field-formula judgment, so it published a field the build
// refuses. It now asks the same pass. No D2 conversion: how a refused
// expression is repaired is a fact only the author holds, and a stored row is
// not re-judged until it is published again.
export const entry: SemanticMigration = {
  id: 'object-extension-door-computed-field-expression-judged',
  surface:
    'an `object_extension` item published at runtime (Studio\'s add-field on a `.custom` pair, '
    + '`PUT /api/v1/meta/object_extension/TARGET`, the MCP and AI authoring doors) whose `fields` carry an '
    + '`expression`, a `formula` field or a stored computed field, e.g. '
    + '`{ extend: \'crm_account\', fields: { score__c: { type: \'formula\', expression: \'sqrt(record.amount)\' } } }`.',
  replacement:
    'An `expression` `os build` accepts on the same extension field: CEL that reads `record.FIELD` for a field '
    + 'the extended object serves (its own fields and every field an extension adds), calls only registered '
    + 'functions, and reads at most one hop through a reference field. A stored field that reads another record, '
    + 'the clock or the acting user is advised, never refused, as on a declared field.',
  reason:
    'The publish door ran only the vocabulary freeze on an extension, so a computed field `os build` refuses '
    + 'published with a 200 and then read null, or failed, on every row. The door now runs the build\'s '
    + 'field-formula pass on each field the written extension adds, against the extended object as the door '
    + 'serves it, and refuses with the build\'s rule id and location '
    + '(`422 INVALID_METADATA`, issue `expression-invalid` at `object \'TARGET\' · objectExtensions[0] · field '
    + '\'FIELD\' expression`).',
  acceptanceCriteria:
    'Publish each extension that adds a computed field again (or run `os validate` on the package that ships '
    + 'it): the publish answers 200 with no `expression-invalid` issue located at an `objectExtensions[0] · field` '
    + 'site, and a record of the extended object holds a value in every computed field the extension adds.',
};
