// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#26836 — the Access pillar's "+ New" over an identifier a
 * permission set already holds, and the discard of a set's pending draft.
 *
 * The create's first-write pin (`If-None-Match: *` with `?mode=draft`)
 * asserts that no DRAFT row exists, so a name that derived to a PUBLISHED
 * set's identifier wrote a blank draft over the live set, and publishing the
 * package would have replaced its grants. Studio offered no way to remove that
 * draft.
 *
 *  - Create over a published id (this package's): refused, nothing written,
 *    the sentence names the set, and "Open" opens it.
 *  - Create over a published id another package holds: refused, nothing
 *    written, and no "Open".
 *  - Create over a draft id: refused before the save, and the save still
 *    carries the first-write pin for a draft that lands after the check.
 *  - A fresh id: created as before.
 *  - Discard: a published set's draft goes and the matrix reads the live
 *    set again; a never-published set leaves the rail.
 *
 * The REAL `AccessPillar` and `PermissionMatrixEditPage`, over a client that
 * keeps published and draft rows the way the metadata door does.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const PKG = 'com.acme.app';
const OTHER_PKG = 'com.other.app';

type Row = { pkg: string; body: Record<string, unknown> };

let clientImpl: ReturnType<typeof makeClient>;

vi.mock('../metadata-admin/useMetadata', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useMetadataClient: () => clientImpl,
    useMetadataTypes: () => ({
      loading: false,
      error: null,
      entries: [{ type: 'permission', label: 'Permission', allowEnvironmentOverlay: true }],
    }),
  };
});
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../components/SuggestedBindingsPanel', () => ({ SuggestedBindingsPanel: () => null }));
vi.mock('../metadata-admin/AccessExplainPanel', () => ({ AccessExplainPanel: () => null }));
vi.mock('./StudioAiCopilot', () => ({ StudioChatDock: () => null }));

import { toast } from 'sonner';
import { t, tFormat } from '../metadata-admin/i18n';
import { AccessPillar } from './StudioDesignSurface';

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

const en = (key: string) => t(key, 'en');

const EDITOR = { name: 'project_editor', label: 'Project Editor', objects: { crm_lead: { allowRead: true } }, fields: {} };

/** A metadata door double: published rows and draft rows, each owned by a package. */
function makeClient(seed: { published?: Record<string, Row>; drafts?: Record<string, Row> } = {}) {
  const published: Record<string, Row> = { ...(seed.published ?? {}) };
  const drafts: Record<string, Row> = { ...(seed.drafts ?? {}) };
  const save = vi.fn(
    async (_type: string, name: string, body: Record<string, unknown>, opts: { packageId?: string; ifNoneMatch?: string }) => {
      if (opts?.ifNoneMatch === '*' && drafts[name]) {
        throw Object.assign(new Error(`permission/${name}: this save asserted that no draft row exists`), {
          status: 409,
          code: 'METADATA_CONFLICT',
        });
      }
      drafts[name] = { pkg: opts?.packageId ?? '', body };
      return body;
    },
  );
  const reset = vi.fn(async (_type: string, name: string, _opts: { state?: string; packageId?: string }) => {
    delete drafts[name];
    return {};
  });
  return {
    published,
    drafts,
    save,
    reset,
    list: vi.fn(async (type: string, opts: { packageId?: string } = {}) => {
      if (type === 'object') {
        return [
          { name: 'crm_account', label: 'Account' },
          { name: 'crm_lead', label: 'Lead' },
        ];
      }
      if (type !== 'permission') return [];
      return Object.values(published)
        .filter((r) => !opts.packageId || r.pkg === opts.packageId)
        .map((r) => ({ name: r.body.name, label: r.body.label }));
    }),
    listDrafts: vi.fn(async (opts: { packageId?: string; type?: string } = {}) =>
      Object.values(drafts)
        .filter((r) => !opts.packageId || r.pkg === opts.packageId)
        .map((r) => ({ type: 'permission', name: r.body.name, label: r.body.label, packageId: r.pkg })),
    ),
    layered: vi.fn(async (_type: string, name: string) => ({
      effective: published[name]?.body ?? null,
      code: null,
      overlay: null,
      overlayScope: null,
    })),
    getDraft: vi.fn(async (type: string, name: string) =>
      drafts[name] ? { type, name, item: drafts[name].body } : null,
    ),
    get: vi.fn(async () => ({ fields: [] })),
  };
}

