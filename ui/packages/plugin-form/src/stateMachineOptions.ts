/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A form's select offers only the values its `state_machine` admits: an edit
 * form the moves from the stored value (#25933), a create form the machine's
 * entry point (#27763).
 *
 * The object's served `validations` declare, per from-state, which values a
 * field may move to, and optionally (`initialStates`) which values a new
 * record may be created in; the server refuses every other move on update and
 * every other initial value on insert. Before this pass the record form
 * offered every option and the user learned which ones were allowed only from
 * the refusal after submit. Here a select field governed by a blocking machine
 * keeps only the admitted values, and the rest are left out (not drawn
 * disabled, so no new copy).
 *
 * Which rules narrow, and to what, is `@object-ui/core`'s
 * `stateMachineNextValues` (update; the same read the grid's inline editor and
 * the board use) and `stateMachineInitialValues` (insert). Four rules of this
 * pass:
 *
 *  - the from-state is the PERSISTED record (`previousValues`), never the live
 *    form value, because the server judges the move against the stored row;
 *  - a create form keeps the machine's `initialStates`; a machine that declares
 *    none leaves it unconstrained, as the server does on insert;
 *  - on an edit the current value always stays offered, so opening and saving
 *    the form without touching the field never fails;
 *  - on a create the value the form OPENS with (`openingValues`: a seeded
 *    default or the caller's pre-fill) stays offered even outside
 *    `initialStates`, so the form never silently drops what it was handed —
 *    the server's refusal stays the one that names it.
 *
 * Both option carriers are narrowed: the FormField's own `options` (the form
 * renderer's built-in select) and the stashed object-field metadata's
 * `field.options` (the registered select widget reads that one).
 */

import { stateMachineInitialValues, stateMachineNextValues } from '@object-ui/core';

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
  /** The form's mode; an edit and a create narrow, every other mode passes through. */
  mode?: string;
  /** The persisted record — the row as the server last stored it. Edit only. */
  previousValues?: Record<string, unknown> | null;
  /** The values a create form opens with — seeded defaults plus the caller's pre-fill. Create only. */
  openingValues?: Record<string, unknown> | null;
}

/** The value a create form opens a field on, when it opens on one. */
function openingValue(openingValues: Record<string, unknown> | null | undefined, name: string): string | null {
  const value = openingValues && typeof openingValues === 'object' ? openingValues[name] : undefined;
  return value === undefined || value === null || value === '' ? null : String(value);
}

/**
 * Narrow each select field's options to the values its blocking
 * `state_machine` admits: on an edit, the moves from the persisted value; on a
 * create, the declared `initialStates` plus the value the form opens with.
 * Fields with no such machine, multi-value fields, an edit whose record has
 * not loaded and every other mode pass through unchanged (same object
 * identity).
 */
export function narrowStateMachineOptions<T extends Record<string, any>>(
  fields: T[],
  { objectSchema, mode, previousValues, openingValues }: NarrowStateMachineOptionsArgs,
): T[] {
  let admitted: (name: string) => Set<string> | null;
  if (mode === 'create') {
    admitted = (name) => {
      const initial = stateMachineInitialValues(objectSchema, name);
      const opening = openingValue(openingValues, name);
      return initial && opening !== null ? new Set([...initial, opening]) : initial;
    };
  } else if (mode === 'edit' && previousValues && typeof previousValues === 'object') {
    admitted = (name) => stateMachineNextValues(objectSchema, name, previousValues[name]);
  } else {
    return fields;
  }
  return fields.map((f) => {
    if (!f?.name) return f;
    // A multi-value select holds a set, not one state, so no machine applies.
    if (f.multiple || f.field?.multiple) return f;
    const reachable = admitted(f.name);
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
