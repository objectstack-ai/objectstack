// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The record Attachments panel offers Upload and delete only to a caller whose
 * `sys_attachment` grant allows them (objectui#12047).
 *
 * ## The defect
 *
 * Upload and delete rendered for every caller; the panel learned about a
 * missing grant only from the server's refusal. For a caller holding read but
 * not create on `sys_attachment`, the three-step presigned upload COMMITTED a
 * `sys_file` and only the final `sys_attachment` insert was refused (403): the
 * user met the error after the bytes were stored, and the file stayed
 * committed with nothing attached to it.
 *
 * ## Why this file drives the REAL provider
 *
 * The grant is read through `usePermissions().can`, so these cases mount the
 * real `MePermissionsProvider` over the real `/me/permissions` payload shape
 * (`initialPermissions`, the provider's own test/SSR seam) and let its genuine
 * `objects` → `check` path answer. A mocked `usePermissions` would assert
 * against a hand-written stand-in for that derivation.
 *
 * ## Why being the uploader does not open delete
 *
 * The server asks the object grant first — plugin-security's CRUD check wraps
 * the engine's `beforeDelete` hooks — and only a caller who passes it reaches
 * service-storage's uploader-or-parent-editor rule, which compares the row's
 * `uploaded_by` with the session user. So the read-only case below includes a
 * row whose `uploaded_by` IS the caller, and still expects no delete: offering
 * it would be this card's defect again, answered by `PERMISSION_DENIED`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MePermissionsProvider, type MePermissionsResponse } from '@object-ui/permissions';

/** The fake presigned adapter: `upload` resolving means a `sys_file` was committed. */
const adapterUpload = vi.fn();

vi.mock('@object-ui/providers', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createObjectStackUploadAdapter: () => ({ upload: adapterUpload }),
}));

import { RecordAttachmentsPanel } from '../RecordAttachmentsPanel';

const ME = 'u-me';

const OTHERS_ROW = {
  id: 'a1',
  file_id: 'f1',
  file_name: 'others.pdf',
  mime_type: 'application/pdf',
  size: 1024,
  uploaded_by: 'u-someone-else',
};

/** A row the CALLER uploaded: `uploaded_by` is the field the server compares. */
const OWN_ROW = {
  id: 'a2',
  file_id: 'f2',
  file_name: 'mine.pdf',
  mime_type: 'application/pdf',
  size: 2048,
  uploaded_by: ME,
};

type Grant = { allowCreate?: boolean; allowDelete?: boolean };

/** A `/me/permissions` answer for an authenticated caller with this `sys_attachment` grant. */
function payload(grant: Grant): MePermissionsResponse {
  return {
    authenticated: true,
    userId: ME,
    tenantId: 'org-1',
    roles: [],
    permissionSets: ['member'],
    objects: {
      sys_attachment: {
        allowRead: true,
        allowCreate: grant.allowCreate ?? false,
        allowEdit: false,
        allowDelete: grant.allowDelete ?? false,
      },
    },
    fields: {},
  };
}

type DataSourceMethod = (...args: unknown[]) => Promise<unknown>;

function makeDataSource(overrides: Partial<Record<'find' | 'create' | 'delete', DataSourceMethod>> = {}) {
  return {
    find: vi.fn(async () => [OTHERS_ROW, OWN_ROW]),
    create: vi.fn(async () => ({ id: 'a3' })),
    delete: vi.fn(async () => ({})),
    ...overrides,
  };
}

function panel(dataSource: unknown) {
  return (
    <RecordAttachmentsPanel
      objectName="att_case"
      recordId="r1"
      dataSource={dataSource}
      currentUserId={ME}
    />
  );
}

function renderWithGrant(grant: Grant, dataSource: unknown = makeDataSource()) {
  return render(
    <MePermissionsProvider initialPermissions={payload(grant)}>{panel(dataSource)}</MePermissionsProvider>,
  );
}

/** The list item rendering `fileName`. */
function rowOf(fileName: string): HTMLElement {
  const li = screen.getByText(fileName).closest('li');
  if (!li) throw new Error(`no row for ${fileName}`);
  return li as HTMLElement;
}

async function rowsLoaded() {
  await waitFor(() => expect(screen.getByText('mine.pdf')).toBeInTheDocument());
  expect(screen.getByText('others.pdf')).toBeInTheDocument();
}

beforeEach(() => {
  adapterUpload.mockReset();
});

