/**
 * Server-streamed export routing — ObjectGrid.
 *
 * A server-backed grid (provider:object + dataSource.exportDownload) routes the
 * export through the streaming `exportDownload` adapter, passing the grid's
 * configured filter + sort and the visible field set, and downloads the Blob.
 * Failures surface in the toolbar instead of being swallowed.
 */
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

import { ObjectGrid } from '../ObjectGrid';
import { registerAllFields } from '@object-ui/fields';
import { ActionProvider } from '@object-ui/react';

registerAllFields();

beforeAll(() => {
  // jsdom has no object-URL plumbing; the download path calls these.
  if (!URL.createObjectURL) (URL as any).createObjectURL = () => 'blob:export';
  if (!URL.revokeObjectURL) (URL as any).revokeObjectURL = () => {};
});

afterEach(() => {
  vi.restoreAllMocks();
});

function makeDataSource(exportDownload: any) {
  return {
    find: vi.fn(async () => ({ data: [], total: 0, hasMore: false, pageSize: 50 })),
    getObjectSchema: async (name: string) => ({
      name,
      fields: { id: { type: 'text' }, name: { type: 'text' } },
    }),
    exportDownload,
  } as any;
}

function renderGrid(dataSource: any, opts?: Record<string, any>) {
  const schema: any = {
    type: 'object-grid',
    objectName: 'task',
    columns: [{ field: 'name', label: 'Name' }],
    exportOptions: { formats: ['csv', 'xlsx'] },
    ...opts,
  };
  return render(
    <ActionProvider>
      <ObjectGrid schema={schema} dataSource={dataSource} />
    </ActionProvider>,
  );
}

describe('ObjectGrid — server-streamed export', () => {
  it('routes export through exportDownload with the grid filter + sort', async () => {
    const exportDownload = vi.fn().mockResolvedValue(new Blob(['ID,Name\n1,Acme'], { type: 'text/csv' }));
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:export');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const ds = makeDataSource(exportDownload);

    renderGrid(ds, {
      filter: [['status', '=', 'open']],
      sort: [{ field: 'name', order: 'desc' }],
    });

    fireEvent.click(await screen.findByRole('button', { name: /export/i }));
    fireEvent.click(await screen.findByRole('button', { name: /export as xlsx/i }));

    await waitFor(() => expect(exportDownload).toHaveBeenCalledTimes(1));
    const [resource, request] = exportDownload.mock.calls[0];
    expect(resource).toBe('task');
    expect(request).toMatchObject({
      format: 'xlsx',
      filter: [['status', '=', 'open']],
      sort: [{ field: 'name', direction: 'desc' }],
    });
    await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(1));
  });

  it('surfaces export failures in the toolbar', async () => {
    const exportDownload = vi.fn().mockRejectedValue(new Error('Permission denied'));
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:export');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const ds = makeDataSource(exportDownload);

    renderGrid(ds);

    fireEvent.click(await screen.findByRole('button', { name: /export/i }));
    fireEvent.click(await screen.findByRole('button', { name: /export as csv/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Permission denied');
  });
});
