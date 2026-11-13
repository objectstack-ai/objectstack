// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #32875: an accept-set narrowing of `os build` and `os validate`. The
// field-formula pass of `@objectstack/lint` (`validateStackExpressions`)
// judged only the fields an object declares; it now judges the computed fields
// an `objectExtensions` entry adds as well, against the extended object as the
// registry serves it. No D2 conversion: how a refused expression is repaired
// (the field it meant, a registered function, a `formula` instead of a stored
// field) is a fact only the author holds.
export const entry: SemanticMigration = {
  id: 'object-extension-computed-field-expression-judged',
  surface:
    'a field an `objectExtensions` entry adds (`defineObjectExtension({ extend, fields })`) that carries an '
    + '`expression`, a `formula` field or a stored computed field, e.g. '
    + '`fields: { hours: { type: \'number\', expression: \'record.days * record.employee.daily_hours\' } }` '
    + 'extending `hr_leave_request`.',
  replacement:
    'An `expression` the field-formula pass accepts on a declared field of the same object: CEL that reads '
    + '`record.FIELD` for a field the extended object serves (its own fields and every field an extension adds), '
    + 'calls only registered functions, and reads at most one hop through a reference field. '
    + 'A stored field that reads another record, the clock or the acting user is warned, as on a declared field: '
    + 'make it a `formula` field to compute it on every read, or keep a stored copy current with a flow.',
  reason:
    'The engine plans and stores a computed field an extension adds exactly as a declared one, but `os build`, '
    + '`os validate` and `os lint` judged only the fields the stack\'s objects declare, so an extension field whose '
    + '`expression` read a field the object does not have, called an unregistered function or read a bare name '
    + 'built clean and read null, or failed, on every row. The pass now judges each field of each extension entry '
    + 'against the extended object as served, located at the entry (`object \'TARGET\' · objectExtensions[N] · '
    + 'field \'FIELD\' expression`), and refuses what it refuses on a declared field. An extension of an object the '
    + 'stack does not declare is judged on what does not depend on the object\'s fields (grammar, functions, bare '
    + 'and unbound references): no field is refused as unknown there.',
  acceptanceCriteria:
    'Run `os validate` (or `os build`) on the stack: no `expression-invalid` error is located at an '
    + '`objectExtensions[N] · field` site. Then read a record of each extended object and confirm every computed '
    + 'field an extension adds holds a value.',
};
