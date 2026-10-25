// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12522 — the page designer for a source page (`kind: 'html'` /
 * `'react'`), and Run mode for a block-tree page.
 *
 * - The properties of an html page show what the page IS: its label
 *   (editable, and the edit autosaves), its identifier, the "Written in" kind,
 *   and every navigation entry that opens it, a nested one with its group.
 *   objectui#12725 — they are the whole aside now: no Source / Properties
 *   tabs; the code editor opens from the item's ⋯ menu (View definition).
 * - The status line under the source editor says "Saved" for the buffer as it
 *   was read, "Unsaved" once it is edited, and "Saved HH:MM" once the
 *   pillar's own save of it lands.
 * - The Design / Run switch is disabled on a source page (Run draws exactly
 *   what Design draws), and the reason is the wrapper's: a tab stop, and a
 *   visually hidden copy both buttons are described by (objectui#12303).
 * - CONTROL, a block-tree page: the switch is live, Design draws the block
 *   canvas's chrome ("Add block", the selectable block), and Run renders the
 *   page without any of it.
 *
 * The canvas and inspectors are the REAL registered page designers; the client
 * is a server double that records every save, as in the sibling
 * `StudioDesignSurface.interfacesReadOnly-11136.test.tsx`.
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
  {
    id: 'grp_help',
    type: 'group',
    label: 'Help',
    children: [{ id: 'nav_landing_again', type: 'page', label: 'Start here', pageName: 'landing' }],
  },
];
const APP = { name: 'acme_app', label: 'Acme', navigation: NAV };

/** A block page: one region, one leaf block the canvas renders and can select. */
const HOME = {
  name: 'home',
  label: 'Home',
  type: 'app',
  regions: [{ name: 'main', components: [{ id: 'hello', type: 'element:text', properties: { content: 'Hello' } }] }],
};

/** A source page: no block tree. */
const LANDING = { name: 'landing', label: 'Landing page', type: 'app', kind: 'html', source: '<h1>Hi</h1>' };

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

// Monaco's loader fails (offline), so the source editor is its textarea.
vi.mock('@monaco-editor/react', () => {
  const Editor = () => null;
  return { Editor, default: Editor, loader: { init: () => Promise.reject(new Error('offline')) } };
});

import { InterfacesPillar } from './StudioDesignSurface';
import '../../services/builtinComponents.js';
import { t, tFormat } from '../metadata-admin/i18n';
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

function renderPillar() {
  return render(
    <MemoryRouter initialEntries={[`/studio/${PKG}/interfaces`]}>
      <InterfacesPillar packageId={PKG} />
    </MemoryRouter>,
  );
}

function rail(): HTMLElement {
  return screen.getByRole('complementary');
}

/** The home page (a block page) open: the pillar lands on it. */
async function openHome(): Promise<void> {
  await screen.findByRole('button', { name: 'Select hello' }, { timeout: 8000 });
}

/** The landing page (an html page) open: its properties fill the aside. */
async function openLanding(): Promise<HTMLElement> {
  renderPillar();
  await openHome();
  fireEvent.click(screen.getByRole('button', { name: /^Landing/ }));
  return within(rail()).findByTestId('source-page-properties', undefined, { timeout: 8000 });
}

/** objectui#12725 — the code editor, opened from the item's ⋯ menu (View definition). */
async function openSource(): Promise<{ editor: HTMLTextAreaElement; sheet: HTMLElement }> {
  fireEvent.pointerDown(screen.getByTestId('if-item-more'), { button: 0, ctrlKey: false });
  fireEvent.click(await screen.findByTestId('if-item-view-definition'));
  const sheet = await screen.findByTestId('if-definition-sheet');
  const editor = await within(sheet).findByRole('textbox', { name: 'Page source' }, { timeout: 8000 });
  return { editor: editor as HTMLTextAreaElement, sheet };
}

function modeButtons(): { design: HTMLElement; run: HTMLElement } {
  const toggle = screen.getByTestId('canvas-mode-toggle');
  return {
    design: within(toggle).getByRole('button', { name: 'Design' }),
    run: within(toggle).getByRole('button', { name: 'Run' }),
  };
}

