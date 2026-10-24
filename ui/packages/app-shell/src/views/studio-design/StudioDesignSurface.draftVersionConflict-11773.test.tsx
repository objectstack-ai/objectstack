// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11773 — two editors of one object in Studio's Data pillar no longer
 * overwrite each other's draft in silence.
 *
 * The defect, as filed: tab A saved a field, tab B (opened earlier) saved its
 * stale copy, and the server draft lost A's field with no 409, banner or toast,
 * because no draft save sent the version it was built on.
 *
 * The server double answers the way the `/meta` draft door of the published
 * `@objectstack/*` 18.0.0-next.0 was measured to (readings on the pull
 * request): a draft save returns its `version`; the draft READ serves the
 * draft's `version` too, and no draft at all is `null` from `getDraft`; an
 * `If-Match` that is not the current draft's version, or `If-None-Match: *`
 * over an existing draft, is `409 METADATA_CONFLICT` carrying
 * `currentVersion`; a save with neither is last-writer-wins. Its refusal is
 * parsed by the REAL `MetadataClient`, so the error the pillar catches is
 * production's.
 *
 * The first save after a load is pinned to that load's read: `If-Match` with
 * the draft's version, or `If-None-Match: *` when no draft was pending — so the
 * card's literal race (two editors who each load and save ONCE) is refused too.
 *
 * The two editors are two mounted `DataPillar`s over one server double: each
 * pillar holds its own buffer and its own version, exactly as two tabs do.
 * The records grid is a double that hands the pillar a column order through
 * the grid's own authoring context (the drag mechanics are the data table's).
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MetadataClient, type MetadataError } from '@object-ui/data-objectstack';

const PKG = 'com.acme.app';

const OBJECT = {
  name: 'acme_task',
  label: 'Task',
  fields: [
    { name: 'title', label: 'Title', type: 'text' },
    { name: 'status', label: 'Status', type: 'text' },
  ],
};

interface SaveCall {
  type: string;
  name: string;
  body: Record<string, unknown>;
  ifMatch: string | undefined;
  ifNoneMatch: string | undefined;
  packageId: string | undefined;
}

const server = vi.hoisted(() => ({
  active: new Map<string, Record<string, unknown>>(),
  drafts: new Map<string, { body: Record<string, unknown>; version: string }>(),
  saves: [] as SaveCall[],
  seq: 0,
}));

/**
 * The 409 the door answers, run through the real client's error parser. The
 * prose is the door's own; nothing in the guard reads it.
 */
async function conflictRefusal(type: string, name: string, head: string | null): Promise<MetadataError> {
  const client = new MetadataClient({
    baseUrl: 'http://localhost:3000',
    fetch: (async () =>
      new Response(
        JSON.stringify({
          error: `${type}/${name} has been modified since you loaded it. The version token sent is not the current version (current is ${head}).`,
          code: 'METADATA_CONFLICT',
          currentVersion: head,
        }),
        { status: 409, headers: { 'content-type': 'application/json' } },
      )) as unknown as typeof fetch,
  });
  return client.save(type, name, {}, { mode: 'draft' }).then(
    () => {
      throw new Error('the stub door accepted the save');
    },
    (e: unknown) => e as MetadataError,
  );
}

const mockClient = vi.hoisted(() => {
  const k = (type: string, name: string) => `${type}/${name}`;
  return {
    list: vi.fn(async (type: string) =>
      [...server.active.entries()]
        .filter(([key]) => key.startsWith(`${type}/`))
        .map(([, row]) => ({ name: row.name, label: row.label ?? row.name })),
    ),
    listDrafts: vi.fn(async () => []),
    listTypes: vi.fn(async () => ({ entries: [] })),
    get: vi.fn(async () => null),
    references: vi.fn(async () => []),
    layered: vi.fn(async (type: string, name: string) => {
      const eff = server.active.get(k(type, name)) ?? null;
      return { code: null, overlay: eff, overlayScope: eff ? 'env' : null, effective: eff, editable: true, deletable: true, resettable: false, lock: 'none' };
    }),
    // The draft read serves the body and its version; no draft is `null`, as
    // the real client resolves the read's 404.
    getDraft: vi.fn(async (type: string, name: string, _options?: { packageId?: string }) => {
      const draft = server.drafts.get(k(type, name));
      if (!draft) return null;
      return { type, name, item: JSON.parse(JSON.stringify(draft.body)) as Record<string, unknown>, version: draft.version };
    }),
    save: vi.fn(async (type: string, name: string, item: unknown, options?: { ifMatch?: string; ifNoneMatch?: string; packageId?: string }) => {
      const body = JSON.parse(JSON.stringify(item)) as Record<string, unknown>;
      const ifMatch = options?.ifMatch;
      const ifNoneMatch = options?.ifNoneMatch;
      server.saves.push({ type, name, body, ifMatch, ifNoneMatch, packageId: options?.packageId });
      const head = server.drafts.get(k(type, name))?.version ?? null;
      if (ifMatch !== undefined && ifMatch !== head) throw await conflictRefusal(type, name, head);
      if (ifNoneMatch !== undefined && head !== null) throw await conflictRefusal(type, name, head);
      server.seq += 1;
      const version = `hmac-sha256:v${server.seq}`;
      server.drafts.set(k(type, name), { body, version });
      return { success: true, version, seq: server.seq, state: 'draft', message: `Saved ${type} '${name}' [seq=${server.seq}]` };
    }),
    publish: vi.fn(async () => ({ success: true })),
    reset: vi.fn(async () => ({})),
  };
});

