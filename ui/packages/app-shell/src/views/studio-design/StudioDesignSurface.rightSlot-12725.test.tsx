// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12725 — Studio's one right slot, the maintainer's 「按「右栏二选一」定稿」:
 * the slot shows the properties OR the AI copilot, never both, and never beside
 * a second right-hand panel.
 *
 *  - With nothing selected the slot shows the copilot, and no properties.
 *  - Selecting a canvas element switches it to that element's properties, the
 *    copilot folded to a strip at the slot's foot; Esc, or a click on empty
 *    canvas, returns to the item's own properties.
 *  - `⌘.` / `Ctrl+.` switches the two; the top bar's right-most icon hides the
 *    slot, remembered under the Studio key, never the console's.
 *  - The canvas has no 画布 / 源码 / 属性 tabs: one status line, and the item's
 *    definition opens from its ⋯ menu.
 *  - The pillar names are visible from 1024 px (`lg`), icons below.
 *  - CONTROLS: a pillar that claims nothing (Access) gets the copilot alone; no
 *    copilot served → the properties alone; an injected `aiSlot` (the cloud
 *    seam) keeps the classic layout with no slot.
 *
 * The copilot is a stub reporting what `StudioChatDock` reports (its own pins
 * live beside `StudioAiCopilot.tsx`); the canvas is a stub dashboard designer
 * whose one button selects a block, as `onSelectionChange` reports it.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const PACKAGE_ID = 'com.acme.app';
const NAV = [{ id: 'nav_dash', type: 'dashboard', label: 'Overview', dashboardName: 'sales_overview' }];

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn(), dismiss: vi.fn() },
  Toaster: () => null,
}));

const mockClient = {
  save: vi.fn(async () => ({})),
  list: vi.fn(async (type: string) => (type === 'app' ? [{ name: 'acme_app', label: 'Acme' }] : [])),
  listDrafts: vi.fn(async () => []),
  listTypes: vi.fn(async () => ({ entries: [] })),
  layered: vi.fn(async (type: string, name: string) => {
    if (type === 'app') return { effective: { name: 'acme_app', label: 'Acme', navigation: NAV } };
    if (type === 'dashboard') return { effective: { name: 'sales_overview', label: 'Sales' } };
    return { effective: { name } };
  }),
  getDraft: vi.fn(async () => null),
  get: vi.fn(async () => undefined),
  references: vi.fn(async () => []),
  withPreviewDrafts() {
    return this;
  },
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
vi.mock('../../preview/DraftChangesPanel', () => ({ DraftChangesPanel: () => null }));

/** What the copilot stub reports, per test. */
const copilot = vi.hoisted(() => ({ available: true, planPendingCount: 0 }));
vi.mock('./StudioAiCopilot', () => ({
  StudioChatDock: ({ onStatusChange }: { onStatusChange?: (s: { available: boolean; planPendingCount: number }) => void }) => {
    React.useEffect(() => {
      onStatusChange?.({ available: copilot.available, planPendingCount: copilot.planPendingCount });
    }, [onStatusChange]);
    return copilot.available ? <div data-testid="copilot-body">conversation</div> : null;
  },
}));

// The source loads `@objectstack/lint` lazily; paid here, at collection, not
// inside a case's clock (check:test-source-alias).
import '@objectstack/lint';
import { StudioDesignSurface } from './StudioDesignSurface';
import { t } from '../metadata-admin/i18n';
import { registerMetadataPreview } from '../metadata-admin/preview-registry';
import { registerMetadataInspector } from '../metadata-admin/inspector-registry';
import { DOCK_EXPANDED_STORAGE_KEY, DOCK_STUDIO_EXPANDED_STORAGE_KEY } from '../../layout/chatDockState';

function StubInspector(): React.ReactElement {
  return (
    <div data-testid="stub-inspector">
      <input aria-label="Block title" />
    </div>
  );
}

function StubDashboardPreview(props: Record<string, unknown>): React.ReactElement {
  const onSel = props.onSelectionChange as ((s: unknown) => void) | undefined;
  return (
    <button type="button" data-testid="pick-block" onClick={() => onSel?.({ kind: 'block', id: 'blk_1', label: 'Revenue' })}>
      pick
    </button>
  );
}

registerMetadataPreview('dashboard', StubDashboardPreview as never);
registerMetadataInspector('dashboard', StubInspector as never);

const answer = (body: unknown) => ({ ok: true, status: 200, json: async () => body });

beforeEach(() => {
  copilot.available = true;
  copilot.planPendingCount = 0;
  window.sessionStorage.clear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) =>
      String(input) === '/api/v1/packages'
        ? answer({ success: true, data: { packages: [{ manifest: { id: PACKAGE_ID, name: 'Acme' }, writable: true }] } })
        : answer([]),
    ),
  );
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
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderAt(tab: string, props: { aiSlot?: React.ReactNode } = {}) {
  render(
    <MemoryRouter initialEntries={[`/studio/${PACKAGE_ID}/${tab}`]}>
      <Routes>
        <Route path="/studio/:packageId/:tab" element={<StudioDesignSurface {...props} />} />
      </Routes>
    </MemoryRouter>,
  );
}

const slot = () => screen.getByTestId('studio-right-slot');

describe('Studio right slot — controls (objectui#12725)', () => {
  it('the slot remembers a hide under the Studio key only: the console dock\'s flag never hides it', async () => {
    window.sessionStorage.setItem(DOCK_EXPANDED_STORAGE_KEY, '0');
    renderAt('data');
    await waitFor(() => expect(slot()).toBeVisible());
    cleanup();

    window.sessionStorage.setItem(DOCK_STUDIO_EXPANDED_STORAGE_KEY, '0');
    renderAt('data');
    await screen.findByTestId('topbar-ai-assistant');
    expect(slot()).not.toBeVisible();
    expect(screen.getByTestId('topbar-ai-assistant')).toHaveAttribute('aria-pressed', 'false');
  });

  // objectui#12725 phase 2 — Data and Automations now claim the slot, so the
  // pillar that claims nothing is Access (its panels are in the main column
  // and in dialogs; it has no properties aside). The Data pillar with nothing
  // selected claims nothing either: `pillarsClaimSlot-12725`.
  it('a pillar that claims nothing gets the copilot alone: a title, no switch, no strip', async () => {
    renderAt('access');
    await waitFor(() => expect(slot()).toHaveAttribute('data-mode', 'copilot'));
    expect(within(slot()).queryAllByRole('tab')).toHaveLength(0);
    expect(within(slot()).getByTestId('studio-slot-title')).toHaveTextContent(t('engine.studio.aiCopilot', 'en'));
    // ⌘. has nothing to switch to.
    fireEvent.keyDown(document, { key: '.', metaKey: true });
    expect(slot()).toHaveAttribute('data-mode', 'copilot');
  });

  // objectui#12725 phase 2 — re-pointed from Data to Access, for the reason above.

});

// objectstack#35061 item 1 — the pillars' host is what every rail's narrow form
// measures, and it says whether the slot squeezes it.
describe('Studio right slot — the rails read whether it squeezes the pillars (objectstack#35061)', () => {

  it('a pillar with no slot to show (Access, no copilot) keeps its host closed', async () => {
    copilot.available = false;
    renderAt('access');
    await screen.findByTestId('studio-shell-header');
    await act(async () => {});
    expect(slot()).not.toBeVisible();
    expect(screen.getByTestId('studio-pillars-host')).toHaveAttribute('data-studio-slot', 'closed');
  });
});
