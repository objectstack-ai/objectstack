/**
 * paramToField — pure adapter from a resolved `ActionParamDef` to the
 * `{ name, type, ...config }` field shape the shared form field widgets
 * (`@object-ui/fields`) consume.
 *
 * `ActionParamDialog` renders every param through the same field-widget
 * renderer the object form uses (`fieldWidgetMap` / `FORM_FIELD_TYPES`), so a
 * declared action param of ANY form-supported field type — `file`, `image`,
 * `richtext`, `color`, `address`, … — gets its real widget instead of
 * collapsing to a text input (ADR-0059). This module is the whole translation
 * layer: pure and exported so the mapping is unit-testable without the dialog
 * render tree (mirrors `filterVisibleParams`' style), with a drift test
 * asserting param support ⊇ form support.
 */
import { EXPANDABLE_FIELD_TYPES, type ActionParamDef } from '@object-ui/core';
// The param-type fold (its alias table included) moved to `@object-ui/fields`
// beside the resolver that reads it first (objectui#12105). This adapter asks
// the same question one step later, so it reads the same function — never a
// local copy of the table.
import { resolveParamWidgetType } from '@object-ui/fields';

/**
 * Widget keys whose picker cannot query without an explicitly DECLARED target,
 * so a param of that type with no `referenceTo` degrades to a plain text input.
 *
 * Deliberately NOT the reference-bearing family (`EXPANDABLE_FIELD_TYPES`, read
 * below): `user` belongs to that family but defaults its target to `sys_user`,
 * so it must never degrade. Two rules over overlapping types, kept separate —
 * the same split the twin keeps between its own `LOOKUP_WIDGET_TYPES` and
 * `widgetNeedsDataSource` (plugin-grid's `bulkParamToField`). objectui#5312
 * converged the second rule only, on purpose.
 */
const LOOKUP_WIDGET_TYPES = new Set(['lookup', 'master_detail']);

/**
 * Does this param degrade to a plain text input for want of a declared target?
 *
 * The ONE answer to that question, exported so every surface that REACTS to the
 * degradation reads the same table that PERFORMS it. `ActionParamDialog` is the
 * caller that made exporting it necessary (objectui#5654): it decides whether to
 * show the objectstack-ai/objectstack#3405 "paste a record id" placeholder and help text, and it used to
 * answer with its own literal over RAW param spellings
 * (`param.type === 'lookup' || param.type === 'reference'`). That copy disagreed
 * with this one in BOTH directions, so neither set contained the other:
 *
 *   - `master_detail` degrades here but got no hints there — a targetless
 *     `master_detail` param really did render as an unexplained empty box asking
 *     for a bare UUID, which is exactly the state objectstack-ai/objectstack#3405 added the hints for.
 *   - `reference` was hand-copied out of `PARAM_TYPE_ALIASES`, a spelling this
 *     side never sees: it is folded to `lookup` before the membership test.
 *
 * Note the parameter: an `ActionParamDef`, not a widget key. Callers must not
 * resolve the widget key themselves to ask this — re-deriving the input is how
 * the fork happened. The predicate is exactly equivalent to "`paramToField()`
 * replaced this param's own widget with the text fallback", pinned as an
 * equivalence over every spelling in `paramToField.test.ts` — which is what lets
 * the dialog drop its `field.type === 'text'` proxy for that question.
 *
 * Deliberately NOT the reference-bearing family: see `LOOKUP_WIDGET_TYPES` above
 * for why `user` must never degrade.
 */
export function paramDegradesWithoutTarget(param: ActionParamDef): boolean {
  return LOOKUP_WIDGET_TYPES.has(resolveParamWidgetType(param.type)) && !param.referenceTo;
}

/**
 * Map an `ActionParamDef` to the field-metadata shape `FieldWidgetComponentProps.field`
 * expects. Lossless for the widget-relevant config: options, `multiple`,
 * upload `accept`/`maxSize`, and the full lookup picker config that
 * `resolveActionParams()` copies from the underlying object field.
 *
 * Param-only fallback: a `lookup`/`reference` param with no known
 * `referenceTo` target renders as a plain text input (the picker cannot query
 * without a target object) — preserving the dialog's long-standing behavior
 * for partially-resolved metadata.
 *
 * That fallback is now a last resort, not an expected path (objectstack-ai/objectstack#3405): inline
 * params declare `reference` and field-backed ones inherit it, and the spec
 * rejects a targetless inline picker at parse time. Reaching it means the
 * metadata is broken or partial, so say so in dev instead of silently handing
 * the user a box that wants a raw UUID.
 */
