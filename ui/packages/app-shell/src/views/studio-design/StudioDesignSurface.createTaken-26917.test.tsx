// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#26917 — Studio's Automations, App and Data creates over an
 * identifier a published item of that type already holds.
 *
 * Each create saves its blank skeleton under the first-write pin
 * (`If-None-Match: *` with `?mode=draft`), which asserts that no DRAFT row
 * exists: the spec's `parentVersion: null` is lifecycle-scoped. Over a
 * PUBLISHED flow, app or object of the same identifier the door therefore
 * wrote the skeleton as that item's pending draft, and publishing the package
 * would have replaced the live item with the blank one. The Access create was
 * fixed the same way by objectstack#26836.
 *
 *  - Automations: a published flow on this rail is refused with "Open"; one
 *    another package holds is refused without it; nothing is written either way.
 *  - Data: the same for objects (the namespace-prefixed identifier).
 *  - App: an app another package holds is refused (Create app is offered only
 *    to a package with no app, so there is nothing of its own to open).
 *  - A fresh identifier is created as before, with the pin.
 *
 * The REAL pillars and dialogs, over a client double that keeps published and
 * draft rows per package, writes a draft over a published row the way the
 * door does, and refuses the pin over a draft row.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const PKG = 'com.acme.app';
const OTHER_PKG = 'com.other.app';

type Row = { pkg: string; body: Record<string, unknown> };

const door = vi.hoisted(() => ({
  /** `type/name` → the published row. */
  published: new Map<string, { pkg: string; body: Record<string, unknown> }>(),
  /** `type/name` → the pending draft row. */
  drafts: new Map<string, { pkg: string; body: Record<string, unknown> }>(),
}));

const mockClient = vi.hoisted(() => {
  const rows = (map: Map<string, { pkg: string; body: Record<string, unknown> }>, type: string | undefined, pkg?: string | null) =>
    [...map.entries()]
      .filter(([key, row]) => (!type || key.startsWith(`${type}/`)) && (!pkg || row.pkg === pkg))
      .map(([key, row]) => ({ key, ...row }));
  const client: Record<string, unknown> = {
    list: vi.fn(async (type: string, opts: { packageId?: string | null } = {}) =>
      rows(door.published, type, opts?.packageId).map((r) => ({ ...r.body, _packageId: r.pkg })),
    ),
    listDrafts: vi.fn(async (opts: { packageId?: string | null; type?: string } = {}) =>
      rows(door.drafts, opts?.type, opts?.packageId).map((r) => ({
        type: r.key.split('/')[0],
        name: r.body.name,
        label: r.body.label,
        packageId: r.pkg,
      })),
    ),
    listTypes: vi.fn(async () => ({ entries: [] })),
    get: vi.fn(async (type: string, name: string) => door.published.get(`${type}/${name}`)?.body ?? null),
    references: vi.fn(async () => []),
    layered: vi.fn(async (type: string, name: string) => {
      const effective = door.published.get(`${type}/${name}`)?.body ?? null;
      return { effective, code: null, overlay: null, overlayScope: null, editable: true, deletable: true, resettable: false, lock: 'none' };
    }),
    getDraft: vi.fn(async (type: string, name: string) => {
      const row = door.drafts.get(`${type}/${name}`);
      return row ? { type, name, item: JSON.parse(JSON.stringify(row.body)) } : null;
    }),
    // The door: a draft-mode first-write pin refuses a DRAFT row only, and
    // writes over a published one.
    save: vi.fn(
      async (type: string, name: string, body: Record<string, unknown>, opts: { packageId?: string | null; ifNoneMatch?: string } = {}) => {
        const key = `${type}/${name}`;
        if (opts?.ifNoneMatch === '*' && door.drafts.has(key)) {
          throw Object.assign(new Error(`${key}: this save asserted that no draft row exists (If-None-Match: *)`), {
            status: 409,
            code: 'METADATA_CONFLICT',
          });
        }
        door.drafts.set(key, { pkg: opts?.packageId ?? '', body: JSON.parse(JSON.stringify(body)) });
        return { type, name, item: body };
      },
    ),
    publish: vi.fn(async () => ({ success: true })),
    reset: vi.fn(async () => ({})),
  };
  client.withPreviewDrafts = () => client;
  return client;
});

