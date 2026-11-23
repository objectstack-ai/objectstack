// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36511 — a permission set in the Studio's Access pillar saves with
 * the top bar's Save and Cancel, and a Save is live at once.
 *
 * - A grant clicked sends nothing: no draft write leaves before Save is
 *   pressed, however long the page waits (the set's 1.5 s autosave is gone
 *   from the Studio).
 * - Save writes the set's draft at its package, then publishes that one set at
 *   the same package (`POST /meta/permission/NAME/publish?package=`).
 * - Cancel sends nothing and puts the matrix back as the server holds it.
 * - A refused publish keeps the grant unsaved, says why on the page, and takes
 *   back the draft the Save wrote.
 *
 * The REAL `AccessPillar` inside the top bar's coordinator; the writes go
 * through a REAL `MetadataClient` whose transport records each one, so the pins
 * read the URL the server would read. The environment door (metadata-admin,
 * no package) keeps its own Save and live write: pinned in
 * `PermissionMatrixEditor.saveSurface-12725.test.tsx`.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MetadataClient } from '@object-ui/data-objectstack';

const PKG = 'com.acme.crm';

const SET = {
  name: 'sales_perms',
  label: 'Sales',
  objects: { a_account: { allowRead: false, allowCreate: true } },
  fields: {},
};

interface Write {
  method: string;
  url: URL;
  body: Record<string, unknown> | null;
}
const writes: Write[] = [];
const door = { refusePublish: false };

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

async function serve(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = new URL(String(input), 'http://console.test');
  const method = (init?.method ?? 'GET').toUpperCase();
  if (method === 'GET') return json(404, { error: { code: 'NOT_FOUND', message: 'absent' } });
  writes.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : null });
  if (method === 'POST' && door.refusePublish) {
    return json(422, { success: false, error: { code: 'INVALID_METADATA', message: 'The set grants on an object that is not live.' } });
  }
  return json(200, { success: true, version: 'v2', state: url.searchParams.get('mode') ?? 'active' });
}

const wire = new MetadataClient({ baseUrl: '', fetch: vi.fn(serve) as unknown as typeof fetch });

/** The reads the pillar makes, answered in memory; the writes are the real client's. */
const client = {
  withPreviewDrafts() { return this; },
  list: async (type: string) => {
    if (type === 'permission') return [{ name: SET.name, label: SET.label }];
    if (type === 'object') return [{ name: 'a_account', label: 'Account' }];
    return [];
  },
  listDrafts: async () => [],
  layered: async () => ({ effective: SET, code: null, overlay: null, overlayScope: null }),
  getDraft: async () => null,
  get: async () => null,
  save: (...args: Parameters<MetadataClient['save']>) => wire.save(...args),
  publish: (...args: Parameters<MetadataClient['publish']>) => wire.publish(...args),
  reset: (...args: Parameters<MetadataClient['reset']>) => wire.reset(...args),
};

vi.mock('./useMetadata', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useMetadataClient: () => client,
    useMetadataTypes: () => ({
      loading: false,
      error: null,
      entries: [{ type: 'permission', label: 'Permission', allowEnvironmentOverlay: true }],
    }),
  };
});
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), message: vi.fn(), dismiss: vi.fn() },
  Toaster: () => null,
}));
vi.mock('./AssignedUsersSection', () => ({ AssignedUsersSection: () => null }));
vi.mock('./AccessExplainPanel', () => ({ AccessExplainPanel: () => null }));
vi.mock('../../components/SuggestedBindingsPanel', () => ({ SuggestedBindingsPanel: () => null }));
vi.mock('../studio-design/StudioAiCopilot', () => ({ StudioChatDock: () => null }));

import { toast } from 'sonner';
import { AccessPillar } from '../studio-design/StudioDesignSurface';
import { StudioSaveHarness, pressStudioCancel, pressStudioSave } from '../studio-design/__tests__/studioSaveHarness';
import { tFormat } from './i18n';

