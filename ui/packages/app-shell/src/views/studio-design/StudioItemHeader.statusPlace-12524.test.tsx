// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12524 — the draft status chip sits in the same place in every
 * pillar's item header.
 *
 * Measured in the 2026-10-15 Studio test pass (a writable package): Data and
 * Automations showed "Unpublished draft" beside the title, Access its "saved
 * as draft" note beside the title, and Interfaces "Unpublished draft" at the
 * far right, among the Design / Run actions. Four headers, two positions.
 *
 * `StudioItemHeader` now takes the status as data (`status`) and draws the
 * chip itself, after the identity (title, api-name or kind chips) and before
 * the meta; the right slot holds actions only. The identity chips sit in
 * one `contents` wrapper, so the chip is the same child of the same row
 * whatever identity chips a pillar shows.
 *
 * The REAL four pillars against one server double that serves a pending draft
 * for the open object, the open flow and the open page. Access has no
 * item-level draft: its writable "saved as draft" note is the pillar's status.
 *
 * Pinned:
 *  - with a draft, the chip in all four headers is a child of the header's
 *    title row at the same index, after the identity and outside the actions;
 *  - the Interfaces actions keep their order with the chip gone from them;
 *  - CONTROL: no draft (and, for Access, a read-only package), no chip, and
 *    Access's read-only link stays in the actions slot.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const PKG = 'com.acme.app';

const OBJECT = { name: 'acme_account', label: 'Account', fields: { title: { name: 'title', type: 'text' } } };
const FLOW = {
  name: 'route_lead',
  label: 'Route lead',
  type: 'autolaunched',
  status: 'active',
  nodes: [
    { id: 'start', type: 'start', label: 'Start', config: { triggerType: 'record-after-create', objectName: 'acme_account' } },
    { id: 'end', type: 'end', label: 'End' },
  ],
  edges: [{ id: 'e1', source: 'start', target: 'end' }],
};
const APP = { name: 'acme_app', label: 'Acme', navigation: [{ id: 'nav_home', type: 'page', label: 'Home', pageName: 'home' }] };
const PAGE = {
  name: 'home',
  label: 'Home',
  type: 'app',
  regions: [{ name: 'main', components: [{ id: 'hello', type: 'element:text', properties: { content: 'Hello' } }] }],
};

const server = vi.hoisted(() => ({
  active: new Map<string, Record<string, unknown>>(),
  /** Whether the open object, flow and page each have a pending draft. */
  drafts: true,
}));

