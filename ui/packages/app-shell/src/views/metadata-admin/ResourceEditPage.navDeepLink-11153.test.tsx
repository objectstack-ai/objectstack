// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11153 — the metadata editor's copy of the `?sel=nav:ID` deep link
 * (objectui#2272) survives the page's mount and selects that nav item.
 *
 * This page carried the same two effects as Studio's Interfaces pillar, with
 * the same defect: the URL mirror is keyed on the selection, so its mount pass
 * ran with no selection and deleted `sel` before the item's draft had loaded,
 * and the apply effect then found nothing to apply. Both copies now go through
 * one hook (`useNavSelDeepLink`), and the pins here are the pillar's pins.
 *
 * Applying the link reads the item's write state. On an item this page cannot
 * write, the link selects the nav item WITHOUT entering editing: this page does
 * render a selection outside editing (the preview marks the row, and the
 * inspector opens on it read-only), so here "selects without editing" is on
 * screen, not only in the URL.
 *
 * The preview and the inspector are the REAL registered `AppPreview` and
 * `AppNavInspector`; only the metadata client is a double.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';

const NAV = [
  { id: 'nav_home', type: 'page', label: 'Home menu', pageName: 'home' },
  { id: 'nav_landing', type: 'page', label: 'Landing menu', pageName: 'landing' },
];
const APP = { name: 'acme_app', label: 'Acme', navigation: NAV };

/** Which tier the `app` type answers for: writable (org override) or not. */
const typeTier = vi.hoisted(() => ({ writable: true }));

const mockClient = vi.hoisted(() => ({
  list: vi.fn(async () => []),
  listDrafts: vi.fn(async () => []),
  get: vi.fn(async () => null),
  getDraft: vi.fn(async () => null),
  references: vi.fn(async () => []),
  // Installed per test in `beforeEach` (the app is not in scope in a hoisted block).
  layered: vi.fn(async (): Promise<Record<string, unknown>> => ({})),
  save: vi.fn(async () => ({})),
}));

vi.mock('./useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./useMetadata')>();
  return {
    ...mod,
    useMetadataClient: () => mockClient,
    useMetadataTypes: () => ({
      loading: false,
      error: null,
      entries: [
        {
          type: 'app',
          name: 'app',
          label: 'App',
          allowEnvironmentOverlay: typeTier.writable,
          allowRuntimeCreate: typeTier.writable,
        },
      ],
    }),
  };
});

import { MetadataResourceEditPage } from './ResourceEditPage';
import { registerMetadataPreview } from './preview-registry';
import { registerBuiltinInspectors } from './inspectors';
import { AppPreview } from './previews/AppPreview';

registerMetadataPreview('app', AppPreview);
registerBuiltinInspectors();

beforeEach(() => {
  typeTier.writable = true;
  mockClient.layered.mockImplementation(async () => ({
    code: null,
    overlay: JSON.parse(JSON.stringify(APP)),
    overlayScope: 'env',
    effective: JSON.parse(JSON.stringify(APP)),
    provenance: 'org',
    editable: true,
    deletable: true,
    lock: 'none',
  }));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/** Renders the router's live `search`, so a pin reads the URL the mirror wrote. */
function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location-search">{location.search}</output>;
}

function selParam(): string | null {
  return new URLSearchParams(screen.getByTestId('location-search').textContent ?? '').get('sel');
}

function renderEditor(sel: string) {
  return render(
    <MemoryRouter initialEntries={[`/metadata/app/${APP.name}?sel=${encodeURIComponent(sel)}`]}>
      <MetadataResourceEditPage type="app" name={APP.name} />
      <LocationProbe />
    </MemoryRouter>,
  );
}

/** The item's draft has loaded: the preview lists its nav items. */
async function draftLoaded(): Promise<void> {
  await screen.findAllByText('Landing menu', undefined, { timeout: 8000 });
  await waitFor(() => expect(mockClient.layered).toHaveBeenCalled());
  await new Promise((r) => setTimeout(r, 50));
}

/** Editing is on: the app preview is in design mode, whose nav canvas alone offers "Add nav item". */
function editingOpen(): boolean {
  return screen.queryAllByRole('button', { name: /Add nav item/ }).length > 0;
}

/**
 * The nav-item inspector's Label field, when `AppNavInspector` is open on a nav
 * item (found through its own close button, so the no-selection form, which
 * also lists the nav labels, is never mistaken for it); null when it is not.
 */
function inspectorLabel(): HTMLInputElement | null {
  const close = screen.queryByRole('button', { name: 'Close nav item' });
  const shell = close?.closest('div.flex.h-full.flex-col') as HTMLElement | null;
  return shell ? (within(shell).getByLabelText('Label') as HTMLInputElement) : null;
}

describe('ResourceEditPage — a `?sel=nav:ID` link on a writable app (objectui#11153)', () => {
  it('opens editing on that item once the draft loads, and the URL keeps the param', async () => {
    renderEditor('nav:nav_landing');

    await waitFor(() => expect(inspectorLabel()).not.toBeNull(), { timeout: 8000 });
    // Open on the LINKED item, not on the first one.
    expect(inspectorLabel()).toHaveValue('Landing menu');
    expect(inspectorLabel()).toBeEnabled();
    expect(editingOpen()).toBe(true);
    expect(selParam()).toBe('nav:nav_landing');
  });

  it('an unknown id changes nothing: no nav item is selected, and the param is left as it was', async () => {
    renderEditor('nav:nav_missing');

    await draftLoaded();
    expect(inspectorLabel()).toBeNull();
    expect(selParam()).toBe('nav:nav_missing');
  });
});

describe('ResourceEditPage — a `?sel=nav:ID` link on an app this page cannot write (objectui#11153)', () => {
  beforeEach(() => {
    typeTier.writable = false;
  });

  it('selects the item without entering editing: the inspector opens on it read-only, and the URL keeps the param', async () => {
    renderEditor('nav:nav_landing');

    await waitFor(() => expect(inspectorLabel()).not.toBeNull(), { timeout: 8000 });
    expect(inspectorLabel()).toHaveValue('Landing menu');
    expect(inspectorLabel()).toBeDisabled();
    expect(editingOpen()).toBe(false);
    expect(selParam()).toBe('nav:nav_landing');
  });

  it('an unknown id changes nothing here either', async () => {
    renderEditor('nav:nav_missing');

    await draftLoaded();
    expect(inspectorLabel()).toBeNull();
    expect(editingOpen()).toBe(false);
    expect(selParam()).toBe('nav:nav_missing');
  });
});
