/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12325 — a gantt whose `data` still says `provider: 'api'` is not
 * read through it.
 *
 * This file used to be `ObjectGantt.apifetch.test.tsx`, which pinned that an
 * api-provider gantt fetched its `read.url` through the host's
 * `SchemaRendererContext.apiFetch` (#2725), falling back to the global fetch.
 * The view-level `api` data source is retired in `@objectstack/spec`
 * (objectstack#23082, ADR-0049): a view binds its object or static rows, and a
 * metadata-declared API call is the page element's `dataSource` binding.
 * `resolveDataSource` has no `api` arm any more, so the block is an unknown
 * provider:
 *
 *   1. its `read` URL is requested through NEITHER channel — not the host's
 *      `apiFetch`, not the global fetch — and with no DataSource no row is
 *      drawn;
 *   2. with a context DataSource the chart answers it the way it answers any
 *      unknown provider: it queries `schema.objectName` through that adapter.
 */
import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SchemaRendererProvider } from '@object-ui/react';
import type { DataSource } from '@object-ui/types';
import { ObjectGantt } from './ObjectGantt';

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));

vi.mock('./GanttView', () => ({
  GanttView: ({ tasks }: any) => (
    <div data-testid="gantt-view">
      {tasks.map((t: any) => (
        <div key={t.id} data-testid={`gv-view-${t.id}`}>{t.title}</div>
      ))}
    </div>
  ),
}));

vi.mock('@object-ui/plugin-detail', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/plugin-detail')>()),
  RecordDetailDrawer: () => null,
  deriveRecordPageHref: () => null,
}));

const ROWS = [
  { id: '1', name: 'Task A', start_date: '2024-01-01', end_date: '2024-01-05' },
];

const ENDPOINT = '/api/gantt/tree';

function retiredApiSchema(): any {
  return {
    type: 'gantt',
    objectName: 'tasks',
    gantt: {
      titleField: 'name',
      startDateField: 'start_date',
      endDateField: 'end_date',
    },
    data: { provider: 'api', read: { url: ENDPOINT, method: 'GET' } },
  };
}

function makeFetch() {
  return vi.fn(async () =>
    new Response(JSON.stringify({ data: ROWS, total: ROWS.length }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

function makeContextDS(): DataSource {
  return {
    find: vi.fn(async () => ({ data: ROWS, total: ROWS.length })),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn(async () => ({ name: 'tasks', fields: {} })),
  } as unknown as DataSource;
}

/** Lets every in-flight read settle, so a request that would follow is counted. */
const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 100)));

describe("ObjectGantt — a retired provider:'api' block (objectui#12325)", () => {
  const bareFetch = makeFetch();

  beforeEach(() => {
    bareFetch.mockClear();
    vi.stubGlobal('fetch', bareFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('requests its read URL through neither the host apiFetch nor the global fetch', async () => {
    const apiFetch = makeFetch();
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      render(
        <SchemaRendererProvider dataSource={null} apiFetch={apiFetch as any}>
          <ObjectGantt schema={retiredApiSchema()} />
        </SchemaRendererProvider>,
      );
      await settle();
    } finally {
      errSpy.mockRestore();
    }

    expect(apiFetch).not.toHaveBeenCalled();
    expect(bareFetch).not.toHaveBeenCalled();
    expect(screen.queryByTestId('gv-view-1')).toBeNull();
  });

  it('with a context DataSource, queries schema.objectName like any unknown provider, and still requests no URL', async () => {
    const apiFetch = makeFetch();
    const ds = makeContextDS();

    render(
      <SchemaRendererProvider dataSource={ds} apiFetch={apiFetch as any}>
        <ObjectGantt schema={retiredApiSchema()} dataSource={ds} />
      </SchemaRendererProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('gv-view-1')).toBeDefined());
    expect((ds.find as any).mock.calls.map((call: unknown[]) => call[0])).toEqual(['tasks']);
    expect(apiFetch).not.toHaveBeenCalled();
    expect(bareFetch).not.toHaveBeenCalled();
  });
});
