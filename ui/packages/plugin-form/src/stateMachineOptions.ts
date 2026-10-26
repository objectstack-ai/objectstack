/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * An edit form's select offers only the moves its `state_machine` allows
 * (#25933).
 *
 * The object's served `validations` declare, per from-state, which values a
 * field may move to; the server refuses every other move on update. Before
 * this pass the record form offered every option and the user learned which
 * ones were allowed only from the refusal after submit. Here a select field
 * governed by a blocking machine keeps the persisted value plus its declared
 * next states, and the rest are left out (not drawn disabled, so no new copy).
 *
 * Which rules narrow, and from which value, is `stateMachineNextValues` in
 * `@object-ui/core` — the same read the grid's inline editor and the board
 * use. Three rules of this pass:
 *
 *  - the from-state is the PERSISTED record (`previousValues`), never the live
 *    form value, because the server judges the move against the stored row;
 *  - a create form is unconstrained — a new record has no from-state, and the
 *    insert entry point (`initialStates`) is a different contract;
 *  - the current value always stays offered, so opening and saving the form
 *    without touching the field never fails.
 *
 * Both option carriers are narrowed: the FormField's own `options` (the form
 * renderer's built-in select) and the stashed object-field metadata's
 * `field.options` (the registered select widget reads that one).
 */

import { stateMachineNextValues } from '@object-ui/core';

type OptionLike = unknown;

function optionValue(option: OptionLike): string {
  if (option && typeof option === 'object' && 'value' in option) {
    return String((option as { value: unknown }).value);
  }
  return String(option);
}

function keepReachable(options: unknown, reachable: Set<string>): unknown {
  return Array.isArray(options)
    ? options.filter((o: OptionLike) => reachable.has(optionValue(o)))
    : options;
}

export interface NarrowStateMachineOptionsArgs {
  /** The object schema the form resolved; its `validations` carry the machines. */
  objectSchema: unknown;
  /** The form's mode; only an edit narrows. */
  mode?: string;
  /** The persisted record — the row as the server last stored it. */
  previousValues?: Record<string, unknown> | null;
}

/**
 * Narrow each select field's options to the values its blocking
 * `state_machine` lets the persisted value move to. Fields with no such
 * machine, multi-value fields and every field of a create form pass through
 * unchanged (same object identity).
 */
export function narrowStateMachineOptions<T extends Record<string, any>>(
  fields: T[],
  { objectSchema, mode, previousValues }: NarrowStateMachineOptionsArgs,
): T[] {
  if (mode !== 'edit' || !previousValues || typeof previousValues !== 'object') return fields;
  return fields.map((f) => {
    if (!f?.name) return f;
    // A multi-value select holds a set, not one state, so no machine applies.
    if (f.multiple || f.field?.multiple) return f;
    const reachable = stateMachineNextValues(objectSchema, f.name, previousValues[f.name]);
    if (!reachable) return f;
    const ownOptions = Array.isArray(f.options);
    const fieldOptions = Array.isArray(f.field?.options);
    if (!ownOptions && !fieldOptions) return f;
    return {
      ...f,
      ...(ownOptions ? { options: keepReachable(f.options, reachable) } : {}),
      ...(fieldOptions
        ? { field: { ...f.field, options: keepReachable(f.field.options, reachable) } }
        : {}),
    };
  });
}
