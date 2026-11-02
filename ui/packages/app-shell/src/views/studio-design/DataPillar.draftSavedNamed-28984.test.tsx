// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#28984 — a landed Studio draft autosave names what it saved.
 *
 * The only feedback a landed draft autosave gave was the top bar's
 * "Saved HH:MM", which names nothing; only feedback that names the item counts
 * as write feedback (ruling 6545938831 ② on #28345). The Data pillar now
 * toasts "Draft saved: LABEL" when the draft save lands, and keeps the hint.
 *
 * Driven through the pillar's real autosave and a real `MetadataClient` over a
 * fetch double, with sonner's real `Toaster` mounted, so the assertions read
 * the toasts a user would see:
 *
 * - a landed save shows one toast naming the object, beside the hint;
 * - a refused save shows the refusal and no "saved" toast;
 * - saving one object again (an Add field, then typing the field's label)
 *   keeps ONE toast on screen: every save announces under the same sonner id,
 *   which updates the toast in place. The toaster's duration is long here so
 *   the first toast is still up when the second save lands; a per-save id
 *   would then show two.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { Toaster, toast } from 'sonner';
import { MetadataClient } from '@object-ui/data-objectstack';

const objectDef = {
  name: 'showcase_task',
  label: 'Task',
  fields: [{ name: 'title', label: 'Title', type: 'text' }],
};

const puts: string[] = [];
const server = { refuse: false };

const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
  if (init?.method === 'PUT') {
    puts.push(String(url));
    if (server.refuse) {
      return new Response(
        JSON.stringify({ success: false, error: { code: 'VALIDATION_ERROR', message: 'The draft was refused by the server.' } }),
        { status: 422, headers: { 'content-type': 'application/json' } },
      );
    }
    return new Response(JSON.stringify({ success: true, data: { state: 'draft' } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }
  return new Response('null', { status: 404, headers: { 'content-type': 'application/json' } });
});

const client = new MetadataClient({ baseUrl: 'http://test.local', fetch: fetchImpl as unknown as typeof fetch });
Object.assign(client, {
  list: vi.fn(async () => [{ name: 'showcase_task', label: 'Task' }]),
  listDrafts: vi.fn(async () => []),
  layered: vi.fn(async () => ({ effective: objectDef, code: objectDef })),
  getDraft: vi.fn(async () => null),
});

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
import { addFieldFromFormToolbar } from './__tests__/dataPillarAddField';
import { createEmptyDataSource } from './__tests__/emptyDataSource';
import { registerBuiltinInspectors } from '../metadata-admin/inspectors';
import { tFormat } from '../metadata-admin/i18n';

const dataSource = createEmptyDataSource();
registerBuiltinInspectors();

const SAID = tFormat('engine.studio.draftSaved', 'en', { item: 'Task' });
const TOAST_ID = 'studio-draft-saved:object:showcase_task';

afterEach(() => {
  act(() => {
    toast.dismiss();
  });
  cleanup();
  puts.length = 0;
  server.refuse = false;
  fetchImpl.mockClear();
  vi.restoreAllMocks();
});

function mount(): void {
  render(
    <>
      <Toaster duration={60_000} />
      <MemoryRouter initialEntries={['/studio/com.example.showcase/data']}>
        <DataPillar packageId="com.example.showcase" />
      </MemoryRouter>
    </>,
  );
}

/** The sonner toasts on screen whose text is the draft-saved sentence. */
function savedToasts(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-sonner-toast]')).filter((el) =>
    (el.textContent ?? '').includes(SAID),
  );
}

/** The inspector control under a visible label. */
function controlUnder(label: string): HTMLInputElement {
  const lab = screen.getByText(label, { selector: 'label' });
  return lab.parentElement!.querySelector('input') as HTMLInputElement;
}

/** Waits past the autosave's 1.5 s debounce and the save's round trip. */
async function pastAutosave(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 2300));
  });
}

describe('Studio Data pillar — a landed draft autosave names what it saved (objectstack#28984)', () => {
  it('a landed save toasts the object by its label, and the top-bar hint stays', async () => {
    const success = vi.spyOn(toast, 'success');
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Form' }));
    await addFieldFromFormToolbar();
    await screen.findByTestId('data-saved-at', undefined, { timeout: 5000 });
    expect(puts.some((u) => u.includes('mode=draft')), `PUTs: ${puts.join(' | ')}`).toBe(true);

    await waitFor(() => expect(savedToasts()).toHaveLength(1));
    expect(SAID).toContain('Task');
    expect(success).toHaveBeenCalledWith(SAID, { id: TOAST_ID });
  });

  it('a refused save shows its refusal and says nothing about saving', async () => {
    server.refuse = true;
    const success = vi.spyOn(toast, 'success');
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Form' }));
    await addFieldFromFormToolbar();
    await screen.findByTestId('studio-refusal', undefined, { timeout: 5000 });
    expect(puts.length, 'the autosave never sent: the harness is dead').toBeGreaterThan(0);

    expect(savedToasts()).toEqual([]);
    expect(success.mock.calls.filter(([, opts]) => (opts as { id?: string } | undefined)?.id === TOAST_ID)).toEqual([]);
    expect(screen.queryByTestId('data-saved-at')).toBeNull();
  });

  it('saving one object again keeps one toast on screen, under one id', async () => {
    const success = vi.spyOn(toast, 'success');
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Form' }));
    await addFieldFromFormToolbar();
    await screen.findByText('Label', { selector: 'label' }, { timeout: 4000 });
    await pastAutosave();
    await waitFor(() => expect(savedToasts()).toHaveLength(1));
    const sentFirst = puts.length;

    // The card's own edit: the field's label, typed in its inspector.
    const label = controlUnder('Label');
    await userEvent.clear(label);
    await userEvent.type(label, 'QA Remark');
    await pastAutosave();
    expect(puts.length, 'the label edit was never saved: the harness is dead').toBeGreaterThan(sentFirst);

    const announced = success.mock.calls.filter(([said]) => said === SAID);
    expect(announced.length, 'two landed saves, two announcements').toBeGreaterThanOrEqual(2);
    expect(savedToasts(), 'one toast, updated in place, not a pile').toHaveLength(1);
    expect(new Set(announced.map(([, opts]) => (opts as { id?: string } | undefined)?.id))).toEqual(new Set([TOAST_ID]));
  });
});
