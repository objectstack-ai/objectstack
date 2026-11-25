// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#26705 — an edit the Data pillar holds unsent is unsaved work:
 * every departure that would drop it asks first.
 *
 * The autosave holds a Picklist added before it has an option
 * (objectui#11786). Before this card only Publish read that hold; leaving the
 * pillar, opening another object in the rail or reloading dropped the field
 * with no question. Now the surface folds the held edit into the guard a dirty
 * pillar already raises (the leave confirm, the shell's link guard and
 * `beforeunload`), and the rail asks before it opens another object.
 * objectstack#36904 — the designer has no rail: another object is another
 * address, so × back to the list is the departure pinned here beside the menu.
 *
 * Rendered through the REAL `StudioDesignSurface` on the real route shape; the
 * field is added the way the pillar offers it (`dataPillarAddField`).
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const PKG = 'com.acme.app';

const OBJECTS: Record<string, Record<string, unknown>> = {
  acme_task: { name: 'acme_task', label: 'Task', fields: [{ name: 'title', label: 'Title', type: 'text' }] },
  acme_note: { name: 'acme_note', label: 'Note', fields: [{ name: 'body', label: 'Body', type: 'text' }] },
};

const mockClient = vi.hoisted(() => ({
  list: vi.fn(async (_type: string) => [] as unknown[]),
  listDrafts: vi.fn(async () => []),
  listTypes: vi.fn(async () => ({ entries: [] })),
  get: vi.fn(async () => null),
  references: vi.fn(async () => []),
  layered: vi.fn(async (_type: string, _name: string) => ({ code: null, overlay: null, overlayScope: null, effective: null as unknown })),
  getDraft: vi.fn(async () => null),
  save: vi.fn(async () => ({ success: true })),
  publishDraft: vi.fn(async () => ({ success: true })),
  publishPackageDrafts: vi.fn(async () => ({ success: true, failed: [] })),
  publish: vi.fn(async () => ({ success: true })),
  reset: vi.fn(async () => ({})),
}));

vi.mock('../metadata-admin/useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../metadata-admin/useMetadata')>();
  return { ...mod, useMetadataClient: () => mockClient, // objectstack#36899 — the registry serves the designer types the left menu lists.
    useMetadataTypes: () => ({
      entries: [
        { type: 'object', domain: 'data' },
        { type: 'flow', domain: 'automation' },
      ],
    }), };
});

vi.mock('./packages-io', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./packages-io')>();
  return {
    ...mod,
    fetchPackages: vi.fn(async () => [{ id: 'com.acme.app', name: 'Acme', writable: true, namespace: 'acme' }]),
  };
});

vi.mock('@object-ui/react', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@object-ui/react')>();
  return { ...mod, useAdapter: () => dataSource };
});

vi.mock('./StudioAiCopilot', () => ({ StudioChatDock: () => null }));
vi.mock('../../preview/DraftChangesPanel', () => ({ DraftChangesPanel: () => null }));

// The source under test reaches a dynamic import of `@objectstack/lint`: its first
// load is paid here, at collection, never inside a case's clock (`check:test-source-alias`).
import '@objectstack/lint';
import '@object-ui/plugin-detail';
import { StudioDesignSurface } from './StudioDesignSurface';
import { addFieldFromFormToolbar } from './__tests__/dataPillarAddField';
import { pressStudioSave } from './__tests__/studioSaveHarness';
import { createEmptyDataSource } from './__tests__/emptyDataSource';
import { registerBuiltinInspectors } from '../metadata-admin/inspectors';
import { t } from '../metadata-admin/i18n';

const dataSource = createEmptyDataSource();
registerBuiltinInspectors();

vi.stubGlobal(
  'fetch',
  vi.fn(async () => new Response('null', { status: 404, headers: { 'content-type': 'application/json' } })),
);

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

// This jsdom environment ships no window.confirm — install a mock outright.
let confirmSpy: ReturnType<typeof vi.fn>;
const LEAVE_QUESTION = t('engine.edit.unsavedLeaveConfirm', 'en');

beforeEach(() => {
  for (const fn of Object.values(mockClient)) (fn as unknown as { mockClear: () => void }).mockClear();
  mockClient.list.mockImplementation(async (type: string) =>
    type === 'object' ? Object.values(OBJECTS).map((o) => ({ name: o.name, label: o.label, _packageId: PKG })) : [],
  );
  mockClient.layered.mockImplementation(async (type: string, name: string) => ({
    code: null,
    overlay: null,
    overlayScope: null,
    effective: type === 'object' && OBJECTS[name] ? JSON.parse(JSON.stringify(OBJECTS[name])) : null,
  }));
  mockClient.save.mockImplementation(async () => ({ success: true }));
  confirmSpy = vi.fn();
  window.confirm = confirmSpy as unknown as typeof window.confirm;
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  window.history.replaceState(null, '', '/');
});

