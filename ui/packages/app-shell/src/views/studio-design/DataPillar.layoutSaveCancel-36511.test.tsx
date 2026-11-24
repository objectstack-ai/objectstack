// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36511 — the field layout (Form · Layout) saves with the top
 * bar's Save and Cancel, as the rest of the object page does.
 *
 * The layout is the object's own `fieldGroups` and `fields[].group`
 * (objectstack#36425), so a layout edit lands in the object's buffer:
 * - it sends nothing before Save, however long the page waits;
 * - Cancel sends nothing and puts the canvas back as the server holds it;
 * - Save writes the object's draft with the new layout, then publishes that one
 *   object at its package.
 *
 * The edit here is a section moved down; a dragged field commits through the
 * same `onChange` (pinned by `ObjectFormDesigner.keyboardDrop-11871`), so it
 * reaches the same buffer.
 *
 * The client is a real `MetadataClient`; only its transport and its reads are
 * doubles, so each write's URL is what the server would read.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MetadataClient } from '@object-ui/data-objectstack';

const PACKAGE = 'com.example.showcase';
const objectDef = {
  name: 'showcase_task',
  label: 'Task',
  fields: [
    { name: 'title', label: 'Title', type: 'text', group: 'main' },
    { name: 'place', label: 'Place', type: 'text', group: 'where' },
  ],
  fieldGroups: [
    { key: 'main', label: 'Main' },
    { key: 'where', label: 'Where' },
  ],
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

interface Write {
  method: string;
  url: URL;
  body: Record<string, unknown> | null;
}
const writes: Write[] = [];

const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
  const method = init?.method ?? 'GET';
  if (method === 'GET') return json(404, null);
  writes.push({ method, url: new URL(url), body: init?.body ? JSON.parse(String(init.body)) : null });
  return json(200, { success: true, version: 'v1' });
});

const client = new MetadataClient({ baseUrl: 'http://test.local', fetch: fetchImpl as unknown as typeof fetch });
const layered = vi.fn(async () => ({ effective: objectDef, code: objectDef }));
Object.assign(client, {
  list: vi.fn(async () => [{ name: 'showcase_task', label: 'Task' }]),
  listDrafts: vi.fn(async () => []),
  layered,
  getDraft: vi.fn(async () => null),
});

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), message: vi.fn(), dismiss: vi.fn() },
  Toaster: () => null,
}));
vi.mock('../metadata-admin/useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../metadata-admin/useMetadata')>();
  return { ...mod, useMetadataClient: () => client, useMetadataTypes: () => ({ entries: [] }) };
});
vi.mock('./packages-io', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./packages-io')>();
  return { ...mod, fetchPackages: vi.fn(async () => []) };
});
vi.mock('@object-ui/react', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@object-ui/react')>();
  return { ...mod, useAdapter: () => dataSource };
});

import { DataPillar } from './StudioDesignSurface';
import { createEmptyDataSource } from './__tests__/emptyDataSource';
import { StudioSaveHarness, pressStudioCancel, pressStudioSave } from './__tests__/studioSaveHarness';
import { t } from '../metadata-admin/i18n';
// The source reaches a dynamic import of it: its first load is paid at collection (`check:test-source-alias`).
import '@objectstack/lint';

const dataSource = createEmptyDataSource();

afterEach(() => {
  cleanup();
  writes.length = 0;
});

const describeWrite = (w: Write) => `${w.method} ${w.url.pathname}${w.url.search}`;

/** The section titles on the Form canvas, top to bottom. */
const sections = () =>
  screen
    .getAllByLabelText(t('engine.studio.designer.group.nameLabel', 'en'))
    .map((input) => (input as HTMLInputElement).value);

async function mountOnLayout(): Promise<void> {
  render(
    <MemoryRouter initialEntries={[`/studio/${PACKAGE}/data`]}>
      <StudioSaveHarness>
        <DataPillar packageId={PACKAGE} />
      </StudioSaveHarness>
    </MemoryRouter>,
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Form' }));
  await screen.findByTestId('form-toolbar');
  await waitFor(() => expect(sections()).toEqual(['Main', 'Where']));
}

/** Move the first section below the second. */
function moveMainDown(): void {
  fireEvent.click(screen.getAllByRole('button', { name: t('engine.studio.designer.groupDown', 'en') })[0]);
}

/** Past the retired autosave's 1.5 s debounce and a round trip. */
async function waitPastTheOldAutosave(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 2300));
  });
}

describe('Field layout — Save and Cancel in the top bar (objectstack#36511)', () => {
  it('a layout edit sends nothing before Save; Cancel puts the canvas back and sends nothing', async () => {
    await mountOnLayout();
    expect(screen.queryByTestId('studio-save')).toBeNull();
    moveMainDown();
    await waitFor(() => expect(sections()).toEqual(['Where', 'Main']));
    expect(await screen.findByTestId('studio-save')).toBeInTheDocument();
    await waitPastTheOldAutosave();
    expect(writes.map(describeWrite), 'no write before Save').toEqual([]);

    const loads = layered.mock.calls.length;
    await pressStudioCancel();
    await waitFor(() => expect(sections()).toEqual(['Main', 'Where']));
    expect(layered.mock.calls.length, 'the object was read again from the server').toBeGreaterThan(loads);
    expect(screen.queryByTestId('studio-save')).toBeNull();
    expect(writes.map(describeWrite)).toEqual([]);
  });

  it('Save writes the new layout as the object’s draft, then publishes that object at its package', async () => {
    await mountOnLayout();
    moveMainDown();
    await waitFor(() => expect(sections()).toEqual(['Where', 'Main']));
    await pressStudioSave();
    await waitFor(() => expect(writes).toHaveLength(2), { timeout: 4000 });
    const [draft, publish] = writes;
    expect(draft.method).toBe('PUT');
    expect(draft.url.pathname).toBe('/api/v1/meta/object/showcase_task');
    expect(draft.url.searchParams.get('mode')).toBe('draft');
    expect(draft.url.searchParams.get('package')).toBe(PACKAGE);
    expect((draft.body?.fieldGroups as Array<{ key: string }>).map((g) => g.key)).toEqual(['where', 'main']);
    expect(publish.method).toBe('POST');
    expect(publish.url.pathname).toBe('/api/v1/meta/object/showcase_task/publish');
    expect(publish.url.searchParams.get('package')).toBe(PACKAGE);
    await waitFor(() => expect(screen.queryByTestId('studio-save')).toBeNull());
  });
});
