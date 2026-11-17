// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#34818 slice 3 — the Automations pillar's flow designer, on the
 * REAL `AutomationsPillar` with the REAL registered `FlowPreview` and
 * `FlowInspector` (the harness of `StudioDesignSurface.autosaveInFlight-11204`).
 *
 * Item 8 — a landed flow autosave settles the header's 正在保存 spinner into
 * an 已保存 badge instead of raising a "Draft saved" toast. Seat ruling
 * 6954475081 on #34818 holds the badge to ruling 6545938831 ② on #28345 (write
 * feedback names the item): the badge sits in the flow header's own title row,
 * beside the flow's title, and its accessible text names the flow. A refused
 * save keeps its strip and raises one error toast. Controls: a second edit
 * clears the badge, and an Interfaces page (a leaf) autosave still toasts.
 *
 * Item 6 — the Debug section takes the Configuration aside's place; leaving
 * Debug brings the aside back with the selection kept. Control: Canvas keeps it.
 *
 * Item 9 — the Runs section says why it is empty: a flow the package does not
 * serve yet (never published) reads "publish and turn on", and no run history
 * is fetched; a served flow whose engine does not answer reads the
 * engine-offline sentence.
 */

import '@testing-library/jest-dom/vitest';
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

const HOME = {
  name: 'home',
  label: 'Home',
  type: 'app',
  regions: [{ name: 'main', components: [{ id: 'hello', type: 'element:text', properties: { content: 'Hello' } }] }],
};
const APP = { name: 'acme_app', label: 'Acme', navigation: [{ id: 'nav_home', type: 'page', label: 'Home menu', pageName: 'home' }] };

const server = vi.hoisted(() => ({
  active: new Map<string, Record<string, unknown>>(),
  drafts: new Map<string, Record<string, unknown>>(),
  saves: [] as Array<{ type: string; name: string }>,
  /** While set, every save is refused with this message. */
  refuse: null as string | null,
  /** The names `listResponse('flow')` serves: the published flows. */
  published: new Set<string>(),
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
      items: type === 'flow' ? [...server.published].map((name) => ({ name })) : [],
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
      server.saves.push({ type, name });
      if (server.refuse) throw Object.assign(new Error(server.refuse), { status: 422 });
      server.drafts.set(k(type, name), JSON.parse(JSON.stringify(item)) as Record<string, unknown>);
      return { type, name, item };
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

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), dismiss: vi.fn() } }));

import { toast } from 'sonner';
import { AutomationsPillar, InterfacesPillar } from './StudioDesignSurface';
import { createEmptyDataSource } from './__tests__/emptyDataSource';
import { registerMetadataPreview } from '../metadata-admin/preview-registry';
import { registerMetadataInspector } from '../metadata-admin/inspector-registry';
import { registerMetadataDefaultInspector } from '../metadata-admin/default-inspector-registry';
import { FlowPreview } from '../metadata-admin/previews/FlowPreview';
import { FlowInspector } from '../metadata-admin/inspectors/FlowInspector';
import { PagePreview } from '../metadata-admin/previews/PagePreview';
import { PageBlockInspector } from '../metadata-admin/inspectors/PageBlockInspector';
import { PageDefaultInspector } from '../metadata-admin/inspectors/PageDefaultInspector';
import { t, tFormat } from '../metadata-admin/i18n';

const dataSource = createEmptyDataSource();

registerMetadataPreview('flow', FlowPreview);
registerMetadataInspector('flow', FlowInspector);
registerMetadataPreview('page', PagePreview);
registerMetadataInspector('page', PageBlockInspector);
registerMetadataDefaultInspector('page', PageDefaultInspector);

const en = (key: string) => t(key, 'en');
const fetchSpy = vi.fn(async (_input: RequestInfo | URL) => new Response('null', { status: 404, headers: { 'content-type': 'application/json' } }));

