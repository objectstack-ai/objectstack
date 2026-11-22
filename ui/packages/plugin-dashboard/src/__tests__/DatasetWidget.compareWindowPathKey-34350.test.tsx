// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#34350 — a compare widget whose date window is keyed on a related
 * record's field (`account.founded_at`).
 *
 * The dataset query answers only declared dimensions, and a dimension name has
 * no dot, so that key is refused at the door. A dataset can declare a date
 * dimension OVER the path, and the widget then sends the window under that
 * declared name. These pins hold both halves: the window served through the
 * one declared date dimension over the path, and the key left as authored, so
 * the door refuses it, when no declared date dimension (or more than one)
 * covers the path.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { SchemaRendererProvider, type ApiFetch } from '@object-ui/react';

import { DatasetWidget, mapCompareWindowKeys, canBeDimensionName } from '../DatasetWidget';

afterEach(() => {
  cleanup();
});

const PATH = 'account.founded_at';
const WINDOW = { $gte: '2026-04-01', $lte: '2026-06-30' };

const FOUNDED = { name: 'account_founded', field: PATH, type: 'date' };
const CLOSE = { name: 'close_date', field: 'close_date', type: 'date' };

/**
 * A stand-in for the dataset door's declared-member rule: a `timeDimensions`
 * entry must name a declared dimension, else `400 INVALID_FIELD`.
 */
function fakeDoor(declared: ReadonlyArray<{ name: string }>) {
  const names = new Set(declared.map((d) => d.name));
  return {
    queryDataset: vi.fn(async (_dataset: string, selection: any) => {
      const undeclared = (selection.timeDimensions ?? [])
        .map((td: { dimension: string }) => td.dimension)
        .filter((n: string) => !names.has(n));
      if (undeclared.length > 0) {
        const err = new Error(`[INVALID_FIELD] dimension "${undeclared[0]}" is not declared by this dataset.`);
        Object.assign(err, { code: 'INVALID_FIELD', status: 400 });
        throw err;
      }
      return { rows: [{ revenue: 10, revenue__compare: 8 }] };
    }),
  };
}

/** The host's `apiFetch`, answering the dataset definition read. */
function definitionFetch(dimensions: unknown[], ok = true) {
  const calls: string[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL) => {
    calls.push(String(input));
    return new Response(JSON.stringify({ item: { name: 'sales', object: 'opportunity', dimensions } }), {
      status: ok ? 200 : 500,
      headers: { 'content-type': 'application/json' },
    });
  });
  return { fn: fn as unknown as ApiFetch, calls };
}

function renderWidget(
  widget: Record<string, unknown>,
  src: { queryDataset: any },
  apiFetch: ApiFetch,
  packageId?: string,
) {
  return render(
    <SchemaRendererProvider dataSource={src as any} apiFetch={apiFetch}>
      <DatasetWidget widget={widget} dataSource={src} packageId={packageId} />
    </SchemaRendererProvider>,
  );
}

const compareWidget = (extra: Record<string, unknown> = {}) => ({
  type: 'metric',
  dataset: 'sales',
  values: ['revenue'],
  filter: { [PATH]: WINDOW, stage: 'won' },
  compareTo: { kind: 'previousPeriod' },
  ...extra,
});

describe('mapCompareWindowKeys', () => {
  it('maps a dotted key to the one declared date dimension over that path', () => {
    expect(mapCompareWindowKeys([PATH], [CLOSE, FOUNDED])).toEqual({ [PATH]: 'account_founded' });
  });

  it('maps nothing when no declared date dimension covers the path', () => {
    expect(mapCompareWindowKeys([PATH], [CLOSE])).toEqual({});
    // A dimension over the path that does not declare `type: 'date'`.
    expect(mapCompareWindowKeys([PATH], [{ name: 'account_founded', field: PATH }])).toEqual({});
    expect(mapCompareWindowKeys([PATH], [{ name: 'account_founded', field: PATH, type: 'string' }])).toEqual({});
  });

  it('maps nothing when two declared date dimensions cover the path', () => {
    expect(
      mapCompareWindowKeys([PATH], [FOUNDED, { name: 'account_founded_q', field: PATH, type: 'date' }]),
    ).toEqual({});
  });

  it('never renames a key that can be a dimension name', () => {
    expect(mapCompareWindowKeys(['close_date'], [{ name: 'closed_on', field: 'close_date', type: 'date' }])).toEqual({});
  });

  it('maps nothing onto a declared name another window already uses', () => {
    const founded = { name: 'founded_at', field: PATH, type: 'date' };
    expect(mapCompareWindowKeys([PATH, 'founded_at'], [founded])).toEqual({});
  });

  it('reads the dimension-name grammar of the dataset schema', () => {
    expect(canBeDimensionName('close_date')).toBe(true);
    expect(canBeDimensionName(PATH)).toBe(false);
  });
});

