// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Setup → Configuration → Recycle bin (ADR-0148 D2, objectstack#30239).
 *
 * Real chain: the page, `CatalogAssignmentPage`, the core's restore
 * (`recordDelete.undo`) and refusal sentences, the shipped packs under a real
 * `I18nProvider`, and a real `MePermissionsProvider`. The stand-ins are the
 * adapter (its SDK `recycleBin` doors, `restoreRecycleBinEntry`, `find`), the
 * metadata store, and sonner.
 *
 * - The object list is the catalog narrowed to the business objects whose
 *   `manageRecycleBin` the caller holds; it sends no bin read.
 * - A caller who manages no bin is told so, and no bin read is sent.
 * - A picked object reads one page (limit 50, offset 0); Load more reads the
 *   next one and appends it.
 * - Restore is a restore, never a create; a refusal says why, by label.
 * - Empty asks first, then reports how many it removed.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nProvider } from '@object-ui/i18n';
import { builtInLocales } from '@object-ui/i18n/locales';
import { MePermissionsProvider, type MePermissionsResponse } from '@object-ui/permissions';

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));

type Entry = {
  id: string;
  object: string;
  recordId: string;
  recordCount: number;
  deletedBy: string | null;
  deletedAt: string | null;
  retentionDays: number | null;
  purgeAfter: string | null;
  rows: Array<{ object: string; id: string; values: Record<string, unknown> }>;
};

function entry(n: number, extra: Partial<Entry> = {}): Entry {
  return {
    id: `rb_${n}`,
    object: 'crm_lead',
    recordId: `l_${n}`,
    recordCount: 1,
    deletedBy: 'u_1',
    deletedAt: '2026-11-08T10:00:00.000Z',
    retentionDays: 30,
    purgeAfter: '2026-12-08T10:00:00.000Z',
    rows: [{ object: 'crm_lead', id: `l_${n}`, values: { id: `l_${n}`, full_name: `Lead ${n}` } }],
    ...extra,
  };
}

let bin: Entry[] = [];
let listError: unknown = null;
let restoreError: unknown = null;

const doors = {
  list: vi.fn(async (_object: string, opts?: { limit?: number; offset?: number }) => {
    if (listError) throw listError;
    const offset = opts?.offset ?? 0;
    const limit = opts?.limit ?? 50;
    return { object: 'crm_lead', entries: bin.slice(offset, offset + limit), hasMore: offset + limit < bin.length };
  }),
  empty: vi.fn(async (object: string) => {
    const removed = bin.length;
    bin = [];
    return { object, removed };
  }),
};

const adapter = {
  getClient: () => ({ recycleBin: doors }),
  find: vi.fn(async (_object: string, query: any) => {
    const ids: string[] = query?.$filter?.id?.$in ?? [];
    return { data: [{ id: 'u_1', name: 'Ada Admin' }].filter((u) => ids.includes(u.id)) };
  }),
  create: vi.fn(),
  restoreRecycleBinEntry: vi.fn(async (_object: string, entryId: string) => {
    if (restoreError) throw restoreError;
    bin = bin.filter((e) => e.id !== entryId);
    return { entryId };
  }),
};

const objects = [
  {
    name: 'crm_lead',
    label: 'Lead',
    nameField: 'full_name',
    fields: { full_name: { type: 'text', label: 'Full name' }, email: { type: 'email', label: 'Email' } },
  },
  { name: 'crm_account', label: 'Account', fields: { name: { type: 'text', label: 'Name' } } },
  { name: 'crm_note', label: 'Note', fields: {} },
  { name: 'sys_user', label: 'User', fields: {} },
];
const metadata = {
  objects,
  ensureType: vi.fn(async (type: string) => (type === 'object' ? objects : [])),
  getTypeStatus: vi.fn(() => 'ready'),
  refresh: vi.fn(async () => {}),
};
vi.mock('@object-ui/react', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAdapter: () => adapter,
  useMetadata: () => metadata,
}));

import { toast } from 'sonner';
import { RecycleBinPage } from './RecycleBinPage';

type Pack = {
  common: { cancel: string };
  objectActions: { restoredNamed: string; restoreFailed: string };
  recycleBin: { refusal: Record<string, string>; page: Record<string, string> };
};
const PACKS = {
  en: builtInLocales.en as unknown as Pack,
  zh: builtInLocales['zh-Hans'] as unknown as Pack,
};
const fill = (template: string, vars: Record<string, string | number>) =>
  template.replace(/\{\{(\w+)\}\}/g, (_m, k) => String(vars[k] ?? ''));

function grants(objectsMap: Record<string, Record<string, boolean>>): MePermissionsResponse {
  return {
    authenticated: true,
    userId: 'u_1',
    tenantId: null,
    positions: [],
    permissionSets: [],
    objects: objectsMap,
    fields: {},
    hasAnyQueue: false,
  } as MePermissionsResponse;
}

