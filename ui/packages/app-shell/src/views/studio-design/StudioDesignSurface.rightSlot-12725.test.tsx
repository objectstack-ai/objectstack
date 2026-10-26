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
const copilot = vi.hoisted(() => ({ available: true, planPending: false }));
vi.mock('./StudioAiCopilot', () => ({
  StudioChatDock: ({ onStatusChange }: { onStatusChange?: (s: { available: boolean; planPending: boolean }) => void }) => {
    React.useEffect(() => {
      onStatusChange?.({ available: copilot.available, planPending: copilot.planPending });
    }, [onStatusChange]);
    return copilot.available ? <div data-testid="copilot-body">conversation</div> : null;
  },
}));

import { StudioDesignSurface } from './StudioDesignSurface';
import { t, tFormat } from '../metadata-admin/i18n';
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
  copilot.planPending = false;
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
const slotProps = () => screen.getByTestId('studio-slot-props');

async function openDashboard() {
  renderAt('interfaces');
  fireEvent.click(await screen.findByTitle('dashboard · sales_overview', undefined, { timeout: 4000 }));
  await screen.findByTestId('pick-block', undefined, { timeout: 4000 });
}

async function selectBlock() {
  fireEvent.click(screen.getByTestId('pick-block'));
  await waitFor(() => expect(slot()).toHaveAttribute('data-mode', 'props'));
}

describe('Studio right slot: properties OR the copilot (objectui#12725)', () => {
  it('shows the copilot, and no properties, while nothing is selected', async () => {
    await openDashboard();
    await waitFor(() => expect(slot()).toHaveAttribute('data-mode', 'copilot'));

    expect(screen.getByTestId('copilot-body')).toBeVisible();
    expect(slotProps()).not.toBeVisible();
    // The segmented header names both halves, the copilot's selected.
    const tabs = within(slot()).getAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      t('engine.studio.inspector.props', 'en'),
      t('engine.studio.aiCopilot', 'en'),
    ]);
    expect(tabs[1]).toHaveAttribute('aria-selected', 'true');
    // No strip while the copilot itself shows; the canvas says what a click does.
    expect(screen.queryByTestId('studio-slot-copilot-strip')).toBeNull();
    expect(screen.getByTestId('if-canvas-hint')).toHaveTextContent(t('engine.studio.if.canvasHint.pick', 'en'));
    // One slot: the properties are not also drawn beside the canvas.
    expect(screen.getAllByTestId('if-inspector')).toHaveLength(1);
    expect(slotProps().contains(screen.getByTestId('if-inspector'))).toBe(true);
  });

  it("selecting an element switches the slot to that element's properties, the copilot a strip at its foot", async () => {
    await openDashboard();
    await selectBlock();

    const inspector = within(slotProps()).getByTestId('stub-inspector');
    expect(inspector).toBeVisible();
    expect(screen.getByTestId('copilot-body')).not.toBeVisible();
    const strip = screen.getByTestId('studio-slot-copilot-strip');
    expect(strip).toHaveTextContent(t('engine.studio.aiCopilot', 'en'));
    expect(strip).toHaveTextContent(t('engine.studio.slot.backToChat', 'en'));
    expect(slot().lastElementChild).toBe(strip);
    expect(screen.getByTestId('if-canvas-hint')).toHaveTextContent(
      tFormat('engine.studio.if.canvasHint.selected', 'en', { label: 'Revenue' }),
    );

    // The strip leads back to the conversation; the selection stays.
    fireEvent.click(strip);
    expect(slot()).toHaveAttribute('data-mode', 'copilot');
    expect(screen.getByTestId('copilot-body')).toBeVisible();
    expect(within(slotProps()).getByTestId('stub-inspector')).toBeInTheDocument();
  });

  it("Esc returns to the item's own properties", async () => {
    await openDashboard();
    await selectBlock();

    // An Escape typed in the inspector's own field is the field's, not the canvas's.
    fireEvent.keyDown(within(slotProps()).getByLabelText('Block title'), { key: 'Escape' });
    expect(within(slotProps()).getByTestId('stub-inspector')).toBeInTheDocument();

    fireEvent.keyDown(document.body, { key: 'Escape' });
    await waitFor(() => expect(within(slotProps()).queryByTestId('stub-inspector')).toBeNull());
    // Still the properties — the item's own (no home inspector here: the invitation).
    expect(slot()).toHaveAttribute('data-mode', 'props');
    expect(slotProps()).toHaveTextContent(t('engine.studio.inspector.emptyLine1', 'en'));
  });

  it('a click on empty canvas returns too; a click on the element does not', async () => {
    await openDashboard();
    await selectBlock();

    fireEvent.click(screen.getByTestId('pick-block'));
    expect(within(slotProps()).getByTestId('stub-inspector')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('if-canvas-main'));
    await waitFor(() => expect(within(slotProps()).queryByTestId('stub-inspector')).toBeNull());
  });

  it('⌘. and Ctrl+. switch the halves; the top bar’s right-most icon hides the slot, under the Studio key', async () => {
    await openDashboard();
    await waitFor(() => expect(slot()).toHaveAttribute('data-mode', 'copilot'));

    fireEvent.keyDown(document, { key: '.', metaKey: true });
    expect(slot()).toHaveAttribute('data-mode', 'props');
    fireEvent.keyDown(document, { key: '.', ctrlKey: true });
    expect(slot()).toHaveAttribute('data-mode', 'copilot');
    // Shift or Alt make another chord.
    fireEvent.keyDown(document, { key: '.', metaKey: true, shiftKey: true });
    fireEvent.keyDown(document, { key: '.', metaKey: true, altKey: true });
    expect(slot()).toHaveAttribute('data-mode', 'copilot');

    const header = screen.getByTestId('studio-shell-header');
    const toggle = within(header).getByTestId('studio-slot-toggle');
    const actions = toggle.parentElement as HTMLElement;
    expect(actions.lastElementChild).toBe(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(toggle).toHaveAccessibleName(t('engine.studio.slot.collapse', 'en'));

    fireEvent.click(toggle);
    expect(slot()).not.toBeVisible();
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(window.sessionStorage.getItem(DOCK_STUDIO_EXPANDED_STORAGE_KEY)).toBe('0');
    expect(window.sessionStorage.getItem(DOCK_EXPANDED_STORAGE_KEY)).toBeNull();

    // ⌘. on a hidden slot shows it again.
    fireEvent.keyDown(document, { key: '.', metaKey: true });
    expect(slot()).toBeVisible();
    expect(window.sessionStorage.getItem(DOCK_STUDIO_EXPANDED_STORAGE_KEY)).toBe('1');
  });

  it('the copilot tab and strip mark a plan that awaits approval', async () => {
    copilot.planPending = true;
    await openDashboard();
    await waitFor(() => expect(screen.getByTestId('studio-slot-plan-pending')).toBeInTheDocument());
    expect(within(slot()).getAllByRole('tab')[1]).toHaveAccessibleDescription(t('engine.studio.slot.planPending', 'en'));
    await selectBlock();
    expect(screen.getByTestId('studio-slot-strip-plan-pending')).toHaveTextContent(
      t('engine.studio.slot.planPending', 'en'),
    );
  });

  it('the canvas has no 画布 / 源码 / 属性 tabs: one status line, and the definition opens from the ⋯ menu', async () => {
    await openDashboard();
    const itemHeader = screen.getByTestId('if-item-header');
    expect(within(itemHeader).queryAllByRole('tab')).toHaveLength(0);
    expect(itemHeader.querySelector('nav')).toBeNull();
    expect(screen.queryByTestId('studio-center-tabs')).toBeNull();
    expect(screen.getByTestId('if-canvas-status')).toHaveTextContent(t('engine.studio.if.status.design', 'en'));

    fireEvent.pointerDown(screen.getByTestId('if-item-more'), { button: 0, ctrlKey: false });
    expect(await screen.findByTestId('if-item-copy-json')).toHaveTextContent(t('engine.studio.if.copyJson', 'en'));
    fireEvent.click(screen.getByTestId('if-item-view-definition'));
    const sheet = await screen.findByTestId('if-definition-sheet');
    expect(within(sheet).getByTestId('if-definition-json')).toHaveTextContent('"name": "sales_overview"');
  });

  it('the pillar names are visible from 1024 px (lg), icons below', async () => {
    await openDashboard();
    const links = within(screen.getByTestId('studio-pillar-nav')).getAllByRole('link');
    expect(links).toHaveLength(4);
    for (const link of links) {
      const name = link.querySelector('span') as HTMLElement;
      expect(name).toHaveClass('sr-only', 'lg:not-sr-only');
      expect(name).not.toHaveClass('xl:not-sr-only');
    }
  });
});

