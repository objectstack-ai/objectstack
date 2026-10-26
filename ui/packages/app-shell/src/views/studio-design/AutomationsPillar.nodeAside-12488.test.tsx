// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12488 — the Automations pillar's node configuration aside.
 *
 * With a node selected the aside carries ONE header: its eyebrow names the
 * node's kind ("Node · Decision"), its title the node's label, and its close
 * clears the selection. The metadata inspector below draws no header of its own
 * (no second "Node" chip, no second close). A decision that routes on its
 * out-edge conditions — HotCRM's shape, empty `config.conditions` — shows each
 * out-edge as a branch card with its target and its condition, where the
 * Branches list used to read "No items yet.", and a card's "Edit connection"
 * opens that connection's inspector in the same aside.
 *
 * The REAL `AutomationsPillar` with the REAL registered `FlowPreview` and
 * `FlowInspector`, on the harness of `AutomationsPillar.tabs-12454.test.tsx`.
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
import { browserClick } from '../metadata-admin/previews/__tests__/browserClick';

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


const aside = () => screen.getByTestId('auto-config-aside');

async function selectDecision(): Promise<HTMLElement> {
  await renderOpenFlow();
  const card = document.querySelector('[data-node-id="check_hot"] [role="button"]') as HTMLElement | null;
  expect(card, 'the decision card is on the canvas').not.toBeNull();
  browserClick(card!);
  await within(aside()).findAllByTestId('flow-branch-card', undefined, { timeout: 8000 });
  return aside();
}

describe('the node configuration aside has one header (objectui#12488)', () => {
  it('names the node in the aside header and draws no inspector header under it', async () => {
    const el = await selectDecision();
    expect(within(el).getByText(`${en('engine.inspector.flowNode.kind')} · Decision`)).toBeInTheDocument();
    expect(within(el).getByText('Hot lead?', { selector: 'header *' })).toBeInTheDocument();
    // One close: the aside's. The inspector's own "Close node" is not drawn.
    expect(within(el).queryByRole('button', { name: en('engine.inspector.flowNode.close') })).toBeNull();
    expect(within(el).getAllByRole('button', { name: en('engine.studio.deselect') })).toHaveLength(1);
    expect(within(el).getByTestId('inspector-shell-hosted')).toBeInTheDocument();
    // The eyebrow names the node, not the empty aside's "Configuration".
    expect(within(el.querySelector('header')!).queryByText(en('engine.studio.auto.config'))).toBeNull();
  });

  it('keeps the "Configuration" eyebrow while nothing is selected', async () => {
    await renderOpenFlow();
    expect(within(aside()).getByText(en('engine.studio.auto.config'))).toBeInTheDocument();
  });
});

describe('a decision routed on its out-edges shows them as branch cards (objectui#12488)', () => {
  it('lists each out-edge with its target and condition, read-only, instead of "No items yet."', async () => {
    const el = await selectDecision();
    const cards = within(el).getAllByTestId('flow-branch-card');
    expect(cards.map((c) => c.getAttribute('data-edge-key'))).toEqual(['e2', 'e3']);
    expect(within(cards[0]).getByText('Hot')).toBeInTheDocument();
    expect(within(cards[1]).getByText('Standard')).toBeInTheDocument();
    const conditions = cards.map((c) => within(c).getByRole('textbox') as HTMLTextAreaElement);
    expect(conditions.map((c) => c.value)).toEqual(['record.rating >= 4', 'record.rating < 4']);
    expect(conditions.every((c) => c.readOnly)).toBe(true);
    expect(within(el).queryByText(en('engine.inspector.flowNode.list.empty'))).toBeNull();
  });

  it('"Edit connection" opens that connection in the same aside', async () => {
    const el = await selectDecision();
    const [first] = within(el).getAllByTestId('flow-branch-card');
    fireEvent.click(within(first).getByRole('button', { name: en('engine.inspector.flowNode.branch.openEdge') }));
    const header = () => aside().querySelector('header')!;
    await waitFor(() => expect(within(header()).getByText(en('engine.inspector.flowEdge.kind'))).toBeInTheDocument());
    // Each end by its node's name (objectui#13143).
    expect(within(header()).getByText('Hot lead? → Hot')).toBeInTheDocument();
  });
});
