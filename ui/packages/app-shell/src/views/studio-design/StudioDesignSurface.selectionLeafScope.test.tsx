// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#7137 — the Interfaces pillar's block `selection` must not outlive a
 * leaf change.
 *
 * ## The mechanism it pins
 *
 * `InterfacesPillar`'s draft-load effect used to be the only thing that cleared
 * the selection, and its clear sat AFTER the guard:
 *
 *     if (!current || !isEditable) { setDraft({}); setHasDraft(false); return; }
 *     …
 *     setSelection(null);   // never reached on the early-return path
 *
 * So walking from a leaf with a block selected to any leaf where
 * `isEditable === false` carried the selection across, and it then described a
 * block on the PREVIOUS leaf's canvas.
 *
 * The repair keys the selection to the leaf it was made on — the same
 * "expires by construction" shape `blockingReport` already uses against
 * `inspectorKey` in this component — so a leaf change nulls it in the SAME
 * render rather than one committed render later.
 *
 * ## Two populations, two different observables — both are pinned here
 *
 * `isEditable = !!Preview && !StudioCanvas` is a conjunction, so it is false
 * for two disjoint reasons, and #7121's landed gating covers only one of them:
 *
 *   (a) **studio-canvas leaves** (`object`). #7121 gates the rail and the
 *       header's clear button on `StudioCanvas`, so both of those symptoms are
 *       already unreachable here. What it did NOT gate is `hasInspectorTarget`,
 *       which fed `nextCenterTab` — so in the folded layout the ONLY
 *       surviving observable of the leak was the center tab. objectui#12725
 *       retired that layout; the selection's identity now feeds the right
 *       slot (it asks for the properties) and the canvas status line ("Selected:
 *       …"), and the slot-layout test below measures that line.
 *
 *   (b) **leaves whose own type has no registered designer**. Nothing gates
 *       this population: the stale selection reaches the
 *       `selection && Inspector && current` rail branch directly and opens the
 *       scoped inspector for a foreign block. Pinned via a mount LEDGER rather
 *       than a point-in-time query, because the defect being excluded is a
 *       mount that is torn down again a render later.
 *
 * ## ⚠️ The registry is POPULATED on purpose
 *
 * Same precondition as `StudioDesignSurface.designerRegistryPartial.test.tsx`:
 * a designer is registered for an unrelated type, so a `page` leaf lands in the
 * no-designer branch for reason (1) "this type has none" — a product fact — and
 * not for #6795 part C's reason (2) "the registries never loaded". A
 * zero-registry reading would measure that other card instead.
 *
 * ## ⛔ Do NOT re-fence this on `isEditable`
 *
 * The discriminator for #7121's rail / Design-mode gating is `StudioCanvas`,
 * never `isEditable` — `StudioDesignSurface.designerRegistryPartial.test.tsx`
 * is the live fence for that and goes red on the substitution. This card is the
 * opposite direction: the STATE lifecycle, which is correctly keyed to the leaf
 * and not to either discriminator.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// jsdom has no matchMedia — `useIsMobile` (rail overlay) needs a stub.
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

/**
 * Three leaves, one app — one of each population plus the editable leaf the
 * selection is made on:
 *   - `dashboard` → a registered designer, so it is editable and can emit a
 *     selection (the ONLY leaf here that can);
 *   - `object`    → population (a), a studio-canvas leaf;
 *   - `page`      → population (b), no designer registered for its own type.
 */
const NAV = [
  { id: 'nav_dash', type: 'dashboard', label: 'Overview', dashboardName: 'sales_overview' },
  { id: 'nav_obj', type: 'object', label: 'Tasks', objectName: 'showcase_task' },
  { id: 'nav_page', type: 'page', label: 'Home', pageName: 'home_page' },
];

const objectDef = {
  name: 'showcase_task',
  label: 'Task',
  fields: [{ name: 'title', label: 'Title', type: 'text' }],
};

const mockClient = {
  save: vi.fn(async () => ({})),
  list: vi.fn(async (type: string) => {
    if (type === 'app') return [{ name: 'acme_app', label: 'Acme' }];
    if (type === 'object') return [{ name: 'showcase_task', label: 'Task' }];
    return [];
  }),
  listDrafts: vi.fn(async () => []),
  layered: vi.fn(async (type: string, name: string) => {
    if (type === 'app') return { effective: { name: 'acme_app', label: 'Acme', navigation: NAV } };
    if (type === 'object') return { effective: objectDef, code: objectDef };
    if (type === 'dashboard') return { effective: { name: 'sales_overview', label: 'Sales' } };
    if (type === 'page') return { effective: { name: 'home_page', label: 'Home' } };
    return { effective: { name } };
  }),
  getDraft: vi.fn(async () => null),
  get: vi.fn(async () => undefined),
  withPreviewDrafts() { return this; },
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
import { listMetadataPreviewTypes, registerMetadataPreview } from '../metadata-admin/preview-registry';
import { listMetadataInspectorTypes, registerMetadataInspector } from '../metadata-admin/inspector-registry';
import { listStudioCanvasPreviewTypes } from './studio-canvas-preview';

/**
 * Every `{type, name, selection}` a scoped inspector was EVER mounted with.
 *
 * A ledger rather than a `queryBy…` at the end of the test, because the defect
 * under exclusion is short-lived by nature: an imperative clear that runs in an
 * effect leaves the stale selection live for one committed render, so the
 * foreign-block inspector mounts, runs its effects, and is torn down before any
 * settled assertion could see it. The ledger catches that frame; a final query
 * cannot.
 */
const mounts: string[] = [];

function StubInspector(props: Record<string, unknown>): React.ReactElement {
  const sel = props.selection as { kind?: string; id?: string } | null;
  const stamp = `${String(props.type)}:${String(props.name)}:${sel?.kind}:${sel?.id}`;
  // Recorded during render (not in an effect) so a mount that is discarded
  // before commit is still counted — the strictest reading available.
  mounts.push(stamp);
  return <div data-testid="stub-inspector" data-for={stamp} />;
}

/**
 * The only leaf here that can produce a selection. Its `pick` button goes
 * through the pillar's own `onSelectionChange`, so the selection under test is
 * made the way the product makes one.
 */
function StubDashboardPreview(props: Record<string, unknown>): React.ReactElement {
  const onSel = props.onSelectionChange as ((s: unknown) => void) | undefined;
  return (
    <div data-testid="stub-dash" data-editing={String(props.editing)}>
      <button
        type="button"
        data-testid="pick-block"
        onClick={() => onSel?.({ kind: 'block', id: 'blk_1' })}
      >
        pick
      </button>
    </div>
  );
}

registerMetadataPreview('dashboard', StubDashboardPreview as never);
// Inspectors for all three types. `object` mirrors production, which registers
// `ObjectFieldInspector` (`metadata-admin/inspectors/index.ts`); `page` is what
// makes population (b)'s scoped-inspector branch reachable rather than
// accidentally empty.
registerMetadataInspector('dashboard', StubInspector as never);
registerMetadataInspector('object', StubInspector as never);
registerMetadataInspector('page', StubInspector as never);

beforeEach(() => {
  mounts.length = 0;
});
afterEach(cleanup);

/** The precondition every test here shares, stated rather than assumed. */
function expectPopulatedRegistries() {
  // Populated — so a `page` leaf reaching the no-designer branch is reaching it
  // because ITS type has none, not because none loaded (#6795 part C).
  expect(listMetadataPreviewTypes()).toEqual(['dashboard']);
  expect(listMetadataPreviewTypes()).not.toContain('page');
  expect(listMetadataInspectorTypes()).toEqual(
    expect.arrayContaining(['dashboard', 'object', 'page']),
  );
  // ...and the two populations really are what this file says they are.
  expect(listStudioCanvasPreviewTypes()).toContain('object');
  expect(listStudioCanvasPreviewTypes()).not.toContain('page');
}

/** objectui#12725 — the Studio surface's right slot, reduced to what the pillar reads of it. */
function SlotHost({ children }: { children: React.ReactNode }) {
  const [target, setTarget] = React.useState<HTMLElement | null>(null);
  const handle = React.useMemo(
    () => ({ propsTarget: target, mode: 'props' as const, claimProps: () => () => {}, showProps: () => {} }),
    [target],
  );
  return (
    <StudioRightSlotContext.Provider value={handle}>
      {children}
      <div ref={setTarget} />
    </StudioRightSlotContext.Provider>
  );
}

function mountPillar(props: { inSlot?: boolean } = {}) {
  const pillar = <InterfacesPillar packageId="com.acme.app" />;
  return render(
    <MemoryRouter initialEntries={['/studio/com.acme.app/interfaces']}>
      {props.inSlot ? <SlotHost>{pillar}</SlotHost> : pillar}
    </MemoryRouter>,
  );
}

const bodyText = () => (document.body.textContent ?? '').replace(/\s+/g, ' ');

/** Select `blk_1` on the dashboard leaf, through the pillar's own callback. */
async function selectBlockOnDashboardLeaf() {
  fireEvent.click(await screen.findByTitle('dashboard · sales_overview'));
  await waitFor(() => expect(screen.getByTestId('stub-dash')).toBeInTheDocument(), {
    timeout: 4000,
  });
  fireEvent.click(screen.getByTestId('pick-block'));
  // Control: the selection really was made. Without this the "it is gone
  // afterwards" assertions below could pass because it never existed.
  await waitFor(() => expect(screen.getByLabelText('Clear selection')).toBeInTheDocument(), {
    timeout: 4000,
  });
  expect(screen.getByTestId('stub-inspector')).toHaveAttribute(
    'data-for',
    'dashboard:sales_overview:block:blk_1',
  );
}

/** The canvas status line's right-hand hint, read from the DOM rather than from state. */
function canvasHint(): string | null {
  return screen.queryByTestId('if-canvas-hint')?.textContent ?? null;
}

describe('Interfaces pillar — a block selection expires with its leaf (#7137)', () => {
  it('does not carry the selection onto a leaf whose type has no designer', async () => {
    expectPopulatedRegistries();
    mountPillar();
    await selectBlockOnDashboardLeaf();

    // Walk to population (b). Nothing in #7121 gates this branch.
    fireEvent.click(screen.getByTitle('page · home_page'));
    await waitFor(
      () =>
        expect(bodyText()).toContain(
          'No designer is registered for page, so it cannot be previewed or designed here.',
        ),
      { timeout: 4000 },
    );

    // The scoped inspector must never have been handed a block from the
    // dashboard leaf — not at the end, and not for a single render either.
    const foreign = mounts.filter((m) => m.startsWith('page:') && m.includes('blk_1'));
    expect(foreign).toEqual([]);
    // Control on the same instrument: the ledger is demonstrably live and does
    // record real mounts, so the empty result above is a measurement and not a
    // broken probe.
    expect(mounts).toContain('dashboard:sales_overview:block:blk_1');

    // ...and the settled state agrees: no scoped inspector, and no offer to
    // clear a selection that no longer exists.
    expect(screen.queryByTestId('stub-inspector')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Clear selection')).not.toBeInTheDocument();
  });

  /**
   * ⚠️ Green on BOTH sides of the repair, and deliberately kept anyway.
   *
   * Measured on the unfixed tree, this test passed while the other four in this
   * file split 3-failed / 2-passed — because #7121 already orders the
   * studio-canvas rail branch ahead of the `selection` branch, so the foreign
   * block never reached an inspector here even with the leak live. That is the
   * finding, not a defect in the test: on population (a) the scoped-inspector
   * symptom is ALREADY unreachable, which is why the folded-tab test below is
   * the one that actually measures this population's leak.
   *
   * It stays as the fence for the combination — state lifecycle and rail gating
   * agreeing — which nothing else asserts.
   */
  it('does not carry the selection onto a studio-canvas leaf', async () => {
    expectPopulatedRegistries();
    mountPillar();
    await selectBlockOnDashboardLeaf();

    // Walk to population (a). objectui#11823 — its rail is the list-view
    // panel now (an `object` leaf's panel edits the list its canvas shows),
    // ordered where the no-blocks statement was: ahead of the selection branch.
    fireEvent.click(screen.getByTitle('object · showcase_task'));
    await screen.findByTestId('studio-list-view-inspector', undefined, { timeout: 4000 });

    const foreign = mounts.filter((m) => m.startsWith('object:') && m.includes('blk_1'));
    expect(foreign).toEqual([]);
    expect(mounts).toContain('dashboard:sales_overview:block:blk_1');
    expect(screen.queryByTestId('stub-inspector')).not.toBeInTheDocument();
  });

  it('in the right slot, the canvas stops naming a selection the new leaf does not hold', async () => {
    expectPopulatedRegistries();
    mountPillar({ inSlot: true });
    await selectBlockOnDashboardLeaf();

    // Control on the same instrument: selecting a block DOES drive this line,
    // so the reading below measures the selection's expiry and not a line
    // that never names one. (objectui#12725 re-points the folded center-tab
    // reading here: that layout is gone.)
    await waitFor(() => expect(canvasHint()).toMatch(/^Selected: blk_1/), { timeout: 4000 });

    // ⭐ A surviving selection would keep naming `blk_1` on the object leaf —
    // a leaf with no block to inspect. Scoped to its leaf, it CLEARS.
    fireEvent.click(screen.getByTitle('object · showcase_task'));
    await screen.findByTestId('studio-list-view-inspector', undefined, { timeout: 4000 });
    expect(canvasHint()).toBeNull();
  });
});

describe('REGRESSION FENCE — the repair must not over-fire (#7137)', () => {
  it('keeps the selection while the leaf stays the same', async () => {
    expectPopulatedRegistries();
    mountPillar();
    await selectBlockOnDashboardLeaf();

    // #5800's contract, quoted in the component: "Selection state is retained
    // so switching back to design keeps context." A repair that cleared on any
    // re-render rather than on a LEAF CHANGE would break this round trip.
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    await waitFor(() =>
      expect(screen.getByTestId('stub-dash')).toHaveAttribute('data-editing', 'false'),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Design' }));
    await waitFor(() =>
      expect(screen.getByTestId('stub-dash')).toHaveAttribute('data-editing', 'true'),
    );

    expect(screen.getByTestId('stub-inspector')).toHaveAttribute(
      'data-for',
      'dashboard:sales_overview:block:blk_1',
    );
    expect(screen.getByLabelText('Clear selection')).toBeInTheDocument();
  });

  it('restores a selection made again on the leaf it was cleared by leaving', async () => {
    expectPopulatedRegistries();
    mountPillar();
    await selectBlockOnDashboardLeaf();

    fireEvent.click(screen.getByTitle('page · home_page'));
    await waitFor(() => expect(screen.queryByTestId('stub-inspector')).not.toBeInTheDocument(), {
      timeout: 4000,
    });

    // Coming BACK must not resurrect the old selection (the leaf starts clean)…
    fireEvent.click(screen.getByTitle('dashboard · sales_overview'));
    await waitFor(() => expect(screen.getByTestId('stub-dash')).toBeInTheDocument(), {
      timeout: 4000,
    });
    expect(screen.queryByLabelText('Clear selection')).not.toBeInTheDocument();

    // …and selecting again on it must still work.
    fireEvent.click(screen.getByTestId('pick-block'));
    await waitFor(() =>
      expect(screen.getByTestId('stub-inspector')).toHaveAttribute(
        'data-for',
        'dashboard:sales_overview:block:blk_1',
      ),
    );
  });
});
