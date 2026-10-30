// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0146 D2 (#28130 child 2a) — one editor per item: on a read-only
 * package, the Interfaces pillar opens a view, dashboard or report editable,
 * as this environment's overlay of the package's item.
 *
 *  - the canvas takes edits and the leaf's draft is saved through the draft
 *    door Setup's item page uses, at the package the pillar opened;
 *  - "Customized in this environment" is drawn in the item header and on the
 *    rail row only when the item's layered read serves an overlay;
 *  - the item menu's removal verb follows the envelope's tri-state
 *    `resettable`: Reset to package default, Delete, or nothing; the reset
 *    discards a pending draft first, then removes the overlay row;
 *  - the read-only mark is gone from an item edited in place, and it no
 *    longer links to Setup;
 *  - CONTROLS: a type the served registry gives no overlay, and an item whose
 *    envelope refuses the write, stay read-only; a writable package reads no
 *    envelope for the rail and offers no reset.
 *
 * The server is a double that records every write; the canvas is a stub that
 * says whether it was handed `onPatch` and patches on a click.
 */
import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const PKG = 'com.acme.crm';

type Envelope = Record<string, unknown>;

const server = vi.hoisted(() => ({
  published: new Map<string, Array<Record<string, unknown>>>(),
  envelopes: new Map<string, Record<string, unknown>>(),
  drafts: new Set<string>(),
  types: [] as Array<{ type: string; allowEnvironmentOverlay?: boolean }>,
}));

const mockClient = vi.hoisted(() => ({
  list: vi.fn(async (type: string) => server.published.get(type) ?? []),
  listDrafts: vi.fn(async () => []),
  listTypes: vi.fn(async () => ({ entries: [] })),
  get: vi.fn(async () => null),
  references: vi.fn(async () => []),
  layered: vi.fn(async (type: string, name: string) => {
    const env = server.envelopes.get(`${type}:${name}`);
    if (env) return env;
    const eff = (server.published.get(type) ?? []).find((row) => row.name === name) ?? null;
    return { code: eff, overlay: null, overlayScope: null, effective: eff, editable: true, deletable: true, resettable: true, lock: 'none' };
  }),
  getDraft: vi.fn(async (type: string, name: string) => {
    if (server.drafts.has(`${type}:${name}`)) return { name, label: 'Draft body' };
    throw Object.assign(new Error(`No pending draft exists for ${type}/${name}.`), { code: 'NO_DRAFT', status: 404 });
  }),
  save: vi.fn(async (type: string, name: string, item: unknown) => ({ type, name, item })),
  publish: vi.fn(async () => ({ success: true })),
  reset: vi.fn(async () => ({})),
}));

vi.mock('../metadata-admin/useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../metadata-admin/useMetadata')>();
  return {
    ...mod,
    useMetadataClient: () => mockClient,
    useMetadataTypes: () => ({ loading: false, error: null, entries: server.types }),
  };
});

vi.mock('@object-ui/react', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@object-ui/react')>();
  return { ...mod, useAdapter: () => ({}) };
});

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), dismiss: vi.fn() } }));

import '../../services/builtinComponents';
import { InterfacesPillar } from './StudioDesignSurface';
import { registerMetadataPreview, type MetadataPreviewProps } from '../metadata-admin/preview-registry';
import { t } from '../metadata-admin/i18n';

vi.stubGlobal(
  'fetch',
  vi.fn(async () => new Response('null', { status: 404, headers: { 'content-type': 'application/json' } })),
);

/** A canvas that says whether it may write, and writes a label on a click. */
function StubPreview({ type, name, onPatch }: MetadataPreviewProps) {
  return (
    <button
      type="button"
      data-testid="stub-canvas"
      data-writable={onPatch ? 'yes' : 'no'}
      onClick={() => onPatch?.({ label: 'Customized label' })}
    >
      {`${type}:${name}`}
    </button>
  );
}
for (const type of ['page', 'dashboard', 'report', 'view']) registerMetadataPreview(type, StubPreview);

const OVERLAY_TYPES = [
  { type: 'view', allowEnvironmentOverlay: true },
  { type: 'dashboard', allowEnvironmentOverlay: true },
  { type: 'report', allowEnvironmentOverlay: true },
  { type: 'page', allowEnvironmentOverlay: false },
];

const CUSTOMIZED = t('engine.studio.overlay.customized', 'en');
const RESET = t('engine.studio.overlay.reset', 'en');
const DELETE = t('engine.edit.delete', 'en');

