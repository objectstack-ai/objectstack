// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'validation-type-mismatch-refused',
  surface:
    'data.Object.validations[].condition and when (nested then / otherwise rules included), '
    + 'data.Field.requiredWhen and readonlyWhen, an option visibleWhen, and a hook condition: a text or '
    + 'boolean field ordered or arithmetic\'d against a number (record.name > 5 on a text field, '
    + 'record.active > 0 on a boolean)',
  replacement:
    'Compare like with like. size(record.name) > 5 for the text\'s length; a number field '
    + '(record.score > 5) for a value; double(record.name) > 5 only when every value is numeric text, '
    + 'because it faults on any other. A boolean: record.active == true',
  reason:
    'A validation rule, a field requiredWhen / readonlyWhen, an option visibleWhen on the write path and '
    + 'a hook condition fail closed: an expression that cannot be evaluated refuses the write (or aborts '
    + 'the operation) instead of being skipped. CEL has no ordering or arithmetic between text and a '
    + 'number, so record.name > 5 faults on every value that is not numeric text, and once such a rule '
    + 'was published every create and update on the object whose value was not numeric text was refused '
    + '("could not be evaluated ... write rejected"). The publish gate passed it with a warning saying the '
    + 'expression silently evaluates to null, which is true only of a formula field. The gate now refuses '
    + 'it at those sites, the severity the nullable-comparison verdict already had there; a formula field '
    + 'keeps the warning. There is no mechanical rewrite: whether the author meant the length, a number '
    + 'stored as text, or another field is a judgement about the rule.',
  acceptanceCriteria:
    'os validate and os build report no type mismatch error on a validation rule, field requiredWhen / '
    + 'readonlyWhen, option visibleWhen or hook condition; POST /api/v1/packages/PKG/publish-drafts '
    + 'publishes the object; a create on POST /api/v1/data/OBJECT that the rule should admit answers 201 '
    + 'where it answered 400 VALIDATION_FAILED "could not be evaluated".',
};
