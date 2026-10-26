/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The footer's `number` arm takes its width from the protocol, and a column
 * with NO fixed width rounds a computed result to its inputs (objectui#9843,
 * carrying objectstack#19628's ruling A′ to this footer).
 *
 * ## What moved
 *
 * A `number` column used to fall through to this file's own widths: `avg` at
 * most two decimals, every other aggregate `Intl`'s default of three. Neither
 * read the column's `scale`, so a declared `scale: 2` summed to `3` under cells
 * reading `1.50`, and a `min` over `1.2345` read `1.235` — a value no row held.
 *
 * The ruling: `resolveFieldScale` is the width. A declared `scale` is fixed; a
 * `number` declaring none has NO fixed width (the protocol deliberately gives
 * `number` no absent-width row), and a computed result is rounded to the widest
 * decimal count among the values that entered it — derived from the data,
 * never a constant.
 *
 * ## What did not move — asserted alongside
 *
 * A column with no `type` keeps the arms it always had: the ruling is about a
 * `number` FIELD, and a column the footer knows nothing about is not one.
 */
import { describe, it, expect } from 'vitest';
import * as React from 'react';
import { renderHook } from '@testing-library/react';
import { I18nProvider, LocalizationProvider } from '@object-ui/i18n';
import type { ListColumn } from '@object-ui/types';
import { useColumnSummary } from '../useColumnSummary';

function wrapper(locale: string) {
  return ({ children }: { children: React.ReactNode }) => (
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }}>
      <LocalizationProvider value={{ locale }}>{children}</LocalizationProvider>
    </I18nProvider>
  );
}

/**
 * `fieldDef` is the FIELD's definition, handed to the hook as `fieldMetadata`:
 * objectui#11588 retired the column-level read of `scale`, so the column names
 * only its `field` and `summary`.
 */
function footer(
  summary: string,
  values: unknown[],
  fieldDef: Record<string, unknown> = { type: 'number' },
  locale = 'en',
): string {
  const cols = [{ field: 'n', summary }] as unknown as ListColumn[];
  const { result } = renderHook(() => useColumnSummary(cols, values.map((n) => ({ n })), { n: fieldDef } as never), {
    wrapper: wrapper(locale),
  });
  return result.current.summaries.get('n')?.label ?? '';
}

describe('a `number` column with no declared `scale` rounds to its inputs (objectui#9843)', () => {
  it('an average of whole numbers is a whole number', () => {
    // Every input carries 0 decimal places, so the result does too.
    expect(footer('avg', [1, 2, 2])).toBe('Avg: 2');
    expect(footer('avg', [1, 2, 2])).not.toBe('Avg: 1.67');
  });

  it('keeps every digit an input carried', () => {
    // `min` returns an input verbatim; the old `Intl` default of three cut it.
    expect(footer('min', [1.2345, 2])).toBe('Min: 1.2345');
    expect(footer('min', [1.2345, 2])).not.toBe('Min: 1.235');
    expect(footer('sum', [1.25, 2.5])).toBe('Sum: 3.75');
  });

  it('drops only digits no input had — binary residue included', () => {
    // 0.1 + 0.2 is 0.30000000000000004 in binary floating point.
    expect(footer('sum', [0.1, 0.2])).toBe('Sum: 0.3');
  });

  it('reads an input spelled in exponent form by its real width', () => {
    // `String(1.5e-7)` is `1.5e-7`: eight decimal places, not one.
    expect(footer('max', [1.5e-7, 0])).toBe(`Max: ${(1.5e-7).toLocaleString('en', { maximumFractionDigits: 8 })}`);
  });

  it('parses a numeric-string cell for its width, as it does for its value', () => {
    expect(footer('sum', ['1.5', 2])).toBe('Sum: 3.5');
  });
});

describe('a declared `scale` is a fixed width on a `number` column (objectui#9843)', () => {
  it('pads to the declared width', () => {
    expect(footer('sum', [1.5], { type: 'number', scale: 2 })).toBe('Sum: 1.50');
    expect(footer('avg', [1, 2, 2], { type: 'number', scale: 2 })).toBe('Avg: 1.67');
  });

  it('rounds to the declared width', () => {
    expect(footer('sum', [1.2345], { type: 'number', scale: 1 })).toBe('Sum: 1.2');
  });

  it('honours `scale: 0`, a real declaration', () => {
    expect(footer('avg', [1, 2], { type: 'number', scale: 0 })).toBe('Avg: 2');
  });

  it('formats the fixed width in the display locale', () => {
    expect(footer('sum', [1234.5], { type: 'number', scale: 2 }, 'de-DE')).toBe('Sum: 1.234,50');
  });

  it('treats a malformed `scale` as no declaration', () => {
    // `"2"` never passed `FieldSchema`; the resolver's door refuses it, so the
    // column has no fixed width and rounds to its inputs.
    expect(footer('sum', [1.5], { type: 'number', scale: '2' })).toBe('Sum: 1.5');
  });
});

describe('controls — columns this card does not move', () => {
  it('a column with no `type` keeps its old arms', () => {
    expect(footer('avg', [1, 2, 2], {})).toBe('Avg: 1.67');
    expect(footer('min', [1.2345, 2], {})).toBe('Min: 1.235');
  });

  it('a count on a `number` column stays a plain cardinality', () => {
    expect(footer('count', [1.25, 2.5, 3])).toBe('Count: 3');
  });
});
