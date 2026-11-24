/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A declared `gap: 0` draws no gap (objectstack#36912).
 *
 * The spec admits zero (`gap: z.number().int().min(0).optional()`,
 * `packages/spec/src/ui/dashboard.zod.ts`), so only an ABSENT `gap` takes the
 * default of 4. The renderer used to read `schema.gap || 4`, which sent a
 * declared zero to the default too: widgets an author wanted flush were drawn
 * 1rem apart. These cases read the grid root's inline `gap` style by
 * rendering, with the absent-`gap` control beside the zero case so a renderer
 * that ignored `gap` altogether is red as well.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import type { DashboardComponentSchema } from '@object-ui/types';
import { DashboardRenderer } from '../DashboardRenderer';

afterEach(cleanup);

function dashboard(extra: Record<string, unknown> = {}): DashboardComponentSchema {
  return {
    type: 'dashboard',
    name: 'ops',
    label: 'Operations',
    columns: 12,
    widgets: [],
    ...extra,
  } as unknown as DashboardComponentSchema;
}

/** The inline `gap` style on the dashboard's grid root. */
function rootGap(schema: DashboardComponentSchema): string {
  const { container } = render(<DashboardRenderer schema={schema} />);
  const root = container.firstElementChild as HTMLElement | null;
  if (!root) throw new Error('the dashboard rendered no root element');
  return root.style.gap;
}

describe('DashboardRenderer declared gap (objectstack#36912)', () => {
  it('draws a declared gap: 0 as no gap', () => {
    expect(rootGap(dashboard({ gap: 0 }))).toBe('0rem');
  });

  it('draws the default gap (4 = 1rem) only when gap is absent', () => {
    expect(rootGap(dashboard())).toBe('1rem');
  });

  it('draws a declared non-zero gap in 0.25rem steps', () => {
    expect(rootGap(dashboard({ gap: 2 }))).toBe('0.5rem');
  });
});
