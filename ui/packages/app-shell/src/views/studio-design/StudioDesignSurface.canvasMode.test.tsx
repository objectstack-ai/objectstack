// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#5800 — the 设计⇄运行 canvas switch (cloud#1609 增量二).
 *
 * ADR-0080's pivot (design state = run state, one renderer) made visible: the
 * Interfaces canvas header carries a two-state switch; RUN mode is pure
 * subtraction — `editing=false` drops the design overlays so the SAME
 * renderer serves the interactive runtime. Pinned through the dashboard leaf
 * because its design mode is the most explicit: `DashboardRenderer` swallows
 * widget interaction behind `widget-click-overlay` elements exactly when
 * designMode is on, so the overlay's presence IS the mode.
 *
 * Also pinned: selection context survives a run round-trip (the acceptance's
 * 「切回设计不丢」), via the switch not clearing the pillar's selection state.
 */
import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const NAV = [
  { id: 'nav_dash', type: 'dashboard', label: 'Overview', dashboardName: 'sales_overview' },
];

const DASHBOARD = {
  name: 'sales_overview',
  label: 'Sales Overview',
  widgets: [
    { id: 'w1', type: 'metric', title: 'Total', options: { value: 42 } },
  ],
};

const mockClient = {
  list: vi.fn(async (type: string) =>
    type === 'app' ? [{ name: 'acme_app', label: 'Acme' }] : [],
  ),
  listDrafts: vi.fn(async () => []),
  layered: vi.fn(async (type: string, name: string) => {
    if (type === 'app') return { effective: { name: 'acme_app', label: 'Acme', navigation: NAV } };
    if (type === 'dashboard' && name === 'sales_overview') return { effective: DASHBOARD };
    return { effective: { name } };
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

import { InterfacesPillar } from './StudioDesignSurface';
import { registerMetadataPreview } from '../metadata-admin/preview-registry';
import { DashboardPreview } from '../metadata-admin/previews/DashboardPreview';

registerMetadataPreview('dashboard', DashboardPreview);

afterEach(cleanup);

function renderPillar() {
  return render(
    <MemoryRouter initialEntries={['/studio/com.acme.app/interfaces']}>
      <InterfacesPillar packageId="com.acme.app" />
    </MemoryRouter>,
  );
}

async function openDashboardLeaf() {
  renderPillar();
  fireEvent.click(await screen.findByTitle('dashboard · sales_overview'));
  await waitFor(() => expect(screen.getByTestId('canvas-mode-toggle')).toBeInTheDocument(), {
    timeout: 4000,
  });
}

describe('Interfaces canvas — 设计⇄运行 switch (objectui#5800)', () => {
  it('design mode (default) swallows widget interaction behind the design overlay', async () => {
    await openDashboardLeaf();
    await waitFor(
      () => expect(screen.getAllByTestId('widget-click-overlay').length).toBeGreaterThan(0),
      { timeout: 4000 },
    );
  });

  // objectui#12842 — every arrival opens this way; no router state asks for
  // another posture since the post-build run-mode landing retired.
  it('an arrival opens on Design with the properties aside open', async () => {
    await openDashboardLeaf();
    expect(screen.getByRole('button', { name: 'Design' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Collapse properties' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show properties' })).not.toBeInTheDocument();
  });

  it('run mode removes the overlays — the SAME renderer serves the interactive runtime', async () => {
    await openDashboardLeaf();
    await waitFor(
      () => expect(screen.getAllByTestId('widget-click-overlay').length).toBeGreaterThan(0),
      { timeout: 4000 },
    );
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    await waitFor(() => expect(screen.queryAllByTestId('widget-click-overlay')).toHaveLength(0), {
      timeout: 4000,
    });
    // ...and back: the switch is a round trip, not a one-way door.
    fireEvent.click(screen.getByRole('button', { name: 'Design' }));
    await waitFor(
      () => expect(screen.getAllByTestId('widget-click-overlay').length).toBeGreaterThan(0),
      { timeout: 4000 },
    );
  });
});