/** An envelope for a packaged item: its code layer, and an overlay when `overlaid`. */
function packaged(row: Record<string, unknown>, over: Envelope = {}, overlaid = false): Envelope {
  const overlay = overlaid ? { ...row, label: `${String(row.label)} (ours)` } : null;
  return {
    code: row,
    overlay,
    overlayScope: overlaid ? 'env' : null,
    effective: overlay ?? row,
    editable: true,
    deletable: true,
    resettable: true,
    lock: 'none',
    ...over,
  };
}

const PIPELINE = { name: 'pipeline', label: 'Pipeline' };
const OPS = { name: 'ops_board', label: 'Ops Board' };
const OPEN_CASES = { name: 'crm_case.open', label: 'Open Cases', object: 'crm_case', viewKind: 'list', config: { type: 'grid', columns: ['name'] } };
const HOME = { name: 'home', label: 'Home', type: 'app' };

function seed() {
  server.published.set('report', [PIPELINE]);
  server.published.set('dashboard', [OPS]);
  server.published.set('view', [OPEN_CASES]);
  server.published.set('page', [HOME]);
  server.envelopes.set('report:pipeline', packaged(PIPELINE, {}, true));
  server.envelopes.set('dashboard:ops_board', packaged(OPS));
  server.envelopes.set('view:crm_case.open', packaged(OPEN_CASES));
}

beforeEach(() => {
  server.published.clear();
  server.envelopes.clear();
  server.drafts.clear();
  server.types = OVERLAY_TYPES;
  for (const fn of Object.values(mockClient)) (fn as unknown as { mockClear: () => void }).mockClear();
  seed();
});

afterEach(cleanup);

function renderPillar(readOnly: boolean) {
  render(
    <MemoryRouter initialEntries={[`/studio/${PKG}/interfaces`]}>
      <InterfacesPillar packageId={PKG} packageLabel="Acme CRM" readOnly={readOnly} />
    </MemoryRouter>,
  );
}

async function offNav(): Promise<HTMLElement> {
  return screen.findByTestId('if-off-nav', undefined, { timeout: 8000 });
}

/** Open a rail row by its label, and wait for its canvas. */
async function open(label: string, opened: string): Promise<HTMLElement> {
  fireEvent.click(within(await offNav()).getByRole('button', { name: new RegExp(`^${label}`) }));
  const canvas = await screen.findByText(opened, undefined, { timeout: 8000 });
  return canvas;
}

async function openMenu(): Promise<HTMLElement> {
  const trigger = await screen.findByTestId('if-item-more', undefined, { timeout: 8000 });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
  return screen.findByRole('menu');
}

