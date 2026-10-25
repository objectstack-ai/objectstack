// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12612 — the Automations rail's groups follow the package app's
 * navigation, read by the shell with the package's app (the row the header's
 * app chip already reads), so the pillar adds no read of its own.
 *
 * The whole surface at `/studio/PKG/automations`: the client serves one app
 * whose navigation lists Leads then Accounts, three flows on Account, Lead and
 * Contract, and the three objects. The groups read Lead, Account, Contract —
 * not the labels' alphabet. The control is the same package with an app that
 * lists no objects: every group is then unlisted, one flow each, by label.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const PACKAGE_ID = 'app.r41l';

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn(), dismiss: vi.fn() },
  Toaster: () => null,
}));

const onObject = (name: string, objectName: string) => ({
  name,
  label: name,
  type: 'autolaunched',
  status: 'active',
  nodes: [{ id: 'start', type: 'start', config: { triggerType: 'record-after-create', objectName } }],
  edges: [],
});

const served = vi.hoisted(() => ({ navigation: [] as unknown[] }));

/**
 * The three flows, as both the list and the per-flow read serve them. The
 * pillar opens the first flow and reads its definition through `layered`;
 * that read must serve the same flow (its start node names its object), or
 * the open flow regroups under "No object" once it lands, and the rail's
 * order depends on whether the assertion polls before or after that read
 * (objectui#12611 measured it settling to "none" on main as well).
 */
const FLOWS = [
  onObject('account_flow', 'crm_account'),
  onObject('contract_flow', 'crm_contract'),
  onObject('lead_flow', 'crm_lead'),
];

const mockClient = {
  list: vi.fn(async (type: string) => {
    if (type === 'app') return [{ name: 'sales', label: 'Sales', navigation: served.navigation }];
    if (type === 'object') {
      return [
        { name: 'crm_account', label: 'Account' },
        { name: 'crm_contract', label: 'Contract' },
        { name: 'crm_lead', label: 'Lead' },
      ];
    }
    if (type === 'flow') return FLOWS;
    return [];
  }),
  listDrafts: vi.fn(async () => []),
  layered: vi.fn(async (type: string, name: string) => ({
    effective: (type === 'flow' && FLOWS.find((f) => f.name === name)) || { name },
  })),
  getDraft: vi.fn(async () => null),
  get: vi.fn(async () => undefined),
  save: vi.fn(async () => ({})),
};

vi.mock('../metadata-admin/useMetadata', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useMetadataClient: () => mockClient,
    useMetadataTypes: () => ({ loading: false, error: null, entries: [] }),
  };
});

vi.mock('@object-ui/react', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useAdapter: () => ({}) };
});

vi.mock('../../components/SuggestedBindingsPanel', () => ({ SuggestedBindingsPanel: () => null }));
vi.mock('../metadata-admin/AccessExplainPanel', () => ({ AccessExplainPanel: () => null }));
vi.mock('./StudioAiCopilot', () => ({ StudioChatDock: () => null }));
vi.mock('../../preview/DraftChangesPanel', () => ({ DraftChangesPanel: () => null }));

import { StudioDesignSurface } from './StudioDesignSurface';

const answer = (body: unknown) => ({ ok: true, status: 200, json: async () => body });

beforeEach(() => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }));
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) =>
      String(input) === '/api/v1/packages'
        ? answer({ success: true, data: { packages: [{ manifest: { id: PACKAGE_ID, name: 'Sales' }, writable: true }] } })
        : answer([]),
    ),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderRail(): void {
  render(
    <MemoryRouter initialEntries={[`/studio/${PACKAGE_ID}/automations`]}>
      <Routes>
        <Route path="/studio/:packageId/:tab" element={<StudioDesignSurface />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** The rail's group keys, top to bottom. */
const railGroupOrder = (): string[] =>
  [...document.querySelectorAll('[data-testid^="auto-rail-group-"]')].map((el) =>
    (el.getAttribute('data-testid') ?? '').replace('auto-rail-group-', ''),
  );

/** Waits for the rail to read `expected`; the app read and the flow read land in either order. */
async function expectRailOrder(expected: string[]): Promise<void> {
  renderRail();
  await screen.findByTestId('auto-rail-group-crm_contract', undefined, { timeout: 8000 });
  await waitFor(() => expect(railGroupOrder()).toEqual(expected), { timeout: 4000 });
}

describe("the Automations rail follows the package app's navigation (objectui#12612)", () => {
  it('a navigation listing Leads, then Accounts: the groups read Lead, Account, then the unlisted Contract', async () => {
    served.navigation = [
      { id: 'nav_home', type: 'page', pageName: 'home' },
      {
        id: 'group_sales',
        type: 'group',
        children: [
          { id: 'nav_lead', type: 'object', objectName: 'crm_lead' },
          { id: 'nav_account', type: 'object', objectName: 'crm_account' },
        ],
      },
    ];
    await expectRailOrder(['crm_lead', 'crm_account', 'crm_contract']);
  });

  it('CONTROL — an app whose navigation lists no object: one flow each, by label', async () => {
    served.navigation = [{ id: 'nav_home', type: 'page', pageName: 'home' }];
    await expectRailOrder(['crm_account', 'crm_contract', 'crm_lead']);
  });
});
