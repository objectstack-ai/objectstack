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
import { MePermissionsProvider, type MePermissionsAuthenticatedResponse } from '@object-ui/permissions';

/** The fake presigned adapter: `upload` resolving means the file was committed and attached. */
const adapterUpload = vi.fn();
/** The options the panel built its adapter with — `attachTo` names the record. */
const adapterOptions = vi.fn();

vi.mock('@object-ui/data-objectstack', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createObjectStackUploadAdapter: (opts: unknown) => {
    adapterOptions(opts);
    return { upload: adapterUpload };
  },
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

type Grant = { allowCreate?: boolean; allowEdit?: boolean; allowDelete?: boolean };

/** A `/me/permissions` answer for an authenticated caller with this `sys_attachment` grant. */
function payload(grant: Grant): MePermissionsAuthenticatedResponse {
  return {
    authenticated: true,
    userId: ME,
    tenantId: 'org-1',
    positions: [],
    hasAnyQueue: false,
    objectsUsingQueues: [],
    permissionSets: ['member'],
    objects: {
      sys_attachment: {
        allowRead: true,
        allowCreate: grant.allowCreate ?? false,
        allowEdit: grant.allowEdit ?? false,
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

/**
 * The actions in the ⋮ menu of the row listing `fileName`: a file row carries
 * its Download and Delete in that menu since the dense attachments rows
 * (objectstack#35602). The menu is closed again before returning.
 */
async function rowMenuItems(fileName: string): Promise<string[]> {
  const user = userEvent.setup();
  await user.click(within(rowOf(fileName)).getByRole('button', { name: `More for ${fileName}` }));
  const items = (await screen.findAllByRole('menuitem')).map((el) => el.textContent?.trim() ?? '');
  await user.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
  return items;
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
    // The own row specifically: `uploaded_by === ME`, and still no delete.
    // Reading is untouched: both rows keep their Download.
    expect(await rowMenuItems('mine.pdf')).toEqual(['Download']);
    expect(await rowMenuItems('others.pdf')).toEqual(['Download']);
  });

  it('a create grant renders Upload (and no delete without the delete grant)', async () => {
    renderWithGrant({ allowCreate: true });
    await rowsLoaded();

    expect(screen.getByRole('button', { name: 'Upload' })).toBeInTheDocument();
    expect(await rowMenuItems('mine.pdf')).toEqual(['Download']);
  });

  it('the uploader sees delete on their own file', async () => {
    renderWithGrant({ allowDelete: true });
    await rowsLoaded();

    expect(await rowMenuItems('mine.pdf')).toContain('Delete attachment');
    // Another user's row keeps it too: whether the caller may edit the parent
    // record is the server's to judge, and the refusal mapping answers it.
    expect(await rowMenuItems('others.pdf')).toContain('Delete attachment');
    // No create grant, no Upload.
    expect(screen.queryByRole('button', { name: 'Upload' })).not.toBeInTheDocument();
  });

  it('CONTROL — with Upload shown and the server refusing the attach, the refusal message still appears', async () => {
    // The attach is the upload's own completion (`attachTo`), so the server's
    // refusal is the upload's.
    adapterUpload.mockRejectedValue(
      Object.assign(new Error('Upload completion failed (403): {"success":false,"error":{"code":"PERMISSION_DENIED"}}'), {
        status: 403,
        code: 'PERMISSION_DENIED',
      }),
    );
    const dataSource = makeDataSource();
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
    expect(adapterOptions).toHaveBeenLastCalledWith(
      expect.objectContaining({ scope: 'attachments', attachTo: { parentObject: 'att_case', parentId: 'r1' } }),
    );
    // No `sys_attachment` create through the generic data door.
    expect(dataSource.create).not.toHaveBeenCalled();
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
    expect(await rowMenuItems('mine.pdf')).toContain('Delete attachment');
    expect(await rowMenuItems('others.pdf')).toContain('Delete attachment');
  });
});

describe('RecordAttachmentsPanel — Rename follows the rename door\'s two limbs (objectstack#35724)', () => {
  // The server renames by the attachment delete rule (uploader or parent
  // editor): the uploader's own rename needs no edit grant, and anyone else's
  // is written as the caller, which needs the edit grant. So the row menu
  // offers Rename where it offers Delete, on the caller's own rows, and on
  // every row only to a reader who also holds the edit grant.
  it('a reader who may not delete sees no Rename, on the own row and on another\'s', async () => {
    renderWithGrant({ allowCreate: true, allowEdit: true });
    await rowsLoaded();

    expect(await rowMenuItems('mine.pdf')).not.toContain('Rename');
    expect(await rowMenuItems('others.pdf')).not.toContain('Rename');
  });

  it('the uploader holding delete but not edit sees Rename on their own row and no Rename on another\'s', async () => {
    renderWithGrant({ allowDelete: true });
    await rowsLoaded();

    expect(await rowMenuItems('mine.pdf')).toEqual(['Download', 'Rename', 'Delete attachment']);
    expect(await rowMenuItems('others.pdf')).toEqual(['Download', 'Delete attachment']);
  });

  it('the same holds where the read expanded the uploader into a user row', async () => {
    const find = vi.fn(async () => [
      { ...OTHERS_ROW, uploaded_by: { id: 'u-someone-else', name: 'Someone Else' } },
      { ...OWN_ROW, uploaded_by: { id: ME, name: 'Me' } },
    ]);
    renderWithGrant({ allowDelete: true }, makeDataSource({ find }));
    await rowsLoaded();

    expect(await rowMenuItems('mine.pdf')).toEqual(['Download', 'Rename', 'Delete attachment']);
    expect(await rowMenuItems('others.pdf')).toEqual(['Download', 'Delete attachment']);
  });

  it('a reader who may delete and edit sees Rename beside Delete on every row', async () => {
    renderWithGrant({ allowDelete: true, allowEdit: true });
    await rowsLoaded();

    expect(await rowMenuItems('mine.pdf')).toEqual(['Download', 'Rename', 'Delete attachment']);
    expect(await rowMenuItems('others.pdf')).toEqual(['Download', 'Rename', 'Delete attachment']);
  });
});
