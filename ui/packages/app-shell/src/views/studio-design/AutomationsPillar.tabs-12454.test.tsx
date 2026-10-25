// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12454 — the Automations pillar's rail groups by object and its item
 * header carries a tab row over the open flow.
 *
 * Acceptance 3 of the card: the Problems count shows as a pill on the Problems
 * tab, and the designer's four info-bar buttons (Variables, Runs, Problems,
 * Debug) have no duplicate anywhere on the page. Beside it: the tabs open their
 * sections as the body, a problem picked there opens the canvas on its element,
 * and the rail row sits under its object's group with its trigger glyph.
 *
 * The REAL `AutomationsPillar` with the REAL registered `FlowPreview` and
 * `FlowInspector`; the client is a server double that serves full flow rows,
 * as the metadata list does. The flow is a record trigger on `crm_lead` whose
 * decision has two conditioned out-edges and no default, which the preview's
 * problem list reports — the count under test is whatever that list holds.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const PKG = 'com.acme.app';

const FLOW = {
  name: 'route_new_lead',
  label: 'Route new lead',
  type: 'autolaunched',
  status: 'active',
  nodes: [
    { id: 'start', type: 'start', label: 'Start', config: { triggerType: 'record-after-create', objectName: 'crm_lead' } },
    { id: 'check_hot', type: 'decision', label: 'Hot lead?' },
    { id: 'end_hot', type: 'end', label: 'Hot' },
    { id: 'end_std', type: 'end', label: 'Standard' },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'check_hot' },
    { id: 'e2', source: 'check_hot', target: 'end_hot', condition: { dialect: 'cel', source: 'record.rating >= 4' } },
    { id: 'e3', source: 'check_hot', target: 'end_std', condition: { dialect: 'cel', source: 'record.rating < 4' } },
  ],
};

const server = vi.hoisted(() => ({
  active: new Map<string, Record<string, unknown>>(),
}));