vi.mock('../metadata-admin/useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../metadata-admin/useMetadata')>();
  return { ...mod, useMetadataClient: () => mockClient, useMetadataTypes: () => ({ entries: [] }) };
});

vi.mock('./packages-io', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./packages-io')>();
  return { ...mod, fetchPackages: vi.fn(async () => []) };
});

vi.mock('@object-ui/react', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@object-ui/react')>();
  return { ...mod, useAdapter: () => dataSource };
});

// The records grid: a double that reverses the columns it was handed through
// the grid's authoring context, the way a header drag reorders them.
vi.mock('@object-ui/plugin-view', async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>();
  const { useGridFieldAuthoring } = await import('@object-ui/components');
  function GridDouble({ schema }: { schema?: { table?: { fields?: string[] } } }) {
    const authoring = useGridFieldAuthoring();
    const cols = schema?.table?.fields ?? [];
    return (
      <>
        <button type="button" onClick={() => authoring?.onReorderFields?.([...cols].reverse())}>
          Reverse columns
        </button>
        {/* objectui#12511 — the grid's "+" column, drawn from the same context. */}
        {authoring?.onAddColumn && (
          <button type="button" data-testid="grid-add-column" onClick={authoring.onAddColumn}>
            Add column
          </button>
        )}
      </>
    );
  }
  return { ...mod, ObjectView: GridDouble };
});

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), dismiss: vi.fn() } }));

import { DataPillar } from './StudioDesignSurface';
import { addFieldFromFormToolbar, addFieldFromGrid, type AddFieldInput } from './__tests__/dataPillarAddField';
import { createEmptyDataSource } from './__tests__/emptyDataSource';
import { readFields } from '../metadata-admin/previews/object-fields-io';

const dataSource = createEmptyDataSource();

beforeEach(() => {
  server.active.clear();
  server.drafts.clear();
  server.saves.length = 0;
  server.seq = 0;
  for (const fn of Object.values(mockClient)) (fn as unknown as { mockClear: () => void }).mockClear();
  server.active.set(`object/${OBJECT.name}`, JSON.parse(JSON.stringify(OBJECT)));
});

afterEach(cleanup);

/** One editor: a mounted Data pillar, as one browser tab holds it. */
function openEditor(): HTMLElement {
  const { container } = render(
    <MemoryRouter initialEntries={[`/studio/${PKG}/data`]}>
      <DataPillar packageId={PKG} />
    </MemoryRouter>,
  );
  return container;
}

const fieldNames = (body: Record<string, unknown>) => readFields(body.fields).entries.map((e) => e.name);
// The object header's count: since objectui#12451 each Form section card
// counts its own fields with the same words, so the read is scoped.
const fieldCount = (editor: HTMLElement) =>
  within(within(editor).getByTestId('data-object-header')).getByText(/^\d+ fields$/).textContent;
const serverDraftFields = () => fieldNames(server.drafts.get(`object/${OBJECT.name}`)!.body);

async function loaded(editor: HTMLElement, count: string): Promise<void> {
  await waitFor(() => expect(fieldCount(editor)).toBe(count), { timeout: 8000 });
}

/** The label of a second added field: it derives `second_field`. */
const SECOND: AddFieldInput = { label: 'Second field' };

