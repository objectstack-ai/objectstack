// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#7121 — what the Interfaces pillar may OFFER beside a studio-canvas
 * leaf.
 *
 * ## The mechanism
 *
 * `registerStudioCanvasPreview(type, …)` opts a type into a surface-specific
 * canvas: the running app, not an editable draft. That is a contract, not a
 * habit — `StudioCanvasPreviewProps` is deliberately a small read-only subset
 * of `MetadataPreviewProps` with **no `selection`, no `onSelectionChange`, no
 * `onPatch`, no `editing`**. So a studio-canvas leaf:
 *
 *   - can never produce a block selection (there is no block tree), and
 *   - can never read the design/run mode (nothing is handed `editing`).
 *
 * Two affordances beside it ignored both facts: the Design/Run switch (#5800)
 * was still offered though `canvasMode` reached no renderer, and the rail fell
 * through to *"Click a block on the canvas, and edit its properties right
 * here."* — an instruction that cannot be followed.
 *
 * ## ⚠️ This is NOT #6795 part C's cause, and the precondition says so
 *
 * Part C repaired what the pillar says when the designer registries are
 * **empty**. Every test here asserts a **POPULATED** registry first
 * (`listMetadataPreviewTypes()` non-empty), because a zero-registry reading
 * would measure that other card instead. The cause here is an ungated
 * affordance, not a missing registration.
 *
 * ## ⛔ The message promises no recovery
 *
 * Part C measured that these registries, then plain `Map`s read during render
 * with no subscription, left a consumer that read an empty one on its fallback
 * for good ("late inspector rendered: false") — so no "loading…", no "try
 * again". objectui#11939 made the reads observable, and a late registration now
 * does reach the consumer; the wording rule stands, because nothing on the page
 * knows a registration is on its way. Here the constraint is even stricter: the statement is not about
 * registration at all. This canvas has no blocks **by contract**, so there is
 * nothing to wait for, and the last test pins the absence of recovery language.
 *
 * ## ⚠️ The discriminator is `StudioCanvas`, NOT `isEditable`
 *
 * `isEditable = !!Preview && !StudioCanvas` is a conjunction of two independent
 * causes. Gating on it would also strip these affordances from leaves whose
 * only fault is that **their own type** has no designer — the exact state
 * `StudioDesignSurface.designerRegistryPartial.test.tsx` pins as still deserving
 * the ordinary "click a block" rail. That file is the live fence: gate on
 * `isEditable` and it goes red.
 *
 * ## objectui#11823 — the `object` leaf's panel now edits its list view
 *
 * The statement below is still true of a studio-canvas leaf in general, and
 * still what its rail says, but no longer of `object`: the list an `object`
 * leaf's canvas shows IS package metadata, and its Properties panel edits that
 * list view (`StudioDesignSurface.listViewInspector-11823.test.tsx`). So the
 * statement's pins are taken on a second studio-canvas type, `report` (a stub
 * canvas registered below), and the `object` leaf keeps the pins that are
 * still true of it: no Design/Run switch, no "click a block" invitation, no
 * foreign block opened.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const objectDef = {
  name: 'showcase_task',
  label: 'Task',
  fields: [{ name: 'title', label: 'Title', type: 'text' }],
};

/**
 * One leaf of each kind, in one app: `object` opts into the studio canvas,
 * `dashboard` does not (it is an ordinary block-canvas designer). The contrast
 * is the point — the second leaf is the regression fence. `report` is a
 * studio-canvas leaf of another type (objectui#11823): the leaf the
 * no-blocks statement is pinned on now that `object`'s panel edits its list.
 */
const NAV = [
  { id: 'nav_obj', type: 'object', label: 'Tasks', objectName: 'showcase_task' },
  { id: 'nav_dash', type: 'dashboard', label: 'Overview', dashboardName: 'sales_overview' },
  { id: 'nav_report', type: 'report', label: 'Pipeline', reportName: 'pipeline_report' },
];

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
import { listMetadataPreviewTypes, registerMetadataPreview } from '../metadata-admin/preview-registry';
import { listMetadataInspectorTypes, registerMetadataInspector } from '../metadata-admin/inspector-registry';
import { listStudioCanvasPreviewTypes, registerStudioCanvasPreview } from './studio-canvas-preview';

/** objectui#11823 — a studio canvas for a type other than `object`. */
function StubReportCanvas(): React.ReactElement {
  return <div data-testid="stub-report-canvas" />;
}
registerStudioCanvasPreview('report', StubReportCanvas);

const CLICK_A_BLOCK = 'Click a block on the canvas,';

