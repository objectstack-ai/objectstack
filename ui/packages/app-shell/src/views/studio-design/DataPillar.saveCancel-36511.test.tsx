// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36511 — the object page saves with the top bar's Save and
 * Cancel, and a Save is live at once.
 *
 * - An edit sends nothing: no draft write leaves before Save is pressed, however
 *   long the page waits (the 1.5 s autosave is gone from this buffer).
 * - Save writes the object's draft at its package, then publishes that one
 *   object at the same package (`POST /meta/object/NAME/publish?package=`), and
 *   says what went live. The batch door (`/packages/:id/publish-drafts`) is
 *   never called.
 * - Cancel sends nothing and puts the page back as the server holds it.
 * - A refused publish keeps the page's edits, unsaved (Save is still offered),
 *   names the reason on the page and in the toast, and takes back the draft the
 *   save wrote, so the refusal leaves no draft pending.
 * - An edit that cannot be sent yet holds the whole Save, naming what it needs.
 * - Removing a published field is confirmed at Save with its consequence;
 *   declined, nothing is sent.
 *
 * The client is a real `MetadataClient`; only its transport and its reads are
 * doubles, so each write's URL is what the server would read.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MetadataClient } from '@object-ui/data-objectstack';

const PACKAGE = 'com.example.showcase';
const objectDef = {
  name: 'showcase_task',
  label: 'Task',
  fields: [
    { name: 'title', label: 'Title', type: 'text' },
    { name: 'place', label: 'Place', type: 'text' },
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
const server = { refusePublish: false };

const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
  const method = init?.method ?? 'GET';
  if (method === 'GET') return json(404, null);
  writes.push({ method, url: new URL(url), body: init?.body ? JSON.parse(String(init.body)) : null });
  if (method === 'POST' && server.refusePublish) {
    return json(422, {
      success: false,
      error: { code: 'INVALID_METADATA', message: 'The object refers to a field that is not live yet.' },
    });
  }
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
// The field header's ⋯ menu as plain buttons (as in `DataPillar.celGate.test.tsx`).
vi.mock('@object-ui/components', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@object-ui/components')>();
  const Pass = (p: { children?: React.ReactNode }) => <div>{p.children}</div>;
  const Item = (p: { children?: React.ReactNode; onSelect?: () => void }) => (
    <button type="button" onClick={() => p.onSelect?.()}>{p.children}</button>
  );
  return {
    ...mod,
    DropdownMenu: Pass,
    DropdownMenuTrigger: Pass,
    DropdownMenuContent: Pass,
    DropdownMenuItem: Item,
    DropdownMenuRadioGroup: Pass,
    DropdownMenuRadioItem: Item,
  };
});
vi.mock('@object-ui/react', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@object-ui/react')>();
  return { ...mod, useAdapter: () => dataSource };
});

import { toast } from 'sonner';
import { DataPillar } from './StudioDesignSurface';
import { addFieldFromFormToolbar } from './__tests__/dataPillarAddField';
import { createEmptyDataSource } from './__tests__/emptyDataSource';
import { StudioSaveHarness, pressStudioCancel, pressStudioSave } from './__tests__/studioSaveHarness';
import { registerBuiltinInspectors } from '../metadata-admin/inspectors';
import { t, tFormat } from '../metadata-admin/i18n';
// The source reaches a dynamic import of it: its first load is paid at collection (`check:test-source-alias`).
import '@objectstack/lint';

const dataSource = createEmptyDataSource();
registerBuiltinInspectors();

const confirmSpy = vi.fn((_message?: string) => true);
beforeEach(() => {
  confirmSpy.mockReset();
  confirmSpy.mockReturnValue(true);
  window.confirm = confirmSpy as unknown as typeof window.confirm;
});
afterEach(() => {
  cleanup();
  writes.length = 0;
  server.refusePublish = false;
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
});

/** The Form canvas's card of the field labelled `label`, or `null`. */
const card = (label: string) =>
  screen.queryAllByText(label).map((el) => el.closest('.cursor-grab')).find((el) => el !== null) ?? null;
const describeWrite = (w: Write) => `${w.method} ${w.url.pathname}${w.url.search}`;

async function mountOnForm(): Promise<void> {
  render(
    <MemoryRouter initialEntries={[`/studio/${PACKAGE}/data`]}>
      <StudioSaveHarness>
        <DataPillar packageId={PACKAGE} />
      </StudioSaveHarness>
    </MemoryRouter>,
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Form' }));
  await screen.findByTestId('form-toolbar');
}

/** Past the retired autosave's 1.5 s debounce and a round trip. */
async function waitPastTheOldAutosave(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 2300));
  });
}

