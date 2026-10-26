// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12611 — the Interfaces canvas beside a right-hand panel keeps a
 * 16 px gutter instead of 24, so a dashboard's tiles get their width.
 *
 * objectui#12725 re-points this file. The folded "Canvas / Properties" toggle
 * it pinned is gone with the folded layout: the Studio surface's right slot
 * shows the properties OR the copilot, and the pillar portals its inspector
 * into the slot. So the dot that said "the folded aside holds an editor" is
 * now the slot being asked for its properties: a selection calls `showProps`,
 * and the element's inspector is in the slot's target. The 16 px gutter moves
 * with the slot; the classic layout (no slot) keeps 24 px and its own aside.
 * The slot's chrome itself is pinned in
 * `StudioDesignSurface.rightSlot-12725.test.tsx`.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

window.matchMedia = ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addListener: () => {},
  removeListener: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia;

const NAV = [{ id: 'nav_dash', type: 'dashboard', label: 'Overview', dashboardName: 'sales_overview' }];

const mockClient = {
  save: vi.fn(async () => ({})),
  list: vi.fn(async (type: string) => (type === 'app' ? [{ name: 'acme_app', label: 'Acme' }] : [])),
  listDrafts: vi.fn(async () => []),
  layered: vi.fn(async (type: string, name: string) => {
    if (type === 'app') return { effective: { name: 'acme_app', label: 'Acme', navigation: NAV } };
    if (type === 'dashboard') return { effective: { name: 'sales_overview', label: 'Sales' } };
    return { effective: { name } };
  }),
  getDraft: vi.fn(async () => null),
  get: vi.fn(async () => undefined),
  withPreviewDrafts() {
    return this;
  },
};

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
  return { ...mod, useAdapter: () => ({}) };
});

import { InterfacesPillar } from './StudioDesignSurface';
import { StudioRightSlotContext } from './studioRightSlotState';
import { registerMetadataPreview } from '../metadata-admin/preview-registry';
import { registerMetadataInspector } from '../metadata-admin/inspector-registry';
import { t } from '../metadata-admin/i18n';

function StubInspector(): React.ReactElement {
  return <div data-testid="stub-inspector" />;
}

function StubDashboardPreview(props: Record<string, unknown>): React.ReactElement {
  const onSel = props.onSelectionChange as ((s: unknown) => void) | undefined;
  return (
    <button type="button" data-testid="pick-block" onClick={() => onSel?.({ kind: 'block', id: 'blk_1' })}>
      pick
    </button>
  );
}

registerMetadataPreview('dashboard', StubDashboardPreview as never);
registerMetadataInspector('dashboard', StubInspector as never);

afterEach(cleanup);

const slotCalls = { claims: 0, releases: 0, showProps: 0 };

// Stable, as the surface's own are (`useCallback`): a claim per mount.
const claimProps = () => {
  slotCalls.claims += 1;
  return () => {
    slotCalls.releases += 1;
  };
};
const showProps = () => {
  slotCalls.showProps += 1;
};

/** The Studio surface's right slot, reduced to what the pillar reads of it. */
function SlotHost({ children }: { children: React.ReactNode }) {
  const [target, setTarget] = React.useState<HTMLElement | null>(null);
  const handle = React.useMemo(
    () => ({ propsTarget: target, mode: 'copilot' as const, claimProps, showProps }),
    [target],
  );
  return (
    <StudioRightSlotContext.Provider value={handle}>
      {children}
      <div data-testid="slot-target" ref={setTarget} />
    </StudioRightSlotContext.Provider>
  );
}

function mountPillar(inSlot: boolean) {
  slotCalls.claims = 0;
  slotCalls.releases = 0;
  slotCalls.showProps = 0;
  const pillar = <InterfacesPillar packageId="com.acme.app" />;
  return render(
    <MemoryRouter initialEntries={['/studio/com.acme.app/interfaces']}>{inSlot ? <SlotHost>{pillar}</SlotHost> : pillar}</MemoryRouter>,
  );
}

async function openDashboard() {
  fireEvent.click(await screen.findByTitle('dashboard · sales_overview'));
  await screen.findByTestId('pick-block', undefined, { timeout: 4000 });
}

describe('the Interfaces canvas beside the right slot (objectui#12611, objectui#12725)', () => {
  it('a selection asks the slot for its properties, and the element’s inspector is in the slot', async () => {
    const { unmount } = mountPillar(true);
    await openDashboard();
    expect(slotCalls.claims).toBe(1);
    const target = screen.getByTestId('slot-target');
    // Nothing selected and no home inspector registered: the invitation, in the slot.
    expect(within(target).getByTestId('if-inspector')).toHaveTextContent(t('engine.studio.inspector.emptyLine1', 'en'));
    expect(slotCalls.showProps).toBe(0);

    fireEvent.click(screen.getByTestId('pick-block'));
    expect(await within(target).findByTestId('stub-inspector', undefined, { timeout: 4000 })).toBeInTheDocument();
    expect(slotCalls.showProps).toBe(1);

    fireEvent.click(screen.getByLabelText(t('engine.studio.deselect', 'en')));
    await waitFor(() => expect(within(target).queryByTestId('stub-inspector')).toBeNull());
    expect(slotCalls.showProps).toBe(1);

    unmount();
    expect(slotCalls.releases).toBe(1);
  });

  it('beside the slot, the canvas keeps a 16 px gutter and draws no toggle of its own', async () => {
    mountPillar(true);
    await openDashboard();
    const main = screen.getByTestId('if-canvas-main');
    expect(main).toHaveClass('px-4');
    expect(main).not.toHaveClass('px-6');
    expect(screen.queryByTestId('studio-center-tabs')).toBeNull();
    expect(screen.queryByTestId('if-properties-toggle')).toBeNull();
  });

  it('CONTROL — no slot (the classic layout): a 24 px gutter, the aside beside the canvas and its toggle', async () => {
    mountPillar(false);
    await openDashboard();
    const main = screen.getByTestId('if-canvas-main');
    expect(main).toHaveClass('px-6');
    expect(main).not.toHaveClass('px-4');
    expect(screen.queryByTestId('studio-center-tabs')).toBeNull();
    expect(screen.getByTestId('if-properties-toggle')).toBeInTheDocument();
    expect(main.parentElement?.contains(screen.getByTestId('if-inspector'))).toBe(true);
    expect(slotCalls.claims).toBe(0);
  });
});