/**
 * A block-canvas designer for an unrelated type. Two jobs: it makes the
 * designer registry demonstrably POPULATED (the card's precondition), and it
 * is the regression fence's leaf. It reports the `editing` prop it was handed,
 * so the Design/Run round trip is measured at the seam that actually carries
 * the mode rather than through any one renderer's overlay internals.
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

/**
 * Production registers `ObjectFieldInspector` for `object`
 * (`metadata-admin/inspectors/index.ts`), so the scoped-inspector branch is
 * reachable on the studio-canvas leaf whenever a `selection` survives a leaf
 * change. Registering a stand-in here is what makes the last pin a measurement
 * of that branch rather than of an accidentally-empty registry.
 */
function StubObjectInspector(props: Record<string, unknown>): React.ReactElement {
  const sel = props.selection as { kind?: string; id?: string } | null;
  return (
    <div
      data-testid="stub-object-inspector"
      data-for={`${String(props.type)}:${String(props.name)}:${sel?.kind}:${sel?.id}`}
    />
  );
}
registerMetadataInspector('object', StubObjectInspector as never);

afterEach(cleanup);

function mountPillar() {
  return render(
    <MemoryRouter initialEntries={['/studio/com.acme.app/interfaces']}>
      <InterfacesPillar packageId="com.acme.app" />
    </MemoryRouter>,
  );
}

/** The precondition every test here shares, stated rather than assumed. */
function expectPopulatedRegistries() {
  expect(listMetadataPreviewTypes()).toContain('dashboard');
  expect(listMetadataPreviewTypes().length).toBeGreaterThan(0);
  expect(listMetadataInspectorTypes()).toContain('object');
  // ...and the leaves under test really are studio-canvas leaves.
  expect(listStudioCanvasPreviewTypes()).toContain('object');
  expect(listStudioCanvasPreviewTypes()).toContain('report');
}

async function openLeaf(title: string) {
  mountPillar();
  fireEvent.click(await screen.findByTitle(title));
}

const bodyText = () => (document.body.textContent ?? '').replace(/\s+/g, ' ');

