// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36742 — after a flow is created in Studio, the header reads the
 * engine's status for it, and the create toast says the flow is switched off.
 *
 * - A new flow is published as it is created, born switched off. The header's
 *   Status pill reads the engine's row, so it says 「已停用」 (Switched off),
 *   not 「未发布草稿」 (Unpublished draft): the snapshot taken before the flow
 *   existed has no row for it, and a missing row reads as never published.
 * - The create toast is its own key, `engine.studio.auto.createdOff`, saying the
 *   flow is created and switched off until enabled, not the Save toast
 *   `engine.studio.save.done` (「已保存并生效」), which promises a run.
 *
 * The REAL `AutomationsPillar` with the REAL registered `FlowPreview` and
 * `FlowInspector`, over a metadata client double whose publish moves the draft
 * to the live row, and an `/automation/_status` double that answers from the
 * live rows, as the engine does.
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
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
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
  /** The `draftChanges` a draft read serves beside the draft, by `TYPE/NAME`. */
  draftChanges: new Map<string, unknown[]>(),
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
      const draftChanges = server.draftChanges.get(k(type, name));
      if (draft) return { item: JSON.parse(JSON.stringify(draft)) as Record<string, unknown>, ...(draftChanges ? { draftChanges } : {}) };
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
import { StudioSaveHarness } from './__tests__/studioSaveHarness';
import { registerMetadataPreview } from '../metadata-admin/preview-registry';
import { registerMetadataInspector } from '../metadata-admin/inspector-registry';
import { FlowPreview } from '../metadata-admin/previews/FlowPreview';
import { FlowInspector } from '../metadata-admin/inspectors/FlowInspector';
import { t, tFormat } from '../metadata-admin/i18n';
import { loadStudioCatalogue } from '@object-ui/i18n/namespaces/studio';

const dataSource = createEmptyDataSource();
registerMetadataPreview('flow', FlowPreview);
registerMetadataInspector('flow', FlowInspector);

const en = (key: string) => t(key, 'en');
const AUTOMATION_STATUS_ROUTE = '/api/v1/automation/_status';
/** How many times the header's engine status was read. */
let statusReads = 0;
/**
 * The engine's `/automation/_status` answer, from the LIVE rows the publish
 * double holds: a published flow has a row (switched off when its `status`
 * is `obsolete`), a flow that does not exist yet has none.
 */
const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
  const url = String(input && typeof input === 'object' && 'url' in input ? (input as { url: unknown }).url : input);
  if (url.split('?')[0] !== AUTOMATION_STATUS_ROUTE) {
    return new Response('null', { status: 404, headers: { 'content-type': 'application/json' } });
  }
  statusReads += 1;
  const flows = [...server.active.entries()]
    .filter(([key]) => key.startsWith('flow/'))
    .map(([, row]) => ({ name: row.name, enabled: row.status !== 'obsolete', bound: false }));
  return new Response(JSON.stringify({ success: true, data: { flows, total: flows.length } }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
});

beforeEach(() => {
  server.active.clear();
  server.drafts.clear();
  server.log.length = 0;
  server.draftChanges.clear();
  statusReads = 0;
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

const statusValue = () => screen.getByText('Status:').nextElementSibling?.textContent ?? '';

async function createFlow(label: string): Promise<void> {
  mount();
  await screen.findByTestId(`auto-rail-row-${FLOW.name}`, undefined, { timeout: 8000 });
  fireEvent.click(screen.getByTitle(en('engine.studio.auto.newTitle')));
  const dialog = await screen.findByRole('dialog');
  fireEvent.click(within(dialog).getByTestId('create-flow-preset-manual'));
  fireEvent.change(dialog.querySelectorAll('input')[0], { target: { value: label } });
  fireEvent.click(within(dialog).getByRole('button', { name: en('engine.studio.createLive') }));
}

describe('a new flow — the header reads the engine, the toast says it is off (objectstack#36742)', () => {
  it('the header reads the engine status after the create: Switched off, not Unpublished draft', async () => {
    await createFlow('Escalate');
    await waitFor(() => expect(server.log).toEqual(['save flow/escalate', 'publish flow/escalate']), { timeout: 8000 });
    expect(server.active.get('flow/escalate')?.status, 'born off').toBe('obsolete');

    await screen.findByText('Status:', undefined, { timeout: 8000 });
    await waitFor(() => expect(statusValue()).toBe(en('engine.studio.auto.off')), { timeout: 8000 });
    expect(statusValue()).not.toBe(en('engine.studio.unpublishedDraft'));
    // The status was read again after the publish, not only at mount.
    expect(statusReads).toBeGreaterThan(1);
  }, 40_000);

  it('the create toast is its own key, worded switched off until enabled', async () => {
    await createFlow('Escalate');
    await waitFor(() => expect(toast.success).toHaveBeenCalled(), { timeout: 8000 });
    expect(toast.success).toHaveBeenCalledWith(tFormat('engine.studio.auto.createdOff', 'en', { name: 'Escalate' }), { id: 'studio-save' });
    expect(toast.success).not.toHaveBeenCalledWith(tFormat('engine.studio.save.done', 'en', { items: 'Escalate' }), expect.anything());
    // The Chinese row, from the namespace's lazily loaded catalogue.
    const zh = await loadStudioCatalogue('zh-CN');
    expect(zh['engine.studio.auto.createdOff']).toBe('已创建：{name}（已停用，启用后才会运行）');
    expect(tFormat('engine.studio.auto.createdOff', 'en', { name: 'Escalate' })).toBe(
      'Created: Escalate (switched off; it runs once you switch it on)',
    );
  }, 40_000);
});