vi.mock('../metadata-admin/useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../metadata-admin/useMetadata')>();
  return {
    ...mod,
    useMetadataClient: () => mockClient,
    useMetadataTypes: () => ({ loading: false, error: null, entries: [] }),
  };
});

vi.mock('./packages-io', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./packages-io')>();
  return {
    ...mod,
    fetchPackages: vi.fn(async () => [{ id: PKG, name: 'Acme', writable: true, namespace: 'acme' }]),
  };
});

vi.mock('@object-ui/react', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@object-ui/react')>();
  return { ...mod, useAdapter: () => dataSource };
});

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() } }));
vi.mock('../../components/SuggestedBindingsPanel', () => ({ SuggestedBindingsPanel: () => null }));
vi.mock('../metadata-admin/AccessExplainPanel', () => ({ AccessExplainPanel: () => null }));
vi.mock('./StudioAiCopilot', () => ({ StudioChatDock: () => null }));
vi.mock('../../preview/DraftChangesPanel', () => ({ DraftChangesPanel: () => null }));

import { AutomationsPillar, DataPillar, StudioDesignSurface } from './StudioDesignSurface';
import { createEmptyDataSource } from './__tests__/emptyDataSource';
import { t, tFormat } from '../metadata-admin/i18n';

const dataSource = createEmptyDataSource();

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

(globalThis as { ResizeObserver?: unknown }).ResizeObserver =
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver ??
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };

const en = (key: string) => t(key, 'en');
const save = mockClient.save as ReturnType<typeof vi.fn>;
const getDraft = mockClient.getDraft as ReturnType<typeof vi.fn>;

function publish(type: string, pkg: string, body: Record<string, unknown>) {
  door.published.set(`${type}/${String(body.name)}`, { pkg, body } satisfies Row);
}

/** The published body, as a deep copy, so "unchanged" compares against what was seeded. */
const publishedBody = (type: string, name: string) => JSON.parse(JSON.stringify(door.published.get(`${type}/${name}`)!.body));

const FLOW_ALPHA = { name: 'alpha_intake', label: 'Alpha intake', type: 'autolaunched', nodes: [], edges: [] };
const FLOW_ESCALATE = {
  name: 'escalate',
  label: 'Escalate',
  type: 'autolaunched',
  status: 'active',
  nodes: [
    { id: 'start', type: 'start', label: 'Start', config: { triggerType: 'record-after-update', objectName: 'acme_ticket' } },
    { id: 'notify', type: 'notify', label: 'Notify' },
    { id: 'end', type: 'end', label: 'End' },
  ],
  edges: [],
};
const OBJ_ACCOUNT = { name: 'acme_account', label: 'Account', fields: { name: { type: 'text', label: 'Name' } } };
const OBJ_TICKET = { name: 'acme_ticket', label: 'Ticket', fields: { subject: { type: 'text', label: 'Subject' } } };
const APP_FIELD = { name: 'field_service', label: 'Field Service', active: true, navigation: [{ id: 'nav_x', type: 'object', objectName: 'other_x' }] };

beforeEach(() => {
  door.published.clear();
  door.drafts.clear();
  window.confirm = vi.fn(() => true) as unknown as typeof window.confirm;
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('null', { status: 404, headers: { 'content-type': 'application/json' } })),
  );
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

/** Fill the create dialog's label (the identifier derives from it) and submit. */
function submitCreate(dialog: HTMLElement, label: string) {
  fireEvent.change(dialog.querySelectorAll('input')[0], { target: { value: label } });
  fireEvent.click(within(dialog).getByRole('button', { name: en('engine.studio.createDraft') }));
}

