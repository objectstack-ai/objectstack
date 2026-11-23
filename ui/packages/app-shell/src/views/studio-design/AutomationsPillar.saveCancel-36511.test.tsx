// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36511 — a flow saves with the top bar's Save and Cancel, and a
 * Save is live at once; its switch and its creation are live at once too.
 *
 * - A canvas or properties edit sends nothing until Save, however long the page
 *   waits (the flow's 1.5 s autosave is gone).
 * - Save writes the flow's draft at its package, then publishes that one flow
 *   at the same package (`publish('flow', NAME, { packageId })`).
 * - Cancel sends nothing and puts the flow back as the server holds it.
 * - The switch needs no Save: a flip writes the stored flow with the new
 *   `status` and publishes it at once. An unsaved canvas edit is not sent with
 *   it, and stays on the page for Save.
 * - A new flow is published as it is created (born off), and switching it on
 *   publishes it on, at once.
 *
 * The REAL `AutomationsPillar` with the REAL registered `FlowPreview` and
 * `FlowInspector`, over a metadata client double whose publish moves the
 * draft to the live row, as the server's single-item publish does.
 */

import '@testing-library/jest-dom/vitest';
// Paid at collection, not inside a clocked case (check:test-source-alias):
// the source under test loads `@objectstack/lint` lazily.
import '@objectstack/lint';
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
// Module scope as well as in the `vi.mock` factory below: the cold transform is paid
// during collection, which no test or hook timeout clocks (AGENTS.md, flaky-test discipline).
import '@object-ui/components';
import { render, screen, fireEvent, cleanup, waitFor, within, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const PKG = 'com.acme.app';

const FLOW = {
  name: 'notify_owner',
  label: 'Notify owner',
  type: 'autolaunched',
  status: 'active',
  nodes: [
    { id: 'start', type: 'start', label: 'Start' },
    { id: 'end', type: 'end', label: 'End' },
  ],
  edges: [{ id: 'e1', source: 'start', target: 'end' }],
};

const server = vi.hoisted(() => ({
  active: new Map<string, Record<string, unknown>>(),
  drafts: new Map<string, Record<string, unknown>>(),
  /** Every write, in order: `save TYPE/NAME`, `publish TYPE/NAME`, `reset TYPE/NAME`. */
  log: [] as string[],
}));

const mockClient = vi.hoisted(() => {
  const k = (type: string, name: string) => `${type}/${name}`;
  return {
    list: vi.fn(async (type: string) =>
      [...server.active.entries()]
        .filter(([key]) => key.startsWith(`${type}/`))
        .map(([, row]) => ({ name: row.name, label: row.label ?? row.name })),
    ),
    listResponse: vi.fn(async (type: string) => ({
      items: [...server.active.keys()].filter((key) => key.startsWith(`${type}/`)).map((key) => ({ name: key.split('/')[1] })),
    })),
    listDrafts: vi.fn(async () => []),
    listTypes: vi.fn(async () => ({ entries: [] })),
    get: vi.fn(async () => null),
    references: vi.fn(async () => []),
    layered: vi.fn(async (type: string, name: string) => {
      const eff = server.active.get(k(type, name)) ?? null;
      const draft = server.drafts.get(k(type, name)) ?? null;
      return { code: null, overlay: eff, overlayScope: eff ? 'env' : null, effective: eff, draft, editable: true, deletable: true, resettable: false, lock: 'none' };
    }),
    getDraft: vi.fn(async (type: string, name: string) => {
      const draft = server.drafts.get(k(type, name));
      if (draft) return { item: JSON.parse(JSON.stringify(draft)) as Record<string, unknown> };
      throw Object.assign(new Error(`No pending draft exists for ${type}/${name}.`), { code: 'NO_DRAFT', status: 404 });
    }),
    save: vi.fn(async (type: string, name: string, item: unknown) => {
      server.log.push(`save ${k(type, name)}`);
      server.drafts.set(k(type, name), JSON.parse(JSON.stringify(item)) as Record<string, unknown>);
      return { type, name, item };
    }),
    // The single-item publish: the pending draft becomes the live row.
    publish: vi.fn(async (type: string, name: string) => {
      server.log.push(`publish ${k(type, name)}`);
      const draft = server.drafts.get(k(type, name));
      if (draft) {
        server.active.set(k(type, name), draft);
        server.drafts.delete(k(type, name));
      }
      return { success: true };
    }),
    reset: vi.fn(async (type: string, name: string) => {
      server.log.push(`reset ${k(type, name)}`);
      return {};
    }),
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
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), dismiss: vi.fn() } }));

