// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#7255 — the Studio workbench converges on an AI copilot apply
 * WITHOUT a page reload.
 *
 * Measured symptom: the copilot staged/published a new object and pushed a nav
 * item into the app's `navigation`; the tenant registry had both (object
 * `active`, item present in `sys_metadata`) — and the workbench's left rail
 * still showed the pre-apply tree until the author reloaded the page.
 *
 * The channel was already there and already production-safe: the copilot is
 * the RIGHT DOCK of this same document (ADR-0057 P3c), and `ChatPane`
 * announces every authoring turn on the assistant bus (`emitMetadataRefresh`,
 * the same pulse `usePendingDrafts` / `MetadataProvider` already converge on).
 * What was missing was a subscriber on the rails. These tests pin that the
 * rails now re-read on the pulse — the SAME mounted tree, so the assertion
 * would still fail if someone "fixed" it by remounting or reloading.
 *
 * Deliberately NOT asserted here: which tool result emits the pulse. That
 * predicate is `ChatPane`'s and is covered where it lives; duplicating it
 * would pin two producers to one test.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, act, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import type { NavNode } from './navSurface.js';

/** The nav BEFORE the copilot turn — the two blueprint items the card names. */
const NAV_BEFORE: NavNode[] = [
  { id: 'nav_dashboard', type: 'page', label: '首页仪表盘', pageName: 'home', icon: 'layout_dashboard' },
  { id: 'nav_customer', type: 'object', label: '客户', objectName: 'b2r4_customer', icon: 'building_2' },
];

/** …and AFTER: the copilot's follow-up table, already live in the registry. */
const NAV_AFTER: NavNode[] = [
  ...NAV_BEFORE,
  { id: 'nav_b2r4_follow_up_record', type: 'object', label: '跟进记录', objectName: 'b2r4_follow_up_record' },
];

/**
 * One mutable world both pillars read, flipped by `applyCopilotTurn()` — the
 * server-side half of the scenario. The client itself is uncached
 * (`cache: 'no-store'` on every `/meta/*` GET), so a re-read is all it takes.
 */
let world = { nav: NAV_BEFORE, objects: [{ name: 'b2r4_customer', label: '客户' }] };

function applyCopilotTurn(): void {
  world = {
    nav: NAV_AFTER,
    objects: [
      { name: 'b2r4_customer', label: '客户' },
      { name: 'b2r4_follow_up_record', label: '跟进记录' },
    ],
  };
}

const mockClient = {
  list: vi.fn(async (type: string) => {
    if (type === 'app') return [{ name: 'b2r4_app', label: '客户管理' }];
    if (type === 'object') return world.objects;
    return [];
  }),
  listDrafts: vi.fn(async () => []),
  layered: vi.fn(async (type: string, name: string) => {
    if (type === 'app') {
      return { effective: { name: 'b2r4_app', label: '客户管理', navigation: world.nav } };
    }
    return { effective: { name, label: name, fields: [] }, code: { name, label: name, fields: [] } };
  }),
  getDraft: vi.fn(async () => null),
  save: vi.fn(async () => ({})),
  get: vi.fn(async () => undefined),
};

vi.mock('../metadata-admin/useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../metadata-admin/useMetadata')>();
  return {
    ...mod,
    useMetadataClient: () => mockClient,
    useMetadataTypes: () => ({ entries: [] }),
  };
});

vi.mock('./packages-io', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./packages-io')>();
  return { ...mod, fetchPackages: vi.fn(async () => []) };
});

vi.mock('@object-ui/react', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@object-ui/react')>();
  return { ...mod, useAdapter: () => ({}) };
});

// The Data pillar's canvas is the runtime records grid; this test is about the
// RAIL, so the grid is stubbed exactly as `DataPillar.gridProjection.test.tsx`
// stubs it — same seam, no plugin-view tree dragged into this file's graph.
vi.mock('@object-ui/plugin-view', async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>();
  return { ...mod, ObjectView: () => <div data-testid="grid-stub" /> };
});

import { emitMetadataRefresh } from '../../assistant/assistantBus.js';
import { DataPillar, InterfacesPillar } from './StudioDesignSurface';
import { SurfaceDeepLinkProvider } from './surfaceDeepLinkChannel';

afterEach(() => {
  cleanup();
  world = { nav: NAV_BEFORE, objects: [{ name: 'b2r4_customer', label: '客户' }] };
  vi.clearAllMocks();
});

describe('Studio rails converge on an AI copilot apply (objectui#7255)', () => {
  it('Interfaces rail grows the new nav item on the pulse, in place', async () => {
    render(
      <MemoryRouter initialEntries={['/studio/b2r4/interfaces']}>
        <InterfacesPillar packageId="b2r4" />
      </MemoryRouter>,
    );

    // Baseline: the two blueprint items, and NOT the copilot's.
    await screen.findByTitle('object · b2r4_customer');
    expect(screen.queryByTitle('object · b2r4_follow_up_record')).toBeNull();

    // The copilot turn lands server-side …
    applyCopilotTurn();
    // … and is still invisible until something tells this tree to re-read:
    // the bug was that nothing did.
    expect(screen.queryByTitle('object · b2r4_follow_up_record')).toBeNull();

    await act(async () => {
      emitMetadataRefresh();
    });

    await waitFor(() =>
      expect(screen.getByTitle('object · b2r4_follow_up_record')).toBeInTheDocument(),
    );
    // Refresh, don't rebuild (AGENTS.md #8): the pre-existing entries are the
    // same tree, not a remounted one — a `key=` bump would have blown away the
    // rail and re-run the mount-time first-leaf selection.
    expect(screen.getByTitle('object · b2r4_customer')).toBeInTheDocument();
  });

  it('Data rail grows the new object on the pulse', async () => {
    render(
      <MemoryRouter initialEntries={['/studio/b2r4/data']}>
        <SurfaceDeepLinkProvider>
          <DataPillar packageId="b2r4" />
        </SurfaceDeepLinkProvider>
      </MemoryRouter>,
    );

    // The objects rail lists labels (no title attribute), and the selected
    // object's label also titles the canvas — so `getAllByText`, scoped by the
    // assertion that the NEW label appears at all (it has no canvas presence
    // until it is selected, which this test never does).
    await screen.findAllByText('客户');
    expect(screen.queryByText('跟进记录')).toBeNull();

    applyCopilotTurn();
    await act(async () => {
      emitMetadataRefresh();
    });

    await waitFor(() => expect(screen.getAllByText('跟进记录').length).toBeGreaterThan(0));
  });
});
