/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The Actions panel's starting points (objectui#11861).
 *
 * The panel's *New* menu opens on these, in plain words; the blank action — the
 * full editor, where every type and operation is chosen — sits under
 * *Advanced*. Each preset is an action of a shape `ActionSchema` already has,
 * given as the keys it writes on top of the panel's seed (name, label, object,
 * `record_header` placement). Nothing here is a new action type, and nothing
 * here is a published surface: the table is Studio-internal, like the panel
 * that reads it.
 *
 * ## A preset fills its action, or it waits for its target
 *
 * The spec refuses a `url`, `flow`, `modal`, `form` or `api` action without a
 * `target`, and only the author knows which flow, page or address they mean. A
 * preset of one of those types is therefore not written to the object draft
 * until it has one: the panel holds it, as the Validations panel holds a new
 * rule until it has a condition (objectui#11820), and the action editor's own
 * target input is where the author gives it. Which presets wait is not a
 * second list: {@link heldInputKey} decides it, from the action as it stands.
 *
 * ⛔ No preset writes a script: a script runs a source the author typed, and a
 * preset cannot type one for them (objectui#11921).
 */

import { t, tFormat } from '../metadata-admin/i18n.js';

/**
 * What a preset reads off one of the object's fields. Its own name, not the
 * Validations presets' `PresetFieldOpt`: this shape also reads `readonly`, so
 * the two are different declarations (one authority per exported name,
 * objectui#6273).
 */
export interface ActionPresetFieldOpt {
  name: string;
  label?: string;
  type?: string;
  hidden?: boolean;
  system?: boolean;
  readonly?: boolean;
}

/**
 * What a preset would do on this object, computed before the author picks it so
 * the menu can say so.
 *
 * - `ready: true` — `keys` are written on top of the panel's seed; `hint`, when
 *   the label alone does not say it, is the line the menu shows under it.
 * - `ready: false` — the object lacks what the preset needs; `hint` says what.
 *
 * Every line here is eager first-load bytes (the designer table), so a preset
 * whose label says it all carries no hint.
 */
export type ActionPresetPlan =
  | { ready: true; keys: Record<string, unknown>; hint?: string }
  | { ready: false; hint: string };

export interface ActionPreset {
  /** Stable id, for the menu row's test id. */
  id: 'change_choice' | 'run_flow' | 'open_url' | 'open_page';
  /** The menu row's plain-language label. */
  labelKey: string;
  plan: (fields: readonly ActionPresetFieldOpt[], locale: string) => ActionPresetPlan;
}

/**
 * The action types the spec refuses without a `target`, each with the
 * catalogue key of the input the action editor shows for that target.
 *
 * Written out rather than read off `ActionSchema` at runtime, so the schema
 * stays out of the console's first load (the reason objectui#11921 gives for
 * its body-key table). The preset test re-derives it from `ActionSchema`, in
 * both directions, for every `ActionType`.
 */
export const TARGET_INPUT_KEYS: Readonly<Record<string, string>> = {
  url: 'engine.inspector.action.target.url.label',
  flow: 'engine.inspector.action.target.flow.label',
  modal: 'engine.inspector.action.target.modal.label',
  form: 'engine.inspector.action.target.form.label',
  api: 'engine.inspector.action.target.api.label',
};

/**
 * The catalogue key of the input `action` still needs before the spec accepts
 * it — its `target`, on a type that requires one — or `null` when it needs
 * none. An action with no `type` is the spec's default, `script`.
 */
export function heldInputKey(action: Record<string, unknown>): string | null {
  const type = typeof action.type === 'string' ? action.type : 'script';
  if (!Object.prototype.hasOwnProperty.call(TARGET_INPUT_KEYS, type)) return null;
  return action.target ? null : TARGET_INPUT_KEYS[type];
}

/**
 * A field name a param may bind: the spec's `SnakeCaseIdentifierSchema`, which
 * `ActionParamSchema.field` is (two characters or more). The preset test checks
 * this against the spec.
 */
const PARAM_FIELD = /^[a-z][a-z0-9_]+$/;

/**
 * The picklist a "Change …" action may ask about: the author's own, as the
 * editor shows them, and one a user may write. A `system` field is the
 * platform's, a hidden one is not on screen, and a read-only one is not the
 * user's to change.
 */
function changeableChoice(fields: readonly ActionPresetFieldOpt[]): ActionPresetFieldOpt | undefined {
  return fields.find(
    (f) => f.type === 'select' && !f.hidden && !f.system && !f.readonly && PARAM_FIELD.test(f.name),
  );
}

/** A preset that waits for its target: only the type is its own. */
const waitsForTarget = (type: string) => (): ActionPresetPlan => ({ ready: true, keys: { type } });

export const ACTION_PRESETS: ReadonlyArray<ActionPreset> = [
  {
    // The declarative single-record write (objectui#11820's shape), with the
    // value asked for in the action's dialog rather than fixed: `params` binds
    // the field, so the click asks for it and the platform writes it, as the
    // caller. Working with nothing more to fill in.
    id: 'change_choice',
    labelKey: 'engine.studio.actions.preset.change',
    plan: (fields, locale) => {
      const field = changeableChoice(fields);
      if (!field) return { ready: false, hint: t('engine.studio.actions.preset.changeNeeds', locale) };
      const vars = { field: field.label || field.name };
      return {
        ready: true,
        keys: {
          label: tFormat('engine.studio.actions.preset.changeLabel', locale, vars),
          operation: 'update',
          params: [{ field: field.name }],
        },
        hint: tFormat('engine.studio.actions.preset.changeHint', locale, vars),
      };
    },
  },
  {
    id: 'run_flow',
    labelKey: 'engine.studio.actions.preset.runFlow',
    plan: waitsForTarget('flow'),
  },
  {
    id: 'open_url',
    labelKey: 'engine.studio.actions.preset.openUrl',
    plan: waitsForTarget('url'),
  },
  {
    id: 'open_page',
    labelKey: 'engine.studio.actions.preset.openPage',
    plan: waitsForTarget('modal'),
  },
];