export function paramToField(param: ActionParamDef): Record<string, any> {
  let type = resolveParamWidgetType(param.type);
  if (paramDegradesWithoutTarget(param)) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn(
        `[ActionParamDialog] Param "${param.name}" is type "${param.type}" but has no reference target, ` +
          'so it degrades to a plain record-id text input. Declare `reference: \'<object>\'` on the param, ' +
          'or make it field-backed (`{ field: \'<lookup_field>\' }`) to inherit the target.',
      );
    }
    type = 'text';
  }

  const field: Record<string, any> = {
    name: param.name,
    label: param.label,
    type,
    required: param.required,
    placeholder: param.placeholder,
    options: param.options,
    multiple: param.multiple,
    accept: param.accept,
    maxSize: param.maxSize,
  };

  // The dialog's boolean params render as an inline checkbox row (label beside
  // the control), matching the pre-ADR-0059 dialog UX — not the form's switch.
  if (type === 'boolean') {
    field.widget = 'checkbox';
  }

  // Which widgets carry a reference target is NOT restated here: it is
  // `EXPANDABLE_FIELD_TYPES` from `@object-ui/core`, the one relational-field
  // family that `buildExpandFields`, the predicate-record projection, the object
  // form's `needsDataSourceWiring` and the grid's `bulkParamToField` already
  // read (objectui#4770 / #4790 / #4815). This face was the fourth CONVERSION
  // of it — the private copy `LOOKUP_WIDGET_TYPES.has(type) || type === 'user'`,
  // once with a fifth spelling `owner` that objectui#4814 retired (ruling A′).
  //
  // This comment used to add "and last". It was true as far as it had been
  // measured and is now known false, twice over: objectui#5692 found two older
  // copies in `plugin-dashboard`, and objectui#5874 four more (kanban, detail
  // ×2, `resolveActionParams`). No count is restated here on purpose — a
  // hand-kept census of this table is exactly what keeps going stale, and
  // writing a bigger integer would only re-create the defect. The census, its
  // falsification and the lineage of the conversions live in ONE place, the
  // family's canonical home: see the "One family, many consumers — and NO
  // reliable count of them" and "The LAST-private-copy claim was false"
  // sections of `packages/core/src/utils/expand-fields.ts`. The mechanical
  // fact, here and on every converted face, is the identity pin (objectui#5875).
  //
  // The comment that stood here claimed the disjunction "moves in lockstep with
  // plugin-grid's `bulkParamToField` twin — the two param faces are never
  // split". Measured on the tip before this change, that was false in BOTH
  // senses: mechanically, the twin had read core's Set since objectui#4815 while
  // this line read a private literal, so the two faces shared nothing and no
  // gate could report a split; and by membership they already differed, by
  // `tree`. Lockstep is true again — and for the first time it is mechanical,
  // not hand-kept: the identity pin in `paramToField.test.ts` fails on a
  // member-identical private copy, which is what a value check would not.
  //
  // `tree` is the member this face gains, and it is unreachable here: it is
  // absent from `fields`' widget map and `mapFieldTypeToFormType` sends it to
  // `field:lookup`, so every key tested here — always `resolveParamWidgetType`
  // output — arrives as `lookup`. Pinned, so registering a real `tree` widget
  // surfaces that behaviour change instead of shipping it silently.
  //
  // Extending this surface later: OR in a second, surface-local set, the way
  // `needsDataSourceWiring` does. Never `new Set([...EXPANDABLE_FIELD_TYPES, …])`
  // — a copy re-forks the table, which is the defect this change removed, and
  // the identity pin fails on it by design.
  if (EXPANDABLE_FIELD_TYPES.has(type)) {
    Object.assign(field, {
      // The widget field's target key is the spec's `reference`, the only
      // spelling `LookupField` / `UserField` read (objectui#11070 round 4).
      reference: param.referenceTo,
      displayField: param.displayField,
      idField: param.idField,
      descriptionField: param.descriptionField,
      title_format: param.titleFormat,
      // ⭐ objectui#12157 — the spec's `lookupColumns` / `lookupPageSize`, the
      // only spellings `LookupField` reads. This emit was the in-repo producer
      // of `lookup_columns` / `lookup_page_size` on a widget field bag, so it
      // moves with the reader: left snake, an action param's picker would lose
      // its declared columns and page size without a word.
      lookupColumns: param.lookupColumns,
      lookupFilters: param.lookupFilters,
      lookupPageSize: param.lookupPageSize,
      // ⭐ objectui#7357 retired `depends_on`, objectui's snake_case twin of
      // the spec's field-level cascade key. This emit was the ONE in-repo
      // framework producer of that spelling on a widget field-metadata bag —
      // the card's own census said there was none, and it was wrong here — so
      // leaving it would have handed `LookupField` a key it no longer reads.
      //
      // ⚠️ What that would have changed, stated as MEASURED and not larger:
      // dropping the read arm without moving this emit would have flipped the
      // gate this key raises into an UNGATED, UNFILTERED picker — a silent
      // behaviour change, and the reason the emit moves with the reader.
      //
      // ⭐ objectui#8672, ruling A — the residue that note recorded is gone.
      // When it was written, this dialog supplied `dependentValues` only to
      // `CASCADE_OPTION_WIDGET_TYPES` (no `lookup` member), so `LookupField`
      // resolved `{}` and the gate this emit raises NEVER lifted, whatever the
      // user typed into the parent. `ActionParamDialog` now feeds the
      // reference-bearing family its live `values` as well — see
      // `paramNeedsDependentValues()` there — so the key this line emits does
      // what its author meant: the trigger ungates once the named parent
      // carries a value, and the picker is narrowed by it on every surface.
      // ⛔ Do not restate the supply rule here; it is asked of that predicate.
      //
      // The remaining snake member above, `title_format`, is a different
      // question (objectui#7155's ruling covered four keys and this was not one
      // of them; `FieldSchema` declares no field-level twin for it).
      dependsOn: param.dependsOn,
    });
  }

  return field;
}
