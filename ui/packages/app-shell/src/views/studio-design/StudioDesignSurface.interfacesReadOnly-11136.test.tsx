// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11136 — the Interfaces pillar honours a read-only package on every
 * editor it opens for a leaf: the block inspector, the default inspector, a
 * source page's code editor, and the canvas's in-place edits.
 *
 * Both of the pillar's autosaves are blocked on `readOnly`, but the block
 * inspector and the default inspector were created with a hardcoded
 * `readOnly={false}`, and the canvas and the source editor were handed the
 * pillar's `onPatch` unconditionally. On a source-loaded package
 * (`writable: false`) an edit therefore took on screen, nothing said it would
 * not persist, and nothing was saved. The Data pillar threads its real flag
 * since objectui#2259 and the Automations pillar since objectui#11124; this
 * pillar now does the same, through each editor's own documented read-only
 * contract.
 *
 * The canvas and the inspectors are the REAL registered `PagePreview`,
 * `PageBlockInspector` and `PageDefaultInspector`: the value under test is
 * what they offer the author, so none of them is stubbed. The client is a
 * server double that records every save. Every read-only case has its writable
 * control in the same file, and the control proves the edit reaches a save.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const PKG = 'com.acme.app';

const NAV = [
  { id: 'nav_home', type: 'page', label: 'Home', pageName: 'home' },
  { id: 'nav_landing', type: 'page', label: 'Landing', pageName: 'landing' },
];
const APP = { name: 'acme_app', label: 'Acme', navigation: NAV };

/** A block page: one region, one leaf block the canvas renders and can select. */
const HOME = {
  name: 'home',
  label: 'Home',
  type: 'app',
  regions: [{ name: 'main', components: [{ id: 'hello', type: 'element:text', properties: { content: 'Hello' } }] }],
};

/** A source page: no block tree, its editor is the rail's code editor. */
const LANDING = { name: 'landing', label: 'Landing', type: 'app', kind: 'html', source: '<h1>Hi</h1>' };

const server = vi.hoisted(() => ({
  active: new Map<string, Record<string, unknown>>(),
  saves: [] as Array<{ type: string; name: string; body: Record<string, unknown> }>,
}));

