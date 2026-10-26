// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11795 — on an Automations row too narrow for the Configuration
 * aside to sit beside the flow canvas, the aside folds away and a selection
 * opens the same configuration in a drawer over the canvas. Wider rows keep
 * the aside exactly as before.
 *
 * Measured in Chromium before the fix: at a 390px window the fixed 288px
 * aside left the canvas ~34px; at 1024px with the Studio chat dock open
 * beside the pillar, ~40px. The aside reserved its width whether or not it
 * had anything to show.
 *
 * The canvas and the inspector are the REAL registered `FlowPreview` and
 * `FlowInspector`. happy-dom lays nothing out, so the row's width is read from
 * a value this file sets, and `ResizeObserver` is a double whose notifications
 * the tests deliver. A row that measures 0 is an unmeasured row — every other
 * Automations pin in this directory renders one — and keeps the aside.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, within, act, fireEvent } from '@testing-library/react';
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
}));

const mockClient = vi.hoisted(() => {
  const k = (type: string, name: string) => `${type}/${name}`;
  return {
    list: vi.fn(async (type: string) =>
      [...server.active.entries()]
        .filter(([key]) => key.startsWith(`${type}/`))
        .map(([, row]) => ({ name: row.name, label: row.label ?? row.name })),
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
import { AUTOMATIONS_CONFIG_FOLD_WIDTH } from './wideViewport';
import { createEmptyDataSource, failOnAbsorbedFetchError } from './__tests__/emptyDataSource';
import { registerMetadataPreview } from '../metadata-admin/preview-registry';
import { registerMetadataInspector } from '../metadata-admin/inspector-registry';
import { FlowPreview } from '../metadata-admin/previews/FlowPreview';
import { FlowInspector } from '../metadata-admin/inspectors/FlowInspector';
import { t } from '../metadata-admin/i18n';
import { browserClick } from '../metadata-admin/previews/__tests__/browserClick';

const dataSource = createEmptyDataSource();
failOnAbsorbedFetchError();

// The pillar's `/automation/_status` probe and the inspector's action-catalog
// read both answer "absent", so each keeps its documented fallback.
vi.stubGlobal(
  'fetch',
  vi.fn(async () => new Response('null', { status: 404, headers: { 'content-type': 'application/json' } })),
);

registerMetadataPreview('flow', FlowPreview);
registerMetadataInspector('flow', FlowInspector);

const CONFIG = t('engine.studio.auto.config', 'en');

/** The width the pillar's row measures; 0 = not laid out. */
let rowWidth = 0;
const observers = new Set<{ cb: ResizeObserverCallback; self: ResizeObserver }>();
class ResizeObserverDouble {
  private entry: { cb: ResizeObserverCallback; self: ResizeObserver };
  constructor(cb: ResizeObserverCallback) {
    this.entry = { cb, self: this as unknown as ResizeObserver };
  }
  observe() {
    observers.add(this.entry);
  }
  unobserve() {
    observers.delete(this.entry);
  }
  disconnect() {
    observers.delete(this.entry);
  }
}
function resizeRowTo(width: number) {
  rowWidth = width;
  act(() => {
    for (const o of [...observers]) o.cb([], o.self);
  });
}

let realResizeObserver: typeof ResizeObserver | undefined;
// Restored on its own: `failOnAbsorbedFetchError` reads its spy in an afterEach,
// so a blanket `vi.restoreAllMocks()` here would empty that record first.
let rectSpy: { mockRestore: () => void } | null = null;
beforeEach(() => {
  server.active.clear();
  for (const fn of Object.values(mockClient)) (fn as unknown as { mockClear: () => void }).mockClear();
  server.active.set(`flow/${FLOW.name}`, JSON.parse(JSON.stringify(FLOW)));
  rowWidth = 0;
  observers.clear();
  realResizeObserver = globalThis.ResizeObserver;
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverDouble;
  const original = Element.prototype.getBoundingClientRect;
  rectSpy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    if (this.getAttribute('data-testid') !== 'auto-layout-row') return original.call(this);
    return { x: 0, y: 0, top: 0, left: 0, right: rowWidth, bottom: 0, width: rowWidth, height: 0, toJSON: () => ({}) } as DOMRect;
  });
});

afterEach(() => {
  cleanup();
  rectSpy?.mockRestore();
  rectSpy = null;
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = realResizeObserver;
});

function renderPillarAt(width: number) {
  rowWidth = width;
  return render(
    <MemoryRouter initialEntries={[`/studio/${PKG}/automations`]}>
      <AutomationsPillar packageId={PKG} />
    </MemoryRouter>,
  );
}

async function openFlow(): Promise<void> {
  // Loaded once the header's Status pill reads the flow's `active` status (objectui#11779).
  await waitFor(() => expect(screen.getByText('Status:').nextElementSibling?.textContent).toBe(t('engine.studio.auto.enabled', 'en')), { timeout: 8000 });
}

function startNodeCard(): HTMLElement {
  const card = document.querySelector('[data-node-id="start"] [role="button"]') as HTMLElement | null;
  expect(card, 'the canvas must render the start node').not.toBeNull();
  return card!;
}

/** The asides the pillar's own row holds (the flow rail is a `nav`, not one). */
function rowAsides(): Element[] {
  return Array.from(screen.getByTestId('auto-layout-row').children).filter((el) => el.tagName === 'ASIDE');
}

describe('Automations pillar on a row too narrow for the Configuration aside (objectui#11795)', () => {
  it('reserves no aside beside the canvas, and a selection opens the configuration in a drawer', async () => {
    renderPillarAt(AUTOMATIONS_CONFIG_FOLD_WIDTH - 1);
    await openFlow();

    expect(rowAsides()).toEqual([]);
    expect(screen.queryByRole('complementary')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();

    browserClick(startNodeCard());

    const drawer = await screen.findByRole('dialog', { name: CONFIG }, { timeout: 8000 });
    expect(await within(drawer).findByLabelText('Label', undefined, { timeout: 8000 })).toBeEnabled();
    expect(startNodeCard()).toHaveAttribute('aria-pressed', 'true');
    // Still no aside: the drawer lies over the canvas, it takes no width from it.
    expect(rowAsides()).toEqual([]);
  });

  it('closing the drawer clears the selection, as the aside’s ✕ does', async () => {
    renderPillarAt(390);
    await openFlow();
    browserClick(startNodeCard());
    const drawer = await screen.findByRole('dialog', { name: CONFIG }, { timeout: 8000 });

    fireEvent.keyDown(drawer, { key: 'Escape' });

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(startNodeCard()).toHaveAttribute('aria-pressed', 'false');
  });

  it('a row that narrows past the threshold folds its aside in place', async () => {
    renderPillarAt(1200);
    await openFlow();
    expect(rowAsides()).toHaveLength(1);

    resizeRowTo(600);

    expect(rowAsides()).toEqual([]);
    browserClick(startNodeCard());
    expect(await screen.findByRole('dialog', { name: CONFIG }, { timeout: 8000 })).toBeInTheDocument();
  });
});

describe('Automations pillar on a row with room for the aside — unchanged (objectui#11795, the control)', () => {
  for (const [label, width] of [
    ['at the threshold', AUTOMATIONS_CONFIG_FOLD_WIDTH],
    ['unmeasured (0 wide)', 0],
  ] as const) {
    it(`${label}: the aside stays beside the canvas and a selection fills it, with no drawer`, async () => {
      renderPillarAt(width);
      await openFlow();

      expect(rowAsides()).toHaveLength(1);
      const aside = screen.getByRole('complementary');
      expect(within(aside).getByText(CONFIG)).toBeInTheDocument();

      browserClick(startNodeCard());

      expect(await within(aside).findByLabelText('Label', undefined, { timeout: 8000 })).toBeEnabled();
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  }
});