const mockClient = vi.hoisted(() => {
  const k = (type: string, name: string) => `${type}/${name}`;
  const client = {
    // The draft-overlaid reads (the rail's definitions, an inspector's object
    // fields) answer as the published ones: this server holds no drafts.
    withPreviewDrafts: vi.fn((): unknown => client),
    list: vi.fn(async (type: string) =>
      [...server.active.entries()].filter(([key]) => key.startsWith(`${type}/`)).map(([, row]) => row),
    ),
    listDrafts: vi.fn(async () => []),
    listTypes: vi.fn(async () => ({ entries: [] })),
    get: vi.fn(async () => null),
    references: vi.fn(async () => []),
    layered: vi.fn(async (type: string, name: string) => {
      const eff = server.active.get(k(type, name)) ?? null;
      return { code: null, overlay: eff, overlayScope: eff ? 'env' : null, effective: eff, editable: true, deletable: true, resettable: false, lock: 'none' };
    }),
    getDraft: vi.fn(async (type: string, name: string) => {
      throw Object.assign(new Error(`No pending draft exists for ${type}/${name}.`), { code: 'NO_DRAFT', status: 404 });
    }),
    save: vi.fn(async (type: string, name: string, item: unknown) => ({ type, name, item })),
    publish: vi.fn(async () => ({ success: true })),
    reset: vi.fn(async () => ({})),
  };
  return client;
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

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { AutomationsPillar } from './StudioDesignSurface';
import { createEmptyDataSource, failOnAbsorbedFetchError } from './__tests__/emptyDataSource';
import { registerMetadataPreview } from '../metadata-admin/preview-registry';
import { registerMetadataInspector } from '../metadata-admin/inspector-registry';
import { FlowPreview } from '../metadata-admin/previews/FlowPreview';
import { FlowInspector } from '../metadata-admin/inspectors/FlowInspector';
import { t } from '../metadata-admin/i18n';

const dataSource = createEmptyDataSource();
failOnAbsorbedFetchError();

registerMetadataPreview('flow', FlowPreview);
registerMetadataInspector('flow', FlowInspector);

const en = (key: string) => t(key, 'en');

beforeEach(() => {
  server.active.clear();
  server.active.set(`flow/${FLOW.name}`, FLOW);
  server.active.set('object/crm_lead', { name: 'crm_lead', label: 'Lead' });
  for (const fn of Object.values(mockClient)) (fn as unknown as { mockClear: () => void }).mockClear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('null', { status: 404, headers: { 'content-type': 'application/json' } })),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function renderOpenFlow(): Promise<void> {
  render(
    <MemoryRouter initialEntries={[`/studio/${PKG}/automations`]}>
      <AutomationsPillar packageId={PKG} />
    </MemoryRouter>,
  );
  await screen.findByTestId('auto-tab-canvas', undefined, { timeout: 8000 });
}

/** The section the preview body shows. */
const sectionShown = () => screen.getByTestId('flow-preview-section').getAttribute('data-section');

describe('the Automations rail groups by object (objectui#12454)', () => {
  it('the flow sits under its object’s group, with its count, its trigger glyph and a legend', async () => {
    await renderOpenFlow();
    const group = await screen.findByTestId('auto-rail-group-crm_lead', undefined, { timeout: 8000 });
    expect(within(group).getByRole('button', { name: /Lead\s*1/ })).toHaveAttribute('aria-expanded', 'true');
    const row = within(group).getByTestId(`auto-rail-row-${FLOW.name}`);
    expect(row).toHaveAttribute('data-trigger', 'record');
    expect(row.getAttribute('title')).toBe(`Route new lead · ${en('engine.studio.auto.kind.record')}`);
    expect(screen.getByTestId('auto-rail-legend')).toHaveTextContent(en('engine.studio.auto.kind.scheduled'));

    // Folding the group hides its row; the count stays on the header.
    fireEvent.click(within(group).getByRole('button', { name: /Lead\s*1/ }));
    expect(within(group).queryByTestId(`auto-rail-row-${FLOW.name}`)).toBeNull();
  });
});

describe('the item header’s tab row over the open flow (objectui#12454)', () => {
  it('offers the five tabs, Canvas open, and the Problems tab carries the problem count as a pill', async () => {
    await renderOpenFlow();
    for (const key of ['canvas', 'variables', 'runs', 'problems', 'debug']) {
      expect(screen.getByTestId(`auto-tab-${key}`)).toBeInTheDocument();
    }
    expect(screen.getByTestId('auto-tab-canvas')).toHaveAttribute('aria-pressed', 'true');
    expect(sectionShown()).toBe('canvas');

    const pill = await within(screen.getByTestId('auto-tab-problems')).findByTestId('auto-problems-count', undefined, {
      timeout: 8000,
    });
    fireEvent.click(screen.getByTestId('auto-tab-problems'));
    expect(sectionShown()).toBe('problems');
    // The pill counts what the Problems body lists.
    const rows = within(screen.getByTestId('flow-preview-section')).getAllByRole('listitem');
    expect(rows.length).toBeGreaterThan(0);
    expect(pill).toHaveTextContent(String(rows.length));
  });

  it('the four former info-bar buttons have no duplicate: the preview draws no bar of its own', async () => {
    await renderOpenFlow();
    // The bar's Variables toggle and its Debug button are gone …
    expect(screen.queryByTitle(en('engine.flowPreview.showVars'))).toBeNull();
    expect(screen.queryAllByRole('button', { name: en('engine.flowPreview.debug') })).toHaveLength(1);
    // … and Runs and Problems each answer by their title once: the tab.
    expect(screen.getAllByTitle(en('engine.flowPreview.runsTitle'))).toEqual([screen.getByTestId('auto-tab-runs')]);
    expect(screen.getAllByTitle(en('engine.flowPreview.problemsTitle'))).toEqual([screen.getByTestId('auto-tab-problems')]);
    // The meta the bar carried is the header's now, once.
    expect(screen.getAllByText(`${en('engine.flowPreview.pill.trigger')}:`)).toHaveLength(1);
    // objectui#13056: the trigger object reads as its served label, not its name.
    await waitFor(() =>
      expect(within(screen.getByTestId('auto-flow-header')).getByTestId('auto-flow-meta')).toHaveTextContent('Record created · Lead'),
    );
  });

  it('a problem picked in the Problems body opens the canvas with its element selected', async () => {
    await renderOpenFlow();
    fireEvent.click(screen.getByTestId('auto-tab-problems'));
    const section = screen.getByTestId('flow-preview-section');
    const nodeProblem = within(section)
      .getAllByRole('button')
      .find((b) => !b.hasAttribute('disabled') && (b.textContent ?? '').includes('check_hot'));
    expect(nodeProblem, 'a problem on the decision node').toBeDefined();
    fireEvent.click(nodeProblem!);
    await waitFor(() => expect(sectionShown()).toBe('canvas'));
    expect(screen.getByTestId('auto-tab-canvas')).toHaveAttribute('aria-pressed', 'true');
    const card = document.querySelector('[data-node-id="check_hot"] [role="button"]');
    expect(card).toHaveAttribute('aria-pressed', 'true');
  });

  it('Variables opens the declared variables as the body, and Debug keeps the canvas beside the simulator', async () => {
    await renderOpenFlow();
    fireEvent.click(screen.getByTestId('auto-tab-variables'));
    expect(sectionShown()).toBe('variables');
    expect(within(screen.getByTestId('flow-preview-section')).getByText(en('engine.flowPreview.noVars'))).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('auto-tab-debug'));
    expect(sectionShown()).toBe('debug');
    expect(document.querySelector('[data-node-id="start"]')).not.toBeNull();
  });
});
