// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'flow-record-read-and-decision-type-mismatch-refused',
  surface:
    'automation.Flow of a record-triggered flow (start config.triggerType record-*): a decision node\'s '
    + 'config.conditions[].expression, and a record.FIELD or previous.FIELD read in the start node '
    + 'config.condition, edges[].condition or a decision branch, where FIELD is a text or boolean field of '
    + 'the trigger object ordered or arithmetic\'d against a number (record.name > 5, title > 5 in a '
    + 'decision branch, record.active > 0)',
  replacement:
    'Compare like with like. size(record.name) > 5 for the text\'s length; a number field '
    + '(record.score > 5) for a value; double(record.name) > 5 only when every value is numeric text, '
    + 'because it faults on any other. A boolean: record.active == true',
  reason:
    'A decision branch is evaluated by the engine\'s evaluateCondition over the same run variables as an '
    + 'edge, and the run binds the trigger record both as record (and previous) and flattened to bare '
    + 'names, so record.name and name are the same value. evaluateCondition throws when the expression '
    + 'faults (ADR-0032 section 1c); CEL has no ordering or arithmetic between text and a number, so the '
    + 'run fails at that condition while the record-change trigger isolates the write that fired it. The '
    + 'publish gate refused the bare name in a start or edge condition already, but passed the record.FIELD '
    + 'read and every decision branch with no verdict at all. It now refuses them with the same run-fails '
    + 'wording. A flow that is not record-triggered keeps a warning, now worded for the failed run instead '
    + 'of a null. There is no mechanical rewrite: whether the author meant the length, a number stored as '
    + 'text, or another field is a judgement about the condition.',
  acceptanceCriteria:
    'os validate and os build report no type-mismatch-run-fails error on a record-triggered flow\'s '
    + 'decision branch or record.FIELD read; POST /api/v1/packages/PKG/publish-drafts publishes the flow; a '
    + 'create on POST /api/v1/data/OBJECT that should start the flow answers 201 and the flow run completes '
    + 'past the condition instead of failing there.',
};
