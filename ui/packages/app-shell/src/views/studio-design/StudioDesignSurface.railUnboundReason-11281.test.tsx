// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11281 — the Automations rail reads `triggerType` and `reason` off
 * the engine's runtime rows, so a flow whose declared trigger the engine has
 * not armed is no longer told to its author as having "no trigger".
 *
 * `FlowStatusDot.test.tsx` pins the dot on its own. This file pins the path the
 * dot's state takes through the REAL `AutomationsPillar`: the pillar's
 * `GET /api/v1/automation/_status` read, the status map it builds from the
 * rows, and the dot each rail row renders. Before this card the map kept only
 * `enabled` / `bound`, so the dot could not see the two fields however it was
 * written.
 *
 * The `_status` double is a router, not a sink (objectui#7307's shape): it
 * serves the one route and `afterEach` fails on any other URL. The rows are the
 * shape the engine's `getFlowRuntimeStates()` puts on the wire; `triggerType`
 * is absent on a flow that declares no trigger, the way the engine omits it.
 * The reason is fixture text, not a platform sentence.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const PKG = 'com.acme.app';

const NODES = [
  { id: 'start', type: 'start', label: 'Start' },
  { id: 'end', type: 'end', label: 'End' },
];
const EDGES = [{ id: 'e1', source: 'start', target: 'end' }];
const flow = (name: string, label: string) => ({ name, label, type: 'autolaunched', status: 'active', nodes: NODES, edges: EDGES });

const FLOWS = [
  flow('nightly_digest', 'Nightly digest'),
  flow('approve_order', 'Approve order'),
  flow('notify_owner', 'Notify owner'),
  flow('weekly_sweep', 'Weekly sweep'),
];

const REASON = 'FIXTURE: the platform sentence for why this flow is not armed, rendered as sent.';

/** The engine's runtime rows, as `GET /api/v1/automation/_status` carries them. */
const RUNTIME_ROWS = [
  // A package-authored schedule flow the deployment policy holds unarmed.
  { name: 'nightly_digest', enabled: true, bound: false, triggerType: 'schedule', reason: REASON },
  // A screen / manual flow: no declared trigger, so no `triggerType` and no `reason`.
  { name: 'approve_order', enabled: true, bound: false },
  // Armed, and disabled: the controls.
  { name: 'notify_owner', enabled: true, bound: true, triggerType: 'record_change', object: 'task' },
  { name: 'weekly_sweep', enabled: false, bound: false, triggerType: 'schedule' },
];

const mockClient = vi.hoisted(() => ({
  list: vi.fn(async () => [] as Array<Record<string, unknown>>),
  listDrafts: vi.fn(async () => []),
  listTypes: vi.fn(async () => ({ entries: [] })),
  get: vi.fn(async () => null),
  references: vi.fn(async () => []),
  layered: vi.fn(async () => ({ code: null, overlay: null, overlayScope: null, effective: null, editable: true, deletable: true, resettable: false, lock: 'none' })),
  getDraft: vi.fn(async (type: string, name: string) => {
    throw Object.assign(new Error(`No pending draft exists for ${type}/${name}.`), { code: 'NO_DRAFT', status: 404 });
  }),
  save: vi.fn(async () => {
    throw new Error('this suite saves nothing');
  }),
  publish: vi.fn(async () => ({ success: true })),
  reset: vi.fn(async () => ({})),
}));

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
import { t } from '../metadata-admin/i18n';

const dataSource = createEmptyDataSource();
failOnAbsorbedFetchError();

const AUTOMATION_STATUS_ROUTE = '/api/v1/automation/_status';

/** Every URL the renders handed the global `fetch`, in request order. */
let fetchCalls: string[] = [];
const routeOf = (url: string) => url.split('?')[0];

beforeEach(() => {
  fetchCalls = [];
  mockClient.list.mockImplementation(async () => FLOWS.map((f) => ({ name: f.name, label: f.label })));
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      const url = String(input && typeof input === 'object' && 'url' in input ? (input as { url: unknown }).url : input);
      fetchCalls.push(url);
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
  expect(fetchCalls.filter((url) => routeOf(url) === AUTOMATION_STATUS_ROUTE).length).toBeGreaterThan(0);
  cleanup();
  vi.unstubAllGlobals();
});

/** The status dot on the rail row for the flow labelled `label`, once it has rendered. */
async function railDot(label: string): Promise<HTMLElement> {
  const row = await screen.findByRole('button', { name: new RegExp(label) }, { timeout: 8000 });
  let dot: HTMLElement | null = null;
  await waitFor(
    () => {
      dot = row.querySelector('span[title]');
      expect(dot).not.toBeNull();
    },
    { timeout: 8000 },
  );
  return dot!;
}

describe('the Automations rail reads `triggerType` and `reason` from the runtime rows (objectui#11281)', () => {
  it('titles a policy-unbound schedule flow with the platform reason, verbatim, and reads "Not running here", not "On"', async () => {
    render(
      <MemoryRouter initialEntries={[`/studio/${PKG}/automations`]}>
        <AutomationsPillar packageId={PKG} />
      </MemoryRouter>,
    );
    const dot = await railDot('Nightly digest');
    expect(dot).toHaveAttribute('title', REASON);
    expect(dot).not.toHaveAttribute('title', t('engine.studio.auto.onUnbound', 'en'));
    // objectui#11779 — visible without hovering: the deployment does not run it.
    expect(dot).toHaveTextContent(t('engine.studio.auto.notRunning', 'en'));
    expect(within(dot).queryByText(t('engine.studio.auto.on', 'en'))).toBeNull();
  });

  it('a flow with no declared trigger still says "no trigger"; bound and disabled flows are unchanged — the controls', async () => {
    render(
      <MemoryRouter initialEntries={[`/studio/${PKG}/automations`]}>
        <AutomationsPillar packageId={PKG} />
      </MemoryRouter>,
    );
    expect(await railDot('Approve order')).toHaveAttribute('title', t('engine.studio.auto.onUnbound', 'en'));
    expect(await railDot('Notify owner')).toHaveAttribute('title', t('engine.studio.auto.onBound', 'en'));
    expect(await railDot('Weekly sweep')).toHaveAttribute('title', t('engine.studio.auto.offTitle', 'en'));
  });
});
