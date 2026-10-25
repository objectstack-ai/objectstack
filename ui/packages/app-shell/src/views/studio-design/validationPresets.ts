/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The Validations panel's starting points (objectui#11861).
 *
 * The panel's *New* menu opens on these, in plain words; the spec's rule types
 * — the full technical menu — sit under *Advanced*. Each preset is a rule of a
 * type `ValidationRuleSchema` already has, with the keys the preset fills on
 * top of the panel's new-rule skeleton. Nothing here is a new rule type, and
 * nothing here is a published surface: the table is Studio-internal, like the
 * panel that reads it.
 *
 * ## A preset fills its condition, or it waits for one (objectui#11820)
 *
 * A guard-bearing rule is not written to the object draft until it has a
 * condition. A preset either derives that condition from the object's own
 * fields — and the rule is written at once, a working rule — or leaves it
 * empty, and the panel holds the rule, as it holds any new rule, and opens it
 * with the condition editor focused. Which one is decided by the plan below, so
 * the panel never has to be told separately what to focus: an empty condition
 * IS the instruction.
 *
 * A preset that needs fields the object does not have is offered disabled, with
 * what it needs, rather than producing a blank rule under a promising name.
 *
 * ## What the conditions are, and why each carries `!= null`
 *
 * The server evaluates a rule's condition fail-CLOSED: a predicate that cannot
 * be evaluated rejects the write. CEL cannot order-compare `null`, so the bare
 * `record.end_date < record.start_date` rejects every record that leaves either
 * date empty. Each comparison is therefore guarded with `!= null`, the spelling
 * the platform's own `end_after_start` showcase rule uses (`has()` asks whether
 * the key is present, and a declared column holding NULL is present, so it is
 * not a guard here). The preset test evaluates every filled condition on an
 * all-empty record through `@objectstack/formula`, so this paragraph is
 * re-derived rather than trusted.
 *
 * Every condition is also a plain `&&` chain of comparisons the panel's row
 * builder (`ConditionBuilder`) parses and re-emits byte for byte, so a preset
 * rule opens as editable rows, not as raw CEL.
 *
 * ## Named on the card, deliberately not offered
 *
 * - "Unique" — the spec removed uniqueness from validation rules: a
 *   SELECT-then-INSERT check is racy, and the spec's own validation docblock
 *   points to a unique index or field-level `unique` instead. There is no rule
 *   type to map it to.
 * - "Required when…" — the spec's validation docblock names this exact phrase
 *   as the mis-read it guards against: a rule here is an invariant, re-checked
 *   on every write, while "required when" is a transition gate, which is
 *   `Field.requiredWhen` — the "Required when" box the field inspector already
 *   offers.
 */

import { t, tFormat } from '../metadata-admin/i18n.js';

/** What a preset reads off one of the object's fields. */
export interface PresetFieldOpt {
  name: string;
  label?: string;
  type?: string;
  hidden?: boolean;
  system?: boolean;
}

/**
 * What a preset would do on this object, computed before the author picks it so
 * the menu can say so.
 *
 * - `ready: true` — `condition` is the guard the rule starts with: non-empty ⇒
 *   written at once; `''` ⇒ held until the author gives one. `fields` is the
 *   `cross_field` participating list, when the preset sets it. `message` is the
 *   rule's error message (`''` leaves it to the author). `hint` is the line the
 *   menu shows under the preset's label.
 * - `ready: false` — the object lacks what the preset needs; `hint` says what.
 */
export type PresetPlan =
  | { ready: true; condition: string; fields?: string[]; message: string; hint: string }
  | { ready: false; hint: string };

export interface ValidationPreset {
  /** Stable id, for the menu row's test id. */
  id: 'end_after_start' | 'not_negative' | 'reject_when';
  /** The spec rule type the preset produces. Both carry their guard as `condition`. */
  type: 'script' | 'cross_field';
  /** The menu row's plain-language label. */
  labelKey: string;
  plan: (fields: readonly PresetFieldOpt[], locale: string) => PresetPlan;
}

/** A field name the row builder can emit as `record.NAME`. */
const CEL_IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * The fields a preset may pick: the author's own, as the editor shows them.
 * A `system` field (the audit timestamps the platform injects among them) is
 * not one an author means by "start date", and a hidden one is not on screen.
 */
function ownFields(fields: readonly PresetFieldOpt[]): PresetFieldOpt[] {
  return fields.filter((f) => !f.hidden && !f.system && CEL_IDENT.test(f.name));
}

const labelOf = (f: PresetFieldOpt) => f.label || f.name;

/** Date types, in the order they are tried. Two fields of ONE type are paired. */
const DATE_TYPES = ['date', 'datetime'] as const;
const NUMBER_TYPES: ReadonlySet<string> = new Set(['number', 'currency', 'percent']);

export const VALIDATION_PRESETS: ReadonlyArray<ValidationPreset> = [
  {
    id: 'end_after_start',
    type: 'cross_field',
    labelKey: 'engine.studio.rules.preset.endAfterStart',
    plan: (fields, locale) => {
      const own = ownFields(fields);
      for (const type of DATE_TYPES) {
        const dates = own.filter((f) => f.type === type);
        if (dates.length < 2) continue;
        // Declaration order: the first date is the start, the second the end.
        // The menu row names both before the author picks it.
        const [start, end] = dates;
        const vars = { start: labelOf(start), end: labelOf(end) };
        return {
          ready: true,
          condition: `record.${start.name} != null && record.${end.name} != null && record.${end.name} < record.${start.name}`,
          // `fields[0]` is the one field the server reads: where the violation
          // attaches. The end date is the one the author has to correct.
          fields: [end.name, start.name],
          message: tFormat('engine.studio.rules.preset.endAfterStartMessage', locale, vars),
          hint: tFormat('engine.studio.rules.preset.usesTwo', locale, vars),
        };
      }
      return { ready: false, hint: t('engine.studio.rules.preset.endAfterStartNeeds', locale) };
    },
  },
  {
    id: 'not_negative',
    type: 'script',
    labelKey: 'engine.studio.rules.preset.notNegative',
    plan: (fields, locale) => {
      const num = ownFields(fields).find((f) => typeof f.type === 'string' && NUMBER_TYPES.has(f.type));
      if (!num) return { ready: false, hint: t('engine.studio.rules.preset.notNegativeNeeds', locale) };
      const vars = { field: labelOf(num) };
      return {
        ready: true,
        condition: `record.${num.name} != null && record.${num.name} < 0`,
        message: tFormat('engine.studio.rules.preset.notNegativeMessage', locale, vars),
        hint: tFormat('engine.studio.rules.preset.usesOne', locale, vars),
      };
    },
  },
  {
    id: 'reject_when',
    type: 'script',
    labelKey: 'engine.studio.rules.preset.rejectWhen',
    // The author's own condition: held until given, with the editor focused.
    plan: (_fields, locale) => ({
      ready: true,
      condition: '',
      message: '',
      hint: t('engine.studio.rules.preset.rejectWhenHint', locale),
    }),
  },
];