/** The object the header names: its machine name beside the label (objectstack#36904). */
async function openObjectIs(name: string): Promise<void> {
  await waitFor(
    () => expect(within(screen.getByTestId('data-object-header')).getAllByTestId('studio-item-api-name')[0]).toHaveTextContent(name),
    { timeout: 8000 },
  );
}

async function openTask(name = 'acme_task'): Promise<void> {
  // The shell's link guard reads the window's URL to skip a link to the page
  // already shown; `BrowserRouter` keeps the two equal, so this does too.
  // objectstack#36904 — the object designer is the object's address.
  const at = `/studio/${PKG}/metadata/object/${name}?package=${PKG}`;
  window.history.replaceState(null, '', at);
  render(
    <MemoryRouter initialEntries={[at]}>
      <Routes>
        {/* objectstack#36899 — a menu type entry opens that type's area list; × the object list. */}
        <Route path="/studio/:packageId/metadata/flow" element={<output data-testid="area-landed" />} />
        <Route path="/studio/:packageId/metadata/object" element={<output data-testid="list-landed" />} />
        <Route path="/studio/:packageId/metadata/*" element={<StudioDesignSurface area="metadata" />} />
      </Routes>
    </MemoryRouter>,
  );
  await openObjectIs(name);
}

/** The card's repro: add a Picklist "Priority" with no option yet; the autosave holds it. */
async function holdAPicklist(): Promise<void> {
  fireEvent.click(await screen.findByRole('button', { name: 'Field layout' }));
  await addFieldFromFormToolbar(undefined, { label: 'Priority', type: /^Picklist$/ });
  await screen.findByTestId('studio-held', undefined, { timeout: 8000 });
}

/** Whether a reload / tab close would be asked about. */
function reloadAsks(): boolean {
  const e = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(e);
  return e.defaultPrevented;
}

/** objectstack#36899 — the left menu's entry for a type: a link to that type's area list. */
const menuEntry = (type: string) => within(screen.getByTestId('studio-menu')).getByTestId(`studio-menu-entry-type:${type}`);
/** × of the designer's header: back to the object list. */
const closeDesigner = () => fireEvent.click(within(screen.getByTestId('data-object-header')).getAllByTestId('studio-detail-close')[0]);

describe('a held Data field guards every departure (objectstack#26705)', () => {
  it('leaving the pillar through the menu asks; Cancel keeps the held field, OK leaves and clears the guard', async () => {
    await openTask();
    await holdAPicklist();

    confirmSpy.mockReturnValueOnce(false);
    fireEvent.click(menuEntry('flow'));
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(confirmSpy).toHaveBeenCalledWith(LEAVE_QUESTION);
    expect(screen.getByTestId('studio-held')).toBeInTheDocument();
    expect(screen.getByTestId('data-object-header')).toBeInTheDocument();

    confirmSpy.mockReturnValueOnce(true);
    fireEvent.click(menuEntry('flow'));
    expect(confirmSpy).toHaveBeenCalledTimes(2);
    await screen.findByTestId('area-landed');
    // The unmounted pillar took its hold back: nothing is asked any more.
    expect(reloadAsks()).toBe(false);
  });

  it('× back to the list asks; Cancel keeps the held field, OK leaves for the list', async () => {
    await openTask();
    await holdAPicklist();

    confirmSpy.mockReturnValueOnce(false);
    closeDesigner();
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(confirmSpy).toHaveBeenCalledWith(LEAVE_QUESTION);
    await openObjectIs('acme_task');
    expect(screen.getByTestId('studio-held')).toBeInTheDocument();

    confirmSpy.mockReturnValueOnce(true);
    closeDesigner();
    expect(confirmSpy).toHaveBeenCalledTimes(2);
    await screen.findByTestId('list-landed');
    expect(reloadAsks()).toBe(false);
  });

  it('a reload asks while the field is held', async () => {
    await openTask();
    expect(reloadAsks()).toBe(false);
    await holdAPicklist();
    expect(reloadAsks()).toBe(true);
  });

  // CONTROL: nothing held, nothing asked.
  it('with no edit held, the reload and the menu link never ask', async () => {
    await openTask();

    expect(reloadAsks()).toBe(false);
    fireEvent.click(menuEntry('flow'));
    await screen.findByTestId('area-landed');
    expect(confirmSpy).not.toHaveBeenCalled();
  });
});

