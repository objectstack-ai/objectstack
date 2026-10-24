// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11823 (step 3) — the Interfaces pillar creates a page, links it from
 * the app's navigation, and opens it on its source beside a live preview
 * (objectstack `docs/design/builder-ui.md` §6: "source + live preview for
 * react / html pages").
 *
 * Pinned here, through the mounted Interfaces pillar with a metadata client
 * double, the real `SourcePageEditor` (its Monaco loader fails, so the editor
 * is its textarea) and the runtime page renderer:
 *
 *  - New page saves a draft `PageSchema` parses (an app page of the chosen
 *    source kind), saves the app document with a labelled `page` entry naming
 *    it (the whole document parses with `AppSchema`), shows the entry in the
 *    rail, and opens it: the code editor holds the page's source, and the
 *    canvas is the live preview drawing that source. objectui#12725 — the
 *    editor is in the item's definition sheet (the ⋯ menu's View definition,
 *    where the inspector's Source tab was), which a new page opens on;
 *  - a React page is written and previewed the same way;
 *  - the definition sheet opens on the new page even after the author closed
 *    an earlier page's;
 *  - an identifier another page already holds (published in any package, or a
 *    draft) is refused in the dialog and nothing is written;
 *  - CONTROLS: the New menu still offers New dashboard and New report, beside
 *    New page; a read-only package shows no New menu.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AppSchema, PageSchema } from '@objectstack/spec/ui';
// The runtime page renderer and the html tier's blocks the live preview draws
// with, registered at import (module scope, per AGENTS.md's flaky-test
// discipline).
import '@object-ui/components';

/** An existing html source page, the leaf the pillar opens first. */
const LANDING = { name: 'landing', label: 'Landing', type: 'app', kind: 'html', source: '<h1>Hi</h1>' };

const NAV = [{ id: 'nav_landing', type: 'page', label: 'Landing', pageName: 'landing' }];

let apps: Array<Record<string, unknown>>;
let published: Record<string, Array<Record<string, unknown>>>;
let draftHeaders: Array<{ type: string; name: string; packageId: string }>;
let draftRows: Record<string, Record<string, unknown>>;

const mockClient = {
  save: vi.fn(async (type: string, name: string, body: Record<string, unknown>) => {
    draftRows[`${type}:${name}`] = body;
    return { success: true, version: 'v1', state: 'draft' };
  }),
  list: vi.fn(async (type: string) => (type === 'app' ? apps : (published[type] ?? []))),
  listDrafts: vi.fn(async (opts: { type?: string } = {}) =>
    draftHeaders.filter((h) => !opts.type || h.type === opts.type),
  ),
  layered: vi.fn(async (type: string, name: string) => {
    if (type === 'app') {
      return { effective: { name: 'acme_app', label: 'Acme', active: true, navigation: NAV } };
    }
    const row = (published[type] ?? []).find((r) => r.name === name);
    return row ? { effective: row } : { code: null, overlay: null, overlayScope: null, effective: null };
  }),
  getDraft: vi.fn(async (type: string, name: string) => {
    const body = draftRows[`${type}:${name}`];
    return body ? { item: body } : null;
  }),
  get: vi.fn(async () => undefined),
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
  return { ...mod, useAdapter: () => dataSource };
});

// Monaco's loader fails (offline), so the source editor falls back to its
// textarea, which holds the same text the Monaco model would.
vi.mock('@monaco-editor/react', () => {
  const Editor = () => null;
  return { Editor, default: Editor, loader: { init: () => Promise.reject(new Error('offline')) } };
});

import { InterfacesPillar } from './StudioDesignSurface';
// The `page` resource config whose `fromDraft` the pillar's page save goes
// through, registered at load exactly as the package entry registers it.
import '../../services/builtinComponents.js';
import { createEmptyDataSource } from './__tests__/emptyDataSource';
import { registerMetadataPreview } from '../metadata-admin/preview-registry';
import { PagePreview } from '../metadata-admin/previews/PagePreview';
import { pageStarterSource } from './interfaceCreate';
import { t } from '../metadata-admin/i18n';

const dataSource = createEmptyDataSource();

registerMetadataPreview('page', PagePreview);

const STARTER = t('engine.studio.interfaces.create.pageStarter', 'en-US');

beforeEach(() => {
  apps = [{ name: 'acme_app', label: 'Acme' }];
  published = { page: [LANDING] };
  draftHeaders = [];
  draftRows = {};
  mockClient.save.mockClear();
});
afterEach(cleanup);