const mockClient = vi.hoisted(() => {
  const k = (type: string, name: string) => `${type}/${name}`;
  return {
    list: vi.fn(async (type: string) =>
      [...server.active.entries()]
        .filter(([key]) => key.startsWith(`${type}/`))
        .map(([, row]) => ({ name: row.name, label: row.label ?? row.name })),
    ),
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
      server.saves.push({ type, name, body: JSON.parse(JSON.stringify(item)) as Record<string, unknown> });
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

// Monaco's loader fails (offline), so the source editor falls back to its
// textarea, which carries the same `readOnly` the Monaco options would.
vi.mock('@monaco-editor/react', () => {
  const Editor = () => null;
  return { Editor, default: Editor, loader: { init: () => Promise.reject(new Error('offline')) } };
});

import { InterfacesPillar } from './StudioDesignSurface';
import { StudioRightSlotContext } from './studioRightSlotState';
// objectui#11357 — the `page` resource config whose `fromDraft` the pillar's page save
// goes through, registered at load exactly as the package entry registers it.
import '../../services/builtinComponents.js';
import { getMetadataResource } from '../metadata-admin/registry';
import { t } from '../metadata-admin/i18n';
import { createEmptyDataSource, failOnAbsorbedFetchError } from './__tests__/emptyDataSource';
import { registerMetadataPreview } from '../metadata-admin/preview-registry';
import { registerMetadataInspector } from '../metadata-admin/inspector-registry';
import { registerMetadataDefaultInspector } from '../metadata-admin/default-inspector-registry';
import { PagePreview } from '../metadata-admin/previews/PagePreview';
import { PageBlockInspector } from '../metadata-admin/inspectors/PageBlockInspector';
import { PageDefaultInspector } from '../metadata-admin/inspectors/PageDefaultInspector';

const dataSource = createEmptyDataSource();
failOnAbsorbedFetchError();

registerMetadataPreview('page', PagePreview);
registerMetadataInspector('page', PageBlockInspector);
registerMetadataDefaultInspector('page', PageDefaultInspector);

const key = (type: string, name: string) => `${type}/${name}`;

beforeEach(() => {
  server.active.clear();
  server.saves.length = 0;
  for (const fn of Object.values(mockClient)) (fn as unknown as { mockClear: () => void }).mockClear();
  server.active.set(key('app', APP.name), JSON.parse(JSON.stringify(APP)));
  server.active.set(key('page', HOME.name), JSON.parse(JSON.stringify(HOME)));
  server.active.set(key('page', LANDING.name), JSON.parse(JSON.stringify(LANDING)));
});

afterEach(cleanup);

const DRAFT_FOOTER = t('engine.studio.inspector.draftFooter', 'en');

/**
 * objectui#12725 — the Studio surface's right slot, reduced to what the pillar
 * reads of it: a properties target to portal into.
 */
function SlotHost({ children }: { children: React.ReactNode }) {
  const [target, setTarget] = React.useState<HTMLElement | null>(null);
  const handle = React.useMemo(
    () => ({ propsTarget: target, mode: 'props' as const, claimProps: () => () => {}, showProps: () => {} }),
    [target],
  );
  return (
    <StudioRightSlotContext.Provider value={handle}>
      {children}
      <div data-testid="studio-slot-props" ref={setTarget} />
    </StudioRightSlotContext.Provider>
  );
}

function renderPillar(readOnly: boolean, opts: { inSlot?: boolean } = {}) {
  const pillar = <InterfacesPillar packageId={PKG} readOnly={readOnly} />;
  return render(
    <MemoryRouter initialEntries={[`/studio/${PKG}/interfaces`]}>
      {opts.inSlot ? <SlotHost>{pillar}</SlotHost> : pillar}
    </MemoryRouter>,
  );
}

/** The right rail (classic layout: the inspector's own aside). */
function rail(): HTMLElement {
  return screen.getByRole('complementary');
}

/** The form controls an author types or picks into — not section toggles. */
function railControls(): HTMLElement[] {
  return Array.from(
    rail().querySelectorAll<HTMLElement>(
      'input, textarea, select, [role="combobox"], [role="switch"], [role="checkbox"]',
    ),
  );
}

function isInert(el: HTMLElement): boolean {
  const field = el as HTMLInputElement;
  return (
    field.disabled === true ||
    field.readOnly === true ||
    el.getAttribute('aria-disabled') === 'true' ||
    el.getAttribute('aria-readonly') === 'true' ||
    el.hasAttribute('data-disabled')
  );
}

/** The home page open, its default inspector (the page form) in the rail. */
async function openHome(): Promise<void> {
  await screen.findByRole('button', { name: 'Select hello' }, { timeout: 8000 });
  await waitFor(() => expect(railControls().length).toBeGreaterThan(0), { timeout: 8000 });
}

/** Select the `hello` block on the canvas; the block inspector opens in the rail. */
async function inspectHello(): Promise<HTMLElement> {
  fireEvent.click(screen.getByRole('button', { name: 'Select hello' }));
  return within(rail()).findByLabelText('ID', undefined, { timeout: 8000 });
}

/**
 * objectui#12725 — a source page's code editor is in its definition sheet (the
 * item's ⋯ menu, View definition), the one source-editor site in either layout.
 */
async function openSourceEditor(): Promise<HTMLTextAreaElement> {
  fireEvent.pointerDown(await screen.findByTestId('if-item-more', undefined, { timeout: 8000 }), {
    button: 0,
    ctrlKey: false,
  });
  fireEvent.click(await screen.findByTestId('if-item-view-definition'));
  const sheet = await screen.findByTestId('if-definition-sheet');
  const editor = await within(sheet).findByRole('textbox', { name: 'Page source' }, { timeout: 8000 });
  return editor as HTMLTextAreaElement;
}

async function openLanding(): Promise<HTMLTextAreaElement> {
  await openHome();
  fireEvent.click(screen.getByRole('button', { name: /Landing/ }));
  await within(rail()).findByTestId('source-page-properties', undefined, { timeout: 8000 });
  return openSourceEditor();
}

/** The same, with the properties in the right slot (the Studio surface's layout). */
async function openLandingInSlot(): Promise<HTMLTextAreaElement> {
  fireEvent.click(await screen.findByRole('button', { name: /Landing/ }, { timeout: 8000 }));
  await within(screen.getByTestId('studio-slot-props')).findByTestId('source-page-properties', undefined, {
    timeout: 8000,
  });
  return openSourceEditor();
}

describe('Interfaces pillar on a read-only package (objectui#11136)', () => {
  it('opens the default inspector read-only: every page-form control is disabled or read-only', async () => {
    renderPillar(true);
    await openHome();

    const controls = railControls();
    expect(controls.length).toBeGreaterThan(0);
    expect(controls.filter((el) => !isInert(el)).map((el) => el.id)).toEqual([]);
  });

  it('opens the block inspector read-only: a block still selects, and its inputs are disabled', async () => {
    renderPillar(true);
    await openHome();

    const id = await inspectHello();
    expect(id).toBeDisabled();
    const controls = railControls();
    expect(controls.length).toBeGreaterThan(1);
    expect(controls.filter((el) => !isInert(el)).map((el) => el.id)).toEqual([]);
  });

  it('offers no canvas edit: no "Add block", and the block is not draggable', async () => {
    renderPillar(true);
    await openHome();

    expect(screen.queryAllByRole('button', { name: 'Add block' })).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Select hello' })).toHaveAttribute('draggable', 'false');
  });

  // objectui#12453 — a read-only package saves no draft: the properties aside
  // does not say edits do.
  it('the properties aside carries no draft footer (objectui#12453)', async () => {
    renderPillar(true);
    await openHome();

    expect(rail()).toBeInTheDocument();
    expect(screen.queryByText(DRAFT_FOOTER)).toBeNull();
  });

  it("opens a source page's code editor read-only", async () => {
    renderPillar(true);
    const editor = await openLanding();

    expect(editor.readOnly).toBe(true);
  });

  it("opens a source page's code editor read-only with the properties in the right slot too", async () => {
    renderPillar(true, { inSlot: true });
    const editor = await openLandingInSlot();

    expect(editor.readOnly).toBe(true);
  });
});

describe('Interfaces pillar on a writable package — the control (objectui#11136)', () => {
  it('the properties aside says edits save as drafts (objectui#12453)', async () => {
    renderPillar(false);
    await openHome();

    expect(within(rail()).getByText(DRAFT_FOOTER)).toBeInTheDocument();
  });

  it('the default inspector edits, and the edit autosaves', async () => {
    renderPillar(false);
    await openHome();

    const label = within(rail()).getByLabelText(/^Label/);
    expect(label).toBeEnabled();
    expect(label).not.toHaveAttribute('readonly');
    fireEvent.change(label, { target: { value: 'Welcome' } });
    fireEvent.blur(label);

    await waitFor(() => expect(server.saves).toHaveLength(1), { timeout: 8000 });
    expect(server.saves[0]).toMatchObject({ type: 'page', name: 'home', body: { label: 'Welcome' } });
  });

  it('the canvas edits, the block inspector edits, and the edit autosaves', async () => {
    renderPillar(false);
    await openHome();
    expect(screen.getAllByRole('button', { name: 'Add block' }).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Select hello' })).toHaveAttribute('draggable', 'true');

    const id = await inspectHello();
    expect(id).toBeEnabled();
    fireEvent.change(id, { target: { value: 'greeting' } });

    await waitFor(() => expect(server.saves).toHaveLength(1), { timeout: 8000 });
    const saved = server.saves[0]!;
    expect(saved).toMatchObject({ type: 'page', name: 'home' });
    expect((saved.body.regions as Array<{ components: Array<{ id: string }> }>)[0]!.components[0]!.id).toBe('greeting');
  });

  it("a source page's code editor edits, and the edit autosaves", async () => {
    renderPillar(false);
    const editor = await openLanding();
    expect(editor.readOnly).toBe(false);

    fireEvent.change(editor, { target: { value: '<h1>Hello</h1>' } });

    await waitFor(() => expect(server.saves).toHaveLength(1), { timeout: 8000 });
    expect(server.saves[0]).toMatchObject({ type: 'page', name: 'landing', body: { source: '<h1>Hello</h1>' } });
  });

  it("a source page's code editor with the properties in the right slot edits too", async () => {
    renderPillar(false, { inSlot: true });
    const editor = await openLandingInSlot();

    expect(editor.readOnly).toBe(false);
  });
});

/**
 * objectui#11357 — the pillar's page save leaves `requires` out of the body.
 *
 * An html page's `requires` is the server's stamp (ADR-0080 §5). The pillar
 * seeds its buffer from the served document, stamp included, and a source edit
 * patches only `source`; sent whole, the old stamp reads as a hand-written
 * list, and once the source gains a plugin component the publish refuses it
 * (`page-requires-disagrees-with-source`). The pillar's page save goes through
 * the `page` registration's `fromDraft`, the serialiser the metadata editor's
 * save uses, so the server stamps the list from the source on every save.
 *
 * The call is PAGE-SCOPED: the pillar applies no `toDraft` on load, so a
 * type's `fromDraft` is safe here only where that type registers no `toDraft`.
 * The last case pins that precondition for `page`; the control pins that a
 * type outside the rule is sent as the draft it is.
 */
describe('Interfaces pillar — a page save body carries no `requires`; the server stamps it (objectui#11357)', () => {
  /** The landing page as the server stored it after a save: its `requires` is the stamp. */
  const STAMPED_LANDING = { ...LANDING, requires: ['ui'] };
  const WITH_KANBAN = '<h1>Hi</h1>\n<Kanban object="opportunity" />';

  it('a source edit that adds a plugin component autosaves with no `requires` key, and nothing else changes', async () => {
    server.active.set(key('page', LANDING.name), JSON.parse(JSON.stringify(STAMPED_LANDING)));
    renderPillar(false);
    const editor = await openLanding();

    fireEvent.change(editor, { target: { value: WITH_KANBAN } });

    await waitFor(() => expect(server.saves).toHaveLength(1), { timeout: 8000 });
    const sent = server.saves[0]!;
    expect(sent).toMatchObject({ type: 'page', name: 'landing' });
    expect(sent.body, 'the pillar sends no `requires`').not.toHaveProperty('requires');
    const { requires: _stamp, ...served } = STAMPED_LANDING;
    expect(sent.body).toStrictEqual({ ...served, source: WITH_KANBAN });
  });

  it('CONTROL: a type outside the rule is sent as the draft it is — a dashboard keeps a key named `requires`', async () => {
    const BoardCanvas = ({ onPatch }: { onPatch?: (patch: Record<string, unknown>) => void }) => (
      <button type="button" onClick={() => onPatch?.({ label: 'Pipeline board' })}>
        patch the board
      </button>
    );
    registerMetadataPreview('dashboard', BoardCanvas as never);
    const BOARD = { name: 'board', label: 'Board', requires: ['ui'], widgets: [] };
    server.active.set(key('dashboard', BOARD.name), JSON.parse(JSON.stringify(BOARD)));
    server.active.set(
      key('app', APP.name),
      { ...APP, navigation: [...NAV, { id: 'nav_board', type: 'dashboard', label: 'Board', dashboardName: 'board' }] },
    );
    renderPillar(false);
    await openHome();

    fireEvent.click(screen.getByRole('button', { name: /Board/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'patch the board' }, { timeout: 8000 }));

    await waitFor(() => expect(server.saves).toHaveLength(1), { timeout: 8000 });
    expect(server.saves[0]).toStrictEqual({ type: 'dashboard', name: 'board', body: { ...BOARD, label: 'Pipeline board' } });
  });

  it('the precondition of the page-scoped call: the `page` registration has a `fromDraft` and no `toDraft`', () => {
    const page = getMetadataResource('page');
    expect(page?.fromDraft).toBeTypeOf('function');
    // The pillar loads a page with no `toDraft`. A `toDraft` registered for
    // `page` would make its `fromDraft` that hook's inverse, and the pillar
    // would then send an editor shape it never received: revisit the pillar's
    // page save before adding one.
    expect(page?.toDraft, 'the pillar applies no `toDraft` on load').toBeUndefined();
  });
});
