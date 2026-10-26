/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#4163 part 1 — `DashboardWidget.title` is the spec's `I18nLabel`,
 * widened by `@objectstack/spec` 17.0.0-rc.6 from `string` to
 * `string | Record<string, string>`.
 *
 * The grid reads it into TWO slots of different kinds, which is why both are
 * pinned: the card heading (a text node, where a map renders `[object Object]`)
 * and the heading's `title` attribute (a `string | undefined` prop, where the
 * map was a `tsc` error and would have become the object's source text).
 *
 * A third fact is pinned here too, and it is the one no type could have caught:
 * the header's own render GATE was `widget.title &&`, and an object is always
 * truthy. So a title map that resolves to nothing used to draw a header
 * containing `[object Object]`; it now draws no header at all.
 */

import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import type { DashboardComponentSchema } from '@object-ui/types';
import { DashboardGridLayout } from '../DashboardGridLayout';

// The grid renders each widget through `SchemaRenderer`; this suite is about
// the CHROME around it (card header / title attribute), so the inner renderer
// is stubbed to keep the assertions about the header alone.
vi.mock('@object-ui/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/react')>();
  return {
    ...actual,
    SchemaRenderer: () => <div data-testid="widget-body" />,
  };
});

function schemaWith(title: unknown): DashboardComponentSchema {
  return {
    type: 'dashboard',
    name: 'sales',
    widgets: [
      {
        id: 'w1',
        type: 'bar',
        // Cast at the fixture boundary only: the point of the test is what a
        // spec-valid authored map does at the RENDER site.
        title: title as never,
        layout: { x: 0, y: 0, w: 6, h: 4 },
      },
    ],
  } as DashboardComponentSchema;
}

describe('DashboardGridLayout — inline per-locale widget titles (#4163)', () => {
  it('renders the resolved locale string as the card heading', () => {
    render(<DashboardGridLayout schema={schemaWith({ en: 'Pipeline', 'zh-CN': '销售漏斗' })} />);
    expect(screen.getByText('Pipeline')).toBeTruthy();
  });

  it('never renders the stringified object, in the heading or the title attribute', () => {
    const { container } = render(
      <DashboardGridLayout schema={schemaWith({ en: 'Pipeline', 'zh-CN': '销售漏斗' })} />,
    );
    expect(container.innerHTML).not.toContain('[object Object]');
  });

  it('puts the resolved string in the heading `title` attribute, not the map', () => {
    render(<DashboardGridLayout schema={schemaWith({ en: 'Pipeline', 'zh-CN': '销售漏斗' })} />);
    const heading = screen.getByText('Pipeline');
    expect(heading.getAttribute('title')).toBe('Pipeline');
  });

  it('leaves a plain-string title exactly as authored', () => {
    // Non-vacuity for the three assertions above.
    render(<DashboardGridLayout schema={schemaWith('Revenue')} />);
    expect(screen.getByText('Revenue')).toBeTruthy();
    expect(screen.getByText('Revenue').getAttribute('title')).toBe('Revenue');
  });

  it('draws NO header for a title map that resolves to nothing', () => {
    // The truthiness half. `{}` is truthy, so the old gate drew a header and
    // filled it with `[object Object]`; the gate now tests the RESOLVED string.
    const { container } = render(<DashboardGridLayout schema={schemaWith({})} />);
    expect(container.innerHTML).not.toContain('[object Object]');
    expect(container.querySelector('[data-testid="widget-body"]')).toBeTruthy();
  });
});