function mountPillar(readOnly = false) {
  return render(
    <MemoryRouter initialEntries={['/studio/com.acme.app/interfaces']}>
      <InterfacesPillar packageId="com.acme.app" readOnly={readOnly} />
    </MemoryRouter>,
  );
}

/** The right rail (the inspector's own aside). */
function rail(): HTMLElement {
  return screen.getByRole('complementary');
}

/** The pillar has loaded its app and opened the first leaf, the landing page's properties. */
async function ready() {
  await screen.findByTitle('page · landing', undefined, { timeout: 8000 });
  await within(rail()).findByTestId('source-page-properties', undefined, { timeout: 8000 });
}

/** objectui#12725 — the item's definition sheet, where its code editor lives. */
function definitionSheet(): HTMLElement {
  return screen.getByTestId('if-definition-sheet');
}

async function openNewPage() {
  await userEvent.click(await screen.findByTestId('if-create-menu'));
  await userEvent.click(await screen.findByTestId('if-create-page'));
  return screen.findByRole('dialog');
}

function typeName(dialog: HTMLElement, text: string) {
  fireEvent.change(within(dialog).getByPlaceholderText('Page name (e.g. Team handbook)'), { target: { value: text } });
}

function savesOf(type: string): Array<[string, string, Record<string, unknown>, Record<string, unknown>]> {
  return mockClient.save.mock.calls.filter((c) => c[0] === type) as never;
}

/** The new page is open: its definition sheet's code editor holds `source`, and the canvas previews it. */
async function expectOpenOnSourceAndPreview(source: string) {
  await waitFor(() =>
    expect(screen.getByTestId('if-canvas-caption')).toHaveAttribute(
      'title',
      expect.stringContaining('page · team_handbook'),
    ),
  );
  await waitFor(
    () => expect(within(definitionSheet()).getByRole('textbox', { name: 'Page source' })).toHaveValue(source),
    { timeout: 8000 },
  );
  // The live preview is the canvas, not the sheet: the runtime renderer drew
  // the starter's paragraph there.
  const preview = await screen.findByText(STARTER, undefined, { timeout: 8000 });
  expect(definitionSheet().contains(preview)).toBe(false);
  expect(screen.queryByText(/HTML page failed to compile/)).toBeNull();
}

