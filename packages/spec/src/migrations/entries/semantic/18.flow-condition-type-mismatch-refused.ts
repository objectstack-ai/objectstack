// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'flow-condition-type-mismatch-refused',
  surface:
    'automation.Flow start node config.condition and edges[].condition of a record-triggered flow '
    + '(start config.triggerType record-*): a text or boolean field of the trigger object ordered or '
    + 'arithmetic\'d against a number (name > 5 on a text field, active > 0 on a boolean)',
  replacement:
    'Compare like with like. size(name) > 5 for the text\'s length; a number field (score > 5) for a '
    + 'value; double(name) > 5 only when every value is numeric text, because it faults on any other. '
    + 'A boolean: active == true',
  reason:
    'A record-triggered flow\'s start and edge conditions are evaluated by the engine\'s '
    + 'evaluateCondition, which throws when the expression faults (ADR-0032 section 1c) instead of '
    + 'reading false or null. CEL has no ordering or arithmetic between text and a number, so name > 5 '
    + 'faults on every value that is not numeric text: the run fails at that condition, while the '
    + 'record-change trigger isolates the write that fired it, so the write lands and the work the flow '
    + 'exists to do is not done. The publish gate passed it with a warning saying the expression '
    + 'silently evaluates to null, which is true only of a formula field. The gate now refuses it there '
    + 'with the run-fails wording, the severity the nullable-comparison verdict already has on the same '
    + 'conditions. Flows that are not record-triggered keep the warning. There is no mechanical '
    + 'rewrite: whether the author meant the length, a number stored as text, or another field is a '
    + 'judgement about the condition.',
  acceptanceCriteria:
    'os validate and os build report no type-mismatch-run-fails error on a record-triggered flow\'s '
    + 'start or edge condition; POST /api/v1/packages/PKG/publish-drafts publishes the flow; a create '
    + 'on POST /api/v1/data/OBJECT that should start the flow answers 201 and the flow run completes '
    + 'past the condition instead of failing there.',
};
