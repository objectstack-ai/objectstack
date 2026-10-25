// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11546 — on a read-only package, a click on a flow canvas node in the
 * Automations pillar selects it and opens the flow inspector read-only.
 *
 * Measured in Chromium before the fix: the node's pointer-down returned early
 * on a read-only canvas, before stopping propagation, so the press reached the
 * canvas background. The background cleared the selection and took pointer
 * capture on the viewport, so the browser fired the click at the viewport and
 * the node's own select never ran. The inspector rail kept its empty state.
 *
 * objectui#11124's pins never saw it: they send `fireEvent.click` straight to
 * the node, with no press first, and happy-dom honours no pointer capture. The
 * click below is dispatched the way a browser dispatches it (`browserClick`),
 * so the press and the capture are part of what is measured.
 *
 * The canvas and the inspector are the REAL registered `FlowPreview` and
 * `FlowInspector`. The writable control is in the same file.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, within } from '@testing-library/react';
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
  saves: [] as Array<{ type: string; name: string }>,
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
    save: vi.fn(async (type: string, name: string, item: unknown) => {
      server.saves.push({ type, name });
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

// The pillar's `/automation/_status` probe and the inspector's action-catalog
// read both go through the global `fetch`; one module-scope double answers
// "absent" so each keeps its documented fallback.
vi.stubGlobal(
  'fetch',
  vi.fn(async () => new Response('null', { status: 404, headers: { 'content-type': 'application/json' } })),
);

registerMetadataPreview('flow', FlowPreview);
registerMetadataInspector('flow', FlowInspector);

beforeEach(() => {
  server.active.clear();
  server.saves.length = 0;
  for (const fn of Object.values(mockClient)) (fn as unknown as { mockClear: () => void }).mockClear();
  server.active.set(`flow/${FLOW.name}`, JSON.parse(JSON.stringify(FLOW)));
});

afterEach(cleanup);

function renderPillar(readOnly: boolean) {
  return render(
    <MemoryRouter initialEntries={[`/studio/${PKG}/automations`]}>
      <AutomationsPillar packageId={PKG} readOnly={readOnly} />
    </MemoryRouter>,
  );
}

async function openFlow(): Promise<void> {
  // The flow is loaded once the header's Status pill reads its `active` status,
  // in the switch's words with no runtime reading (objectui#11779).
  await waitFor(() => expect(screen.getByText('Status:').nextElementSibling?.textContent).toBe(t('engine.studio.auto.enabled', 'en')), { timeout: 8000 });
}

function startNodeCard(): HTMLElement {
  const card = document.querySelector('[data-node-id="start"] [role="button"]') as HTMLElement | null;
  expect(card, 'the canvas must render the start node').not.toBeNull();
  return card!;
}

/** The controls in the rail an author could type into or toggle, and that are not disabled. */
function enabledRailControls(rail: HTMLElement): HTMLElement[] {
  return Array.from(
    rail.querySelectorAll<HTMLElement>(
      'input, textarea, select, [contenteditable="true"], [role="combobox"], [role="switch"], [role="checkbox"]',
    ),
  ).filter((el) => !el.matches(':disabled') && el.getAttribute('aria-disabled') !== 'true');
}

describe('Automations pillar on a read-only package: a node click opens the inspector read-only (objectui#11546)', () => {
  it('selects the clicked node and opens its inspector, with every input disabled', async () => {
    renderPillar(true);
    await openFlow();

    browserClick(startNodeCard());

    const rail = screen.getByRole('complementary');
    const label = await within(rail).findByLabelText('Label', undefined, { timeout: 8000 });
    expect(startNodeCard()).toHaveAttribute('aria-pressed', 'true');
    expect(label).toBeDisabled();
    expect(within(rail).getByLabelText('ID')).toBeDisabled();
    expect(enabledRailControls(rail)).toEqual([]);
    expect(server.saves).toHaveLength(0);
  });
});

describe('Automations pillar on a writable package — the control (objectui#11546)', () => {
  it('the same click opens the inspector with editable inputs', async () => {
    renderPillar(false);
    await openFlow();

    browserClick(startNodeCard());

    const rail = screen.getByRole('complementary');
    const label = await within(rail).findByLabelText('Label', undefined, { timeout: 8000 });
    expect(startNodeCard()).toHaveAttribute('aria-pressed', 'true');
    expect(label).toBeEnabled();
    // The read-only case's "no enabled control" reading can fail: here it finds some.
    expect(enabledRailControls(rail).length).toBeGreaterThan(0);
  });
});