describe('RecordAttachmentsPanel — write affordances follow the sys_attachment grant (objectui#12047)', () => {
  it('a read-only grant renders no Upload and no delete, not even on a row the caller uploaded', async () => {
    renderWithGrant({});
    await rowsLoaded();

    expect(screen.queryByRole('button', { name: 'Upload' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete attachment' })).not.toBeInTheDocument();
    // The own row specifically: `uploaded_by === ME`, and still no delete.
    expect(
      within(rowOf('mine.pdf')).queryByRole('button', { name: 'Delete attachment' }),
    ).not.toBeInTheDocument();
    // Reading is untouched: both rows keep their Download.
    expect(screen.getAllByRole('button', { name: 'Download' })).toHaveLength(2);
  });

  it('a create grant renders Upload (and no delete without the delete grant)', async () => {
    renderWithGrant({ allowCreate: true });
    await rowsLoaded();

    expect(screen.getByRole('button', { name: 'Upload' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete attachment' })).not.toBeInTheDocument();
  });

  it('the uploader sees delete on their own file', async () => {
    renderWithGrant({ allowDelete: true });
    await rowsLoaded();

    expect(
      within(rowOf('mine.pdf')).getByRole('button', { name: 'Delete attachment' }),
    ).toBeInTheDocument();
    // Another user's row keeps it too: whether the caller may edit the parent
    // record is the server's to judge, and the refusal mapping answers it.
    expect(
      within(rowOf('others.pdf')).getByRole('button', { name: 'Delete attachment' }),
    ).toBeInTheDocument();
    // No create grant, no Upload.
    expect(screen.queryByRole('button', { name: 'Upload' })).not.toBeInTheDocument();
  });

  it('CONTROL — with Upload shown and the server refusing the attach, the refusal message still appears', async () => {
    adapterUpload.mockResolvedValue({
      name: 'quote.pdf',
      mimeType: 'application/pdf',
      size: 10,
      meta: { fileId: 'f-new' },
    });
    const dataSource = makeDataSource({
      create: vi.fn(async () => {
        throw Object.assign(new Error("[Security] Access denied: operation 'insert' on sys_attachment"), {
          httpStatus: 403,
          code: 'PERMISSION_DENIED',
        });
      }),
    });
    const { container } = renderWithGrant({ allowCreate: true }, dataSource);
    await rowsLoaded();
    expect(screen.getByRole('button', { name: 'Upload' })).toBeInTheDocument();

    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const user = userEvent.setup();
    await user.upload(input, new File(['%PDF'], 'quote.pdf', { type: 'application/pdf' }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent("You don't have permission to do that."),
    );
    expect(adapterUpload).toHaveBeenCalledTimes(1);
    expect(dataSource.create).toHaveBeenCalledWith(
      'sys_attachment',
      expect.objectContaining({ parent_object: 'att_case', parent_id: 'r1', file_id: 'f-new' }),
    );
  });

  it('no flash while permissions load: a read-only answer never shows Upload, not even before it arrives', async () => {
    let answer!: (res: Response) => void;
    const fetcher = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          answer = resolve;
        }),
    ) as unknown as typeof fetch;

    // Record every Upload button ever attached, so a show-then-hide between
    // two assertions cannot pass unseen.
    let uploadEverShown = false;
    const observer = new MutationObserver(() => {
      if (screen.queryByRole('button', { name: 'Upload' })) uploadEverShown = true;
    });
    observer.observe(document.body, { childList: true, subtree: true });

    try {
      render(
        <MePermissionsProvider fetcher={fetcher} maxRetries={0}>
          {panel(makeDataSource())}
        </MePermissionsProvider>,
      );
      // The provider holds its children until it has an answer.
      await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
      expect(screen.queryByTestId('record-attachments-panel')).not.toBeInTheDocument();

      await act(async () => {
        answer(new Response(JSON.stringify(payload({})), { status: 200 }));
      });
      await rowsLoaded();

      expect(screen.queryByRole('button', { name: 'Upload' })).not.toBeInTheDocument();
      expect(uploadEverShown).toBe(false);
    } finally {
      observer.disconnect();
    }
  });

  it('with no permissions provider mounted, Upload and delete stay and the server remains the gate', async () => {
    render(panel(makeDataSource()));
    await rowsLoaded();

    expect(screen.getByRole('button', { name: 'Upload' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Delete attachment' })).toHaveLength(2);
  });
});