describe('Studio right slot — controls (objectui#12725)', () => {
  it('the slot remembers a hide under the Studio key only: the console dock\'s flag never hides it', async () => {
    window.sessionStorage.setItem(DOCK_EXPANDED_STORAGE_KEY, '0');
    renderAt('data');
    await waitFor(() => expect(slot()).toBeVisible());
    cleanup();

    window.sessionStorage.setItem(DOCK_STUDIO_EXPANDED_STORAGE_KEY, '0');
    renderAt('data');
    await screen.findByTestId('studio-slot-toggle');
    expect(slot()).not.toBeVisible();
    expect(screen.getByTestId('studio-slot-toggle')).toHaveAttribute('aria-pressed', 'false');
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
  it('no copilot served: the Interfaces slot holds the properties alone; the Access pillar shows no slot', async () => {
    copilot.available = false;
    await openDashboard();
    await waitFor(() => expect(slot()).toHaveAttribute('data-mode', 'props'));
    expect(within(slot()).queryAllByRole('tab')).toHaveLength(0);
    expect(screen.queryByTestId('studio-slot-copilot-strip')).toBeNull();
    expect(screen.queryByTestId('if-canvas-hint')).toBeNull();
    cleanup();

    renderAt('access');
    await screen.findByTestId('studio-shell-header');
    await act(async () => {});
    expect(slot()).not.toBeVisible();
    expect(screen.queryByTestId('studio-slot-toggle')).toBeNull();
  });

  it('an injected aiSlot keeps the classic layout: no slot, and the properties beside the canvas', async () => {
    renderAt('interfaces', { aiSlot: <div data-testid="cloud-copilot" /> });
    fireEvent.click(await screen.findByTitle('dashboard · sales_overview', undefined, { timeout: 4000 }));
    await screen.findByTestId('pick-block', undefined, { timeout: 4000 });
    expect(screen.queryByTestId('studio-right-slot')).toBeNull();
    expect(screen.queryByTestId('studio-slot-toggle')).toBeNull();
    expect(screen.getByTestId('if-inspector')).toBeVisible();
    expect(screen.getByTestId('if-properties-toggle')).toBeInTheDocument();
    expect(screen.getByTestId('if-canvas-main')).toHaveClass('px-6');
  });
});
