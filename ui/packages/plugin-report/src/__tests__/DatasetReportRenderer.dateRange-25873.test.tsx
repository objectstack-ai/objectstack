/**
 * The report page reads `dateRange` (objectstack-ai/objectstack#25873, ruling
 * 6408567749 letter B; the spec half is #26548).
 *
 * The renderer contract is the TSDoc on `ReportSchema.dateRange`: the active
 * window rides every dataset query of the report as ONE
 * `selection.timeDimensions` entry, `{ dimension, dateRange }`, with no
 * `granularity`; a preset goes on the wire by name, a custom pick as
 * `[start, end]`; an omitted `dimension` is the dataset's one `type: 'date'`
 * dimension. A report without `dateRange` posts exactly what it posted before.
 */
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import { SchemaRendererProvider } from '@object-ui/react';
import { I18nProvider } from '@object-ui/i18n';
import { DatasetReportRenderer } from '../DatasetReportRenderer';

// Radix Select opens on pointer events the DOM environment does not implement;
// the shim `DashboardFilterBar.options.test.tsx` uses.
beforeAll(() => {
  class MockPointerEvent extends Event {
    button: number;
    ctrlKey: boolean;
    pointerType: string;
    constructor(type: string, props: PointerEventInit = {}) {
      super(type, props);
      this.button = props.button ?? 0;
      this.ctrlKey = props.ctrlKey ?? false;
      this.pointerType = props.pointerType ?? 'mouse';
    }
  }
  Object.assign(window, { PointerEvent: MockPointerEvent });
  Object.assign(HTMLElement.prototype, {
    hasPointerCapture: vi.fn(),
    releasePointerCapture: vi.fn(),
    scrollIntoView: vi.fn(),
  });
});

afterEach(cleanup);

function makeSource() {
  const selections: any[] = [];
  return {
    selections,
    queryDataset: vi.fn(async (_dataset: string, selection: unknown) => {
      selections.push(selection);
      return { rows: [{ stage: 'Won', amount: 10 }] };
    }),
  };
}

/** An `apiFetch` serving one dataset definition; records every URL. */
function makeApiFetch(dimensions: Array<{ name: string; type?: string }>) {
  const urls: string[] = [];
  const apiFetch = vi.fn(async (input: unknown) => {
    const url = String(input);
    urls.push(url);
    if (url !== '/api/v1/meta/dataset/opportunity_metrics') {
      return new Response('{}', { status: 404 });
    }
    return new Response(JSON.stringify({ item: { name: 'opportunity_metrics', dimensions } }), { status: 200 });
  });
  return { apiFetch, urls };
}

const BASE = {
  name: 'pipeline',
  type: 'summary',
  dataset: 'opportunity_metrics',
  rows: ['stage'],
  values: ['amount'],
};

function renderReport(report: Record<string, unknown>, src: ReturnType<typeof makeSource>, apiFetch?: any) {
  return render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }}>
      <SchemaRendererProvider dataSource={undefined} apiFetch={apiFetch}>
        <DatasetReportRenderer report={report} dataSource={src} />
      </SchemaRendererProvider>
    </I18nProvider>,
  );
}

const trigger = () => screen.getByRole('combobox', { name: 'Date range' });