describe('the Interfaces pillar creates a page and opens it on source plus live preview (objectui#11823 step 3)', () => {
  it('New page saves a spec-valid html page, links it from the navigation, and opens its source beside the live preview', async () => {
    mountPillar();
    await ready();
    const dialog = await openNewPage();
    typeName(dialog, 'Team handbook');
    expect(within(dialog).getByTestId('create-page-kind').textContent).toBe('HTML');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save as draft' }));

    await waitFor(() => expect(savesOf('app')).toHaveLength(1), { timeout: 8000 });

    // The page's draft: an app page of the html kind, starting from the starter.
    const [[, name, body, options]] = savesOf('page');
    expect(name).toBe('team_handbook');
    // objectui#11773 — a create is the first-write pin.
    expect(options).toEqual({ mode: 'draft', packageId: 'com.acme.app', ifNoneMatch: '*', surface: 'studio' });
    expect(body).toEqual({
      name: 'team_handbook',
      label: 'Team handbook',
      type: 'app',
      kind: 'html',
      source: pageStarterSource('html', STARTER),
    });
    const parsedPage = PageSchema.safeParse(body);
    expect(parsedPage.success, JSON.stringify(parsedPage.error?.issues)).toBe(true);

    // The entry that links it, appended to the app document the server holds,
    // with its label: a page entry inherits none.
    const [[, appName, appBody, appOptions]] = savesOf('app');
    expect(appName).toBe('acme_app');
    // objectui#11773 — the app had no pending draft when the pillar loaded it,
    // so the nav save that links the new item is the first-write pin too.
    expect(appOptions).toEqual({ mode: 'draft', packageId: 'com.acme.app', ifNoneMatch: '*', surface: 'studio' });
    expect(appBody.navigation).toEqual([
      ...NAV,
      { id: 'nav_team_handbook', type: 'page', pageName: 'team_handbook', label: 'Team handbook' },
    ]);
    const parsedApp = AppSchema.safeParse(appBody);
    expect(parsedApp.success, JSON.stringify(parsedApp.error?.issues)).toBe(true);

    expect(await screen.findByTitle('page · team_handbook')).toBeInTheDocument();
    await expectOpenOnSourceAndPreview(pageStarterSource('html', STARTER));
    // The create dialog is gone; the one dialog open is the new page's definition.
    expect(screen.getAllByRole('dialog')).toEqual([definitionSheet()]);
  });

  it('a React page is written and opened the same way', async () => {
    mountPillar();
    await ready();
    const dialog = await openNewPage();
    typeName(dialog, 'Team handbook');
    // The kind picker is the shared `Select` (objectui#11865); its list opens in
    // a portal outside the dialog.
    fireEvent.keyDown(within(dialog).getByTestId('create-page-kind'), { key: 'ArrowDown' });
    fireEvent.click(within(await screen.findByRole('listbox')).getByRole('option', { name: 'React' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save as draft' }));

    await waitFor(() => expect(savesOf('app')).toHaveLength(1), { timeout: 8000 });
    const [[, , body]] = savesOf('page');
    expect(body).toMatchObject({ type: 'app', kind: 'react', source: pageStarterSource('react', STARTER) });
    const parsedPage = PageSchema.safeParse(body);
    expect(parsedPage.success, JSON.stringify(parsedPage.error?.issues)).toBe(true);

    await expectOpenOnSourceAndPreview(pageStarterSource('react', STARTER));
  });

  it('the definition sheet opens on the new page even after the author closed an earlier page\'s', async () => {
    mountPillar();
    await ready();
    fireEvent.pointerDown(screen.getByTestId('if-item-more'), { button: 0, ctrlKey: false });
    fireEvent.click(await screen.findByTestId('if-item-view-definition'));
    await within(definitionSheet()).findByRole('textbox', { name: 'Page source' }, { timeout: 8000 });
    fireEvent.keyDown(definitionSheet(), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('if-definition-sheet')).toBeNull());

    const dialog = await openNewPage();
    typeName(dialog, 'Team handbook');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save as draft' }));

    await waitFor(() => expect(savesOf('app')).toHaveLength(1), { timeout: 8000 });
    await expectOpenOnSourceAndPreview(pageStarterSource('html', STARTER));
  });

  it('an identifier a page in another package holds is refused in the dialog, and nothing is written', async () => {
    published.page = [LANDING, { name: 'team_handbook', label: 'Their handbook', type: 'app' }];
    mountPillar();
    await ready();
    const dialog = await openNewPage();
    typeName(dialog, 'Team handbook');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save as draft' }));

    expect(
      await within(dialog).findByText('A page with the identifier “team_handbook” already exists. Choose another identifier.'),
    ).toBeInTheDocument();
    expect(mockClient.save).not.toHaveBeenCalled();
    expect(screen.queryByTitle('page · team_handbook')).toBeNull();
  });

  it('an identifier a page draft holds is refused in the dialog, and nothing is written', async () => {
    draftHeaders = [{ type: 'page', name: 'team_handbook', packageId: 'com.other.app' }];
    mountPillar();
    await ready();
    const dialog = await openNewPage();
    typeName(dialog, 'Team handbook');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save as draft' }));

    expect(
      await within(dialog).findByText('A page with the identifier “team_handbook” already exists. Choose another identifier.'),
    ).toBeInTheDocument();
    expect(mockClient.save).not.toHaveBeenCalled();
  });

  describe('controls', () => {
    // objectui#12455 — the menu is the rail's "+" kind picker: the ten nav
    // kinds, in the spec's order, and the create flow still behind Page,
    // Dashboard and Report.
    it('the New menu still offers New dashboard and New report, beside New page', async () => {
      mountPillar();
      await ready();
      await userEvent.click(await screen.findByTestId('if-create-menu'));
      const items = await screen.findAllByRole('menuitem');
      expect(items.map((i) => i.getAttribute('data-testid'))).toEqual([
        'if-add-nav-object',
        'if-create-page',
        'if-create-dashboard',
        'if-create-report',
        'if-add-nav-url',
        'if-add-nav-action',
        'if-add-nav-component',
        'if-add-nav-doc',
        'if-add-nav-group',
        'if-add-nav-separator',
      ]);
    });

    it('a read-only package shows no New menu', async () => {
      mountPillar(true);
      await ready();
      expect(screen.queryByTestId('if-create-menu')).toBeNull();
    });
  });
});
