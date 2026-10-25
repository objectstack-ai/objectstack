/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * bulkParamToField — pure adapter from a `BulkActionParam` to the
 * `{ name, type, ...config }` field shape the shared form field widgets
 * (`@object-ui/fields`) consume.
 *
 * `BulkActionDialog` renders every param through the same field-widget
 * renderer the object form and `ActionParamDialog` use (`getLazyFieldWidget`),
 * so a bulk param of any form-supported field type gets its real widget — a
 * `lookup` param gets the searchable record picker instead of a preloaded
 * 200-row `<Select>` (#3064), a `user`-targeting param gets the PeoplePicker
 * the form uses — completing ADR-0059 for the bulk surface. This module is
 * the whole translation layer: pure and exported so the mapping is
 * unit-testable without the dialog render tree (mirrors app-shell's
 * `paramToField`).
 */
import { EXPANDABLE_FIELD_TYPES } from '@object-ui/core';
import { resolveFormWidgetType } from '@object-ui/fields';
import type { BulkActionParam } from '@object-ui/types';

/**
 * Param-only type spellings folded onto the canonical form widget vocabulary,
 * kept for params already authored with them — new params should use spec
 * `FieldType` values directly. (Same dialect app-shell's `paramToField`
 * accepts, so the two param surfaces don't drift.)
 */
const BULK_PARAM_TYPE_ALIASES: Record<string, string> = {
  checkbox: 'boolean',
  reference: 'lookup',
  'datetime-local': 'datetime',
};

/** Widget keys that render the record-picker family and need a reference target. */
const LOOKUP_WIDGET_TYPES = new Set(['lookup', 'master_detail']);

/**
 * Widget keys that render the person-picker family (target defaults to sys_user).
 *
 * `owner` was a member until objectui#4814 retired the spelling (ruling A′): it
 * was a synonym for `user` resolving to the same widget, and this set was one of
 * the three code faces that had drifted apart on the word. It moves in lockstep
 * with app-shell's `paramToField` — the twin this file mirrors — so the two
 * param surfaces can never disagree about it again.
 */
const USER_WIDGET_TYPES = new Set(['user']);

/**
 * Whether the widget rendered for this key has to QUERY records to do its job —
 * so it must be handed the grid's `DataSource`, and its field shape needs the
 * `reference` / `displayField` the picker queries with.
 *
 * The reference-bearing half is NOT restated here: it is `EXPANDABLE_FIELD_TYPES`
 * from `@object-ui/core`, the one relational-field family the `$expand` builder
 * and the predicate-record projection already read, and the same seam the object
 * form derives `needsDataSourceWiring` from (objectui#4790). This module held a
 * private copy of it (`DATA_SOURCE_WIDGET_TYPES = LOOKUP_WIDGET_TYPES ∪
 * USER_WIDGET_TYPES`) until objectui#4815 — the FOURTH hand-maintained answer to
 * one question, with a member set that matched neither of the other three and no
 * gate anywhere that could say so.
 *
 * Converging on the shared set costs this surface nothing, because the one cell
 * where the two tables differ is unreachable here: `tree` is a core member but
 * never a widget key on this path — it is absent from `fields`' widget map and
 * `mapFieldTypeToFormType` sends it to `field:lookup`, so every key tested here
 * (always `resolveBulkParamWidgetType` output) arrives as `lookup`. The form's
 * copy carries the same inert `tree` member for the same reason.
 *
 * The other direction is deliberately NOT converged: the form additionally wires
 * `object-ref` / `filter-condition` / `recipient-picker`, which are widget HINTS
 * that no object schema can declare (`widgetHintOnly: true`) and that a bulk
 * param does not produce. Pulling them in would CHANGE which widgets receive a
 * DataSource on this surface — a behaviour change, not a convergence — so
 * objectui#4815 left that cell measured and empty on purpose.
 *
 * Extending this surface later: OR in a second, surface-local set, the way
 * `needsDataSourceWiring` does — `EXPANDABLE_FIELD_TYPES.has(t) || SURFACE_ONLY.has(t)`.
 * Never `new Set([...EXPANDABLE_FIELD_TYPES, …])`: a copy silently re-forks the
 * table, which is the defect objectui#4815 removed, and the identity pin in
 * `__tests__/bulkParamToField.test.ts` fails on it by design.
 */
function widgetNeedsDataSource(widgetType: string): boolean {
  return EXPANDABLE_FIELD_TYPES.has(widgetType);
}

/** Resolve a param `type` to the form widget key that renders it. */
export function resolveBulkParamWidgetType(paramType: string): string {
  return resolveFormWidgetType(BULK_PARAM_TYPE_ALIASES[paramType] ?? paramType);
}

/** True when the resolved widget is a record/person picker (id-valued). */
export function isLookupishParam(param: BulkActionParam): boolean {
  const type = resolveBulkParamWidgetType(param.type);
  return widgetNeedsDataSource(type);
}

/**
 * The object a picker param queries for candidates/labels: the declared
 * `object`, else `sys_user` for person params (mirroring UserField's default).
 */
export function lookupTargetObject(param: BulkActionParam): string | undefined {
  const type = resolveBulkParamWidgetType(param.type);
  if (param.object) return param.object as string;
  return USER_WIDGET_TYPES.has(type) ? 'sys_user' : undefined;
}

/**
 * Map a `BulkActionParam` to the field-metadata shape `FieldWidgetComponentProps.field`
 * expects. `multiple` is the EFFECTIVE multi-value semantics (explicit
 * `param.multiple` or the target field's schema, #2204) — passed in by the
 * dialog, not re-derived here.
 *
 * - A `lookup` param with no `object` target degrades to a plain text input
 *   (the picker cannot query without a target), warning in dev — same
 *   last-resort fallback as app-shell's `paramToField`.
 * - A `lookup` param targeting `sys_user` is promoted to the `user` widget so
 *   bulk person params get the exact PeoplePicker the form's user fields use
 *   (search-first, avatar + department·email rows, banned users excluded).
 * - `BulkActionParam`'s documented catch-all keys (min/max/step/format/…) are
 *   forwarded to the widget as-is.
 */
export function bulkParamToField(
  param: BulkActionParam,
  multiple: boolean,
): Record<string, any> {
  let type = resolveBulkParamWidgetType(param.type);

  if (LOOKUP_WIDGET_TYPES.has(type) && !param.object) {
    if ((globalThis as any).process?.env?.NODE_ENV !== 'production') {
      console.warn(
        `[BulkActionDialog] Param "${param.name}" is type "${param.type}" but has no \`object\` target, ` +
          'so it degrades to a plain record-id text input. Declare `object: \'<object>\'` on the param.',
      );
    }
    type = 'text';
  }

  if (LOOKUP_WIDGET_TYPES.has(type) && param.object === 'sys_user') {
    type = 'user';
  }

  const {
    name,
    label,
    type: _type,
    required,
    // Rendered by the dialog beneath the control, not by the widget.
    help: _help,
    // Seeded into the dialog's initial values, not widget metadata.
    default: _default,
    // Effective multi-ness comes from the `multiple` argument (#2204).
    multiple: _multiple,
    options,
    object,
    labelField,
    placeholder,
    ...extra
  } = param;

  const field: Record<string, any> = {
    ...extra,
    name,
    label: label ?? name,
    type,
    required,
    placeholder,
    // Radix Select values are strings — stringify to match what the select
    // widgets emit, so option lookups on the confirm step compare equal.
    options: options?.map(o => ({ ...o, value: String(o.value) })),
    multiple,
  };

  if (widgetNeedsDataSource(type)) {
    // `reference` is the only target spelling the picker widgets read
    // (objectui#11070 round 4).
    field.reference = object;
    if (typeof labelField === 'string') field.displayField = labelField;
  }

  return field;
}

/** Whether the widget for this field shape needs the DataSource threaded in. */
export function fieldNeedsDataSource(field: Record<string, any>): boolean {
  return widgetNeedsDataSource(field.type);
}
