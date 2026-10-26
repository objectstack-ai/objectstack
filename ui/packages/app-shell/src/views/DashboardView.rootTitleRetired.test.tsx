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
 * `title` read arms retire together under ADR-0049, and `label` — REQUIRED on
 * `@objectstack/spec`'s `DashboardSchema` — becomes the only header source,
 * then the raw `name`. This file pins THIS view's arm; the four siblings carry
 * their own, in the same shape.
 *
 * Shaped like the #5830 / #5852 retirements: the assertion is what a document
 * carrying the retired key RENDERS, not that the code still compiles. A
 * compile-only pin would have passed with the arm still in place.
 *
 * Why the retired key can still arrive at all: the spec refuses root `title` BY
 * NAME (`unrecognized_keys(title)` at the document root), so the save route
 * answers `422 INVALID_METADATA` and no AUTHORED document can acquire it. What
 * retired is compatibility with documents STORED before the refusal existed —
 * a renderer cannot refuse to receive stored metadata, so it is pinned rather
 * than assumed away.
 *
 * ⛔ Widget-level `widget.title` is a DIFFERENT, DECLARED key
 * (`DashboardWidget.title`, the spec's `I18nLabel`) and is NOT retired. The
 * last case is the negative control for exactly that: root and widget arms are
 * told apart by RECEIVER, never by grep, and a sweep that confused them would
 * delete live contract-declared behaviour.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { MetadataCtx } from '@object-ui/react';

// The renderer is stubbed: the header <h1> under test is rendered by the VIEW,
// and capturing the props also proves the widgets (with their own `title`)
// reach the renderer untouched.
const cap = vi.hoisted(() => ({ props: null as any }));
vi.mock('@object-ui/plugin-dashboard', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  DashboardRenderer: (props: any) => {
    cap.props = props;
    return null;
  },
}));

const meta = vi.hoisted(() => ({ value: null as any }));
vi.mock('../providers/MetadataProvider', () => ({ useMetadata: () => meta.value }));

vi.mock('react-router-dom', () => ({
  useParams: () => ({ dashboardName: 'sales_overview' }),
  useNavigate: () => vi.fn(),
  useLocation: () => ({ pathname: '/dashboards/sales_overview', search: '' }),
}));

vi.mock('./useOpenRecordList', () => ({ useOpenRecordList: () => vi.fn() }));
vi.mock('./MetadataInspector', () => ({
  MetadataPanel: () => null,
  useMetadataInspector: () => ({ showDebug: false }),
}));
vi.mock('../providers/AdapterProvider', () => ({ useAdapter: () => ({}) }));
vi.mock('../providers/ExpressionProvider', () => ({ useExpressionContext: () => ({ app: undefined }) }));
vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({ t: (k: string) => k }),
  // Pass-through: the i18n bundle is a SEPARATE channel with its own tests, and
  // resolving through it here would let a bundle entry answer for the key this
  // file is measuring.
  useObjectLabel: () => ({
    dashboardLabel: ({ label, name }: any) => label ?? name,
    dashboardDescription: ({ description }: any) => description,
  }),
  createSafeTranslation: (defaults: Record<string, string>) => () => ({
    t: (k: string) => defaults?.[k] ?? k,
  }),
}));

import { DashboardView } from './DashboardView';

const LEGACY_TITLE = 'Legacy Title From A Stored Document';
const CANONICAL_LABEL = 'Sales Overview';

/** Mount the view over exactly one stored dashboard document. */
async function mountWith(dashboard: Record<string, unknown>) {
  meta.value = {
    apps: [],
    objects: [],
    dashboards: [dashboard],
    reports: [],
    pages: [],
    loading: false,
    error: null,
    refresh: async () => {},
    invalidate: () => {},
    ensureType: async () => [],
    getItem: vi.fn(async () => null),
    getItemsByType: () => [],
    getTypeStatus: () => 'ready',
  };

  const { container } = render(
    <MetadataCtx.Provider value={meta.value as any}>
      <DashboardView />
    </MetadataCtx.Provider>,
  );

  // The view renders a skeleton first; the header only exists once loading ends.
  await waitFor(() => expect(container.querySelector('h1')).not.toBeNull());
  return container.querySelector('h1')!;
}

beforeEach(() => {
  cap.props = null;
  vi.clearAllMocks();
});
afterEach(cleanup);

describe('DashboardView — the root `title` read arm is retired (objectui#7509)', () => {
  it('renders the `label` header for a document carrying BOTH, and never the `title`', async () => {
    // The ruling's stated, VISIBLE change: a legacy document that also carries
    // the required `label` now shows the `label`.
    const h1 = await mountWith({
      name: 'sales_overview',
      label: CANONICAL_LABEL,
      title: LEGACY_TITLE,
      widgets: [],
    });

    expect(h1.textContent).toBe(CANONICAL_LABEL);
    expect(screen.queryByText(LEGACY_TITLE)).toBeNull();
  });

  it('falls through to the raw `name` for a document carrying ONLY the retired key', async () => {
    // `label` is REQUIRED on DashboardSchema, so this document was already
    // invalid; it is pinned because a renderer cannot refuse stored metadata,
    // and because it is where the retirement is actually felt.
    const h1 = await mountWith({ name: 'sales_overview', title: LEGACY_TITLE, widgets: [] });

    expect(h1.textContent).toBe('sales_overview');
    expect(screen.queryByText(LEGACY_TITLE)).toBeNull();
  });

  it('CONTROL — a document with only `label` renders it, so the two assertions above are not vacuous', async () => {
    // Without this, "the title is absent" would also be satisfied by a header
    // that renders nothing at all, and both cases above would pass for the
    // wrong reason.
    const h1 = await mountWith({ name: 'sales_overview', label: CANONICAL_LABEL, widgets: [] });

    expect(h1.textContent).toBe(CANONICAL_LABEL);
  });

  it('CONTROL — widget-level `title` is a different DECLARED key and reaches the renderer intact', async () => {
    // `DashboardWidget.title` is the spec's `I18nLabel`. A grep-driven sweep
    // over these files would have taken it too; this is the receiver-level
    // proof that it survived.
    await mountWith({
      name: 'sales_overview',
      label: CANONICAL_LABEL,
      title: LEGACY_TITLE,
      widgets: [{ id: 'w1', type: 'metric', title: 'Revenue' }],
    });

    await waitFor(() => expect(cap.props).not.toBeNull());
    expect(cap.props.schema.widgets).toHaveLength(1);
    expect(cap.props.schema.widgets[0].title).toBe('Revenue');
  });
});