describe('ADR-0146 D2 — a read-only package’s view, dashboard and report are edited in place', () => {
  it.each([
    ['Pipeline', 'report:pipeline', 'report', 'pipeline'],
    ['Ops Board', 'dashboard:ops_board', 'dashboard', 'ops_board'],
    ['Open Cases', 'view:crm_case.open', 'view', 'crm_case.open'],
  ] as const)('%s opens editable, and its edit saves a draft at the package', async (label, opened, type, name) => {
    renderPillar(true);
    const canvas = await open(label, opened);
    await waitFor(() => expect(canvas).toHaveAttribute('data-writable', 'yes'), { timeout: 8000 });
    // Edited in place: the item is not marked read-only.
    expect(screen.queryByTestId('studio-readonly-link')).toBeNull();
    fireEvent.click(canvas);
    await waitFor(() => expect(mockClient.save).toHaveBeenCalled(), { timeout: 8000 });
    const [savedType, savedName, body, options] = mockClient.save.mock.calls[0] as unknown as [string, string, Record<string, unknown>, Record<string, unknown>];
    expect([savedType, savedName]).toEqual([type, name]);
    expect(body.label).toBe('Customized label');
    expect(options).toMatchObject({ mode: 'draft', packageId: PKG });
  });

  it('the chip is drawn only where the layered read serves an overlay: header and rail row', async () => {
    renderPillar(true);
    const sections = await offNav();
    await waitFor(
      () => expect(within(sections).getAllByTestId('studio-customized-mark')).toHaveLength(1),
      { timeout: 8000 },
    );
    const marked = within(sections).getByTestId('studio-customized-mark').closest('button') as HTMLElement;
    expect(marked).toHaveAttribute('title', 'report · pipeline');
    expect(within(marked).getByText(CUSTOMIZED)).toBeInTheDocument();

    await open('Pipeline', 'report:pipeline');
    expect(await within(screen.getByTestId('if-item-header')).findByTestId('studio-customized-chip')).toHaveTextContent(CUSTOMIZED);

    await open('Ops Board', 'dashboard:ops_board');
    await waitFor(() => expect(screen.getByTestId('if-breadcrumb')).toHaveTextContent('Ops Board'));
    expect(screen.queryByTestId('studio-customized-chip')).toBeNull();
  });

  it('Reset to package default: confirmed, the pending draft goes first, then the overlay row', async () => {
    server.drafts.add('report:pipeline');
    renderPillar(true);
    await open('Pipeline', 'report:pipeline');
    const menu = await openMenu();
    const item = within(menu).getByTestId('studio-overlay-removal');
    expect(item).toHaveAttribute('data-verb', 'reset');
    expect(item).toHaveTextContent(RESET);
    fireEvent.click(item);
    const dialog = await screen.findByTestId('studio-overlay-removal-dialog');
    expect(dialog).toHaveTextContent(t('engine.studio.overlay.draftDiscarded', 'en'));
    expect(mockClient.reset).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByTestId('studio-overlay-removal-confirm'));
    await waitFor(() => expect(mockClient.reset).toHaveBeenCalledTimes(2));
    expect(mockClient.reset.mock.calls).toEqual([
      ['report', 'pipeline', { state: 'draft', packageId: PKG }],
      ['report', 'pipeline', { packageId: PKG }],
    ]);
  });

  it('the verb is the envelope’s: `resettable: false` is Delete, no opinion offers nothing', async () => {
    server.envelopes.set('report:pipeline', packaged(PIPELINE, { resettable: false }, true));
    renderPillar(true);
    await open('Pipeline', 'report:pipeline');
    const item = within(await openMenu()).getByTestId('studio-overlay-removal');
    expect(item).toHaveAttribute('data-verb', 'delete');
    expect(item).toHaveTextContent(DELETE);
    cleanup();

    server.envelopes.set('report:pipeline', packaged(PIPELINE, { resettable: undefined }, true));
    renderPillar(true);
    await open('Pipeline', 'report:pipeline');
    const menu = await openMenu();
    expect(within(menu).getByTestId('if-item-view-definition')).toBeInTheDocument();
    expect(within(menu).queryByTestId('studio-overlay-removal')).toBeNull();
  });

  it('an item with no overlay offers no removal', async () => {
    renderPillar(true);
    await open('Ops Board', 'dashboard:ops_board');
    const menu = await openMenu();
    expect(within(menu).queryByTestId('studio-overlay-removal')).toBeNull();
  });
});

describe('CONTROLS — what is not edited in place stays as it was', () => {
  it('a page (no overlay in the served registry) opens read-only, with the plain read-only mark', async () => {
    renderPillar(true);
    const canvas = await open('Home', 'page:home');
    expect(canvas).toHaveAttribute('data-writable', 'no');
    const mark = await screen.findByTestId('studio-readonly-link');
    expect(mark.tagName).toBe('SPAN');
    expect(mark).not.toHaveAttribute('href');
  });

  it('an item whose envelope refuses the write, and a registry that offers no overlay, stay read-only', async () => {
    server.envelopes.set('report:pipeline', packaged(PIPELINE, { editable: false }, true));
    renderPillar(true);
    const canvas = await open('Pipeline', 'report:pipeline');
    // The fact is still drawn; the edit is not offered.
    expect(await within(screen.getByTestId('if-item-header')).findByTestId('studio-customized-chip')).toBeInTheDocument();
    expect(canvas).toHaveAttribute('data-writable', 'no');
    expect(screen.getByTestId('studio-readonly-link')).toBeInTheDocument();
    cleanup();

    server.types = [];
    renderPillar(true);
    expect(await open('Ops Board', 'dashboard:ops_board')).toHaveAttribute('data-writable', 'no');
    fireEvent.click(screen.getByTestId('stub-canvas'));
    expect(mockClient.save).not.toHaveBeenCalled();
  });

  it('a writable package is unchanged: no envelope read for the rail, no chip, no reset', async () => {
    renderPillar(false);
    const sections = await offNav();
    const canvas = await open('Pipeline', 'report:pipeline');
    expect(canvas).toHaveAttribute('data-writable', 'yes');
    // The leaf's own load reads the open item's layers; the rail reads none.
    for (const [type, name] of mockClient.layered.mock.calls as unknown as Array<[string, string]>) {
      expect(`${type}:${name}`).toBe('report:pipeline');
    }
    expect(within(sections).queryByTestId('studio-customized-mark')).toBeNull();
    expect(screen.queryByTestId('studio-customized-chip')).toBeNull();
    expect(within(await openMenu()).queryByTestId('studio-overlay-removal')).toBeNull();
  });
});