/**
 * Add a field and wait until the autosave carrying it has landed. From the
 * Records grid's "+" column by default; a draft-only object has no grid, so
 * its case adds from the Form toolbar (objectui#12511). A second field on the
 * same object takes another label (`input`): a repeated label derives a taken
 * name, and the popover asks for its api name (objectui#13389).
 */
async function addFieldAndSave(
  editor: HTMLElement,
  add = addFieldFromGrid,
  input?: AddFieldInput,
): Promise<void> {
  const before = server.saves.length;
  await add(editor, input);
  await waitFor(() => expect(server.saves.length).toBe(before + 1), { timeout: 8000 });
  await waitFor(() => expect(within(editor).queryByTestId('data-autosaving')).toBeNull(), { timeout: 8000 });
}

/** Reverse the grid's columns (a save the pillar sends itself) and wait for it. */
async function reorderAndSave(editor: HTMLElement): Promise<void> {
  const before = server.saves.length;
  fireEvent.click(await within(editor).findByRole('button', { name: 'Reverse columns' }, { timeout: 8000 }));
  await waitFor(() => expect(server.saves.length).toBe(before + 1), { timeout: 8000 });
  await waitFor(() => expect(within(editor).queryByTestId('data-autosaving')).toBeNull(), { timeout: 8000 });
}

/**
 * The race, with both editors past their first save: A saves, B opens on A's
 * draft and saves its own change, then A — still holding the copy it saved —
 * edits again.
 */
async function raceTwoEditors(): Promise<{ a: HTMLElement; b: HTMLElement }> {
  const a = openEditor();
  await loaded(a, '2 fields');
  await addFieldAndSave(a); // A: + new_field
  const b = openEditor();
  await loaded(b, '3 fields');
  await reorderAndSave(b); // B: status before title
  expect(serverDraftFields()).toEqual(['status', 'title', 'new_field']);
  await addFieldFromGrid(a, SECOND); // A's stale copy + second_field
  await screen.findByTestId('draft-conflict-dialog', undefined, { timeout: 8000 });
  return { a, b };
}