/*
 * objectstack#27511, objectstack#36511 — an edit the top bar's Save has not
 * sent, or whose Save was refused, is unsaved work too (`saveBar.dirty` in the
 * surface's `unsavedPillarWork`): the designer's departures ask before they
 * drop it, and a saved edit leaves nothing to ask about. objectstack#36904 —
 * the rail's object switch these cases pinned is the designer's › (the next
 * object, by name with no list context: Note, then Task) and its ×.
 */
describe('an unsaved Data edit guards the designer\'s × and › (objectstack#27511, objectstack#36511)', () => {
  const next = () => fireEvent.click(within(screen.getByTestId('data-object-header')).getAllByTestId('studio-detail-next')[0]);
  const nextReady = () =>
    waitFor(() => expect(within(screen.getByTestId('data-object-header')).getAllByTestId('studio-detail-next')[0]).toBeEnabled(), {
      timeout: 8000,
    });
  /** A Text field: complete as added, so nothing is held; it waits for Save. */
  async function addUnsavedField(): Promise<void> {
    fireEvent.click(await screen.findByRole('button', { name: 'Field layout' }));
    await addFieldFromFormToolbar();
    await screen.findByTestId('studio-save', undefined, { timeout: 8000 });
    expect(screen.queryByTestId('studio-held')).toBeNull();
  }

  it('› over an unsaved edit asks and sends nothing; declined, the edit stays; agreed, Task opens', async () => {
    await openTask('acme_note');
    await nextReady();
    await addUnsavedField();

    confirmSpy.mockReturnValueOnce(false);
    next();
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(confirmSpy).toHaveBeenCalledWith(LEAVE_QUESTION);
    await openObjectIs('acme_note');
    expect(screen.getByTestId('studio-save')).toBeInTheDocument();
    expect(reloadAsks()).toBe(true);

    confirmSpy.mockReturnValueOnce(true);
    next();
    expect(confirmSpy).toHaveBeenCalledTimes(2);
    await openObjectIs('acme_task');
    expect(mockClient.save).not.toHaveBeenCalled();
  });

  it('× over an unsaved edit asks; Cancel keeps it, OK leaves for the list', async () => {
    await openTask('acme_note');
    await addUnsavedField();

    confirmSpy.mockReturnValueOnce(false);
    closeDesigner();
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(confirmSpy).toHaveBeenCalledWith(LEAVE_QUESTION);
    await openObjectIs('acme_note');

    confirmSpy.mockReturnValueOnce(true);
    closeDesigner();
    await screen.findByTestId('list-landed');
    expect(mockClient.save).not.toHaveBeenCalled();
  });

  it('an edit whose Save was refused is not dropped silently: › asks, and a declined ask keeps it', async () => {
    mockClient.save.mockImplementation(async () => {
      throw Object.assign(new Error('The server refused this draft.'), { status: 500 });
    });
    await openTask('acme_note');
    await nextReady();
    await addUnsavedField();
    await pressStudioSave();
    expect(mockClient.save).toHaveBeenCalledTimes(1);

    confirmSpy.mockReturnValueOnce(false);
    next();
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(confirmSpy).toHaveBeenCalledWith(LEAVE_QUESTION);
    await openObjectIs('acme_note');
    expect(reloadAsks()).toBe(true);

    confirmSpy.mockReturnValueOnce(true);
    next();
    await openObjectIs('acme_task');
    expect(mockClient.save).toHaveBeenCalledTimes(1);
  });

  // CONTROL: a saved edit is the stored object; nothing is left to ask about.
  it('a saved edit leaves at once: › opens Task with no question', async () => {
    await openTask('acme_note');
    await nextReady();
    await addUnsavedField();
    await pressStudioSave();
    expect(mockClient.save).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(reloadAsks()).toBe(false), { timeout: 8000 });

    next();
    await openObjectIs('acme_task');
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  // CONTROL: nothing pending, nothing asked, nothing sent.
  it('with nothing pending, › opens Task at once and sends nothing', async () => {
    await openTask('acme_note');
    await nextReady();
    next();
    await openObjectIs('acme_task');
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(mockClient.save).not.toHaveBeenCalled();
  });
});
