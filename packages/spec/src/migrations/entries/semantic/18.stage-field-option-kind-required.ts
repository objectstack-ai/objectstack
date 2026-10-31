// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #23809 — the select option's lifecycle `kind`, mandatory under `stageField`.
// A D3 entry with no conversion on purpose: the maintainer's ruling withholds a
// default under `stageField`, so no mechanical edit can say which option ends a
// record's life successfully and which does not. This entry states the
// refusal an authored source meets and the edit only its author can make.
export const entry: SemanticMigration = {
  id: 'stage-field-option-kind-required',
  surface: 'object.stageField naming a select whose options declare no kind (data/object.zod.ts)',
  replacement:
    "`kind: 'open' | 'won' | 'lost'` on every option of the field `stageField` names, for example "
    + "`{ label: 'Closed Won', value: 'closed_won', kind: 'won' }`",
  reason:
    'A select option now declares its lifecycle category, `kind`: `open` for a step on the way, `won` '
    + 'for the successful end, `lost` for the unsuccessful end. The record path and the other stage '
    + 'renderers read it instead of guessing a terminus from the value\'s spelling, which drew a lost '
    + 'state such as Unqualified as one more step after Converted. On a plain select the key is optional '
    + 'and an absent kind reads as `open`. On the field an object\'s `stageField` names, every option must '
    + 'declare it: a maintainer ruling withholds a default there, because a default would draw a lifecycle '
    + 'whose author forgot the key as the same wrong path. So the object parse refuses, at '
    + '`fields.<field>.options.<i>.kind`, every option of the stage field that declares no kind, naming '
    + 'the field and the option; and at `stageField` it refuses a stage field whose options are not '
    + 'declared on the object (a picklist-backed select) or that holds no single option code per record '
    + '(a multi-value choice). The refusal reaches `defineStack`, `objectstack validate`, '
    + '`objectstack build` and the metadata save door. No conversion makes the edit: which option is the '
    + 'successful end and which the unsuccessful one is the author\'s to say. Add `kind` to each option '
    + 'of the stage field, or set `stageField: false` if the object has no linear lifecycle.',
  acceptanceCriteria:
    '`objectstack validate` reports no refusal at a `fields.<field>.options.<i>.kind` or `stageField` path; '
    + 'every option of each object\'s stage field declares `kind`, with each terminal state marked `won` '
    + 'or `lost` and every other state `open`.',
};