describe('objectstack#26917 — Automations: New automation over a taken identifier', () => {
  async function openNewAutomation() {
    render(
      <MemoryRouter initialEntries={[`/studio/${PKG}/automations`]}>
        <AutomationsPillar packageId={PKG} />
      </MemoryRouter>,
    );
    await screen.findByTestId('auto-rail-row-alpha_intake', undefined, { timeout: 8000 });
    fireEvent.click(screen.getByTitle(en('engine.studio.auto.newTitle')));
    const dialog = await screen.findByRole('dialog');
    // The manual preset: the record ones hold Create until an object is named.
    fireEvent.click(within(dialog).getByTestId('create-flow-preset-manual'));
    return dialog;
  }

  it("a published flow on this package's rail: refused, nothing written, and Open opens it", async () => {
    publish('flow', PKG, FLOW_ALPHA);
    publish('flow', PKG, FLOW_ESCALATE);
    const before = publishedBody('flow', 'escalate');
    const dialog = await openNewAutomation();
    submitCreate(dialog, 'Escalate');

    const taken = await within(dialog).findByTestId('flow-create-taken');
    expect(taken).toHaveTextContent(
      tFormat('engine.studio.auto.createTaken', 'en', { name: 'escalate', label: 'Escalate' }),
    );
    expect(save).not.toHaveBeenCalled();
    expect(door.drafts.size).toBe(0);
    expect(door.published.get('flow/escalate')!.body).toEqual(before);

    expect(getDraft.mock.calls.some(([, name]) => name === 'escalate')).toBe(false);
    fireEvent.click(within(taken).getByTestId('flow-create-open-existing'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(getDraft.mock.calls.some(([, name]) => name === 'escalate')).toBe(true));
    expect(save).not.toHaveBeenCalled();
  });

  it('a published flow another package holds: refused, nothing written, and no Open', async () => {
    publish('flow', PKG, FLOW_ALPHA);
    publish('flow', OTHER_PKG, FLOW_ESCALATE);
    const before = publishedBody('flow', 'escalate');
    const dialog = await openNewAutomation();
    submitCreate(dialog, 'Escalate');

    const taken = await within(dialog).findByTestId('flow-create-taken');
    expect(taken).toHaveTextContent(
      tFormat('engine.studio.auto.createTakenElsewhere', 'en', { name: 'escalate', label: 'Escalate' }),
    );
    expect(within(taken).queryByTestId('flow-create-open-existing')).toBeNull();
    expect(save).not.toHaveBeenCalled();
    expect(door.drafts.size).toBe(0);
    expect(door.published.get('flow/escalate')!.body).toEqual(before);
  });

  it('a fresh identifier is created as before, under the first-write pin', async () => {
    publish('flow', PKG, FLOW_ALPHA);
    publish('flow', OTHER_PKG, FLOW_ESCALATE);
    const dialog = await openNewAutomation();
    submitCreate(dialog, 'Close stale');

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    const [type, name, , opts] = save.mock.calls[0]!;
    expect([type, name, opts]).toEqual([
      'flow',
      'close_stale',
      { mode: 'draft', packageId: PKG, ifNoneMatch: '*', surface: 'studio' },
    ]);
    expect(door.drafts.has('flow/close_stale')).toBe(true);
    expect(screen.queryByTestId('flow-create-taken')).toBeNull();
  });
});

describe('objectstack#26917 — Data: New object over a taken identifier', () => {
  async function openNewObject() {
    render(
      <MemoryRouter initialEntries={[`/studio/${PKG}/data`]}>
        <DataPillar packageId={PKG} />
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByRole('button', { name: en('engine.studio.data.newObject') }, { timeout: 8000 }));
    const dialog = await screen.findByRole('dialog');
    // The identifier is stored with the package's namespace prefix
    // (`prefixObjectName`): wait until the dialog previews it.
    await waitFor(() => {
      fireEvent.change(dialog.querySelectorAll('input')[0], { target: { value: 'Ticket' } });
      expect(within(dialog).getByTestId('create-item-stored-name')).toHaveTextContent('acme_ticket');
    });
    return dialog;
  }

  it('a published object another package holds: refused, nothing written, and no Open', async () => {
    publish('object', PKG, OBJ_ACCOUNT);
    publish('object', OTHER_PKG, OBJ_TICKET);
    const before = publishedBody('object', 'acme_ticket');
    const dialog = await openNewObject();
    submitCreate(dialog, 'Ticket');

    const taken = await within(dialog).findByTestId('object-create-taken');
    expect(taken).toHaveTextContent(
      tFormat('engine.studio.data.createTakenElsewhere', 'en', { name: 'acme_ticket', label: 'Ticket' }),
    );
    expect(within(taken).queryByTestId('object-create-open-existing')).toBeNull();
    expect(save).not.toHaveBeenCalled();
    expect(door.drafts.size).toBe(0);
    expect(door.published.get('object/acme_ticket')!.body).toEqual(before);
  });

  it("an object on this package's rail: refused, nothing written, and Open opens it", async () => {
    publish('object', PKG, OBJ_ACCOUNT);
    publish('object', PKG, OBJ_TICKET);
    const dialog = await openNewObject();
    submitCreate(dialog, 'Ticket');

    const taken = await within(dialog).findByTestId('object-create-taken');
    expect(taken).toHaveTextContent(
      tFormat('engine.studio.data.createTaken', 'en', { name: 'acme_ticket', label: 'Ticket' }),
    );
    expect(save).not.toHaveBeenCalled();

    fireEvent.click(within(taken).getByTestId('object-create-open-existing'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(getDraft.mock.calls.some(([type, name]) => type === 'object' && name === 'acme_ticket')).toBe(true));
    expect(save).not.toHaveBeenCalled();
  });

  it('a fresh identifier is created as before, under the first-write pin', async () => {
    publish('object', PKG, OBJ_ACCOUNT);
    const dialog = await openNewObject();
    submitCreate(dialog, 'Ticket');

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    const [type, name, , opts] = save.mock.calls[0]!;
    expect([type, name, opts]).toEqual([
      'object',
      'acme_ticket',
      { mode: 'draft', packageId: PKG, ifNoneMatch: '*', surface: 'studio' },
    ]);
  });
});

describe('objectstack#26917 — Create app over a taken identifier', () => {
  async function openCreateApp() {
    render(
      <MemoryRouter initialEntries={[`/studio/${PKG}/automations`]}>
        <Routes>
          <Route path="/studio/:packageId/:tab" element={<StudioDesignSurface />} />
        </Routes>
      </MemoryRouter>,
    );
    const toolbar = await screen.findByTestId('studio-shell-header', undefined, { timeout: 8000 });
    await waitFor(() => expect(within(toolbar).getByRole('button', { name: en('engine.studio.app.create') })).toBeInTheDocument());
    fireEvent.click(within(toolbar).getByRole('button', { name: en('engine.studio.app.create') }));
    return await screen.findByRole('dialog');
  }

  it('a published app another package holds: refused, nothing written', async () => {
    publish('app', OTHER_PKG, APP_FIELD);
    const before = publishedBody('app', 'field_service');
    const dialog = await openCreateApp();
    submitCreate(dialog, 'Field Service');

    const taken = await within(dialog).findByTestId('app-create-taken');
    expect(taken).toHaveTextContent(
      tFormat('engine.studio.app.createTaken', 'en', { name: 'field_service', label: 'Field Service' }),
    );
    expect(within(taken).queryByTestId('app-create-open-existing')).toBeNull();
    expect(save).not.toHaveBeenCalled();
    expect(door.drafts.size).toBe(0);
    expect(door.published.get('app/field_service')!.body).toEqual(before);
  });

  it('a fresh identifier is created as before, under the first-write pin', async () => {
    publish('app', OTHER_PKG, APP_FIELD);
    const dialog = await openCreateApp();
    submitCreate(dialog, 'Dispatch');

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    const [type, name, , opts] = save.mock.calls[0]!;
    expect([type, name, opts]).toEqual([
      'app',
      'dispatch',
      { mode: 'draft', packageId: PKG, ifNoneMatch: '*', surface: 'studio' },
    ]);
  });
});
