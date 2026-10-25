/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Retirement pin — the dashboard-ROOT `title` read arm (objectui#7509).
 *
 * Maintainer ruling 2026-09-04 (decision batch #29, option C): the five root
 * `title` read arms retire together under ADR-0049, `label` is the only header
 * source. This file pins THIS surface's arm — the `<h2>` that used to read
 * `schema.title || pickLocalized(schema.label, language) || 'Dashboard'`.
 *
 * This surface is the reason the ruling refused option B (retire the console's
 * arm alone): `dashboard-grid` was then separately registered as an SDUI
 * component (retired by objectui#10859 batch 8),
 * so leaving its arm would have shown ONE stored document under two different
 * headers depending on which surface opened it.
 *
 * Shaped like the #5830 / #5852 retirements — what a document carrying the
 * retired key RENDERS, not that it compiles.
 *
 * ⛔ Four of this file's five `.title` occurrences are widget-level
 * (`DashboardWidget.title`, the spec's `I18nLabel`) and are NOT retired; the
 * last two cases are their control.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import type { DashboardComponentSchema } from '@object-ui/types';
import { DashboardGridLayout } from '../DashboardGridLayout';

// The grid renders each widget through `SchemaRenderer`; this suite is about
// the chrome around it, so the inner renderer is stubbed (same treatment as
// `DashboardGridLayout.i18nTitle.test.tsx`).
vi.mock('@object-ui/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/react')>();
  return {
    ...actual,
    SchemaRenderer: () => <div data-testid="widget-body" />,
  };
});

afterEach(cleanup);

const LEGACY_TITLE = 'Legacy Title From A Stored Document';
const CANONICAL_LABEL = 'Sales Overview';

const dash = (root: Record<string, unknown>): DashboardComponentSchema =>
  ({ type: 'dashboard', name: 'sales', widgets: [], ...root }) as unknown as DashboardComponentSchema;

/** The dashboard heading — the widget cards use `CardTitle`, never `h2`. */
const heading = (container: HTMLElement) => container.querySelector('h2');

describe('DashboardGridLayout — the root `title` read arm is retired (objectui#7509)', () => {
  it('renders the `label` header for a document carrying BOTH, and never the `title`', () => {
    const { container } = render(
      <DashboardGridLayout schema={dash({ label: CANONICAL_LABEL, title: LEGACY_TITLE })} />,
    );

    expect(heading(container)!.textContent).toBe(CANONICAL_LABEL);
    expect(screen.queryByText(LEGACY_TITLE)).toBeNull();
  });

  it('falls through to the generic heading for a document carrying ONLY the retired key', () => {
    // This surface has no `name` arm — its last resort is the literal
    // `'Dashboard'`, and the retirement does not change that backstop.
    const { container } = render(<DashboardGridLayout schema={dash({ title: LEGACY_TITLE })} />);

    expect(heading(container)!.textContent).toBe('Dashboard');
    expect(screen.queryByText(LEGACY_TITLE)).toBeNull();
  });

  it('CONTROL — a document with only `label` renders it, so the two assertions above are not vacuous', () => {
    const { container } = render(<DashboardGridLayout schema={dash({ label: CANONICAL_LABEL })} />);

    expect(heading(container)!.textContent).toBe(CANONICAL_LABEL);
  });

  it('CONTROL — an inline per-locale `label` still resolves through `pickLocalized`', () => {
    // The resolver the retired arm used to short-circuit whenever a legacy
    // `title` was present: with `title` read first, a document carrying both
    // never exercised `pickLocalized` at all (objectui#4580).
    const { container } = render(
      <DashboardGridLayout
        schema={dash({ label: { en: 'Pipeline', 'zh-CN': '销售漏斗' }, title: LEGACY_TITLE })}
      />,
    );

    expect(heading(container)!.textContent).toBe('Pipeline');
    expect(container.innerHTML).not.toContain('[object Object]');
  });

  it('CONTROL — widget-level `title` is a different DECLARED key and still renders', () => {
    render(
      <DashboardGridLayout
        schema={dash({
          label: CANONICAL_LABEL,
          title: LEGACY_TITLE,
          widgets: [{ id: 'w1', type: 'bar', title: 'Revenue', layout: { x: 0, y: 0, w: 6, h: 4 } }],
        })}
      />,
    );

    const widgetHeading = screen.getByText('Revenue');
    expect(widgetHeading).toBeTruthy();
    expect(widgetHeading.getAttribute('title')).toBe('Revenue');
  });
});
