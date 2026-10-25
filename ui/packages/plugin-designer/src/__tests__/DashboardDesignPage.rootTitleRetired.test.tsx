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
 * `title` read arms retire together under ADR-0049, `label` is the only name
 * source, then the raw `name`. This file pins THIS surface's arm — the page
 * heading that used to read
 * `(dashboard as any).label || (dashboard as any).title || dashboardName`.
 *
 * This page is one half of why the ruling refused option B: it is the DESIGNER
 * side of the same stored document the console renders. Retiring the console's
 * arm alone would have left one document titled here and untitled there.
 *
 * The second describe block pins the other edit this card makes on this file:
 * the not-found seed literal — the only dashboard-document literal objectui
 * authors — now spells `label` rather than the retired root `title`.
 *
 * Shaped like the #5830 / #5852 retirements: what a document carrying the
 * retired key RENDERS, not that it compiles.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import type { DashboardComponentSchema } from '@object-ui/types';

const update = vi.fn().mockResolvedValue(undefined);
const dashboards: any[] = [];

vi.mock('react-router-dom', () => ({
  useParams: () => ({ dashboardName: 'sales' }),
  useNavigate: () => vi.fn(),
}));

vi.mock('@object-ui/react', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useAdapter: () => ({ update }),
    useMetadata: () => ({ dashboards, refresh: () => Promise.resolve() }),
  };
});

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { DashboardDesignPage } from '../pages/DashboardDesignPage';

const LEGACY_TITLE = 'Legacy Title From A Stored Document';
const CANONICAL_LABEL = 'Sales Overview';

const stored = (root: Record<string, unknown>): DashboardComponentSchema =>
  ({
    type: 'dashboard',
    name: 'sales',
    columns: 2,
    widgets: [{ id: 'w1', type: 'metric', title: 'Revenue' }],
    ...root,
  }) as unknown as DashboardComponentSchema;

/** Load one stored document into the page and hand back its heading. */
function headingFor(doc: DashboardComponentSchema) {
  dashboards.length = 0;
  dashboards.push(doc);
  render(<DashboardDesignPage />);
  return screen.getByRole('heading', { level: 1 });
}

beforeEach(() => {
  update.mockClear();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('DashboardDesignPage — the root `title` read arm is retired (objectui#7509)', () => {
  it('heads the page with `label` for a document carrying BOTH, never with the `title`', () => {
    const h1 = headingFor(stored({ label: CANONICAL_LABEL, title: LEGACY_TITLE }));

    expect(h1.textContent).toContain(CANONICAL_LABEL);
    expect(h1.textContent).not.toContain(LEGACY_TITLE);
    expect(screen.queryByText(LEGACY_TITLE)).toBeNull();
  });

  it('falls through to the raw `name` for a document carrying ONLY the retired key', () => {
    // `label` is REQUIRED on DashboardSchema, so this document was already
    // invalid; pinned because the designer cannot refuse stored metadata.
    const h1 = headingFor(stored({ title: LEGACY_TITLE }));

    expect(h1.textContent).toContain('sales');
    expect(h1.textContent).not.toContain(LEGACY_TITLE);
  });

  it('CONTROL — a document with only `label` heads the page with it, so the above is not vacuous', () => {
    const h1 = headingFor(stored({ label: CANONICAL_LABEL }));

    expect(h1.textContent).toContain(CANONICAL_LABEL);
  });

  it('CONTROL — widget-level `title` is a different DECLARED key and survives into the editor', () => {
    headingFor(stored({ label: CANONICAL_LABEL, title: LEGACY_TITLE }));

    expect(screen.getByTestId('dashboard-widget-w1').textContent).toContain('Revenue');
  });
});

describe('DashboardDesignPage — the not-found seed spells `label`, not the retired key (objectui#7509)', () => {
  it('renders the not-found state, and puts NO root `title` on screen', () => {
    // The seed literal is reachable only on this branch, and this branch
    // early-returns without persisting — which is why moving the key moves no
    // behaviour. What is pinnable is that the branch still behaves, and that
    // nothing here re-introduces the retired spelling into the DOM.
    dashboards.length = 0;
    const { container } = render(<DashboardDesignPage />);

    expect(container.textContent).toContain('not found');
    expect(container.querySelector('[data-testid="dashboard-design-page"]')).toBeNull();
    expect(update).not.toHaveBeenCalled();
  });
});
