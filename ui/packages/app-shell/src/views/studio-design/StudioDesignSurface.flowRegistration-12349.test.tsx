// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12349 — a flow the automation engine refused at boot no longer
 * reads as "unpublished" (the header) or as nothing (the rail).
 *
 * The platform serves the engine's verdict beside the flow list's items, as
 * `registrations` keyed by name (objectstack#23316, `FlowRegistrationSchema`).
 * Driven through the REAL `AutomationsPillar` with the REAL registered
 * `FlowPreview`, as the objectui#11779 pins are: the client double's
 * `listResponse` answers the list WITH the verdicts, its `list` the same items
 * without them, and the `_status` route serves runtime rows only for the flows
 * the engine runs — a refused flow has none.
 *
 * One flow per verdict, plus one with no verdict. The refusal message is
 * fixture text, ⛔ not an engine sentence.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const PKG = 'com.acme.app';

const MESSAGE = 'FIXTURE: what the engine threw for this flow at boot, shown as sent.';

const edges = [{ id: 'e1', source: 'start', target: 'end' }];
const end = { id: 'end', type: 'end', label: 'End' };
const recordStart = { id: 'start', type: 'start', label: 'Start', config: { triggerType: 'record-after-update', objectName: 'task' } };

/** Published flows, each stored `status: 'active'` — the author's declared state, which nothing rewrites. */
const FLOWS: Array<Record<string, unknown>> = [
  { name: 'refused_flow', label: 'Refused flow', type: 'autolaunched', status: 'active', nodes: [recordStart, end], edges },
  { name: 'unregistered_flow', label: 'Unregistered flow', type: 'autolaunched', status: 'active', nodes: [recordStart, end], edges },
  { name: 'registered_flow', label: 'Registered flow', type: 'autolaunched', status: 'active', nodes: [recordStart, end], edges },
  { name: 'unjudged_flow', label: 'Unjudged flow', type: 'autolaunched', status: 'active', nodes: [recordStart, end], edges },
];

/** The engine's verdicts, as the list serves them. `unjudged_flow` has none. */
const REGISTRATIONS = {
  refused_flow: { state: 'refused', reason: { message: MESSAGE } },
  unregistered_flow: { state: 'unregistered' },
  registered_flow: { state: 'registered' },
};

/** The engine's runtime rows: only the flow it runs has one. */
const RUNTIME_ROWS = [{ name: 'registered_flow', enabled: true, bound: true, triggerType: 'record_change', object: 'task' }];

const server = vi.hoisted(() => ({
  active: new Map<string, Record<string, unknown>>(),
  saves: [] as Array<{ type: string; name: string }>,
  registrations: {} as Record<string, unknown>,
}));

const mockClient = vi.hoisted(() => {
  const k = (type: string, name: string) => `${type}/${name}`;
  const items = (type: string) =>
    [...server.active.entries()]
      .filter(([key]) => key.startsWith(`${type}/`))
      .map(([, row]) => ({ name: row.name, label: row.label ?? row.name }));
  return {
    list: vi.fn(async (type: string) => items(type)),
    listResponse: vi.fn(async (type: string) => ({
      items: items(type),
      ...(type === 'flow' ? { registrations: server.registrations } : {}),
    })),
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
import { FlowPreview } from '../metadata-admin/previews/FlowPreview';
import { t } from '../metadata-admin/i18n';

const dataSource = createEmptyDataSource();
failOnAbsorbedFetchError();

registerMetadataPreview('flow', FlowPreview);

const AUTOMATION_STATUS_ROUTE = '/api/v1/automation/_status';
const routeOf = (url: string) => url.split('?')[0];

beforeEach(() => {
  server.active.clear();
  server.saves.length = 0;
  server.registrations = JSON.parse(JSON.stringify(REGISTRATIONS));
  for (const f of FLOWS) server.active.set(`flow/${String(f.name)}`, JSON.parse(JSON.stringify(f)));
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      const url = String(input && typeof input === 'object' && 'url' in input ? (input as { url: unknown }).url : input);
      if (routeOf(url) !== AUTOMATION_STATUS_ROUTE) {
        return new Response('null', { status: 404, headers: { 'content-type': 'application/json' } });
      }
      return new Response(JSON.stringify({ success: true, data: { flows: RUNTIME_ROWS, total: RUNTIME_ROWS.length } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
});

afterEach(() => {
  // ⛔ The stored `status` is never rewritten: reading a verdict saves nothing.
  expect(server.saves).toEqual([]);
  cleanup();
  vi.unstubAllGlobals();
});

function renderPillar() {
  return render(
    <MemoryRouter initialEntries={[`/studio/${PKG}/automations`]}>
      <AutomationsPillar packageId={PKG} />
    </MemoryRouter>,
  );
}

const en = (key: string) => t(key, 'en');

/** The rail row's status element for the flow labelled `label`, once one renders. */
async function railStatus(label: string): Promise<HTMLElement> {
  const row = await screen.findByRole('button', { name: new RegExp(label) }, { timeout: 8000 });
  let el: HTMLElement | null = null;
  await waitFor(
    () => {
      el = row.querySelector('span[title]');
      expect(el).not.toBeNull();
    },
    { timeout: 8000 },
  );
  return el!;
}

function headerPill(label: string): { pill: HTMLElement; value: string } {
  const labelEl = screen.getByText(`${label}:`);
  return { pill: labelEl.parentElement as HTMLElement, value: labelEl.nextElementSibling?.textContent ?? '' };
}

async function openFlow(label: string, name: string): Promise<void> {
  fireEvent.click(await screen.findByRole('button', { name: new RegExp(label) }, { timeout: 8000 }));
  await screen.findByTitle(`API name: ${name}`, undefined, { timeout: 8000 });
  await screen.findByText('Status:', undefined, { timeout: 8000 });
}

async function statusPillReads(value: string): Promise<HTMLElement> {
  await waitFor(() => expect(headerPill('Status').value).toBe(value), { timeout: 8000 });
  return headerPill('Status').pill;
}

describe('the engine registration verdict in the rail and the header (objectui#12349)', () => {
  it('a refused flow reads "Refused by the engine" in the rail and the header, titled with the message as sent — not "unpublished", not "enabled"', async () => {
    renderPillar();
    const chip = await railStatus('Refused flow');
    expect(chip).toHaveTextContent(en('engine.studio.auto.refused'));
    expect(chip).toHaveAttribute('title', MESSAGE);

    await openFlow('Refused flow', 'refused_flow');
    const pill = await statusPillReads(en('engine.studio.auto.refused'));
    expect(pill).toHaveAttribute('title', MESSAGE);
    expect(headerPill('Status').value).not.toBe(en('engine.studio.unpublishedDraft'));
    expect(headerPill('Status').value).not.toBe(en('engine.studio.auto.enabled'));
    expect(pill.innerHTML).not.toMatch(/emerald/);
  });

  it('an unregistered flow reads "Not running here" in the rail and the header, titled by its own row', async () => {
    renderPillar();
    const chip = await railStatus('Unregistered flow');
    expect(chip).toHaveTextContent(en('engine.studio.auto.notRunning'));
    expect(chip).toHaveAttribute('title', en('engine.studio.auto.unregisteredTitle'));

    await openFlow('Unregistered flow', 'unregistered_flow');
    const pill = await statusPillReads(en('engine.studio.auto.notRunning'));
    expect(pill).toHaveAttribute('title', en('engine.studio.auto.unregisteredTitle'));
  });

  it('a registered flow reads as today: On, from its runtime row', async () => {
    renderPillar();
    const dot = await railStatus('Registered flow');
    expect(dot).toHaveTextContent(en('engine.studio.auto.on'));
    expect(dot).toHaveAttribute('title', en('engine.studio.auto.onBound'));

    await openFlow('Registered flow', 'registered_flow');
    await statusPillReads(en('engine.studio.auto.on'));
  });

  it('a flow with no verdict reads as today: no rail status, and "unpublished" in the header without a runtime row', async () => {
    renderPillar();
    await railStatus('Refused flow'); // the verdicts and the runtime rows are in
    await openFlow('Unjudged flow', 'unjudged_flow');
    await statusPillReads(en('engine.studio.unpublishedDraft'));
    const row = screen.getByRole('button', { name: /Unjudged flow/ });
    expect(row.querySelector('span[title]')).toBeNull();
  });

  it('the verdicts are read from the flow list of the pillar\'s package', async () => {
    renderPillar();
    await railStatus('Refused flow');
    expect(mockClient.listResponse).toHaveBeenCalledWith('flow', { packageId: PKG });
  });
});
