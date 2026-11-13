// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// The AI solution blueprint's object now runs the stage-field option-kind rule
// `stage-field-option-kind-required` states for an object, at the blueprint's
// own parse. A D3 entry with no conversion: a blueprint is never persisted, so
// nothing at rest is rewritten, and which option ends a record's life
// successfully is the author's to say.
export const entry: SemanticMigration = {
  id: 'blueprint-stage-field-option-kind-required',
  surface:
    'ai.SolutionBlueprint.objects[].stageField naming a select or radio field whose options declare no kind '
    + '(ai/solution-blueprint.zod.ts, the blueprint apply_blueprint parses)',
  replacement:
    "`kind: 'open' | 'won' | 'lost'` on every option of the field the blueprint object's `stageField` names, "
    + "for example `{ label: 'Closed Won', value: 'closed_won', kind: 'won' }`; or omit `stageField`",
  reason:
    'A blueprint object that names a `stageField` is built into an object with that stage field, and the object '
    + 'schema refuses a stage field whose options do not each declare their lifecycle `kind` (or that holds no '
    + 'single option code per record). The blueprint parse did not apply that rule, so such a blueprint parsed, '
    + 'its views and navigation entry were staged, and only the object write was refused, leaving staged entries '
    + 'that point at an object that was never written. The blueprint parse now runs the same rule and refuses '
    + 'the blueprint before anything is staged, at `objects.<i>.fields.<j>.options.<k>.kind` for each option '
    + 'without a kind and at `objects.<i>.stageField` for a multi-value stage field. Every blueprint this refuses '
    + 'was already refused at the object write. A blueprint is never persisted, so there is nothing at rest to '
    + 'convert; a producer that emits blueprints states each option\'s kind, which only it can choose.',
  acceptanceCriteria:
    '`SolutionBlueprintSchema.safeParse` of every blueprint the producer emits succeeds; every option of each '
    + 'blueprint object\'s stage field declares `kind`, with each terminal state marked `won` or `lost` and every '
    + 'other state `open`.',
};