describe('Interfaces pillar — a source page (objectui#12522)', () => {
  it("the properties list the page's label, identifier, kind and the navigation entries that open it", async () => {
    const props = await openLanding();
    // objectui#12725 — no Source / Properties tab strip over them.
    expect(within(rail()).queryAllByRole('tab')).toHaveLength(0);

    expect(within(props).getByLabelText(t('engine.studio.if.pageProps.label', 'en'))).toHaveValue('Landing page');
    expect(within(props).getByTestId('source-page-identifier')).toHaveTextContent('landing');
    expect(within(props).getByTestId('source-page-kind')).toHaveTextContent(
      t('engine.studio.interfaces.create.pageKindHtml', 'en'),
    );
    const entries = within(within(props).getByTestId('source-page-nav-entries')).getAllByRole('listitem');
    expect(entries.map((li) => li.getAttribute('data-nav-id'))).toEqual(['nav_landing', 'nav_landing_again']);
    expect(entries[1]).toHaveTextContent('Help › Start here');
    // The page that is not this one is not listed.
    expect(within(props).queryByText('Home')).toBeNull();
  });

  it('a label edit in the properties autosaves, and the status line moves from Unsaved to Saved HH:MM', async () => {
    await openLanding();
    const label = await within(rail()).findByLabelText(t('engine.studio.if.pageProps.label', 'en'));
    fireEvent.change(label, { target: { value: 'Welcome' } });

    await waitFor(() => expect(server.saves).toHaveLength(1), { timeout: 8000 });
    expect(server.saves[0]).toMatchObject({ type: 'page', name: 'landing', body: { label: 'Welcome', kind: 'html' } });

    const { sheet } = await openSource();
    await waitFor(() => expect(within(sheet).getByTestId('source-page-status')).toHaveAttribute('data-state', 'saved'));
    expect(within(sheet).getByTestId('source-page-status').textContent).toMatch(/^Saved \d{1,2}:\d{2}/);
  });

  it('a source edit reads Unsaved until its save lands', async () => {
    await openLanding();
    const { editor, sheet } = await openSource();
    expect(within(sheet).getByTestId('source-page-status')).toHaveTextContent(t('engine.studio.if.pageSaved', 'en'));
    fireEvent.change(editor, { target: { value: '<h1>Hello</h1>' } });
    expect(within(sheet).getByTestId('source-page-status')).toHaveTextContent(t('engine.studio.if.pageUnsaved', 'en'));
    await waitFor(() => expect(server.saves).toHaveLength(1), { timeout: 8000 });
  });

  it('the Design / Run switch is disabled, and says why through a focusable wrapper (objectui#12303 pattern)', async () => {
    await openLanding();

    const { design, run } = modeButtons();
    expect(design).toBeDisabled();
    expect(run).toBeDisabled();
    const reason = screen.getByTestId('canvas-mode-reason');
    expect(reason).toHaveClass('sr-only');
    expect(reason).toHaveTextContent(
      tFormat('engine.studio.if.modeSourcePage', 'en', { kind: t('engine.studio.interfaces.create.pageKindHtml', 'en') }),
    );
    expect(design).toHaveAttribute('aria-describedby', reason.id);
    expect(run).toHaveAttribute('aria-describedby', reason.id);
    const wrapper = reason.closest('[data-disabled-reason]') as HTMLElement;
    expect(wrapper).toHaveAttribute('tabindex', '0');
    expect(wrapper).toHaveAttribute('aria-describedby', reason.id);
  });
});

describe('Interfaces pillar — Run mode of a block-tree page (objectui#12522 control)', () => {
  it('Design draws the block canvas chrome; Run renders the page without it, through a live switch', async () => {
    renderPillar();
    await openHome();

    const { design, run } = modeButtons();
    expect(design).toBeEnabled();
    expect(run).toBeEnabled();
    expect(screen.queryByTestId('canvas-mode-reason')).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Add block' }).length).toBeGreaterThan(0);

    fireEvent.click(run);

    await waitFor(() => expect(screen.queryByRole('button', { name: 'Select hello' })).toBeNull(), { timeout: 8000 });
    expect(screen.queryAllByRole('button', { name: 'Add block' })).toHaveLength(0);
    expect(await screen.findByText('Hello', undefined, { timeout: 8000 })).toBeInTheDocument();
  });
});
