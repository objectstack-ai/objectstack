/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A bare `columns` of four or more keeps two tiles across on a phone
 * (objectstack#27355, row 11).
 *
 * A home page's KPI strip is a layout `grid` with a bare count (`columns: 4`)
 * over `object-metric` tiles. The bare count's mobile-first ramp collapsed
 * every N-across row to one column below `sm`, so four KPI tiles took a row
 * each and filled a phone's first screen. A row of four or more holds tiles
 * sized for a quarter of the row or less, so the ramp now keeps two across on
 * a phone, as the dashboard does for its metric tiles.
 *
 * The emitted class string is the renderer's whole output on this path (it
 * reads no viewport), so each case compares it whole — see
 * `grid-breakpoint-columns-7097.test.tsx` for why that observation is sound.
 *
 * Module-scope import of the renderers, not `beforeAll` (AGENTS.md §测试纪律).
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import '../renderers';
import { SchemaRenderer } from '@object-ui/react';

const classOf = (schema: unknown): string => {
  const { container } = render(<SchemaRenderer schema={schema as never} />);
  const el = container.firstElementChild as HTMLElement | null;
  expect(el, 'the grid rendered no element').not.toBeNull();
  return el!.className;
};

describe('a bare column count of four or more keeps two tiles across on a phone (objectstack#27355)', () => {
  it('four across: two on a phone, four from md', () => {
    expect(classOf({ type: 'grid', columns: 4, gap: 4 })).toBe('grid grid-cols-2 md:grid-cols-4 gap-4');
  });

  it.each([5, 6, 8, 12])('%i across: two on a phone, the authored count from md', (n) => {
    expect(classOf({ type: 'grid', columns: n, gap: 4 })).toBe(`grid grid-cols-2 md:grid-cols-${n} gap-4`);
  });

  it('control: two and three across still stack on a phone and pair from sm', () => {
    expect(classOf({ type: 'grid', columns: 2, gap: 4 })).toBe('grid grid-cols-1 sm:grid-cols-2 md:grid-cols-2 gap-4');
    expect(classOf({ type: 'grid', columns: 3, gap: 4 })).toBe('grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4');
  });

  it('control: one across is one across everywhere', () => {
    expect(classOf({ type: 'grid', columns: 1, gap: 4 })).toBe('grid grid-cols-1 gap-4');
  });

  it('control: an authored breakpoint object is drawn as written, at four across too', () => {
    expect(classOf({ type: 'grid', columns: { xs: 1, md: 2, lg: 4 }, gap: 4 })).toBe(
      'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4',
    );
    expect(classOf({ type: 'grid', columns: { xs: 1, md: 4 }, gap: 4 })).toBe('grid grid-cols-1 md:grid-cols-4 gap-4');
    expect(classOf({ type: 'grid', columns: { md: 4 }, gap: 4 })).toBe('grid grid-cols-1 md:grid-cols-4 gap-4');
  });
});