/** Manages the Lead and Note bins; reads Account without managing it. */
const MANAGER = grants({
  crm_lead: { allowRead: true, manageRecycleBin: true },
  crm_note: { allowRead: true, allowRestoreOwnDeleted: true, manageRecycleBin: true },
  crm_account: { allowRead: true, allowDelete: true },
  sys_user: { allowRead: true, manageRecycleBin: true },
});
/** A plain member: reads and deletes, may restore its own deletes, manages no bin. */
const MEMBER = grants({ crm_lead: { allowRead: true, allowDelete: true, allowRestoreOwnDeleted: true } });

function renderPage(language: keyof typeof PACKS, permissions: MePermissionsResponse, search = '') {
  return render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }} persistLanguage={false}>
      <MePermissionsProvider initialPermissions={permissions}>
        <MemoryRouter initialEntries={[`/apps/setup/component/data/recycle-bin${search}`]}>
          <RecycleBinPage />
        </MemoryRouter>
      </MePermissionsProvider>
    </I18nProvider>,
  );
}

beforeEach(() => {
  bin = [entry(1), entry(2, { recordCount: 3 })];
  listError = null;
  restoreError = null;
  vi.clearAllMocks();
});

afterEach(cleanup);

describe('Setup → Recycle bin: the object list (objectstack#30239)', () => {
  const pack = PACKS.en;

  it('lists only the business objects whose bin the caller manages, and reads no bin', async () => {
    renderPage('en', MANAGER);
    const list = await screen.findByRole('list', { name: pack.recycleBin.page.objectsList });
    expect(within(list).getByRole('button', { name: /Lead/ })).toBeInTheDocument();
    expect(within(list).getByRole('button', { name: /Note/ })).toBeInTheDocument();
    // Account is read but not managed; sys_user is a platform object, never in the bin.
    expect(within(list).queryByRole('button', { name: /Account/ })).toBeNull();
    expect(within(list).queryByRole('button', { name: /User/ })).toBeNull();
    expect(screen.getByTestId('setup-recycle-bin-pick')).toHaveTextContent(pack.recycleBin.page.pick);
    expect(doors.list).not.toHaveBeenCalled();
  });

  it("a member who manages no bin is told so, and no bin read is sent", async () => {
    renderPage('en', MEMBER);
    expect(await screen.findByText(pack.recycleBin.page.noObjectsTitle)).toBeInTheDocument();
    expect(screen.getByText(pack.recycleBin.page.noObjectsBody)).toBeInTheDocument();
    expect(doors.list).not.toHaveBeenCalled();
  });

  it("control: '*' modifyAllRecords manages every business object's bin, never a platform object's", async () => {
    renderPage('en', grants({ '*': { modifyAllRecords: true } }));
    const list = await screen.findByRole('list', { name: pack.recycleBin.page.objectsList });
    expect(within(list).getAllByRole('button').map((b) => b.textContent)).toEqual([
      expect.stringContaining('Account'),
      expect.stringContaining('Lead'),
      expect.stringContaining('Note'),
    ]);
  });

  it('a link to an object the caller does not manage reads nothing', async () => {
    renderPage('en', MANAGER, '?object=crm_account');
    expect(await screen.findByTestId('setup-recycle-bin-not-found')).toBeInTheDocument();
    expect(doors.list).not.toHaveBeenCalled();
  });
});

describe('Setup → Recycle bin: one object (objectstack#30239)', () => {
  const pack = PACKS.en;

  it('reads one page of 50, names the record, the related rows and who deleted it (one user read)', async () => {
    renderPage('en', MANAGER, '?object=crm_lead');
    const rows = await screen.findAllByTestId('recycle-bin-entry');
    expect(rows).toHaveLength(2);
    expect(doors.list).toHaveBeenCalledTimes(1);
    expect(doors.list).toHaveBeenCalledWith('crm_lead', { limit: 50, offset: 0 });
    expect(within(rows[0]).getByText('Lead 1')).toBeInTheDocument();
    expect(within(rows[1]).getByText(fill(pack.recycleBin.page.related_other, { count: 2 }))).toBeInTheDocument();
    expect(within(rows[0]).queryByText(/related/)).toBeNull();
    await waitFor(() => expect(within(rows[0]).getByText('Ada Admin')).toBeInTheDocument());
    expect(adapter.find).toHaveBeenCalledTimes(1);
    expect(adapter.find).toHaveBeenCalledWith('sys_user', { $filter: { id: { $in: ['u_1'] } }, $top: 1 });
    expect(screen.queryByRole('button', { name: pack.recycleBin.page.loadMore })).toBeNull();
  });

  it('Load more reads the next page at offset 50 and appends it, until the door says there is no more', async () => {
    bin = Array.from({ length: 60 }, (_, i) => entry(i + 1));
    renderPage('en', MANAGER, '?object=crm_lead');
    expect(await screen.findAllByTestId('recycle-bin-entry')).toHaveLength(50);
    fireEvent.click(screen.getByRole('button', { name: pack.recycleBin.page.loadMore }));
    await waitFor(() => expect(screen.getAllByTestId('recycle-bin-entry')).toHaveLength(60));
    expect(doors.list).toHaveBeenLastCalledWith('crm_lead', { limit: 50, offset: 50 });
    expect(screen.queryByRole('button', { name: pack.recycleBin.page.loadMore })).toBeNull();
  });

  it('an empty bin says so', async () => {
    bin = [];
    renderPage('en', MANAGER, '?object=crm_lead');
    expect(await screen.findByTestId('recycle-bin-empty')).toHaveTextContent(
      fill(pack.recycleBin.page.entriesEmpty, { object: 'Lead' }),
    );
    expect(screen.getByTestId('recycle-bin-empty-action')).toBeDisabled();
  });

  it('a deployment with no recycle bin reads its own sentence, with a retry', async () => {
    listError = Object.assign(new Error('raw'), { code: 'NOT_IMPLEMENTED', httpStatus: 501 });
    renderPage('en', MANAGER, '?object=crm_lead');
    const alert = await screen.findByTestId('recycle-bin-load-failed');
    expect(alert).toHaveTextContent(pack.recycleBin.refusal.notAvailable);
    listError = null;
    fireEvent.click(within(alert).getByRole('button'));
    expect(await screen.findAllByTestId('recycle-bin-entry')).toHaveLength(2);
  });
});

