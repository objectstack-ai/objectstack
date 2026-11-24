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
 * ## Why the uploader's own row is judged apart (objectstack#36488)
 *
 * The grant decides the data door only. The caller's own upload is removed
 * and renamed through the storage service's own doors at
 * `/api/v1/attachments/:id`, which admit the row whose `uploaded_by` names the
 * caller with no grant beyond read. So the grant cases below hold for another
 * user's row, and the caller's own row offers Delete and Rename under every
 * grant, read-only included.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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
  it('a read-only grant renders no Upload, and no delete on another user\'s row', async () => {
    renderWithGrant({});
    await rowsLoaded();

    expect(screen.queryByRole('button', { name: 'Upload' })).not.toBeInTheDocument();
    // Reading is untouched: both rows keep their Download. The own row's
    // Delete and Rename are the uploader's doors, pinned in their own describe.
    expect(await rowMenuItems('others.pdf')).toEqual(['Download']);
  });

  it('a create grant renders Upload (and no delete on another user\'s row without the delete grant)', async () => {
    renderWithGrant({ allowCreate: true });
    await rowsLoaded();

    expect(screen.getByRole('button', { name: 'Upload' })).toBeInTheDocument();
    expect(await rowMenuItems('others.pdf')).toEqual(['Download']);
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
  // offers Rename on the caller's own rows, and on another's only to a reader
  // who holds the edit grant — the delete grant plays no part in it.
  it('a reader holding the edit grant but not delete sees Rename on every row, and Delete only on their own', async () => {
    renderWithGrant({ allowCreate: true, allowEdit: true });
    await rowsLoaded();

    expect(await rowMenuItems('mine.pdf')).toEqual(['Download', 'Rename', 'Delete attachment']);
    expect(await rowMenuItems('others.pdf')).toEqual(['Download', 'Rename']);
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

describe('RecordAttachmentsPanel — the uploader deletes and renames their own upload with no grant beyond the member baseline (objectstack#36488)', () => {
  // The member baseline on `sys_attachment` is read and create. The storage
  // service's removal door and rename door admit the row whose `uploaded_by`
  // names the caller under that baseline, so the row menu offers both verbs
  // on the caller's own upload, and on another member's upload neither.
  const MEMBER: Grant = { allowCreate: true };

  // Only `vi.spyOn` spies are restored (vitest 4): the module-level adapter fns keep their wiring.
  afterEach(() => vi.restoreAllMocks());

  /** Answer every request the panel sends with `status` and `body`, and record them. */
  function serveDoor(status: number, body: unknown) {
    return vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () =>
        new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
    );
  }

  async function chooseOnRow(fileName: string, item: string) {
    const user = userEvent.setup();
    await user.click(within(rowOf(fileName)).getByRole('button', { name: `More for ${fileName}` }));
    await user.click(await screen.findByRole('menuitem', { name: item }));
    return user;
  }

  it('a plain member sees Delete and Rename on their own upload, and neither on another member\'s', async () => {
    renderWithGrant(MEMBER);
    await rowsLoaded();

    expect(await rowMenuItems('mine.pdf')).toEqual(['Download', 'Rename', 'Delete attachment']);
    expect(await rowMenuItems('others.pdf')).toEqual(['Download']);
  });

  it('the same holds where the read expanded the uploader into a user row', async () => {
    const find = vi.fn(async () => [
      { ...OTHERS_ROW, uploaded_by: { id: 'u-someone-else', name: 'Someone Else' } },
      { ...OWN_ROW, uploaded_by: { id: ME, name: 'Me' } },
    ]);
    renderWithGrant(MEMBER, makeDataSource({ find }));
    await rowsLoaded();

    expect(await rowMenuItems('mine.pdf')).toEqual(['Download', 'Rename', 'Delete attachment']);
    expect(await rowMenuItems('others.pdf')).toEqual(['Download']);
  });

  it('deleting their own upload goes through the removal door, the row leaves the list, and the data door is not asked', async () => {
    const fetchSpy = serveDoor(200, { success: true, data: { id: OWN_ROW.id, deleted: true } });
    const dataSource = makeDataSource();
    renderWithGrant(MEMBER, dataSource);
    await rowsLoaded();

    const user = await chooseOnRow('mine.pdf', 'Delete attachment');
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(screen.queryByText('mine.pdf')).not.toBeInTheDocument());
    expect(screen.getByText('others.pdf')).toBeInTheDocument();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [RequestInfo | URL, RequestInit];
    expect(String(url)).toMatch(/\/api\/v1\/attachments\/a2$/);
    expect(init.method).toBe('DELETE');
    expect(dataSource.delete).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('renaming their own upload goes through the rename door, and the row shows the stored name', async () => {
    const fetchSpy = serveDoor(200, { success: true, data: { id: OWN_ROW.id, file_name: 'mine-v2.pdf' } });
    renderWithGrant(MEMBER);
    await rowsLoaded();

    const user = await chooseOnRow('mine.pdf', 'Rename');
    const dialog = await screen.findByTestId('attachment-rename-dialog');
    const input = within(dialog).getByTestId('attachment-rename-input');
    await user.clear(input);
    await user.type(input, 'mine-v2.pdf');
    await user.click(within(dialog).getByTestId('attachment-rename-submit'));

    await waitFor(() => expect(screen.getByText('mine-v2.pdf')).toBeInTheDocument());
    const [url, init] = fetchSpy.mock.calls[0] as [RequestInfo | URL, RequestInit];
    expect(String(url)).toMatch(/\/api\/v1\/attachments\/a2$/);
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(String(init.body))).toEqual({ file_name: 'mine-v2.pdf' });
  });

  it('a removal the door refuses keeps the row and names the refusal', async () => {
    serveDoor(403, { success: false, error: { code: 'PERMISSION_DENIED', message: 'Not your attachment' } });
    renderWithGrant(MEMBER);
    await rowsLoaded();

    const user = await chooseOnRow('mine.pdf', 'Delete attachment');
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent("You don't have permission to do that."));
    expect(screen.getByText('mine.pdf')).toBeInTheDocument();
  });

  it('a delete-grant holder\'s delete of another member\'s upload still goes through the data door, never the removal door', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const dataSource = makeDataSource();
    renderWithGrant({ allowDelete: true }, dataSource);
    await rowsLoaded();

    const user = await chooseOnRow('others.pdf', 'Delete attachment');
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(screen.queryByText('others.pdf')).not.toBeInTheDocument());
    expect(dataSource.delete).toHaveBeenCalledWith('sys_attachment', OTHERS_ROW.id);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
