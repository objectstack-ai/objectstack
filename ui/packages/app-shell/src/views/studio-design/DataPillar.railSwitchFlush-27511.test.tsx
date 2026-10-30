// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#27511 — an object switch in the Data pillar's rail never drops
 * an edit still inside the autosave's debounce.
 *
 * The autosave sends 1.5 s after the last edit, and its timer sends nothing
 * once the open object has changed (objectui#11232): the rail's switch reloads
 * the one buffer the edit lives in. So an edit made less than 1.5 s before a
 * click on another object was dropped with nothing on screen, and reverted on
 * the next visit. The switch now sends the pending edit first with the
 * autosave's own `flush` and opens the next object once its save has landed; a
 * save already in flight is waited out the same way; an edit that cannot be
 * sent (its save was refused) is the author's to drop, and the switch asks.
 *
 * The client is a server double that records every save and can hold or
 * refuse one; the records grid is a double that draws only its "+" column.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
// Module scope as well as in the `vi.mock` factory below: the cold transform is paid
// during collection, which no test or hook timeout clocks (AGENTS.md, flaky-test discipline).
import '@object-ui/components';
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const PKG = 'com.acme.app';

const TASK = {
  name: 'acme_task',
  label: 'Task',
  fields: [
    { name: 'title', label: 'Title', type: 'text' },
    { name: 'status', label: 'Status', type: 'text' },
  ],
};
const NOTE = { name: 'acme_note', label: 'Note', fields: [{ name: 'body', label: 'Body', type: 'text' }] };

const server = vi.hoisted(() => ({
  active: new Map<string, Record<string, unknown>>(),
  drafts: new Map<string, Record<string, unknown>>(),
  /** Every save, as the server received it. */
  saves: [] as Array<{ name: string; body: Record<string, unknown> }>,
  /** While set, the next save waits on it (a save held in flight). */
  saveHold: null as Promise<void> | null,
  /** While true, every save is refused. */
  refuse: false,
}));

// A server double: a save lands as the object's draft, and a later load serves it.
const mockClient = vi.hoisted(() => ({
  list: vi.fn(async () => [...server.active.values()].map((row) => ({ name: row.name, label: row.label }))),
  listDrafts: vi.fn(async () => []),
  listTypes: vi.fn(async () => ({ entries: [] })),
  get: vi.fn(async () => null),
  withPreviewDrafts: vi.fn((): unknown => mockClient),
  references: vi.fn(async () => []),
  layered: vi.fn(async (_type: string, name: string) => {
    const eff = server.active.get(name) ?? null;
    return { code: null, overlay: eff, overlayScope: eff ? 'env' : null, effective: eff, editable: true, deletable: true, resettable: false, lock: 'none' };
  }),
  getDraft: vi.fn(async (type: string, name: string) => {
    const draft = server.drafts.get(name);
    if (draft) return { item: JSON.parse(JSON.stringify(draft)) as Record<string, unknown> };
    throw Object.assign(new Error(`No pending draft exists for ${type}/${name}.`), { code: 'NO_DRAFT', status: 404 });
  }),
  save: vi.fn(async (_type: string, name: string, item: unknown) => {
    const body = JSON.parse(JSON.stringify(item)) as Record<string, unknown>;
    server.saves.push({ name, body });
    const hold = server.saveHold;
    server.saveHold = null;
    if (hold) await hold;
    if (server.refuse) throw Object.assign(new Error('The server refused this draft.'), { status: 500 });
    server.drafts.set(name, body);
    return { type: 'object', name, item };
  }),
}));

vi.mock('../metadata-admin/useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../metadata-admin/useMetadata')>();
  return { ...mod, useMetadataClient: () => mockClient, useMetadataTypes: () => ({ loading: false, error: null, entries: [] }) };
});

vi.mock('./packages-io', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./packages-io')>();
  return { ...mod, fetchPackages: vi.fn(async () => [{ id: PKG, name: 'Acme', writable: true, namespace: 'acme' }]) };
});

vi.mock('@object-ui/react', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@object-ui/react')>();
  return { ...mod, useAdapter: () => dataSource };
});

// The records grid: only its "+" column, drawn from the grid's authoring
// context the way the real grid draws it (objectui#12511).
vi.mock('@object-ui/plugin-view', async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>();
  const { useGridFieldAuthoring } = await import('@object-ui/components');
  function GridDouble() {
    const authoring = useGridFieldAuthoring();
    return authoring?.onAddColumn ? (
      <button type="button" data-testid="grid-add-column" onClick={authoring.onAddColumn}>
        Add column
      </button>
    ) : null;
  }
  return { ...mod, ObjectView: GridDouble };
});

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), dismiss: vi.fn() },
  Toaster: () => null,
}));