describe('DatasetReportRenderer reads dateRange (objectstack-ai/objectstack#25873)', () => {
  it('posts one timeDimensions window from defaultRange, on every query, and draws the chip', async () => {
    const src = makeSource();
    renderReport(
      {
        ...BASE,
        chart: { type: 'bar', xAxis: 'stage', yAxis: 'amount' },
        dateRange: { dimension: 'close_date', defaultRange: 'last_30_days' },
      },
      src,
    );
    await waitFor(() => expect(screen.getByText('Won')).toBeInTheDocument());
    expect(trigger()).toHaveTextContent('Last 30 days');
    // The table and the embedded chart both query: each carries the window.
    expect(src.selections.length).toBeGreaterThanOrEqual(2);
    for (const selection of src.selections) {
      expect(selection.timeDimensions).toEqual([{ dimension: 'close_date', dateRange: 'last_30_days' }]);
    }
  });

  it('re-queries with the new window when the chip changes', async () => {
    const src = makeSource();
    renderReport({ ...BASE, dateRange: { dimension: 'close_date', defaultRange: 'last_30_days' } }, src);
    await waitFor(() => expect(src.selections).toHaveLength(1));

    fireEvent.pointerDown(trigger(), { button: 0 });
    fireEvent.click(await screen.findByRole('option', { name: 'This quarter' }));

    await waitFor(() => expect(src.selections).toHaveLength(2));
    expect(src.selections[1].timeDimensions).toEqual([{ dimension: 'close_date', dateRange: 'this_quarter' }]);
    expect(trigger()).toHaveTextContent('This quarter');

    // All time states no window at all.
    fireEvent.pointerDown(trigger(), { button: 0 });
    fireEvent.click(await screen.findByRole('option', { name: 'All time' }));
    await waitFor(() => expect(src.selections).toHaveLength(3));
    expect(src.selections[2]).not.toHaveProperty('timeDimensions');
  });

  it('a custom pick posts [start, end] once both ends are named', async () => {
    const src = makeSource();
    renderReport({ ...BASE, dateRange: { dimension: 'close_date', defaultRange: 'last_7_days' } }, src);
    await waitFor(() => expect(src.selections).toHaveLength(1));

    fireEvent.pointerDown(trigger(), { button: 0 });
    fireEvent.click(await screen.findByRole('option', { name: 'Custom…' }));
    await waitFor(() => expect(src.selections).toHaveLength(2));
    // `custom` with no ends is the spec's "open the picker, no window".
    expect(src.selections[1]).not.toHaveProperty('timeDimensions');

    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-01-01' } });
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-03-31' } });
    await waitFor(() => expect(src.selections).toHaveLength(3));
    expect(src.selections[2].timeDimensions).toEqual([
      { dimension: 'close_date', dateRange: ['2026-01-01', '2026-03-31'] },
    ]);
  });

  it('allowCustomRange: false offers no custom pick', async () => {
    const src = makeSource();
    renderReport({ ...BASE, dateRange: { dimension: 'close_date', defaultRange: 'this_year', allowCustomRange: false } }, src);
    await waitFor(() => expect(src.selections).toHaveLength(1));
    fireEvent.pointerDown(trigger(), { button: 0 });
    expect(await screen.findByRole('option', { name: 'This year' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Custom…' })).toBeNull();
  });

  it('an omitted defaultRange opens on the spec default, this_month', async () => {
    const src = makeSource();
    renderReport({ ...BASE, dateRange: { dimension: 'close_date' } }, src);
    await waitFor(() => expect(src.selections).toHaveLength(1));
    expect(src.selections[0].timeDimensions).toEqual([{ dimension: 'close_date', dateRange: 'this_month' }]);
  });

  it('an omitted dimension is the dataset\'s one date dimension, read before any query', async () => {
    const src = makeSource();
    const { apiFetch, urls } = makeApiFetch([
      { name: 'stage', type: 'string' },
      { name: 'close_date', type: 'date' },
    ]);
    renderReport({ ...BASE, dateRange: { defaultRange: 'last_90_days' } }, src, apiFetch);
    await waitFor(() => expect(src.selections).toHaveLength(1));
    expect(urls).toEqual(['/api/v1/meta/dataset/opportunity_metrics']);
    expect(src.selections[0].timeDimensions).toEqual([{ dimension: 'close_date', dateRange: 'last_90_days' }]);
  });

  it('an omitted dimension over a dataset with two date dimensions draws the error and queries nothing', async () => {
    const src = makeSource();
    const { apiFetch } = makeApiFetch([
      { name: 'close_date', type: 'date' },
      { name: 'created_date', type: 'date' },
    ]);
    renderReport({ ...BASE, dateRange: { defaultRange: 'last_90_days' } }, src, apiFetch);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('close_date, created_date');
    expect(src.queryDataset).not.toHaveBeenCalled();
  });

  it('CONTROL: a report without dateRange draws no chip, reads no dataset definition and posts no timeDimensions', async () => {
    const src = makeSource();
    const { apiFetch } = makeApiFetch([{ name: 'close_date', type: 'date' }]);
    renderReport({ ...BASE }, src, apiFetch);
    await waitFor(() => expect(screen.getByText('Won')).toBeInTheDocument());
    expect(screen.queryByTestId('report-date-range')).toBeNull();
    expect(apiFetch).not.toHaveBeenCalled();
    expect(src.selections).toHaveLength(1);
    expect(src.selections[0]).not.toHaveProperty('timeDimensions');
  });
});

/*
 * ADR-0150 D3 — the omitted-dimension read of the dataset definition is made
 * as the report's reader (`?callerPackage=` = the report's served package), so
 * it reads the dataset the report's queries resolve. A refusal is the read's
 * error state, never retried bare.
 */
describe('DatasetReportRenderer reads the date dimension as the report\'s reader (ADR-0150 D3)', () => {
  /** The server's answers: the D3 resolution for `com.acme.app` (its dependency's dataset), else another holder's. */
  function makeResolvingApiFetch({ refuse = false } = {}) {
    const urls: string[] = [];
    const apiFetch = vi.fn(async (input: unknown) => {
      const url = String(input);
      urls.push(url);
      if (url === '/api/v1/meta/dataset/opportunity_metrics?callerPackage=com.acme.app') {
        if (refuse) {
          return new Response(JSON.stringify({ success: false, error: { code: 'RESOURCE_CONFLICT', message: 'held by 2 packages in the closure' } }), { status: 409 });
        }
        return new Response(JSON.stringify({ item: { name: 'opportunity_metrics', dimensions: [{ name: 'won_on', type: 'date' }] } }), { status: 200 });
      }
      if (url === '/api/v1/meta/dataset/opportunity_metrics') {
        return new Response(JSON.stringify({ item: { name: 'opportunity_metrics', dimensions: [{ name: 'bare_date', type: 'date' }] } }), { status: 200 });
      }
      return new Response('{}', { status: 404 });
    });
    return { apiFetch, urls };
  }

  it('a package report reads the definition with its package as the caller, and windows on that dataset\'s date dimension', async () => {
    const src = makeSource();
    const { apiFetch, urls } = makeResolvingApiFetch();
    renderReport({ ...BASE, _packageId: 'com.acme.app', dateRange: { defaultRange: 'last_90_days' } }, src, apiFetch);
    await waitFor(() => expect(src.selections).toHaveLength(1));
    expect(urls).toEqual(['/api/v1/meta/dataset/opportunity_metrics?callerPackage=com.acme.app']);
    expect(src.selections[0].timeDimensions).toEqual([{ dimension: 'won_on', dateRange: 'last_90_days' }]);
  });

  it('a 409 for the reader is the read\'s error state: no bare retry, no query', async () => {
    const src = makeSource();
    const { apiFetch, urls } = makeResolvingApiFetch({ refuse: true });
    renderReport({ ...BASE, _packageId: 'com.acme.app', dateRange: { defaultRange: 'last_90_days' } }, src, apiFetch);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('HTTP 409');
    expect(urls).toEqual(['/api/v1/meta/dataset/opportunity_metrics?callerPackage=com.acme.app']);
    expect(src.queryDataset).not.toHaveBeenCalled();
  });

  it('the caller package is part of the read: the same report served from another package re-reads, and never windows on the first one\'s dimension', async () => {
    const sent: Array<{ caller: unknown; timeDimensions: unknown }> = [];
    const src = {
      queryDataset: vi.fn(async (_dataset: string, selection: any, options?: { callerPackage?: string }) => {
        sent.push({ caller: options?.callerPackage, timeDimensions: selection?.timeDimensions });
        return { rows: [{ stage: 'Won', amount: 10 }] };
      }),
    };
    const urls: string[] = [];
    const apiFetch = vi.fn(async (input: unknown) => {
      const url = String(input);
      urls.push(url);
      const dimension = url.endsWith('?callerPackage=com.acme.app') ? 'won_on'
        : url.endsWith('?callerPackage=com.acme.other') ? 'closed_on' : undefined;
      return dimension
        ? new Response(JSON.stringify({ item: { name: 'opportunity_metrics', dimensions: [{ name: dimension, type: 'date' }] } }), { status: 200 })
        : new Response('{}', { status: 404 });
    });
    const tree = (packageId: string) => (
      <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }}>
        <SchemaRendererProvider dataSource={undefined} apiFetch={apiFetch}>
          <DatasetReportRenderer report={{ ...BASE, _packageId: packageId, dateRange: { defaultRange: 'last_90_days' } }} dataSource={src as any} />
        </SchemaRendererProvider>
      </I18nProvider>
    );
    const { rerender } = render(tree('com.acme.app'));
    await waitFor(() => expect(sent).toHaveLength(1));
    rerender(tree('com.acme.other'));
    await waitFor(() => expect(sent.some((s) => s.caller === 'com.acme.other')).toBe(true));
    expect(urls).toEqual([
      '/api/v1/meta/dataset/opportunity_metrics?callerPackage=com.acme.app',
      '/api/v1/meta/dataset/opportunity_metrics?callerPackage=com.acme.other',
    ]);
    expect(sent.filter((s) => s.caller === 'com.acme.other').map((s) => s.timeDimensions))
      .toEqual([[{ dimension: 'closed_on', dateRange: 'last_90_days' }]]);
  });

  it.each([
    ['no _packageId', undefined],
    ['the package-less sentinel', 'sys_metadata'],
  ])('CONTROL: a report authored in the environment (%s) reads the definition with no caller', async (_label, packageId) => {
    const src = makeSource();
    const { apiFetch, urls } = makeResolvingApiFetch();
    renderReport({ ...BASE, ...(packageId ? { _packageId: packageId } : {}), dateRange: { defaultRange: 'last_90_days' } }, src, apiFetch);
    await waitFor(() => expect(src.selections).toHaveLength(1));
    expect(urls).toEqual(['/api/v1/meta/dataset/opportunity_metrics']);
    expect(src.selections[0].timeDimensions).toEqual([{ dimension: 'bare_date', dateRange: 'last_90_days' }]);
  });
});
