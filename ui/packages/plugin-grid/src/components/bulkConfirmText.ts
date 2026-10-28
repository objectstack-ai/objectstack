/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { fillTemplateHoles, hasTemplateHoles } from '@object-ui/core';
import type { BulkActionDef, BulkActionParam } from '@object-ui/types';
import { BULK_CONFIRM_COUNT_ROOT, bulkConfirmTemplateRoots } from '@objectstack/spec/ui';
import { isLookupishParam } from './bulkParamToField';

/**
 * The text a bulk action's `confirmText` carries: the string itself, or the
 * `source` of a `{ dialect: 'template', source }` envelope, verbatim. Returns
 * `undefined` when the slot is absent, blank (empty or whitespace-only), or
 * carries no string `source` — the caller shows its default sentence then.
 *
 * Why two arms (objectui#13183, step 1 of the landing order for
 * objectstack#24947): the protocol is making this slot a `template`-dialect
 * slot, so a parsed bulk def serves the envelope where it served a string.
 * Rendered as a React child, the envelope is an object and the confirm step
 * breaks. This reader accepts both shapes, the way core's
 * `formatTitleTemplate` reads `titleFormat`, so the renderer can move before
 * the spec does.
 *
 * ⚠️ The `{{ }}` holes are NOT filled here: `source` is returned as written.
 * {@link bulkConfirmText} is the reader that fills them.
 */
export function bulkConfirmTextSource(
  confirmText: BulkActionDef['confirmText'] | null | undefined,
): string | undefined {
  const text =
    typeof confirmText === 'string'
      ? confirmText
      : confirmText !== null && typeof confirmText === 'object' && typeof confirmText.source === 'string'
        ? confirmText.source
        : undefined;
  return text !== undefined && text.trim() !== '' ? text : undefined;
}

/**
 * What a bulk `confirmText` hole is filled from: the run's record count, and
 * the dialog's param values with what it needs to show them.
 */
export interface BulkConfirmScope {
  /** The number of records the run covers (the dialog's `rows.length`). */
  count: number;
  /** The def's params, in declaration order. */
  params?: readonly BulkActionParam[];
  /** The dialog's in-progress param values, by param `name`. */
  values?: Record<string, unknown>;
  /**
   * The display names the confirm step resolved for picker params: param name
   * → record id → name. Filled lazily once the step opens.
   */
  lookupLabels?: Record<string, Record<string, string>>;
}

/**
 * A param's DISPLAY value for a confirm hole, by the rule the protocol states
 * on `confirmText` (`packages/spec/src/ui/bulk-action.zod.ts`): the chosen
 * option's `label` for an option-bearing param, the picked record's display
 * name for a `lookup` / user param, and the entered value otherwise — returned
 * as the value itself, not a string, so the engine's formatters
 * (`{{ amount | currency:EUR }}`, `{{ due | date:long }}`) apply to it. A
 * multi-value param's entries are joined with ', '. An empty value is
 * `undefined`, so it prints empty and `{{ x | default:'—' }}` can name it.
 *
 * A picker id whose name has not been resolved (yet, or ever) shows the id,
 * as the confirm step's own value summary does; the sentence re-renders when
 * the name arrives.
 */
export function bulkConfirmParamDisplayValue(
  param: BulkActionParam,
  value: unknown,
  lookupLabels?: Record<string, Record<string, string>>,
): unknown {
  if (value === undefined || value === null || value === '') return undefined;
  if (Array.isArray(value) && value.length === 0) return undefined;
  let labelOf: ((entry: unknown) => string) | undefined;
  if (isLookupishParam(param)) {
    const names = lookupLabels?.[param.name] ?? {};
    labelOf = (entry) => names[String(entry)] ?? String(entry);
  } else if (Array.isArray(param.options) && param.options.length > 0) {
    const options = param.options;
    labelOf = (entry) => {
      const option = options.find((o) => String(o.value) === String(entry));
      return option ? String(option.label) : String(entry);
    };
  }
  if (Array.isArray(value)) return value.map((entry) => (labelOf ? labelOf(entry) : String(entry))).join(', ');
  return labelOf ? labelOf(value) : value;
}

/**
 * The roots a bulk `confirmText` is filled over: the protocol's closed scope
 * (`bulkConfirmTemplateRoots`), `count` bound to the run's record count and
 * each param bound to its display value. `count` is written last, so it wins
 * over a param of that name, as the protocol declares.
 */
export function bulkConfirmTemplateScope(scope: BulkConfirmScope): Record<string, unknown> {
  const params = scope.params ?? [];
  const roots: Record<string, unknown> = {};
  for (const root of bulkConfirmTemplateRoots({ params })) {
    if (root === BULK_CONFIRM_COUNT_ROOT) continue;
    const param = params.find((p) => p.name === root);
    if (param) roots[root] = bulkConfirmParamDisplayValue(param, scope.values?.[root], scope.lookupLabels);
  }
  roots[BULK_CONFIRM_COUNT_ROOT] = scope.count;
  return roots;
}

/**
 * The confirm sentence a bulk action's `confirmText` shows, its `{{ }}` holes
 * filled over the bulk-confirm scope the protocol declares
 * (`bulkConfirmTemplateRoots`, ruling B on objectstack#24798): `{{ count }}` is
 * the number of records the run covers, and `{{ <param name> }}` that param's
 * display value ({@link bulkConfirmParamDisplayValue}). Returns `undefined` exactly when
 * {@link bulkConfirmTextSource} does, so the caller keeps its default
 * sentence.
 *
 * Filled through core's `fillTemplateHoles`, the template engine the flow
 * notifications and the single-record `confirmText` render with, so the
 * engine's whitelisted formatters apply (`{{ count | number }}`) and no hole
 * holds logic. A sentence without a `{{ }}` hole is shown as written.
 *
 * `locale` is the viewer's display locale, the BCP-47 tag the dialog reads
 * from `useDisplayLocale()`; the formatters (`currency`, `number`, `date`)
 * render in it (objectstack#26307). It goes to `fillTemplateHoles`'s own
 * locale channel, apart from the roots, so a param named `locale` stays a
 * value the sentence prints. ⛔ No second resolution of it here: absent, the
 * engine formats in `en-US`.
 *
 * `currency` is the tenant default currency (`useLocalization().currency`)
 * that a `{{ amount | currency }}` hole with no argument formats in, on
 * `fillTemplateHoles`'s own currency channel. Absent, such a sentence is shown
 * as written.
 */
export function bulkConfirmText(
  confirmText: BulkActionDef['confirmText'] | null | undefined,
  scope: BulkConfirmScope,
  locale?: string,
  currency?: string,
): string | undefined {
  const source = bulkConfirmTextSource(confirmText);
  if (source === undefined || !hasTemplateHoles(source)) return source;
  return fillTemplateHoles(source, bulkConfirmTemplateScope(scope), locale, currency);
}
