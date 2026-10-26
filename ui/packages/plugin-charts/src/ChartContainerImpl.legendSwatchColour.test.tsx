/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The legend swatch carries the series colour the way AGENTS.md's styling
 * carve-out prescribes (objectui#10021).
 *
 * A series colour is author-declared, so it may reach the DOM through
 * `style={{}}` — but only as a CSS custom property that a STATIC Tailwind
 * utility consumes, never as a colour-bearing property (`backgroundColor`)
 * written inline. The swatch used to write `backgroundColor: item.color`; the
 * tooltip indicator in the same file already used the compliant shape
 * (`bg-(--color-bg)` + `"--color-bg"`), and the swatch now copies it.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';

// ResponsiveContainer measures 0x0 under happy-dom; a passthrough keeps the
// legend content (rendered as a plain child) in the tree.
vi.mock('recharts', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('recharts');
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactElement }) => children,
  };
});

import { ChartContainer, ChartLegendContent } from './ChartContainerImpl';

afterEach(() => {
  cleanup();
});

function renderSwatch(color: string): HTMLElement {
  const { container } = render(
    <ChartContainer config={{}}>
      <ChartLegendContent
        payload={[{ value: 'Revenue', dataKey: 'revenue', type: 'square', color }]}
      />
    </ChartContainer>,
  );
  const swatch = container.querySelector<HTMLElement>('.rounded-\\[2px\\]');
  expect(swatch).not.toBeNull();
  return swatch!;
}

describe('ChartLegendContent swatch colour (objectui#10021)', () => {
  it('writes no colour-bearing property inline', () => {
    const swatch = renderSwatch('#ff0000');
    expect(swatch.style.backgroundColor).toBe('');
    expect(swatch.style.color).toBe('');
    expect(swatch.getAttribute('style') ?? '').not.toMatch(/background|(^|;)\s*color\s*:/i);
  });

  it('publishes the author colour as a custom property a static utility consumes', () => {
    const swatch = renderSwatch('#ff0000');
    expect(swatch.style.getPropertyValue('--color-bg')).toBe('#ff0000');
    expect(swatch.classList.contains('bg-(--color-bg)')).toBe(true);
  });
});