import { toast } from 'sonner';
import { AutomationsPillar } from './StudioDesignSurface';
import { createEmptyDataSource } from './__tests__/emptyDataSource';
import { StudioSaveHarness, pressStudioCancel, pressStudioSave } from './__tests__/studioSaveHarness';
import { registerMetadataPreview } from '../metadata-admin/preview-registry';
import { registerMetadataInspector } from '../metadata-admin/inspector-registry';
import { FlowPreview } from '../metadata-admin/previews/FlowPreview';
import { FlowInspector } from '../metadata-admin/inspectors/FlowInspector';
import { t, tFormat } from '../metadata-admin/i18n';

const dataSource = createEmptyDataSource();
registerMetadataPreview('flow', FlowPreview);
registerMetadataInspector('flow', FlowInspector);

const en = (key: string) => t(key, 'en');
const fetchSpy = vi.fn(async (_input: RequestInfo | URL) => new Response('null', { status: 404, headers: { 'content-type': 'application/json' } }));

beforeEach(() => {
  server.active.clear();
  server.drafts.clear();
  server.log.length = 0;
  for (const fn of Object.values(mockClient)) (fn as unknown as { mockClear: () => void }).mockClear();
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
  window.confirm = vi.fn(() => true) as unknown as typeof window.confirm;
  // The `/automation/_status` probe, the action catalog and the run history
  // read all go through the global `fetch`; one double answers "absent".
  vi.stubGlobal('fetch', fetchSpy);
  server.active.set(`flow/${FLOW.name}`, JSON.parse(JSON.stringify(FLOW)));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function mount(): void {
  render(
    <StudioSaveHarness>
      <MemoryRouter initialEntries={[`/studio/${PKG}/automations`]}>
        <AutomationsPillar packageId={PKG} />
      </MemoryRouter>
    </StudioSaveHarness>,
  );
}

const statusText = () => screen.getByText('Status:').nextElementSibling;

async function openFlow(): Promise<void> {
  mount();
  await screen.findByTestId('auto-tab-canvas', undefined, { timeout: 8000 });
  await waitFor(() => expect(statusText()).toHaveTextContent(en('engine.studio.auto.enabled')), { timeout: 8000 });
}

async function editStartLabel(value: string): Promise<void> {
  fireEvent.click(document.querySelector('[data-node-id="start"] [role="button"]') as HTMLElement);
  const box = await within(screen.getByTestId('auto-config-aside')).findByLabelText('Label', undefined, { timeout: 8000 });
  fireEvent.change(box, { target: { value } });
  fireEvent.blur(box);
}

/** Past the retired autosave's 1.5 s debounce and a round trip. */
async function waitPastTheOldAutosave(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 2300));
  });
}

const nodeLabel = (id: string) =>
  ((server.active.get(`flow/${FLOW.name}`)?.nodes as Array<{ id: string; label?: string }>) ?? []).find((n) => n.id === id)?.label;