const mockClient = vi.hoisted(() => {
  const k = (type: string, name: string) => `${type}/${name}`;
  const client = {
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
      const body = server.drafts && type !== 'app' ? server.active.get(k(type, name)) : undefined;
      if (body) return { item: JSON.parse(JSON.stringify(body)) };
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

// The Access pillar's siblings that play no part in its header.
vi.mock('../../components/SuggestedBindingsPanel', () => ({ SuggestedBindingsPanel: () => null }));
vi.mock('../metadata-admin/AccessExplainPanel', () => ({ AccessExplainPanel: () => null }));

import { AccessPillar, AutomationsPillar, DataPillar, InterfacesPillar } from './StudioDesignSurface';
import '../../services/builtinComponents.js';
import { t } from '../metadata-admin/i18n';
import { createEmptyDataSource, failOnAbsorbedFetchError } from './__tests__/emptyDataSource';
import { registerMetadataPreview } from '../metadata-admin/preview-registry';
import { registerMetadataInspector } from '../metadata-admin/inspector-registry';
import { registerMetadataDefaultInspector } from '../metadata-admin/default-inspector-registry';
import { PagePreview } from '../metadata-admin/previews/PagePreview';
import { PageBlockInspector } from '../metadata-admin/inspectors/PageBlockInspector';
import { PageDefaultInspector } from '../metadata-admin/inspectors/PageDefaultInspector';
import { FlowPreview } from '../metadata-admin/previews/FlowPreview';
import { FlowInspector } from '../metadata-admin/inspectors/FlowInspector';

const dataSource = createEmptyDataSource();
failOnAbsorbedFetchError();

registerMetadataPreview('page', PagePreview);
registerMetadataInspector('page', PageBlockInspector);
registerMetadataDefaultInspector('page', PageDefaultInspector);
registerMetadataPreview('flow', FlowPreview);
registerMetadataInspector('flow', FlowInspector);

const en = (key: string) => t(key, 'en');

beforeEach(() => {
  server.active.clear();
  server.drafts = true;
  for (const [type, body] of [
    ['object', OBJECT],
    ['flow', FLOW],
    ['app', APP],
    ['page', PAGE],
  ] as const) {
    server.active.set(`${type}/${body.name}`, JSON.parse(JSON.stringify(body)));
  }
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

type PillarCase = {
  pillar: string;
  testId: string;
  element: (readOnly: boolean) => React.ReactElement;
  /** Resolves once the open item's draft read has settled. */
  settled: (header: HTMLElement) => Promise<void>;
};

const CASES: PillarCase[] = [
  {
    pillar: 'Data',
    testId: 'data-object-header',
    element: (readOnly) => <DataPillar packageId={PKG} readOnly={readOnly} />,
    settled: async (header) => {
      await within(header).findByText(OBJECT.name, undefined, { timeout: 8000 });
    },
  },
  {
    pillar: 'Automations',
    testId: 'auto-flow-header',
    element: (readOnly) => <AutomationsPillar packageId={PKG} readOnly={readOnly} />,
    settled: async () => {
      await screen.findByTestId('auto-flow-meta', undefined, { timeout: 8000 });
    },
  },
  {
    pillar: 'Interfaces',
    testId: 'if-item-header',
    element: (readOnly) => <InterfacesPillar packageId={PKG} readOnly={readOnly} />,
    settled: async () => {
      await screen.findByRole('button', { name: 'Select hello' }, { timeout: 8000 });
    },
  },
  {
    pillar: 'Access',
    testId: 'access-item-header',
    element: (readOnly) => <AccessPillar packageId={PKG} readOnly={readOnly} />,
    settled: async (header) => {
      await within(header).findByRole('button', { name: en('engine.studio.access.explain.open') }, { timeout: 8000 });
    },
  },
];

async function openHeader(c: PillarCase, readOnly = false): Promise<HTMLElement> {
  render(<MemoryRouter initialEntries={[`/studio/${PKG}`]}>{c.element(readOnly)}</MemoryRouter>);
  const header = await screen.findByTestId(c.testId, undefined, { timeout: 8000 });
  await c.settled(header);
  return header;
}

/** The header's title row: the row that holds the item's title. */
function titleRow(header: HTMLElement): HTMLElement {
  const row = header.querySelector('h1')?.parentElement;
  expect(row, 'the header has no title row: the harness is dead').toBeTruthy();
  return row as HTMLElement;
}

/** Where the status chip sits: its row and its index among the row's children. */
async function statusPlace(header: HTMLElement): Promise<{ index: number; chip: HTMLElement; row: HTMLElement }> {
  const chip = await within(header).findByTestId('studio-item-status', undefined, { timeout: 8000 });
  const row = titleRow(header);
  return { index: Array.from(row.children).indexOf(chip), chip, row };
}

describe('the status chip sits in the same place in every pillar’s item header (objectui#12524)', () => {
  it('with a draft, all four headers draw it as the same child of the title row: after the identity, before meta and actions', async () => {
    const places: Array<{ pillar: string; index: number; text: string }> = [];
    for (const c of CASES) {
      const header = await openHeader(c);
      const { index, chip, row } = await statusPlace(header);
      // A child of the title row, never of the actions slot.
      expect(chip.parentElement, c.pillar).toBe(row);
      // Right after the identity: the title, then the wrapper of its chips.
      expect(row.children[index - 2]?.tagName, `${c.pillar}: the chip does not follow the title`).toBe('H1');
      expect(row.children[index - 1], `${c.pillar}: the chip does not follow the identity chips`).toHaveAttribute(
        'data-slot',
        'identity-chips',
      );
      // Nothing after it is identity: the meta and the actions follow.
      for (const later of Array.from(row.children).slice(index + 1)) {
        expect(later.tagName, c.pillar).not.toBe('H1');
        expect(later.getAttribute('data-slot'), c.pillar).not.toBe('identity-chips');
      }
      places.push({ pillar: c.pillar, index, text: chip.textContent ?? '' });
      cleanup();
    }

    expect(places.map((p) => p.pillar)).toEqual(['Data', 'Automations', 'Interfaces', 'Access']);
    // The same index in all four.
    expect(new Set(places.map((p) => p.index)).size, JSON.stringify(places)).toBe(1);
    // The three item drafts say so; Access says its edits save as drafts.
    expect(places.map((p) => p.text)).toEqual([
      en('engine.studio.unpublishedDraft'),
      en('engine.studio.unpublishedDraft'),
      en('engine.studio.unpublishedDraft'),
      en('engine.studio.access.banner'),
    ]);
  });

  it('the Interfaces actions keep their order, and the chip is no longer one of them', async () => {
    const header = await openHeader(CASES[2]);
    const { row } = await statusPlace(header);
    const actions = row.lastElementChild as HTMLElement;
    expect(within(actions).queryByTestId('studio-item-status')).toBeNull();
    expect(within(actions).queryByText(en('engine.studio.unpublishedDraft'))).toBeNull();
    const order = Array.from(actions.querySelectorAll('[data-testid]'))
      .map((el) => el.getAttribute('data-testid'))
      .filter((id) => id === 'canvas-mode-toggle' || id === 'if-properties-toggle');
    expect(order).toEqual(['canvas-mode-toggle', 'if-properties-toggle']);
  });

  it('CONTROL: with no draft, Data, Automations and Interfaces draw no status chip', async () => {
    server.drafts = false;
    for (const c of CASES.slice(0, 3)) {
      const header = await openHeader(c);
      // The draft read has settled (the header's identity is in), and nothing says draft.
      await waitFor(() => expect(mockClient.getDraft).toHaveBeenCalled());
      expect(within(header).queryByTestId('studio-item-status'), c.pillar).toBeNull();
      expect(within(header).queryByText(en('engine.studio.unpublishedDraft')), c.pillar).toBeNull();
      cleanup();
    }
  });

  it('CONTROL: a read-only package draws no Access status; its read-only link stays in the actions slot', async () => {
    const header = await openHeader(CASES[3], true);
    expect(within(header).queryByTestId('studio-item-status')).toBeNull();
    const link = within(header).getByTestId('studio-readonly-link');
    const row = titleRow(header);
    expect(link.parentElement).toBe(row.lastElementChild);
    expect(link.parentElement).toHaveClass('ml-auto');
  });
});