window.matchMedia = ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addEventListener: () => {},
  removeEventListener: () => {},
  addListener: () => {},
  removeListener: () => {},
  dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia;

const readBox = () => screen.getByRole('checkbox', { name: 'a_account Read' });
const describeWrite = (w: Write) => `${w.method} ${w.url.pathname}${w.url.search}`;

/** Past the retired autosave's 1.5 s debounce and a round trip. */
async function waitPastTheOldAutosave(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 2300));
  });
}

async function mount(): Promise<void> {
  render(
    <StudioSaveHarness>
      <MemoryRouter>
        <AccessPillar packageId={PKG} />
      </MemoryRouter>
    </StudioSaveHarness>,
  );
  await waitFor(() => expect(readBox()).toBeInTheDocument(), { timeout: 8000 });
  expect(readBox()).not.toBeChecked();
}

beforeEach(() => {
  window.confirm = vi.fn(() => true) as unknown as typeof window.confirm;
});
afterEach(() => {
  cleanup();
  writes.length = 0;
  door.refusePublish = false;
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
});

describe('Access — a permission set saves with the top bar, live at once (objectstack#36511)', () => {
  it('a grant sends nothing until Save; Save writes the draft, then publishes that set at its package', async () => {
    await mount();
    expect(screen.queryByTestId('studio-save')).toBeNull();
    fireEvent.click(readBox());
    expect(await screen.findByTestId('studio-save')).toBeInTheDocument();
    await waitPastTheOldAutosave();
    expect(writes.map(describeWrite), 'no write before Save').toEqual([]);

    await pressStudioSave();
    await waitFor(() => expect(writes).toHaveLength(2), { timeout: 4000 });
    const [draft, publish] = writes;
    expect(draft.method).toBe('PUT');
    expect(draft.url.pathname).toBe('/api/v1/meta/permission/sales_perms');
    expect(draft.url.searchParams.get('mode')).toBe('draft');
    expect(draft.url.searchParams.get('package')).toBe(PKG);
    expect((draft.body?.objects as Record<string, { allowRead?: boolean }>).a_account.allowRead).toBe(true);
    expect(publish.method).toBe('POST');
    expect(publish.url.pathname).toBe('/api/v1/meta/permission/sales_perms/publish');
    expect(publish.url.searchParams.get('package')).toBe(PKG);

    await waitFor(() => expect(screen.queryByTestId('studio-save')).toBeNull());
    expect(readBox()).toBeChecked();
    expect(toast.success).toHaveBeenCalledWith(tFormat('engine.studio.save.done', 'en', { items: 'Sales' }), { id: 'studio-save' });
  });

  it('Cancel sends nothing and puts the matrix back as the server holds it', async () => {
    await mount();
    fireEvent.click(readBox());
    expect(readBox()).toBeChecked();
    await pressStudioCancel();
    await waitFor(() => expect(readBox()).not.toBeChecked());
    expect(screen.queryByTestId('studio-save')).toBeNull();
    await waitPastTheOldAutosave();
    expect(writes.map(describeWrite)).toEqual([]);
  });

  it('a refused publish keeps the grant unsaved, says why, and takes back the draft it wrote', async () => {
    door.refusePublish = true;
    await mount();
    fireEvent.click(readBox());
    await pressStudioSave();
    await waitFor(() => expect(writes.map((w) => w.method)).toEqual(['PUT', 'POST', 'DELETE']), { timeout: 4000 });
    const discard = writes[2];
    expect(discard.url.pathname).toBe('/api/v1/meta/permission/sales_perms');
    expect(discard.url.searchParams.get('state')).toBe('draft');
    expect(discard.url.searchParams.get('package')).toBe(PKG);
    expect(readBox(), 'the grant is still on the page').toBeChecked();
    expect(screen.getByTestId('studio-save'), 'and still offered to Save').toBeInTheDocument();
    expect(await screen.findByText(/The set grants on an object that is not live\./)).toBeInTheDocument();
    expect(toast.success).not.toHaveBeenCalled();
  });
});
