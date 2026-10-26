// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The page designer's block card shows the span the block takes in its
 * region's 12-column grid (objectui#12624), read-only, from the page
 * renderer's own table in `@object-ui/components` — so the card and the page
 * cannot disagree.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import { PAGE_BLOCK_SPANS } from '@object-ui/components';
// Module scope, not a hook: the registrations the span table names
// (AGENTS.md §测试纪律).
import '@object-ui/plugin-dashboard';
import '@object-ui/plugin-charts';
import { PageBlockCanvas } from './PageBlockCanvas';

afterEach(cleanup);

function spanBadges(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('[data-block-span]')).map(
    (el) => el.getAttribute('data-block-span') ?? '',
  );
}

describe('PageBlockCanvas — the block card shows its derived span (objectui#12624)', () => {
  it('a metric tile reads 3/12, a chart 6/12 and a block the table does not name 12/12', () => {
    const { container } = render(
      <PageBlockCanvas
        draft={{
          name: 'home',
          type: 'home',
          regions: [
            {
              name: 'main',
              components: [
                { type: 'object-metric', id: 'revenue' },
                { type: 'object-chart', id: 'trend' },
                { type: 'element:text', id: 'note' },
              ],
            },
          ],
        }}
      />,
    );
    expect(spanBadges(container)).toEqual(['3', '6', '12']);
    const badge = container.querySelector('[data-block-span="3"]')!;
    expect(badge.textContent).toBe('3/12');
    // Read-only: the badge is not a control.
    expect(badge.closest('input, select, [role="spinbutton"]')).toBeNull();
  });

  it('a block in a rail region reads 12/12, as the page draws it', () => {
    const { container } = render(
      <PageBlockCanvas
        draft={{
          name: 'home',
          type: 'home',
          template: 'three-column',
          regions: [
            { name: 'sidebar', components: [{ type: 'object-metric', id: 'a' }] },
            { name: 'main', components: [{ type: 'object-metric', id: 'b' }] },
          ],
        }}
      />,
    );
    expect(spanBadges(container)).toEqual(['12', '3']);
  });

  it('a `children` page stacks its blocks, so its cards show no span', () => {
    const { container } = render(
      <PageBlockCanvas draft={{ name: 'home', type: 'home', children: [{ type: 'object-metric', id: 'a' }] }} />,
    );
    expect(container.querySelector('[data-block-span]')).toBeNull();
  });

  it('the children of a page:card show the span the card lays them out at', () => {
    const { container } = render(
      <PageBlockCanvas
        draft={{
          name: 'home',
          type: 'home',
          regions: [
            {
              name: 'main',
              components: [
                {
                  type: 'page:card',
                  id: 'kpis',
                  properties: {
                    title: 'Key Performance Indicators',
                    children: [
                      { type: 'object-metric', id: 'a' },
                      { type: 'object-metric', id: 'b' },
                      { type: 'element:text', id: 'c' },
                    ],
                  },
                },
              ],
            },
          ],
        }}
      />,
    );
    // The card itself (12), then its three children.
    expect(spanBadges(container)).toEqual(['12', '3', '3', '12']);
  });

  it('every type the span table names is a registered block type', () => {
    const unregistered = [...PAGE_BLOCK_SPANS.keys()].filter(
      (type) => !ComponentRegistry.has(type) && !ComponentRegistry.hasLazy(type),
    );
    expect(unregistered).toEqual([]);
  });
});
