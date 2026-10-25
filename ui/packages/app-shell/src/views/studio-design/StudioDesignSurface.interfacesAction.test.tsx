// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Acceptance for objectui#4019's `action` half, at the pillar level: the
 * Studio Interfaces rail must LIST an action nav entry and OPEN it on the
 * standard design surface.
 *
 * Before this, the entry rendered — the rail walks every nav leaf — but with
 * `disabled` set, because `resolveSurface` had no `action` case. So the one
 * nav variant that names an authorable metadata item was the one the designer
 * could not open, while the shipped sidebar rendered and dispatched it
 * (framework#4509). The two assertions below are exactly those two verbs.
 */
import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const NAV = [
  { id: 'nav_home', type: 'page', label: 'Home', pageName: 'home' },
  { id: 'nav_run_sync', type: 'action', label: 'Run Sync', actionDef: { actionName: 'sync_now' } },
];

/** Spec-valid (`ActionSchema`, 17.0.0-rc.6) — the item the rail must open. */
const ACTION = {
  name: 'sync_now',
  label: 'Sync Now',
  type: 'script',
  target: 'sync',
  locations: ['list_toolbar'],
};

const mockClient = {
  list: vi.fn(async (type: string) =>
    type === 'app' ? [{ name: 'acme_app', label: 'Acme' }] : [],
  ),
  listDrafts: vi.fn(async () => []),
  layered: vi.fn(async (type: string, name: string) => {
    if (type === 'app') return { effective: { name: 'acme_app', label: 'Acme', navigation: NAV } };
    if (type === 'action' && name === 'sync_now') return { effective: ACTION };
    return { effective: { name, kind: 'blocks', blocks: [] } };
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
import { ActionPreview } from '../metadata-admin/previews/ActionPreview';

// Registered directly rather than via `registerBuiltinPreviews()` — the barrel
// pulls every preview module (flow canvas, dashboard, report…) into this file's
// graph for one canvas. Same trade-off, and same precedent, as
// `EmbeddedItemEditor.preview.test.tsx`. That the barrel itself still carries
// the `action` line is the pre-existing registration this card builds on
// (`previews/index.ts`), not something this test can drift from.
//
// The right-hand inspector is deliberately not asserted here: `action`'s
// default inspector was already registered and already has its own coverage
// (`inspectors/ActionDefaultInspector.celGate.test.tsx`); mounting it would
// drag the CEL condition-builder tree into a rail test.
registerMetadataPreview('action', ActionPreview);

afterEach(cleanup);

function renderPillar() {
  return render(
    <MemoryRouter initialEntries={['/studio/com.acme.app/interfaces']}>
      <InterfacesPillar packageId="com.acme.app" />
    </MemoryRouter>,
  );
}

describe('Interfaces pillar — action nav entries (objectui#4019)', () => {
  it('lists the action entry as an ENABLED rail item', async () => {
    renderPillar();

    const entry = await screen.findByTitle('action · sync_now');
    expect(entry).toBeInTheDocument();
    // The verb that was broken: the rail renders every leaf, but an
    // unresolvable one is `disabled` and cannot be opened.
    expect(entry).toBeEnabled();
  });

  it('opens it on the standard design surface when clicked', async () => {
    renderPillar();

    // The first resolvable leaf (`Home`) auto-opens, so this also proves the
    // rail SWITCHES to the action rather than merely defaulting to it.
    const entry = await screen.findByTitle('action · sync_now');
    fireEvent.click(entry);

    // Canvas caption — the surface the pillar is now editing. objectui#7254
    // changed WHAT it says, not whether it says it: the caption used to print
    // the internal `action · sync_now` pair and now names the item the way the
    // author does (its nav label) plus the metadata kind, with the internal
    // pair moved to the tooltip. Asserted through the caption's own testid
    // rather than by matching its whole text, so the next copy change does not
    // land here again.
    const caption = await waitFor(() => screen.getByTestId('if-canvas-caption'));
    expect(caption).toHaveTextContent('Run Sync');
    expect(caption).toHaveAttribute('title', 'Internal id: action · sync_now');
    // ...rendered by the registered `ActionPreview`, which draws the action's
    // own label as the faux button an author is designing.
    await waitFor(() => expect(screen.getAllByText('Sync Now').length).toBeGreaterThan(0));
  });
});