beforeEach(() => {
  server.active.clear();
  server.drafts.clear();
  server.saves.length = 0;
  server.refuse = null;
  server.published = new Set([FLOW.name]);
  for (const fn of Object.values(mockClient)) (fn as unknown as { mockClear: () => void }).mockClear();
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
  fetchSpy.mockClear();
  // The `/automation/_status` probe, the action catalog and the run history
  // read all go through the global `fetch`; one double answers "absent".
  vi.stubGlobal('fetch', fetchSpy);
  server.active.set(`flow/${FLOW.name}`, JSON.parse(JSON.stringify(FLOW)));
  server.active.set(`page/${HOME.name}`, JSON.parse(JSON.stringify(HOME)));
  server.active.set(`app/${APP.name}`, JSON.parse(JSON.stringify(APP)));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function editText(el: HTMLElement, value: string): void {
  fireEvent.change(el, { target: { value } });
  fireEvent.blur(el);
}

async function renderOpenFlow(): Promise<void> {
  render(
    <MemoryRouter initialEntries={[`/studio/${PKG}/automations`]}>
      <AutomationsPillar packageId={PKG} />
    </MemoryRouter>,
  );
  await screen.findByTestId('auto-tab-canvas', undefined, { timeout: 8000 });
  await waitFor(() => expect(screen.getByText('Status:').nextElementSibling).toHaveTextContent(en('engine.studio.auto.enabled')), { timeout: 8000 });
}

async function selectStart(): Promise<HTMLElement> {
  fireEvent.click(document.querySelector('[data-node-id="start"] [role="button"]') as HTMLElement);
  return within(screen.getByTestId('auto-config-aside')).findByLabelText('Label', undefined, { timeout: 8000 });
}

const flowToasts = () =>
  vi.mocked(toast.success).mock.calls.filter(([text]) => String(text).includes(FLOW.label) || String(text).includes(FLOW.name));

describe('a landed flow autosave says 已保存 in the header, not in a toast (#34818 item 8)', () => {
  it('shows the badge in the flow header title row, naming the flow, and raises no toast', async () => {
    await renderOpenFlow();
    editText(await selectStart(), 'Kick-off');
    const badge = await screen.findByTestId('auto-autosaved', undefined, { timeout: 8000 });
    expect(server.saves.filter((s) => s.type === 'flow')).toHaveLength(1);

    // Beside the flow's title: the header's own title row holds both.
    const titleRow = screen.getByTestId('auto-flow-header').firstElementChild as HTMLElement;
    expect(titleRow.contains(badge)).toBe(true);
    expect(within(titleRow).getByRole('heading', { level: 1 })).toHaveTextContent(FLOW.label);
    // Seen: "Saved". Heard: the sentence that names the flow.
    expect(badge).toHaveAttribute('role', 'status');
    expect(badge).toHaveTextContent(en('engine.studio.autoSaved'));
    expect(within(badge).getByText(tFormat('engine.studio.flowSavedNamed', 'en', { item: FLOW.label }))).toHaveClass('sr-only');

    expect(flowToasts(), 'no "Draft saved" toast for a flow').toEqual([]);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('a second edit clears the badge until that edit lands', async () => {
    await renderOpenFlow();
    const label = await selectStart();
    editText(label, 'Kick-off');
    await screen.findByTestId('auto-autosaved', undefined, { timeout: 8000 });
    editText(label, 'Kick-off two');
    expect(screen.queryByTestId('auto-autosaved')).toBeNull();
    await screen.findByTestId('auto-autosaved', undefined, { timeout: 8000 });
    expect(server.saves.filter((s) => s.type === 'flow')).toHaveLength(2);
  });

  it('a refused save keeps its strip, raises one error toast and shows no badge', async () => {
    server.refuse = 'Flow "notify_owner" is invalid: label too long.';
    await renderOpenFlow();
    editText(await selectStart(), 'Kick-off');
    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1), { timeout: 8000 });
    expect(vi.mocked(toast.error).mock.calls[0][0]).toBe(tFormat('engine.studio.flowSaveFailed', 'en', { item: FLOW.label }));
    expect(await screen.findByText(/label too long/, undefined, { timeout: 8000 })).toBeInTheDocument();
    expect(screen.queryByTestId('auto-autosaved')).toBeNull();
    expect(flowToasts()).toEqual([]);
  });

  it('the control: an Interfaces page (a leaf) autosave still toasts by its label', async () => {
    render(
      <MemoryRouter initialEntries={[`/studio/${PKG}/interfaces`]}>
        <InterfacesPillar packageId={PKG} />
      </MemoryRouter>,
    );
    await screen.findByRole('button', { name: 'Select hello' }, { timeout: 8000 });
    const label = await within(screen.getByRole('complementary')).findByLabelText(/^Label/, undefined, { timeout: 8000 });
    editText(label, 'Welcome');
    await waitFor(() => expect(toast.success).toHaveBeenCalled(), { timeout: 8000 });
    expect(vi.mocked(toast.success).mock.calls[0][0]).toBe(tFormat('engine.studio.draftSaved', 'en', { item: 'Home menu' }));
  });
});

describe('the Debug section takes the Configuration aside’s place (#34818 item 6)', () => {
  it('hides the aside in Debug and brings it back, selection kept, on leaving', async () => {
    await renderOpenFlow();
    await selectStart();
    fireEvent.click(screen.getByTestId('auto-tab-debug'));
    await waitFor(() => expect(screen.getByTestId('flow-preview-section')).toHaveAttribute('data-section', 'debug'));
    expect(screen.queryByTestId('auto-config-aside')).toBeNull();
    expect(screen.getByTestId('flow-preview-section').className).toContain('lg:grid-cols-[1fr_300px]');

    fireEvent.click(screen.getByTestId('auto-tab-canvas'));
    const aside = await screen.findByTestId('auto-config-aside');
    expect(within(aside).getByLabelText('Label')).toHaveValue('Start');
  });

  it('the control: the Canvas section keeps the aside', async () => {
    await renderOpenFlow();
    expect(screen.getByTestId('flow-preview-section')).toHaveAttribute('data-section', 'canvas');
    expect(screen.getByTestId('auto-config-aside')).toBeInTheDocument();
  });
});

describe('the Runs section says why it is empty (#34818 item 9)', () => {
  const runFetches = () => fetchSpy.mock.calls.filter(([input]) => String(input).includes('/runs'));

  it('a flow the package does not serve yet reads "publish and turn on", with no run fetch', async () => {
    server.published = new Set();
    await renderOpenFlow();
    await waitFor(() => expect(mockClient.listResponse).toHaveBeenCalled());
    fireEvent.click(screen.getByTestId('auto-tab-runs'));
    expect(await screen.findByTestId('flow-runs-unpublished', undefined, { timeout: 8000 })).toHaveTextContent(
      en('engine.flowRuns.unpublished'),
    );
    expect(runFetches()).toEqual([]);
  });

  it('a served flow whose engine does not answer reads the engine-offline sentence alone', async () => {
    await renderOpenFlow();
    await waitFor(() => expect(mockClient.listResponse).toHaveBeenCalled());
    fireEvent.click(screen.getByTestId('auto-tab-runs'));
    expect(await screen.findByTestId('flow-runs-unavailable', undefined, { timeout: 8000 })).toHaveTextContent(
      en('engine.flowRuns.engineOffline'),
    );
    expect(screen.queryByTestId('flow-runs-unpublished')).toBeNull();
    expect(runFetches().length).toBeGreaterThan(0);
  });
});

