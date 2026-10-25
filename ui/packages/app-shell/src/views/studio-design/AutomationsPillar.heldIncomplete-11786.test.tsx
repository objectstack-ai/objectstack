// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11786 — on the Studio Automations page, a step just added is held
 * until its required inputs are filled, not refused.
 *
 * The card's measured case: adding a Notify step sent the draft at once
 * (`PUT …/meta/flow/NAME?mode=draft`) and the server answered 422, a red strip
 * before the author could fill the step in. A fresh Notify (the canvas seed,
 * `channels: ['inbox'], recipients: []`) is refused for one key, its `title`:
 * the spec's flow parse names `nodes.N.config.title` and nothing else
 * (`metadataError.heldEdit-11786.test.ts` measures it on the installed spec).
 *
 * Now the pillar asks the spec's own judges before sending (`specRequiresField`
 * over the inputs the step's inspector offers): the edit stays dirty and
 * unsent, the inspector says so under the required input, a neutral line names
 * it, and filling it in lets the next autosave go. A server refusal of a
 * complete draft keeps objectui#11785's red strip
 * (`AutomationsPillar.authorRefusal-11785.test.tsx`, unchanged).
 *
 * The canvas and inspector are the real registered `FlowPreview` and
 * `FlowInspector`; the client double records every save.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const PKG = 'com.acme.app';

const FLOW = {
  name: 'approval',
  label: 'Approval',
  type: 'autolaunched',
  status: 'obsolete',
  nodes: [
    { id: 'start', type: 'start', label: 'Start' },
    { id: 'end', type: 'end', label: 'End' },
  ],
  edges: [{ id: 'e1', source: 'start', target: 'end' }],
};

const mockClient = vi.hoisted(() => ({
  saves: [] as Array<Record<string, unknown>>,
  list: vi.fn(async () => [{ name: 'approval', label: 'Approval' }]),
  listDrafts: vi.fn(async () => []),
  listTypes: vi.fn(async () => ({ entries: [] })),
  get: vi.fn(async () => null),
  references: vi.fn(async () => []),
  layered: vi.fn(async () => ({
    code: null,
    overlay: null,
    overlayScope: null,
    effective: JSON.parse(JSON.stringify(FLOW)),
    editable: true,
    deletable: true,
    resettable: false,
    lock: 'none',
  })),
  getDraft: vi.fn(async (type: string, name: string) => {
    throw Object.assign(new Error(`No pending draft exists for ${type}/${name}.`), { code: 'NO_DRAFT', status: 404 });
  }),
  save: vi.fn(async (_type: string, _name: string, item: unknown) => {
    mockClient.saves.push(JSON.parse(JSON.stringify(item)) as Record<string, unknown>);
    return {};
  }),
  publish: vi.fn(async () => ({ success: true })),
  reset: vi.fn(async () => ({})),
}));

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

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { AutomationsPillar } from './StudioDesignSurface';
import { createEmptyDataSource } from './__tests__/emptyDataSource';
import { registerMetadataPreview } from '../metadata-admin/preview-registry';
import { registerMetadataInspector } from '../metadata-admin/inspector-registry';
import { FlowPreview } from '../metadata-admin/previews/FlowPreview';
import { FlowInspector } from '../metadata-admin/inspectors/FlowInspector';
import { browserClick } from '../metadata-admin/previews/__tests__/browserClick';
import { t, tFormat } from '../metadata-admin/i18n';

const dataSource = createEmptyDataSource();

// The pillar's `/automation/_status` probe, the palette's engine overlay and the
// inspector's catalog reads go through the global `fetch`; "absent" keeps each
// on its documented offline fallback.
vi.stubGlobal(
  'fetch',
  vi.fn(async () => new Response('null', { status: 404, headers: { 'content-type': 'application/json' } })),
);

registerMetadataPreview('flow', FlowPreview);
registerMetadataInspector('flow', FlowInspector);

beforeEach(() => {
  mockClient.saves.length = 0;
  for (const fn of Object.values(mockClient)) {
    if (typeof fn === 'function') (fn as unknown as { mockClear: () => void }).mockClear();
  }
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

/** Past the autosave's 1.5 s debounce. */
async function outlastDebounce(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 2300));
  });
}

/** Open the flow and add a Notify step on its one edge, as an author does. */
async function addNotify(): Promise<string> {
  render(
    <MemoryRouter initialEntries={[`/studio/${PKG}/automations`]}>
      <AutomationsPillar packageId={PKG} />
    </MemoryRouter>,
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Insert node here' }, { timeout: 8000 }));
  const option = screen.getAllByRole('option').find((o) => o.textContent?.startsWith('Notify'));
  expect(option, 'the palette offers Notify').toBeDefined();
  browserClick(option!);
  const rail = screen.getByRole('complementary');
  const id = (await within(rail).findByLabelText('ID', undefined, { timeout: 8000 })) as HTMLInputElement;
  return id.value;
}

const heldLine = (clause: string) => tFormat('engine.studio.held.line', 'en', { clause });

describe('Automations page — a new Notify step is held until it is filled in (objectui#11786)', () => {
  it('sends no draft and shows no red strip; Title carries the hint; filling it lets the save go', async () => {
    const id = await addNotify();
    await outlastDebounce();

    expect(mockClient.save, 'a step missing a required input is not sent').not.toHaveBeenCalled();
    expect(screen.queryByTestId('studio-refusal'), 'no red strip on the normal path').toBeNull();
    const held = screen.getByTestId('studio-held');
    expect(within(held).getByTestId('studio-held-message')).toHaveTextContent(
      heldLine(tFormat('engine.studio.held.needsInput', 'en', { input: 'Title', step: 'Notify' })),
    );
    // The step is the one open: the line offers no "Show me".
    expect(within(held).queryByRole('button', { name: t('engine.studio.refusal.show', 'en') })).toBeNull();
    const rail = screen.getByRole('complementary');
    const hints = within(rail).getAllByTestId('flow-field-held-hint');
    expect(hints, 'one hint, under the one required input the step leaves out').toHaveLength(1);
    expect(hints[0]).toHaveTextContent(t('engine.studio.held.inputHint', 'en'));
    expect(hints[0].previousElementSibling).toHaveTextContent(/^Title/);

    fireEvent.change(within(rail).getByPlaceholderText('Your request was approved'), {
      target: { value: 'Request approved' },
    });
    await waitFor(() => expect(mockClient.save).toHaveBeenCalledTimes(1), { timeout: 4000 });
    const sent = mockClient.saves[0].nodes as Array<Record<string, unknown>>;
    expect(sent.find((n) => n.id === id)).toEqual(
      expect.objectContaining({ type: 'notify', config: expect.objectContaining({ title: 'Request approved' }) }),
    );
    await waitFor(() => expect(screen.queryByTestId('studio-held')).toBeNull());
    expect(within(rail).queryByTestId('flow-field-held-hint')).toBeNull();
    expect(screen.queryByTestId('studio-refusal')).toBeNull();
  });

  it('"Show me" on the line reopens the held step once another selection closed it', async () => {
    const id = await addNotify();
    await outlastDebounce();

    fireEvent.click(screen.getByRole('button', { name: t('engine.studio.deselect', 'en') }));
    const rail = screen.getByRole('complementary');
    expect(within(rail).queryByLabelText('ID')).toBeNull();

    fireEvent.click(
      within(screen.getByTestId('studio-held')).getByRole('button', { name: t('engine.studio.refusal.show', 'en') }),
    );
    expect(((await within(rail).findByLabelText('ID')) as HTMLInputElement).value).toBe(id);
    expect(mockClient.save).not.toHaveBeenCalled();
  });
});
