// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36423 — the record Attachments panel announces the writes it
 * makes outside the data source on the data-invalidation bus, so a reader that
 * counts a record's files (a kanban card's footer, `kanban.cardFooter`) asks
 * again. An upload goes through the storage route and the uploader's own
 * delete through the removal door; neither reaches the data source, so no
 * mutation event carries them. A delete through the data door is announced by
 * the data source's own mutation event and is not announced again here.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { subscribeDataChanges, type DataChange } from '@object-ui/react';

const adapterUpload = vi.fn();
vi.mock('@object-ui/data-objectstack', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createObjectStackUploadAdapter: () => ({ upload: adapterUpload }),
}));

import { RecordAttachmentsPanel } from '../RecordAttachmentsPanel';

const ME = 'u-me';
const OWN_ROW = { id: 'a2', file_id: 'f2', file_name: 'mine.pdf', mime_type: 'application/pdf', size: 2048, uploaded_by: ME };
const OTHERS_ROW = { id: 'a1', file_id: 'f1', file_name: 'others.pdf', mime_type: 'application/pdf', size: 1024, uploaded_by: 'u-else' };

function makeDataSource() {
  return {
    find: vi.fn(async () => [OTHERS_ROW, OWN_ROW]),
    create: vi.fn(async () => ({ id: 'a3' })),
    delete: vi.fn(async () => ({})),
  };
}

let changes: DataChange[] = [];
let unsubscribe: () => void = () => {};
beforeEach(() => {
  adapterUpload.mockReset();
  changes = [];
  unsubscribe = subscribeDataChanges((change) => changes.push(change));
});
afterEach(() => {
  unsubscribe();
  vi.restoreAllMocks();
});

const attachmentChanges = () => changes.filter((c) => c.objectName === 'sys_attachment');

function renderPanel() {
  const dataSource = makeDataSource();
  const result = render(
    <RecordAttachmentsPanel objectName="att_case" recordId="r1" dataSource={dataSource} currentUserId={ME} />,
  );
  return { ...result, dataSource };
}

describe('the Attachments panel announces its storage-route writes (objectstack#36423)', () => {
  it('an upload is announced as a sys_attachment write', async () => {
    adapterUpload.mockResolvedValue({ meta: { attachmentId: 'a9' } });
    const { container } = renderPanel();
    await waitFor(() => expect(screen.getByText('mine.pdf')).toBeInTheDocument());

    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.setup().upload(input, new File(['%PDF'], 'quote.pdf', { type: 'application/pdf' }));

    await waitFor(() => expect(attachmentChanges()).toEqual([{ objectName: 'sys_attachment', recordId: 'a9' }]));
  });

  it('a refused upload is not announced', async () => {
    adapterUpload.mockRejectedValue(Object.assign(new Error('denied'), { status: 403, code: 'PERMISSION_DENIED' }));
    const { container } = renderPanel();
    await waitFor(() => expect(screen.getByText('mine.pdf')).toBeInTheDocument());

    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.setup().upload(input, new File(['%PDF'], 'quote.pdf', { type: 'application/pdf' }));

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(attachmentChanges()).toEqual([]);
  });

  it('the uploader\'s own delete through the removal door is announced', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () =>
        new Response(JSON.stringify({ success: true, data: { id: OWN_ROW.id, deleted: true } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    );
    renderPanel();
    await waitFor(() => expect(screen.getByText('mine.pdf')).toBeInTheDocument());

    const user = userEvent.setup();
    const row = screen.getByText('mine.pdf').closest('li') as HTMLElement;
    await user.click(within(row).getByRole('button', { name: 'More for mine.pdf' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Delete attachment' }));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(screen.queryByText('mine.pdf')).not.toBeInTheDocument());
    expect(attachmentChanges()).toEqual([{ objectName: 'sys_attachment', recordId: 'a2' }]);
  });
});
