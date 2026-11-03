// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#29706 — the Automations rail labelled a draft object's flow
 * group with the object's machine name, which the header's `uppercase` style
 * turned into REPAIRS_REPAIR_TICKET on a zh screen.
 *
 * The rail's object index (`readObjectLabels`) read the PUBLISHED objects
 * only. An object the builder has not published yet is a draft, so the flow
 * started on it was grouped under a name with no label. The index now merges
 * the package's object drafts, each with the label its `_drafts` row carries,
 * as the Data rail lists them.
 *
 * The whole surface at `/studio/PKG/automations`, with the harness of
 * StudioDesignSurface.automationsRailOrder-12612.test.tsx: one published
 * object (Account) and one draft-only object (维修工单), one flow on each.
 * The control is a published object, whose group already read its label.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
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


const onObject = (name: string, objectName: string) => ({
  name,
  label: name,
  type: 'autolaunched',
  status: 'active',
  nodes: [{ id: 'start', type: 'start', config: { triggerType: 'record-after-create', objectName } }],
  edges: [],
});

const FLOWS = [onObject('account_flow', 'crm_account'), onObject('ticket_flow', 'repairs_repair_ticket')];

const mockClient = {
  list: vi.fn(async (type: string) => {
    if (type === 'app') return [{ name: 'sales', label: 'Sales', navigation: [] }];
    if (type === 'object') return [{ name: 'crm_account', label: 'Account' }];
    if (type === 'flow') return FLOWS;
    return [];
  }),
  // The object the builder has not published: a `_drafts` header with its label.
  listDrafts: vi.fn(async (query?: { type?: string }) =>
    query?.type === 'object' ? [{ name: 'repairs_repair_ticket', label: '维修工单' }] : [],
  ),
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

/** One group of the rail: its header and its flow rows. */
const groupHeader = (key: string): Promise<HTMLElement> =>
  screen.findByTestId(`auto-rail-group-${key}`, undefined, { timeout: 8000 });

describe("a draft object's flow group reads the object's label (objectstack#29706)", () => {
  it('a flow on an object not published yet is grouped under its draft label, not its machine name', async () => {
    renderRail();
    const group = await groupHeader('repairs_repair_ticket');
    await waitFor(() => expect(group).toHaveTextContent('维修工单'));
    expect(within(group).queryByText(/repairs_repair_ticket/i)).toBeNull();
  });

  it('CONTROL — a published object’s group reads its published label', async () => {
    renderRail();
    const group = await groupHeader('crm_account');
    await waitFor(() => expect(group).toHaveTextContent('Account'));
    expect(within(group).queryByText(/crm_account/i)).toBeNull();
  });
});