beforeEach(() => {
  window.confirm = vi.fn(() => true) as unknown as typeof window.confirm;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderAccess(readOnly = false) {
  render(
    <MemoryRouter>
      <AccessPillar packageId={PKG} readOnly={readOnly} />
    </MemoryRouter>,
  );
}

const header = () => within(screen.getByTestId('access-item-header'));
const rail = () => within(screen.getByTestId('studio-rail-access'));

async function openCreate(label: string, name?: string) {
  fireEvent.click(await screen.findByTestId('studio-rail-add', undefined, { timeout: 8000 }));
  const dialog = await screen.findByRole('dialog', { name: en('engine.studio.access.new') });
  fireEvent.change(within(dialog).getByLabelText(en('engine.studio.access.nameLabel')), { target: { value: label } });
  if (name) {
    fireEvent.change(within(dialog).getByLabelText(en('engine.studio.access.idLabel')), { target: { value: name } });
  }
  fireEvent.click(within(dialog).getByRole('button', { name: en('engine.studio.createDraft') }));
  return dialog;
}

describe('objectstack#26836 — "+ New" over a taken identifier', () => {
  it('a published set of this package: refused, nothing written, the set named, and "Open" opens it', async () => {
    clientImpl = makeClient({ published: { project_editor: { pkg: PKG, body: EDITOR } } });
    renderAccess();
    await screen.findByText('1 object granted · 0 field overrides', undefined, { timeout: 8000 });
    // Leave the set, so "Open" has somewhere to go back from.
    fireEvent.click(rail().getByText(en('engine.studio.owd.railLabel')));

    const dialog = await openCreate('Project Editor');
    const taken = await within(dialog).findByTestId('access-create-taken');
    expect(taken).toHaveTextContent(
      tFormat('engine.studio.access.createTaken', 'en', { name: 'project_editor', label: 'Project Editor' }),
    );
    expect(clientImpl.save).not.toHaveBeenCalled();
    expect(clientImpl.drafts).toEqual({});

    fireEvent.click(within(taken).getByTestId('access-create-open-existing'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await screen.findByText('1 object granted · 0 field overrides')).toBeInTheDocument();
    expect(header().getByRole('heading', { level: 1 })).toHaveTextContent('Project Editor');
    expect(clientImpl.save).not.toHaveBeenCalled();
  });

  it('a published set another package holds: refused, nothing written, and no "Open"', async () => {
    clientImpl = makeClient({ published: { project_editor: { pkg: OTHER_PKG, body: EDITOR } } });
    renderAccess();
    const dialog = await openCreate('Project Editor');
    const taken = await within(dialog).findByTestId('access-create-taken');
    expect(taken).toHaveTextContent(
      tFormat('engine.studio.access.createTakenElsewhere', 'en', { name: 'project_editor', label: 'Project Editor' }),
    );
    expect(within(taken).queryByTestId('access-create-open-existing')).toBeNull();
    expect(clientImpl.save).not.toHaveBeenCalled();
    expect(clientImpl.drafts).toEqual({});
  });

  it('a draft set: refused before the save', async () => {
    clientImpl = makeClient({
      drafts: { project_editor: { pkg: PKG, body: { name: 'project_editor', label: 'Project Editor', objects: {} } } },
    });
    renderAccess();
    const dialog = await openCreate('Project Editor');
    expect(await within(dialog).findByTestId('access-create-taken')).toHaveTextContent(
      tFormat('engine.studio.access.createTaken', 'en', { name: 'project_editor', label: 'Project Editor' }),
    );
    expect(clientImpl.save).not.toHaveBeenCalled();
  });

  it('a draft that lands after the check: the door\'s first-write pin still refuses it (objectui#11773)', async () => {
    clientImpl = makeClient();
    renderAccess();
    await screen.findByTestId('access-empty', undefined, { timeout: 8000 });
    // The draft appears between the pillar's read and its save.
    clientImpl.drafts.project_editor = {
      pkg: PKG,
      body: { name: 'project_editor', label: 'Somebody else', objects: { crm_lead: { allowRead: true } } },
    };
    clientImpl.listDrafts.mockResolvedValueOnce([]);
    const dialog = await openCreate('Project Editor');
    await waitFor(() => expect(clientImpl.save).toHaveBeenCalledTimes(1));
    expect(clientImpl.save.mock.calls[0][3]).toMatchObject({ mode: 'draft', packageId: PKG, ifNoneMatch: '*' });
    expect(await within(dialog).findByText(/asserted that no draft row exists/)).toBeInTheDocument();
    expect(clientImpl.drafts.project_editor.body.label).toBe('Somebody else');
  });

  it('a fresh identifier: created as a draft, as before, and opened', async () => {
    clientImpl = makeClient({ published: { project_editor: { pkg: PKG, body: EDITOR } } });
    renderAccess();
    await screen.findByText('1 object granted · 0 field overrides', undefined, { timeout: 8000 });
    await openCreate('Project Viewer');
    await waitFor(() => expect(clientImpl.save).toHaveBeenCalledTimes(1));
    const [type, name, , opts] = clientImpl.save.mock.calls[0];
    expect([type, name]).toEqual(['permission', 'project_viewer']);
    expect(opts).toMatchObject({ mode: 'draft', packageId: PKG, ifNoneMatch: '*', surface: 'studio' });
    expect(toast.success).toHaveBeenCalledWith(tFormat('engine.studio.access.created', 'en', { label: 'Project Viewer' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await rail().findByText('project_viewer')).toBeInTheDocument();
    await waitFor(() => expect(header().getByText('project_viewer')).toBeInTheDocument());
  });
});

describe('objectstack#26836 — discarding a set\'s pending draft', () => {
  it('a published set: the draft goes, the matrix reads the live set again, and the set stays', async () => {
    clientImpl = makeClient({
      published: { project_editor: { pkg: PKG, body: EDITOR } },
      drafts: { project_editor: { pkg: PKG, body: { name: 'project_editor', label: 'Project Editor', objects: {} } } },
    });
    renderAccess();
    // The blank draft is what the matrix shows.
    expect(await screen.findByText('0 objects granted · 0 field overrides', undefined, { timeout: 8000 })).toBeInTheDocument();

    fireEvent.click(await header().findByTestId('access-discard-draft'));
    expect(window.confirm).toHaveBeenCalledWith(
      tFormat('engine.studio.access.discardConfirm', 'en', { item: 'Project Editor' }),
    );
    await waitFor(() => expect(clientImpl.reset).toHaveBeenCalledTimes(1));
    expect(clientImpl.reset.mock.calls[0].slice(0, 3)).toEqual(['permission', 'project_editor', { state: 'draft', packageId: PKG }]);
    expect(clientImpl.drafts).toEqual({});
    expect(toast.success).toHaveBeenCalledWith(tFormat('engine.edit.draftDiscarded', 'en', { item: 'Project Editor' }));

    expect(await screen.findByText('1 object granted · 0 field overrides')).toBeInTheDocument();
    expect(rail().getByText('project_editor')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByTestId('access-discard-draft')).toBeNull());
    expect(clientImpl.save).not.toHaveBeenCalled();
  });

  it('a set never published: discarding its draft takes it off the rail', async () => {
    clientImpl = makeClient({
      published: { project_editor: { pkg: PKG, body: EDITOR } },
      drafts: { project_viewer: { pkg: PKG, body: { name: 'project_viewer', label: 'Project Viewer', objects: {} } } },
    });
    renderAccess();
    fireEvent.click(await rail().findByText('project_viewer', undefined, { timeout: 8000 }));
    fireEvent.click(await header().findByTestId('access-discard-draft'));
    expect(window.confirm).toHaveBeenCalledWith(
      tFormat('engine.studio.access.discardConfirmUnpublished', 'en', { item: 'Project Viewer' }),
    );
    await waitFor(() => expect(rail().queryByText('project_viewer')).toBeNull());
    expect(clientImpl.reset.mock.calls[0].slice(0, 3)).toEqual(['permission', 'project_viewer', { state: 'draft', packageId: PKG }]);
    // The rail's remaining set opens in its place.
    expect(await screen.findByText('1 object granted · 0 field overrides')).toBeInTheDocument();
  });

  it('a declined confirm discards nothing', async () => {
    clientImpl = makeClient({
      published: { project_editor: { pkg: PKG, body: EDITOR } },
      drafts: { project_editor: { pkg: PKG, body: { name: 'project_editor', label: 'Project Editor', objects: {} } } },
    });
    window.confirm = vi.fn(() => false) as unknown as typeof window.confirm;
    renderAccess();
    fireEvent.click(await screen.findByTestId('access-discard-draft', undefined, { timeout: 8000 }));
    expect(window.confirm).toHaveBeenCalledTimes(1);
    expect(clientImpl.reset).not.toHaveBeenCalled();
    expect(screen.getByTestId('access-discard-draft')).toBeInTheDocument();
  });

  it('no discard without a pending draft, nor on a read-only package', async () => {
    clientImpl = makeClient({ published: { project_editor: { pkg: PKG, body: EDITOR } } });
    renderAccess();
    await screen.findByText('1 object granted · 0 field overrides', undefined, { timeout: 8000 });
    expect(screen.queryByTestId('access-discard-draft')).toBeNull();
    cleanup();

    clientImpl = makeClient({
      published: { project_editor: { pkg: PKG, body: EDITOR } },
      drafts: { project_editor: { pkg: PKG, body: { name: 'project_editor', label: 'Project Editor', objects: {} } } },
    });
    renderAccess(true);
    await screen.findByText('0 objects granted · 0 field overrides', undefined, { timeout: 8000 });
    expect(screen.queryByTestId('access-discard-draft')).toBeNull();
  });
});
