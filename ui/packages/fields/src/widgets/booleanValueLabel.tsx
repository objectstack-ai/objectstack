/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The WORD a boolean value is drawn with when it is shown as text rather than
 * as a control (objectui#11689).
 *
 * The read-only surfaces that draw a boolean as a word — `BooleanField`'s
 * readonly branch, a `boolean`-returning `FormulaField`, the lookup column's
 * plain-text fallback (`renderLookupColumnValue`) and the record-detail
 * highlights chip in `@object-ui/plugin-detail` — each spelled `'Yes'` /
 * `'No'` in code, so a record read in Chinese showed an English word beside a
 * translated label. They now read the word here, so none keeps a literal of
 * its own and no two can disagree in a locale.
 *
 * ## Which key pair, and why that one
 *
 * The packs carry more than one `yes` row. This reads `common.yes` /
 * `common.no`, the pair whose meaning is "the value of a boolean":
 *
 *   - its existing reader is app-shell's audit-history display, which draws a
 *     boolean field's old and new value with it — the same job as here;
 *   - `grid.yes` / `grid.no` belong to the grid's own toolbar bundle (the
 *     group header and the bulk-action dialog of `ObjectGrid`);
 *   - `lookup.yes` is the record picker's filter-checkbox caption and has no
 *     `no` half.
 *
 * No key was added: a second pair saying the same thing would be one more
 * place for a locale to drift.
 *
 * ## Without a provider
 *
 * `useFieldTranslation`'s defaults table carries both rows with the `en`
 * pack's values, so a field rendered outside an `I18nProvider` (an embed, a
 * standalone SDUI node) still says `Yes` / `No`.
 */
import React from 'react';
import { useFieldTranslation } from './useFieldTranslation.js';

/** Draws a boolean value as the current locale's word for it. */
export type BooleanValueLabel = (value: boolean) => string;

/**
 * The current locale's word for a boolean value: `common.yes` for `true`,
 * `common.no` for `false`.
 *
 * The caller decides WHICH values are booleans; this only names them. Call it
 * once at the top of a component and use the returned function in the render.
 */
export function useBooleanValueLabel(): BooleanValueLabel {
  const { t } = useFieldTranslation();
  return (value: boolean) => t(value ? 'common.yes' : 'common.no');
}

/**
 * The same word as a node, for a caller that is a plain function and cannot
 * call a hook itself (`renderLookupColumnValue`).
 */
export function BooleanValueText({ value }: { value: boolean }): React.ReactElement {
  const label = useBooleanValueLabel();
  return <>{label(value)}</>;
}