describe('Interfaces pillar — affordances beside a studio-canvas leaf (#7121)', () => {
  it('offers no Design/Run switch on a leaf whose canvas cannot read the mode', async () => {
    expectPopulatedRegistries();
    await openLeaf('object · showcase_task');

    // Wait on the canvas itself, not on the toggle — the toggle's ABSENCE is
    // the assertion, so waiting for it would deadlock the pin by construction.
    await waitFor(() => expect(bodyText()).toContain('Runtime list preview'), { timeout: 4000 });

    expect(screen.queryByTestId('canvas-mode-toggle')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Design' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Run' })).not.toBeInTheDocument();
  });

  it('replaces the impossible "click a block" invitation with what is true', async () => {
    expectPopulatedRegistries();
    await openLeaf('report · pipeline_report');
    await waitFor(() => expect(screen.getByTestId('stub-report-canvas')).toBeInTheDocument(), { timeout: 4000 });

    await waitFor(() =>
      expect(bodyText()).toContain('This canvas renders the running app, not a block tree'),
    );
    // ⛔ The invitation that cannot be followed must be gone.
    expect(bodyText()).not.toContain(CLICK_A_BLOCK);
    // ⛔ And this must not be mistaken for #6795 part C's empty-registry state,
    // which is demonstrably not the cause here.
    expect(bodyText()).not.toContain('No metadata designers are registered');
  });

  it('promises no recovery — there is nothing to wait for', async () => {
    expectPopulatedRegistries();
    await openLeaf('report · pipeline_report');
    await waitFor(() => expect(bodyText()).toContain('This canvas renders the running app'), {
      timeout: 4000,
    });

    // Scoped to the RAIL, not the document: on the `object` leaf this pin was
    // first taken on, the canvas beside it renders the real records grid,
    // which in jsdom (no data source) says "Error loading grid" — its own
    // honest state, and nothing this card may speak for. A document-wide scan
    // would read that as the rail promising recovery.
    const railBlock = screen.getByText(/This canvas renders the running app/).closest('div');
    const rail = railBlock?.textContent ?? '';
    // Control: the scoped read must actually have found the message.
    expect(rail).toContain('This canvas renders the running app');

    for (const promise of ['Loading', 'loading', 'try again', 'Try again', 'not yet', 'in progress']) {
      expect(rail).not.toContain(promise);
    }
  });

  it('on an object leaf, the panel edits the list view, and still invites no block click', async () => {
    expectPopulatedRegistries();
    await openLeaf('object · showcase_task');
    await waitFor(() => expect(bodyText()).toContain('Runtime list preview'), { timeout: 4000 });

    // objectui#11823 — what is true of this leaf now: its panel edits the
    // list the canvas shows. Still no block, so still no invitation to click one.
    await screen.findByTestId('studio-list-view-inspector', undefined, { timeout: 4000 });
    expect(bodyText()).not.toContain(CLICK_A_BLOCK);
    expect(bodyText()).not.toContain('This canvas renders the running app, not a block tree');
  });

  it('does not open a scoped inspector for a block selected on a DIFFERENT leaf', async () => {
    expectPopulatedRegistries();

    // Select a block on the dashboard leaf — a real selection, made through the
    // pillar's own `onSelectionChange`.
    await openLeaf('dashboard · sales_overview');
    await waitFor(() => expect(screen.getByTestId('stub-dash')).toBeInTheDocument(), {
      timeout: 4000,
    });
    fireEvent.click(screen.getByTestId('pick-block'));
    await waitFor(() => expect(screen.getByLabelText('Clear selection')).toBeInTheDocument(), {
      timeout: 4000,
    });

    // ...then walk to the studio-canvas leaf.
    //
    // ⚠️ This step's premise CHANGED under objectui#7137. When this test landed,
    // the pillar's load effect cleared `selection` only on the editable path, so
    // the selection was still live here and the two absences below measured
    // #7121's gating against it. #7137 keyed `selection` to its leaf, so it is
    // now already null on arrival and those two absences hold for that stronger
    // reason instead — belt-and-braces rather than the sole guard. Kept as-is
    // (it is still the end-to-end statement "a block picked on another leaf
    // opens nothing here"), but #7121's gating is independently pinned by the
    // three tests ABOVE, which assert it with no selection in play at all —
    // those are the ones that go red if the gate is removed or re-fenced on
    // `isEditable`.
    fireEvent.click(screen.getByTitle('object · showcase_task'));
    await waitFor(() => expect(bodyText()).toContain('Runtime list preview'), { timeout: 4000 });

    // The block belongs to another leaf's canvas and does not exist on this one.
    expect(screen.queryByTestId('stub-object-inspector')).not.toBeInTheDocument();
    // objectui#11823 — the rail holds this leaf's list-view panel instead.
    expect(await screen.findByTestId('studio-list-view-inspector', undefined, { timeout: 4000 })).toBeInTheDocument();
    // ...and the rail must not contradict itself by offering to clear a
    // selection it just said cannot exist here.
    expect(screen.queryByLabelText('Clear selection')).not.toBeInTheDocument();
  });
});

describe('REGRESSION FENCE — a leaf WITH a block canvas is untouched (#7121)', () => {
  it('still offers the Design/Run switch, and it still round-trips', async () => {
    expectPopulatedRegistries();
    await openLeaf('dashboard · sales_overview');
    await waitFor(() => expect(screen.getByTestId('canvas-mode-toggle')).toBeInTheDocument(), {
      timeout: 4000,
    });

    // #5800's acceptance: 设计⇄运行 is a round trip on the SAME renderer, and
    // `editing` is the mode the renderer actually reads.
    expect(screen.getByTestId('stub-dash')).toHaveAttribute('data-editing', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    await waitFor(() =>
      expect(screen.getByTestId('stub-dash')).toHaveAttribute('data-editing', 'false'),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Design' }));
    await waitFor(() =>
      expect(screen.getByTestId('stub-dash')).toHaveAttribute('data-editing', 'true'),
    );
  });

  it('keeps the ordinary "click a block" rail where a block canvas exists', async () => {
    expectPopulatedRegistries();
    await openLeaf('dashboard · sales_overview');
    await waitFor(() => expect(screen.getByTestId('stub-dash')).toBeInTheDocument(), {
      timeout: 4000,
    });

    // The repair must not over-fire: this leaf HAS blocks to click.
    await waitFor(() => expect(bodyText()).toContain(CLICK_A_BLOCK));
    expect(bodyText()).not.toContain('This canvas renders the running app');
  });

  it('keeps the selection affordances where a block canvas exists', async () => {
    expectPopulatedRegistries();
    await openLeaf('dashboard · sales_overview');
    await waitFor(() => expect(screen.getByTestId('stub-dash')).toBeInTheDocument(), {
      timeout: 4000,
    });

    fireEvent.click(screen.getByTestId('pick-block'));
    await waitFor(() => expect(screen.getByLabelText('Clear selection')).toBeInTheDocument());
  });
});