describe('Data pillar — a draft saved elsewhere is not overwritten in silence (objectui#11773)', () => {
  it('one editor: the first autosave is pinned to the load ("no draft"), and each later one to the receipt before it', async () => {
    const a = openEditor();
    await loaded(a, '2 fields');
    await addFieldAndSave(a);
    await addFieldAndSave(a, addFieldFromGrid, SECOND);
    await reorderAndSave(a);
    expect(server.saves.map((s) => [s.ifMatch, s.ifNoneMatch])).toEqual([
      [undefined, '*'],
      ['hmac-sha256:v1', undefined],
      ['hmac-sha256:v2', undefined],
    ]);
    // The draft was read at the package the saves write.
    expect(mockClient.getDraft).toHaveBeenCalledWith('object', OBJECT.name, { packageId: PKG });
    expect(server.saves.every((s) => s.packageId === PKG)).toBe(true);
    expect(screen.queryByTestId('draft-conflict-dialog')).toBeNull();
  });

  it('the card\'s race: two editors who each load and save ONCE — the later first save is refused, and the earlier one\'s field survives', async () => {
    const a = openEditor();
    await loaded(a, '2 fields');
    const b = openEditor();
    await loaded(b, '2 fields');
    await addFieldAndSave(a); // A: + new_field, the first draft
    expect(serverDraftFields()).toEqual(['title', 'status', 'new_field']);
    await addFieldFromGrid(b); // B's first save, built on the published object
    await screen.findByTestId('draft-conflict-dialog', undefined, { timeout: 8000 });
    const refused = server.saves[server.saves.length - 1]!;
    expect([refused.ifMatch, refused.ifNoneMatch]).toEqual([undefined, '*']);
    // A's field is still in the draft: B's stale copy was not written over it.
    expect(serverDraftFields()).toEqual(['title', 'status', 'new_field']);
  });

  it('an editor that opens on a pending draft pins its first save to the version that read served', async () => {
    server.drafts.set(`object/${OBJECT.name}`, { body: JSON.parse(JSON.stringify(OBJECT)), version: 'hmac-sha256:pending' });
    const a = openEditor();
    await loaded(a, '2 fields');
    await addFieldAndSave(a);
    expect(server.saves.map((s) => [s.ifMatch, s.ifNoneMatch])).toEqual([['hmac-sha256:pending', undefined]]);
  });

  it('two editors: the stale save is refused with the conflict dialog, and the other editor\'s change survives', async () => {
    const { a } = await raceTwoEditors();
    const refused = server.saves[server.saves.length - 1]!;
    expect(refused.ifMatch).toBe('hmac-sha256:v1');
    expect(fieldNames(refused.body)).toEqual(['title', 'status', 'new_field', 'second_field']);
    // Nothing was written over B's draft.
    expect(serverDraftFields()).toEqual(['status', 'title', 'new_field']);
    expect(screen.getByTestId('draft-conflict-dialog')).toHaveTextContent('acme_task');

    fireEvent.click(screen.getByTestId('draft-conflict-cancel'));
    await waitFor(() => expect(screen.queryByTestId('draft-conflict-dialog')).toBeNull(), { timeout: 8000 });
    // Keep editing: A's edit stays on screen, unsaved, and the refusal says so.
    expect(fieldCount(a)).toBe('4 fields');
    expect(within(a).getByText(/^Not saved:/)).toBeInTheDocument();
    expect(serverDraftFields()).toEqual(['status', 'title', 'new_field']);
  });

  it('"reload" replaces the stale buffer with the saved draft, and the next save is pinned to that draft\'s version', async () => {
    const { a } = await raceTwoEditors();
    const savesBefore = server.saves.length;
    fireEvent.click(screen.getByTestId('draft-conflict-reload'));
    await waitFor(() => expect(screen.queryByTestId('draft-conflict-dialog')).toBeNull(), { timeout: 8000 });
    await loaded(a, '3 fields');
    expect(server.saves.length).toBe(savesBefore);

    await addFieldAndSave(a, addFieldFromGrid, SECOND);
    const next = server.saves[server.saves.length - 1]!;
    expect(next.ifMatch).toBe('hmac-sha256:v2');
    // Built on B's draft: B's column order is kept.
    expect(fieldNames(next.body)).toEqual(['status', 'title', 'new_field', 'second_field']);
  });

  it('"overwrite" asks again, then re-sends pinned to the refusal\'s currentVersion and wins; the next save is pinned to it', async () => {
    const { a } = await raceTwoEditors();
    fireEvent.click(screen.getByTestId('draft-conflict-overwrite'));
    // The second, explicit confirmation — nothing is sent until it is given.
    const savesBefore = server.saves.length;
    expect(await screen.findByTestId('draft-conflict-overwrite-confirm')).toBeInTheDocument();
    expect(server.saves.length).toBe(savesBefore);
    await act(async () => {
      fireEvent.click(screen.getByTestId('draft-conflict-overwrite-confirm'));
    });
    await waitFor(() => expect(server.saves.length).toBe(savesBefore + 1), { timeout: 8000 });
    const overwrite = server.saves[server.saves.length - 1]!;
    // B's draft is the version the refusal named.
    expect([overwrite.ifMatch, overwrite.ifNoneMatch]).toEqual(['hmac-sha256:v2', undefined]);
    expect(serverDraftFields()).toEqual(['title', 'status', 'new_field', 'second_field']);
    await waitFor(() => expect(within(a).queryByTestId('data-autosaving')).toBeNull(), { timeout: 8000 });

    await addFieldAndSave(a, addFieldFromGrid, { label: 'Third field' });
    expect(server.saves[server.saves.length - 1]!.ifMatch).toBe(`hmac-sha256:v${server.seq - 1}`);
  });
});

describe('Data pillar — a create sends If-None-Match: * (objectui#11773)', () => {
  it('the new object\'s skeleton is sent with the first-write pin; its first edit after the load is pinned to the read', async () => {
    server.active.clear();
    const a = openEditor();
    fireEvent.click(await within(a).findByTestId('empty-state-new-object', undefined, { timeout: 8000 }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(dialog.querySelectorAll('input')[0]!, { target: { value: 'Ticket' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /save as draft/i }));
    await waitFor(() => expect(server.saves).toHaveLength(1), { timeout: 8000 });
    expect([server.saves[0]!.ifMatch, server.saves[0]!.ifNoneMatch]).toEqual([undefined, '*']);

    await loaded(a, '1 fields');
    fireEvent.click(within(a).getAllByRole('button', { name: 'Form' })[0]!);
    await addFieldAndSave(a, addFieldFromFormToolbar);
    await addFieldAndSave(a, addFieldFromFormToolbar, SECOND);
    expect(server.saves.map((s) => [s.ifMatch, s.ifNoneMatch])).toEqual([
      [undefined, '*'],
      ['hmac-sha256:v1', undefined],
      ['hmac-sha256:v2', undefined],
    ]);
  });
});