import { DataPillar } from './StudioDesignSurface';
import { addFieldFromGrid } from './__tests__/dataPillarAddField';
import { createEmptyDataSource } from './__tests__/emptyDataSource';
import { readFields } from '../metadata-admin/previews/object-fields-io';

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
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
  (globalThis as unknown as { ResizeObserver?: unknown }).ResizeObserver ??
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };

// This environment ships no window.confirm: the pillar's discard question.
let confirmSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  server.active.clear();
  server.drafts.clear();
  server.saves.length = 0;
  server.saveHold = null;
  server.refuse = false;
  server.active.set(TASK.name, JSON.parse(JSON.stringify(TASK)));
  server.active.set(NOTE.name, JSON.parse(JSON.stringify(NOTE)));
  confirmSpy = vi.fn(() => false);
  window.confirm = confirmSpy as unknown as typeof window.confirm;
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('null', { status: 404, headers: { 'content-type': 'application/json' } })),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const SLOW = { timeout: 8000 };

const fieldNamesOf = (body: Record<string, unknown>) => readFields(body.fields).entries.map((e) => e.name);
const savesRead = () => server.saves.map((s) => [s.name, fieldNamesOf(s.body)]);
const fieldCount = () => screen.getByText(/^\d+ fields?( \(\+\d+ system\))?$/);

async function openTask(): Promise<void> {
  render(
    <MemoryRouter initialEntries={[`/studio/${PKG}/data`]}>
      <DataPillar packageId={PKG} />
    </MemoryRouter>,
  );
  await waitFor(() => expect(fieldCount()).toHaveTextContent('2 fields'), SLOW);
}

/** Waits past the autosave's debounce: what was sent by then is what will be. */
async function pastDebounce(ms = 2500): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}

describe('Data pillar — an object switch inside the autosave debounce (objectstack#27511)', () => {
  it('sends the pending edit to its own object first, then opens the next one', async () => {
    await openTask();
    await addFieldFromGrid();
    // Inside the debounce: nothing has been sent yet.
    expect(server.saves).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: /Note/ }));

    await waitFor(() => expect(fieldCount()).toHaveTextContent('1 field'), SLOW);
    await pastDebounce();
    // Exactly one save, to Task, carrying the edit; nothing was sent as Note's.
    expect(savesRead()).toEqual([['acme_task', ['title', 'status', 'new_field']]]);
    expect(confirmSpy).not.toHaveBeenCalled();

    // The edit is Task's draft: back on Task, it is there.
    fireEvent.click(screen.getByRole('button', { name: /Task/ }));
    await waitFor(() => expect(fieldCount()).toHaveTextContent('3 fields'), SLOW);
  }, 30000);

  it('waits out a save in flight, and opens the next object once it lands', async () => {
    await openTask();
    let release!: () => void;
    server.saveHold = new Promise<void>((r) => (release = r));
    await addFieldFromGrid();
    // The timer sends it, and the save is held in flight.
    await waitFor(() => expect(server.saves).toHaveLength(1), SLOW);

    fireEvent.click(screen.getByRole('button', { name: /Note/ }));
    await pastDebounce(300);
    // Still on Task while its save is in flight.
    expect(fieldCount()).toHaveTextContent('3 fields');

    await act(async () => {
      release();
      await new Promise((r) => setTimeout(r, 0));
    });
    await waitFor(() => expect(fieldCount()).toHaveTextContent('1 field'), SLOW);
    await pastDebounce();
    expect(savesRead()).toEqual([['acme_task', ['title', 'status', 'new_field']]]);
  }, 30000);

  it('an edit whose save was refused is not dropped silently: the switch asks, and a declined ask keeps it', async () => {
    await openTask();
    server.refuse = true;
    await addFieldFromGrid();
    await waitFor(() => expect(server.saves).toHaveLength(1), SLOW);
    await pastDebounce(300);

    fireEvent.click(screen.getByRole('button', { name: /Note/ }));
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    await pastDebounce(300);
    expect(fieldCount()).toHaveTextContent('3 fields');

    // Agreed to: the edit is dropped and Note opens; nothing more was sent.
    confirmSpy.mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: /Note/ }));
    await waitFor(() => expect(fieldCount()).toHaveTextContent('1 field'), SLOW);
    expect(server.saves).toHaveLength(1);
  }, 30000);

  it('a switch with nothing pending opens the next object at once and sends nothing', async () => {
    await openTask();
    fireEvent.click(screen.getByRole('button', { name: /Note/ }));
    await waitFor(() => expect(fieldCount()).toHaveTextContent('1 field'), SLOW);
    await pastDebounce();
    expect(server.saves).toEqual([]);
    expect(confirmSpy).not.toHaveBeenCalled();
  }, 30000);
});