describe('Flows — Save and Cancel in the top bar, live at once (objectstack#36511)', () => {
  it('an edit sends nothing until Save; Save writes the draft, then publishes that flow at its package', async () => {
    await openFlow();
    expect(screen.queryByTestId('studio-save')).toBeNull();
    await editStartLabel('Kick-off');
    expect(await screen.findByTestId('studio-save')).toBeInTheDocument();
    await waitPastTheOldAutosave();
    expect(server.log, 'no write before Save').toEqual([]);

    await pressStudioSave();
    await waitFor(() => expect(server.log).toEqual([`save flow/${FLOW.name}`, `publish flow/${FLOW.name}`]), { timeout: 4000 });
    const [, , body, opts] = mockClient.save.mock.calls[0] as unknown as [string, string, Record<string, unknown>, Record<string, unknown>];
    expect(opts).toMatchObject({ mode: 'draft', packageId: PKG });
    expect(JSON.stringify(body.nodes)).toContain('Kick-off');
    expect(mockClient.publish).toHaveBeenCalledWith('flow', FLOW.name, { packageId: PKG });
    expect(nodeLabel('start'), 'the live row holds the edit').toBe('Kick-off');
    await waitFor(() => expect(screen.queryByTestId('studio-save')).toBeNull());
    expect(toast.success).toHaveBeenCalledWith(tFormat('engine.studio.save.done', 'en', { items: FLOW.label }), { id: 'studio-save' });
  }, 30_000);

  it('Cancel sends nothing and puts the flow back as the server holds it', async () => {
    await openFlow();
    await editStartLabel('Kick-off');
    await waitFor(() => expect(document.querySelector('[data-node-id="start"]')).toHaveTextContent('Kick-off'));

    await pressStudioCancel();
    await waitFor(() => expect(document.querySelector('[data-node-id="start"]')).toHaveTextContent('Start'));
    expect(document.querySelector('[data-node-id="start"]')).not.toHaveTextContent('Kick-off');
    expect(screen.queryByTestId('studio-save')).toBeNull();
    await waitPastTheOldAutosave();
    expect(server.log).toEqual([]);
  }, 30_000);

  it('the switch is live at once: the stored flow is written with the new status and published, without the unsaved edit', async () => {
    await openFlow();
    await editStartLabel('Kick-off');
    await screen.findByTestId('studio-save');

    fireEvent.click(screen.getByRole('switch'));
    await waitFor(() => expect(server.log).toEqual([`save flow/${FLOW.name}`, `publish flow/${FLOW.name}`]), { timeout: 4000 });
    const live = server.active.get(`flow/${FLOW.name}`)!;
    expect(live.status).toBe('obsolete');
    expect(nodeLabel('start'), 'the unsaved edit was not sent with the switch').toBe('Start');
    expect(toast.success).toHaveBeenCalledWith(en('engine.studio.auto.disabledToast'));
    // The edit stays on the page, for Save.
    expect(screen.getByTestId('studio-save')).toBeInTheDocument();
    expect(document.querySelector('[data-node-id="start"]')).toHaveTextContent('Kick-off');
  }, 30_000);

  it('a new flow is published as it is created, off; switched on, it is published on at once', async () => {
    mount();
    await screen.findByTestId(`auto-rail-row-${FLOW.name}`, undefined, { timeout: 8000 });
    fireEvent.click(screen.getByTitle(en('engine.studio.auto.newTitle')));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByTestId('create-flow-preset-manual'));
    fireEvent.change(dialog.querySelectorAll('input')[0], { target: { value: 'Escalate' } });
    fireEvent.click(within(dialog).getByRole('button', { name: en('engine.studio.createDraft') }));

    await waitFor(() => expect(server.log).toEqual(['save flow/escalate', 'publish flow/escalate']), { timeout: 8000 });
    expect(mockClient.save.mock.calls[0][3]).toMatchObject({ mode: 'draft', packageId: PKG, ifNoneMatch: '*' });
    expect(mockClient.publish).toHaveBeenCalledWith('flow', 'escalate', { packageId: PKG });
    expect(server.active.get('flow/escalate')?.status, 'born off').toBe('obsolete');
    expect(server.drafts.has('flow/escalate'), 'no draft is left').toBe(false);

    const toggle = await screen.findByRole('switch', undefined, { timeout: 8000 });
    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'false'), { timeout: 8000 });
    await waitFor(() => expect(toggle).not.toHaveAttribute('aria-disabled'));
    fireEvent.click(toggle);
    await waitFor(() => expect(server.log.slice(2)).toEqual(['save flow/escalate', 'publish flow/escalate']), { timeout: 8000 });
    expect(server.active.get('flow/escalate')?.status, 'switched on, live').toBe('active');
    expect(toast.success).toHaveBeenCalledWith(en('engine.studio.auto.enabledToast'));
    expect(screen.queryByTestId('studio-save'), 'nothing is left to Save').toBeNull();
  }, 40_000);
});
