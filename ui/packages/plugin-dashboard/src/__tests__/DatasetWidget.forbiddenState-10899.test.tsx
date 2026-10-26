// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A dataset tile the viewer may not read shows a localized "no access" state,
 * not the raw exception (objectui#10899 item 3).
 *
 * Measured on the 2026-09-28 local E2E: an invited member's dashboard tile
 * read `Dataset query failed: 403 Forbidden — [Analytics] Access denied:
 * reading "y8bc_customer" is not permitted for this user.` — raw English in a
 * Chinese UI — while the list view over the same object already rendered its
 * localized 「无权访问」 panel. The underlying permission grant is cloud#2439;
 * this pins how the refusal READS.
 *
 * The rejection below carries the two fields `@object-ui/data-objectstack`'s
 * `AnalyticsForbiddenError` declares for this refusal (`httpStatus: 403`,
 * `code: 'PERMISSION_DENIED'`; the adapter half is pinned in
 * `queryDataset.forbidden-10899.test.ts`), and the tile classifies it through
 * the shared `classifyLoadError` — the same classifier the list view uses.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

vi.mock('@object-ui/react', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  SchemaRenderer: () => <div data-testid="chart-rendered" />,
}));

import { DatasetWidget } from '../DatasetWidget';

const RAW = 'Analytics query refused: this user may not read the data behind dataset "crm". (server said: [Analytics] Access denied: reading "y8bc_customer" is not permitted for this user.)';

function refusal() {
  return Object.assign(new Error(RAW), { name: 'AnalyticsForbiddenError', httpStatus: 403, code: 'PERMISSION_DENIED' });
}

const WIDGET = { type: 'bar', dataset: 'crm', dimensions: ['status'], values: ['count'] };

afterEach(() => cleanup());

describe('DatasetWidget — a read refusal renders the no-access state (objectui#10899)', () => {
  it('shows the localized no-access state and never the exception text', async () => {
    const src = { queryDataset: vi.fn(async () => { throw refusal(); }) };

    render(<DatasetWidget widget={WIDGET} dataSource={src} />);

    const state = await screen.findByTestId('dataset-widget-forbidden');
    expect(state).toHaveTextContent('You don’t have access');
    expect(state).toHaveTextContent('You don’t have permission to view the data behind this widget.');
    expect(screen.queryByText(/Access denied|Dataset query failed|Analytics query refused/)).toBeNull();
    expect(screen.queryByTestId('chart-rendered')).toBeNull();
  });

  it('CONTROL — any other failure keeps the detailed error alert', async () => {
    const src = {
      queryDataset: vi.fn(async () => {
        throw new Error('Dataset query failed: 400 Bad Request — relationship not declared in include');
      }),
    };

    render(<DatasetWidget widget={WIDGET} dataSource={src} />);

    expect(await screen.findByText(/relationship not declared in include/)).toBeInTheDocument();
    expect(screen.queryByTestId('dataset-widget-forbidden')).toBeNull();
  });

  it('CONTROL — the text "403" in a message alone is not a verdict: no status/code, no no-access state', async () => {
    const src = {
      queryDataset: vi.fn(async () => {
        throw new Error('Dataset query failed: 403 Forbidden — <html>proxy</html>');
      }),
    };

    render(<DatasetWidget widget={WIDGET} dataSource={src} />);

    expect(await screen.findByText(/Dataset query failed: 403/)).toBeInTheDocument();
    expect(screen.queryByTestId('dataset-widget-forbidden')).toBeNull();
  });
});
