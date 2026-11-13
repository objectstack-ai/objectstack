// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
// [#23809] The single-option-code types — the only ones whose options take a
// lifecycle `kind`, and so the only option fields a `stageField` may name.
import { SINGLE_OPTION_TYPES } from './field-value.zod';

// The stage-field option-kind rule, declared once for the two shapes that carry
// a `stageField`: `ObjectSchema` (`./object.zod.ts`) and the AI blueprint
// object (`BlueprintObjectSchema`, `../ai/solution-blueprint.zod.ts`).
//
// Declared in its own module, outside the `data` barrel, so the blueprint runs
// this function rather than a copy of it, and the function does not join the
// package's published exports.

/** How a shape that carries `stageField` spells the two things the refusal names. */
export interface StageFieldSpelling {
  /**
   * The path segment that locates field `name` under `fields`: the name itself
   * on an object's field MAP, the entry's index on a blueprint's field ARRAY.
   */
  readonly fieldKey: (name: string) => string | number;
  /** The sentence the refusal ends on for an object with no linear lifecycle. */
  readonly noLifecycle: string;
}

/** `ObjectSchema`'s spelling: a field map, and `stageField: false` for "no lifecycle". */
const OBJECT_STAGE_FIELD_SPELLING: StageFieldSpelling = {
  fieldKey: (name) => name,
  noLifecycle: 'Or set `stageField: false` if this object has no linear lifecycle.',
};

/**
 * [#23809, maintainer ruling on the card: 「同意」] The field an object's
 * `stageField` names declares a `kind` on EVERY option — `open`, `won` or
 * `lost` (`SelectOption.kind`). Every renderer of the stage field (the
 * record path, the kanban column order, the "closed" filters, the won / lost
 * measures) reads that kind to tell the steps from the two ends, so an option
 * without one would be drawn by the old guess from its spelling — the defect
 * this key exists to end. There is deliberately no default here: on a plain
 * select an absent kind reads as `open`, but under `stageField` that reading
 * would hand an AI that forgot the key the same wrong path, only declared.
 *
 * Refused, judged against the AUTHORED field map:
 *
 *  - one located issue per option without `kind`, at
 *    `['fields', <field>, 'options', <i>, 'kind']`, naming the field and the
 *    option;
 *  - at `['stageField']`, a stage field whose options are not declared on this
 *    object (a `picklist`-backed select): its options cannot be judged here,
 *    and this is the one door every save passes, so it is refused rather than
 *    let through unjudged;
 *  - at `['stageField']`, a stage field that carries options but holds no
 *    single option code per record (a multi-value choice, a `multiple: true`
 *    select): a record stands at one stage.
 *
 * Unchanged, on purpose: `stageField: false`, a `stageField` naming no declared
 * field (the lint `semantic-roles` rule reports it), and one naming a field
 * with no options at all.
 *
 * Judged at parse, beside `refuseDishonestReferenceDeletedWhen` in
 * `ObjectSchema`'s refinement (`./object.zod.ts`), so every door —
 * `defineStack`, a raw `.parse()`, the metadata save door — refuses it. The AI
 * blueprint object (`BlueprintObjectSchema`, `../ai/solution-blueprint.zod.ts`)
 * runs this same function over its field ARRAY, so `apply_blueprint` refuses a
 * blueprint the object write would refuse before anything is staged; `spelling`
 * is the only thing that differs between the two shapes.
 */
export function refuseStageFieldWithoutKinds(
  ownName: unknown,
  stageField: unknown,
  fields: unknown,
  ctx: z.RefinementCtx,
  spelling: StageFieldSpelling = OBJECT_STAGE_FIELD_SPELLING,
): void {
  if (typeof stageField !== 'string') return;
  if (fields === null || typeof fields !== 'object') return;
  const fieldMap = fields as Record<string, unknown>;
  if (!Object.prototype.hasOwnProperty.call(fieldMap, stageField)) return;
  const def = fieldMap[stageField] as
    | { type?: unknown; multiple?: unknown; options?: unknown; picklist?: unknown }
    | null
    | undefined;
  if (def === null || typeof def !== 'object') return;
  const objectName = typeof ownName === 'string' ? ownName : '<unnamed>';
  const type = typeof def.type === 'string' ? def.type : String(def.type);
  const hasOptionSource = Array.isArray(def.options) || typeof def.picklist === 'string';
  const prescription =
    'A stage field is a single-value `select` (or `radio`) whose inline `options` each declare `kind`: '
    + "`'open'` for a step on the way, `'won'` for the successful end, `'lost'` for the unsuccessful end "
    + `(e.g. \`{ label: 'Closed Won', value: 'closed_won', kind: 'won' }\`). ${spelling.noLifecycle}`;

  if (!SINGLE_OPTION_TYPES.has(type) || def.multiple === true) {
    if (!hasOptionSource) return;
    ctx.addIssue({
      code: 'custom',
      path: ['stageField'],
      message:
        `Object \`${objectName}\` declares \`stageField: '${stageField}'\`, a \`${type}\` field`
        + `${def.multiple === true ? ' with `multiple: true`' : ''} that holds no single option code per `
        + `record, so it cannot be a lifecycle stage. ${prescription}`,
    });
    return;
  }

  if (!Array.isArray(def.options)) {
    if (typeof def.picklist !== 'string') return;
    ctx.addIssue({
      code: 'custom',
      path: ['stageField'],
      message:
        `Object \`${objectName}\` declares \`stageField: '${stageField}'\`, a field that takes its options from `
        + `\`picklist: '${def.picklist}'\`. Those options are not declared on this object, so whether each `
        + `declares its lifecycle \`kind\` cannot be checked here. Declare the stage field's options inline on `
        + `\`${stageField}\` instead of the picklist. ${prescription}`,
    });
    return;
  }

  def.options.forEach((option, index) => {
    const rec = option as { value?: unknown; kind?: unknown } | null;
    if (rec === null || typeof rec !== 'object' || rec.kind !== undefined) return;
    const value = typeof rec.value === 'string' ? rec.value : String(rec.value);
    ctx.addIssue({
      code: 'custom',
      path: ['fields', spelling.fieldKey(stageField), 'options', index, 'kind'],
      message:
        `Option '${value}' of field \`${stageField}\` declares no \`kind\`, and object \`${objectName}\` names `
        + `\`${stageField}\` as its \`stageField\`: every option of a stage field declares its lifecycle kind, `
        + `so the record path can tell the steps from the two ends. Add \`kind: 'open'\` (a step on the way), `
        + `\`kind: 'won'\` (the successful end) or \`kind: 'lost'\` (the unsuccessful end) to '${value}'.`,
    });
  });
}