describe('Data pillar — Save and Cancel in the top bar, live at once (objectstack#36511)', () => {
  it('an edit sends nothing until Save; Save writes the draft, then publishes that object at its package', async () => {
    await mountOnForm();
    expect(screen.queryByTestId('studio-save'), 'no edit, no Save').toBeNull();
    await addFieldFromFormToolbar(undefined, { label: 'Due' });
    expect(await screen.findByTestId('studio-save')).toBeInTheDocument();
    expect(screen.getByTestId('studio-cancel')).toBeInTheDocument();
    await waitPastTheOldAutosave();
    expect(writes.map(describeWrite), 'no write before Save').toEqual([]);

    await pressStudioSave();
    await waitFor(() => expect(writes).toHaveLength(2), { timeout: 4000 });
    const [draft, publish] = writes;
    expect(draft.method).toBe('PUT');
    expect(draft.url.pathname).toBe('/api/v1/meta/object/showcase_task');
    expect(draft.url.searchParams.get('mode')).toBe('draft');
    expect(draft.url.searchParams.get('package')).toBe(PACKAGE);
    expect((draft.body?.fields as Array<{ name: string }>).map((f) => f.name)).toContain('due');
    expect(publish.method).toBe('POST');
    expect(publish.url.pathname).toBe('/api/v1/meta/object/showcase_task/publish');
    expect(publish.url.searchParams.get('package')).toBe(PACKAGE);
    expect(writes.some((w) => w.url.pathname.includes('publish-drafts'))).toBe(false);

    await waitFor(() => expect(screen.queryByTestId('studio-save')).toBeNull());
    expect(toast.success).toHaveBeenCalledWith(tFormat('engine.studio.save.done', 'en', { items: 'Task' }));
  });

  it('Cancel sends nothing and puts the page back as the server holds it', async () => {
    await mountOnForm();
    await addFieldFromFormToolbar(undefined, { label: 'Due' });
    await waitFor(() => expect(card('Due')).not.toBeNull());
    const loads = layered.mock.calls.length;

    await pressStudioCancel();
    await waitFor(() => expect(card('Due')).toBeNull());
    expect(card('Place')).not.toBeNull();
    expect(layered.mock.calls.length, 'the object was read again from the server').toBeGreaterThan(loads);
    expect(screen.queryByTestId('studio-save')).toBeNull();
    await waitPastTheOldAutosave();
    expect(writes.map(describeWrite)).toEqual([]);
  });

  it('a refused publish keeps the edits unsaved, says why, and takes back the draft it wrote', async () => {
    server.refusePublish = true;
    await mountOnForm();
    await addFieldFromFormToolbar(undefined, { label: 'Due' });
    await pressStudioSave();
    await waitFor(() => expect(writes).toHaveLength(3), { timeout: 4000 });
    expect(writes.map((w) => w.method)).toEqual(['PUT', 'POST', 'DELETE']);
    const discard = writes[2];
    expect(discard.url.pathname).toBe('/api/v1/meta/object/showcase_task');
    expect(discard.url.searchParams.get('state')).toBe('draft');
    expect(discard.url.searchParams.get('package')).toBe(PACKAGE);

    const strip = await screen.findByTestId('studio-refusal');
    expect(strip).toHaveTextContent('The object refers to a field that is not live yet.');
    expect(card('Due'), 'the edit is still on the page').not.toBeNull();
    expect(screen.getByTestId('studio-save'), 'and still offered to Save').toBeInTheDocument();
    expect(toast.error).toHaveBeenCalledWith(
      tFormat('engine.studio.save.refused', 'en', { items: 'Task' }),
      expect.objectContaining({ description: expect.stringContaining('The object refers to a field that is not live yet.') }),
    );
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('an edit that cannot be sent yet holds the whole Save and names what it needs', async () => {
    await mountOnForm();
    // A Picklist with no option yet: the write guard would refuse it.
    await addFieldFromFormToolbar(undefined, { label: 'Stage', type: /^Picklist$/ });
    await screen.findByTestId('studio-held');
    await pressStudioSave();
    const clause = tFormat('engine.studio.held.needsOptions', 'en', { field: 'Stage' });
    expect(toast.error).toHaveBeenCalledWith(tFormat('engine.studio.save.held', 'en', { clause }));
    await waitPastTheOldAutosave();
    expect(writes.map(describeWrite)).toEqual([]);
    expect(screen.getByTestId('studio-save')).toBeInTheDocument();
  });

  it('removing a published field asks at Save, naming the consequence; declined, nothing is sent', async () => {
    confirmSpy.mockReturnValue(false);
    await mountOnForm();
    fireEvent.click((await screen.findByText('Place')).closest('.cursor-grab') as HTMLElement);
    fireEvent.click(await screen.findByRole('button', { name: 'Remove “Place”' }));
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByTestId('field-remove-confirm-action'));
    await waitFor(() => expect(card('Place')).toBeNull());
    await waitPastTheOldAutosave();
    expect(writes.map(describeWrite), 'removing it from the page sends nothing').toEqual([]);

    await pressStudioSave();
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    const asked = String(confirmSpy.mock.calls[0][0]);
    expect(asked).toContain(tFormat('engine.studio.save.confirmRemoveField', 'en', { field: 'Place' }));
    expect(writes.map(describeWrite), 'declined: nothing sent').toEqual([]);
    expect(screen.getByTestId('studio-save')).toBeInTheDocument();

    confirmSpy.mockReturnValue(true);
    await pressStudioSave();
    await waitFor(() => expect(writes.map((w) => w.method)).toEqual(['PUT', 'POST']), { timeout: 4000 });
    expect((writes[0].body?.fields as Array<{ name: string }>).map((f) => f.name)).toEqual(['title']);
    expect(t('engine.studio.save.confirmIrreversible', 'en')).not.toBe('engine.studio.save.confirmIrreversible');
  });
});