describe('DatasetWidget — a compare window keyed on a related record’s field (objectstack#34350)', () => {
  it('serves the window through the declared date dimension over the path', async () => {
    const declared = [CLOSE, FOUNDED];
    const src = fakeDoor(declared);
    const host = definitionFetch(declared);
    renderWidget(compareWidget(), src, host.fn, 'crm');

    await waitFor(() => expect(src.queryDataset).toHaveBeenCalled());
    // The definition was read once, as the widget's reader, before the query.
    expect(host.calls).toEqual(['/api/v1/meta/dataset/sales?callerPackage=crm']);
    expect(src.queryDataset).toHaveBeenCalledTimes(1);
    const selection = src.queryDataset.mock.calls[0][1];
    expect(selection.timeDimensions).toEqual([
      { dimension: 'account_founded', dateRange: ['2026-04-01', '2026-06-30'] },
    ]);
    expect(selection.runtimeFilter).toEqual({ stage: 'won' });
    expect(selection.compareTo).toEqual({ kind: 'previousPeriod' });
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(await screen.findByText('10')).toBeTruthy();
  });

  it('sends compareTo.dimension as the declared name, written either way', async () => {
    for (const dimension of [PATH, 'account_founded']) {
      const declared = [FOUNDED];
      const src = fakeDoor(declared);
      renderWidget(compareWidget({ compareTo: { kind: 'previousYear', dimension } }), src, definitionFetch(declared).fn);
      await waitFor(() => expect(src.queryDataset).toHaveBeenCalled());
      const selection = src.queryDataset.mock.calls[0][1];
      expect(selection.compareTo).toEqual({ kind: 'previousYear', dimension: 'account_founded' });
      expect(selection.timeDimensions.map((td: { dimension: string }) => td.dimension)).toEqual(['account_founded']);
      cleanup();
    }
  });

  it('leaves the key as authored when no declared date dimension covers the path, and the door refuses it', async () => {
    const declared = [CLOSE];
    const src = fakeDoor(declared);
    renderWidget(compareWidget(), src, definitionFetch(declared).fn);

    await waitFor(() => expect(src.queryDataset).toHaveBeenCalled());
    expect(src.queryDataset.mock.calls[0][1].timeDimensions).toEqual([
      { dimension: PATH, dateRange: ['2026-04-01', '2026-06-30'] },
    ]);
    const refusal = await src.queryDataset.mock.results[0].value.catch((e: { code: string; status: number }) => e);
    expect({ code: refusal.code, status: refusal.status }).toEqual({ code: 'INVALID_FIELD', status: 400 });
    expect(await screen.findByRole('alert')).toHaveTextContent(`"${PATH}"`);
  });

  it('leaves the key as authored when two declared date dimensions cover the path', async () => {
    const declared = [FOUNDED, { name: 'account_founded_q', field: PATH, type: 'date' }];
    const src = fakeDoor(declared);
    renderWidget(compareWidget(), src, definitionFetch(declared).fn);

    await waitFor(() => expect(src.queryDataset).toHaveBeenCalled());
    expect(src.queryDataset.mock.calls[0][1].timeDimensions[0].dimension).toBe(PATH);
    expect(await screen.findByRole('alert')).toHaveTextContent(`"${PATH}"`);
  });

  it('leaves the key as authored when the definition cannot be read', async () => {
    const src = fakeDoor([FOUNDED]);
    renderWidget(compareWidget(), src, definitionFetch([FOUNDED], false).fn);

    await waitFor(() => expect(src.queryDataset).toHaveBeenCalled());
    expect(src.queryDataset.mock.calls[0][1].timeDimensions[0].dimension).toBe(PATH);
  });

  it('reads no definition for a window keyed on a field of the dataset’s own object', async () => {
    const src = fakeDoor([CLOSE]);
    const host = definitionFetch([CLOSE]);
    renderWidget(compareWidget({ filter: { close_date: WINDOW } }), src, host.fn);

    await waitFor(() => expect(src.queryDataset).toHaveBeenCalled());
    expect(src.queryDataset.mock.calls[0][1].timeDimensions).toEqual([
      { dimension: 'close_date', dateRange: ['2026-04-01', '2026-06-30'] },
    ]);
    expect(host.calls.filter((c) => c.includes('/meta/dataset/'))).toEqual([]);
  });

  it('reads no definition for a widget without compareTo', async () => {
    const src = fakeDoor([CLOSE]);
    const host = definitionFetch([FOUNDED]);
    renderWidget(compareWidget({ compareTo: undefined }), src, host.fn);

    await waitFor(() => expect(src.queryDataset).toHaveBeenCalled());
    expect(src.queryDataset.mock.calls[0][1].runtimeFilter).toEqual({ [PATH]: WINDOW, stage: 'won' });
    expect(host.calls.filter((c) => c.includes('/meta/dataset/'))).toEqual([]);
  });
});