describe.each(['en', 'zh'] as const)('Setup → Recycle bin: restore and empty in %s (objectstack#30239)', (language) => {
  const pack = PACKS[language];

  it('Restore restores the entry (never a create), names the record and drops its row', async () => {
    renderPage(language, MANAGER, '?object=crm_lead');
    const rows = await screen.findAllByTestId('recycle-bin-entry');
    fireEvent.click(within(rows[0]).getByRole('button', { name: pack.recycleBin.page.restore }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1));
    expect(adapter.restoreRecycleBinEntry).toHaveBeenCalledWith('crm_lead', 'rb_1');
    expect(adapter.create).not.toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith(fill(pack.objectActions.restoredNamed, { label: 'Lead', name: 'Lead 1' }));
    await waitFor(() => expect(screen.getAllByTestId('recycle-bin-entry')).toHaveLength(1));
    expect(doors.list).toHaveBeenCalledTimes(1);
  });

  it.each([
    [
      'RESTORE_UNIQUE_VALUE_TAKEN',
      { object: 'crm_lead', recordId: 'l_1', field: 'email' },
      (p: Pack) => fill(p.recycleBin.refusal.uniqueValueTaken, { field: 'Email' }),
    ],
    [
      'RESTORE_PARENT_IN_RECYCLE_BIN',
      { parentObject: 'crm_account', parentId: 'a_1', parentEntryId: 'rb_9' },
      (p: Pack) => fill(p.recycleBin.refusal.parentInRecycleBin, { parent: 'Account' }),
    ],
  ])('a refused restore (%s) says why, naming fields and objects by label, and keeps the row', async (code, details, sentence) => {
    restoreError = Object.assign(new Error('raw server text'), { code, httpStatus: 409, details });
    renderPage(language, MANAGER, '?object=crm_lead');
    const rows = await screen.findAllByTestId('recycle-bin-entry');
    fireEvent.click(within(rows[0]).getByRole('button', { name: pack.recycleBin.page.restore }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    expect(toast.error).toHaveBeenCalledWith(fill(pack.objectActions.restoreFailed, { label: 'Lead' }), {
      description: sentence(pack),
    });
    expect(screen.getAllByTestId('recycle-bin-entry')).toHaveLength(2);
  });

  it('control: a refusal with a code nobody names keeps the server message', async () => {
    restoreError = Object.assign(new Error('raw server text'), { code: 'SOMETHING_ELSE', httpStatus: 409 });
    renderPage(language, MANAGER, '?object=crm_lead');
    const rows = await screen.findAllByTestId('recycle-bin-entry');
    fireEvent.click(within(rows[0]).getByRole('button', { name: pack.recycleBin.page.restore }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    expect((toast.error as any).mock.calls[0][1]).toEqual({ description: 'raw server text' });
  });

  it('Empty asks first, says it is permanent, then reports how many it removed', async () => {
    renderPage(language, MANAGER, '?object=crm_lead');
    await screen.findAllByTestId('recycle-bin-entry');
    fireEvent.click(screen.getByTestId('recycle-bin-empty-action'));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(fill(pack.recycleBin.page.emptyTitle, { object: 'Lead' }))).toBeInTheDocument();
    expect(within(dialog).getByText(fill(pack.recycleBin.page.emptyBody, { object: 'Lead' }))).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: pack.recycleBin.page.emptyAction }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1));
    expect(doors.empty).toHaveBeenCalledWith('crm_lead');
    expect(toast.success).toHaveBeenCalledWith(fill(pack.recycleBin.page.emptied_other, { count: 2 }));
    expect(await screen.findByTestId('recycle-bin-empty')).toBeInTheDocument();
  });

  it('control: Cancel empties nothing', async () => {
    renderPage(language, MANAGER, '?object=crm_lead');
    await screen.findAllByTestId('recycle-bin-entry');
    fireEvent.click(screen.getByTestId('recycle-bin-empty-action'));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: pack.common.cancel }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(doors.empty).not.toHaveBeenCalled();
    expect(screen.getAllByTestId('recycle-bin-entry')).toHaveLength(2);
  });
});
