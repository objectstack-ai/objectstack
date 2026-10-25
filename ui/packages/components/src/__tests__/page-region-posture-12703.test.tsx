/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * A page region tells its blocks their posture, measured against the page
 * (objectui#12703): narrower than half the page ⇒ `compact`, otherwise `full`,
 * and `null` wherever the width is not known.
 *
 * A DOM test has no layout, so the widths come from a stand-in
 * `ResizeObserver` that reports a width per observed element: the page body
 * (the element `[data-page-type] > div`) and each region's grid
 * (`[data-region]`). A probe block registered here prints the posture it reads.
 */

import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import { ActionProvider, SchemaRenderer } from '@object-ui/react';
// Module scope, not a hook: registers PageRenderer (AGENTS.md §测试纪律).
import '../renderers';
import { pageRegionPostureFor, usePageRegionPosture } from '../renderers/layout/page-region-posture';

const PROBE = 'test:region-posture-probe-12703';

function PostureProbe({ schema }: { schema: { id?: string } }) {
  const posture = usePageRegionPosture();
  return <span data-testid={`posture-${schema.id}`}>{posture ?? 'unknown'}</span>;
}
ComponentRegistry.register(PROBE, PostureProbe as never, { namespace: 'test', label: 'Posture probe' });

const probe = (id: string) => ({ type: PROBE, id });

/** Installs a `ResizeObserver` that reports `widths` for the page body and each region. */
function stubWidths(widths: { page: number; regions: Record<string, number> }) {
  class WidthReportingObserver {
    constructor(private readonly callback: ResizeObserverCallback) {}
    observe(target: Element) {
      const region = target.getAttribute('data-region');
      const width = region != null
        ? widths.regions[region]
        : target.matches('[data-page-type] > div') ? widths.page : undefined;
      if (width === undefined) return;
      this.callback([{ target, contentRect: { width } } as unknown as ResizeObserverEntry], this as never);
    }
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal('ResizeObserver', WidthReportingObserver);
}

function renderPage(schema: unknown) {
  return render(
    <ActionProvider>
      <SchemaRenderer schema={schema as never} />
    </ActionProvider>,
  );
}

const threeColumnPage = {
  type: 'home',
  template: 'three-column',
  regions: [
    { name: 'main', components: [probe('in-main')] },
    { name: 'aside', width: 'medium', components: [probe('in-aside')] },
  ],
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('pageRegionPostureFor (objectui#12703)', () => {
  it('is compact below half the page, full at half or wider', () => {
    // 1200 wide: "half" is (1200 - 24) / 2 = 588, the width of each cell of a
    // half-and-half row.
    expect(pageRegionPostureFor(320, 1200)).toBe('compact');
    expect(pageRegionPostureFor(587, 1200)).toBe('compact');
    expect(pageRegionPostureFor(588, 1200)).toBe('full');
    expect(pageRegionPostureFor(856, 1200)).toBe('full');
    expect(pageRegionPostureFor(1200, 1200)).toBe('full');
  });

  it('is unknown when either width is unknown', () => {
    expect(pageRegionPostureFor(0, 1200)).toBeNull();
    expect(pageRegionPostureFor(320, 0)).toBeNull();
    expect(pageRegionPostureFor(Number.NaN, 1200)).toBeNull();
  });
});

describe('a page region publishes its measured posture to its blocks (objectui#12703)', () => {
  it('the aside beside main is compact and main is full', async () => {
    stubWidths({ page: 1200, regions: { main: 856, aside: 320 } });
    renderPage(threeColumnPage);
    await waitFor(() => expect(screen.getByTestId('posture-in-aside').textContent).toBe('compact'));
    expect(screen.getByTestId('posture-in-main').textContent).toBe('full');
  });

  it('a stacked aside (as wide as the page) is full', async () => {
    stubWidths({ page: 700, regions: { main: 700, aside: 700 } });
    renderPage(threeColumnPage);
    await waitFor(() => expect(screen.getByTestId('posture-in-aside').textContent).toBe('full'));
  });

  it('a block nested in a container inside the region reads the region posture', async () => {
    stubWidths({ page: 1200, regions: { main: 856, aside: 320 } });
    renderPage({
      ...threeColumnPage,
      regions: [
        threeColumnPage.regions[0],
        { name: 'aside', components: [{ type: 'page:card', id: 'card', properties: { title: 'Card', children: [probe('in-card')] } }] },
      ],
    });
    await waitFor(() => expect(screen.getByTestId('posture-in-card').textContent).toBe('compact'));
  });

  it('no measurement (no ResizeObserver, no layout) leaves the posture unknown', () => {
    vi.stubGlobal('ResizeObserver', undefined);
    renderPage(threeColumnPage);
    expect(screen.getByTestId('posture-in-aside').textContent).toBe('unknown');
    expect(screen.getByTestId('posture-in-main').textContent).toBe('unknown');
  });

  it('a page with no regions gives its blocks no posture', () => {
    stubWidths({ page: 1200, regions: {} });
    renderPage({ type: 'page', children: [probe('flat')] });
    expect(screen.getByTestId('posture-flat').textContent).toBe('unknown');
  });

  it('a block outside any page reads no posture', () => {
    render(<SchemaRenderer schema={probe('bare') as never} />);
    expect(screen.getByTestId('posture-bare').textContent).toBe('unknown');
  });
});
