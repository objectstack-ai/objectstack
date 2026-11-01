// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#28680 (maintainer ruling A) — the metadata editor writes app
 * navigation where a page or dashboard is created or deleted, instead of the
 * retired `NavigationSyncEffect` noticing it in a whole-list diff.
 *
 * Pins over the REAL page and the real `useNavigationWrites` door; the
 * metadata client is an in-memory stand-in whose `/layers` answer follows what
 * was published, and the app write is the adapter's `meta.saveItem` spy:
 *
 *   - create: the FIRST publish of a package-less page (its draft was its only
 *     layer) adds it to the app's navigation, once. A second publish of the
 *     same page is an update and adds no second entry;
 *   - an update of a page that already had a published layer writes nothing;
 *   - a publish bound to a package (`?package=`) writes nothing: the package
 *     ships its own navigation, as the diff's provenance rule said;
 *   - delete: a real delete (no baseline remains) removes the page's entry; a
 *     reset to a packaged baseline writes nothing.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AdapterCtx, MetadataCtx, type MetadataContextValue } from '@object-ui/react';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }));

const NAME = 'team_home';
const PAGE = {
  name: NAME,
  label: 'Team Home',
  type: 'home',
  template: 'default',
  regions: [{ name: 'main', components: [{ type: 'text', id: 'b1' }] }],
};

/** What the stand-in server holds for the page: its packaged baseline and its published row. */
const server = {
  code: null as Record<string, unknown> | null,
  overlay: null as Record<string, unknown> | null,
};

const mockClient = {
  list: vi.fn(async () => []),
  listDrafts: vi.fn(async () => []),
  layered: vi.fn(async () => {
    const effective = server.overlay ?? server.code;
    if (!effective) return { code: null, overlay: null, overlayScope: null, effective: null };
    return {
      code: server.code,
      overlay: server.overlay,
      overlayScope: server.overlay ? 'env' : null,
      effective,
      editable: true,
      deletable: true,
      resettable: server.code != null,
    };
  }),
  // A pending draft is what makes the Publish button exist at all; it stays
  // pending after a publish, so the same button can publish twice.
  getDraft: vi.fn(async () => ({ item: PAGE })),
  get: vi.fn(async () => null),
  save: vi.fn(async () => ({})),
  publish: vi.fn(async () => {
    server.overlay = PAGE;
    return { success: true, version: 1 };
  }),
  reset: vi.fn(async () => {
    server.overlay = null;
    return {};
  }),
  references: vi.fn(async () => []),
};

vi.mock('./useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./useMetadata')>();
  return {
    ...mod,
    useMetadataClient: () => mockClient,
    useMetadataTypes: () => ({
      entries: [{ type: 'page', name: 'page', label: 'Page', allowEnvironmentOverlay: true, allowRuntimeCreate: true }],
    }),
  };
});

import { MetadataResourceEditPage } from './ResourceEditPage';
import { registerMetadataPreview, getMetadataPreview } from './preview-registry';

/** Canvas stand-in: this suite is about the publish and delete doors, not the designer. */
function StubPageCanvas() {
  return <div data-testid="page-canvas" />;
}
const realPagePreview = getMetadataPreview('page');

const saveItem = vi.fn(async () => ({}));
const adapter = { getClient: () => ({ meta: { saveItem } }) } as unknown as React.ComponentProps<
  typeof AdapterCtx.Provider
>['value'];

function metaValue(apps: unknown[]): MetadataContextValue {
  return {
    apps,
    objects: [],
    dashboards: [],
    reports: [],
    pages: [],
    loading: false,
    error: null,
    refresh: async () => {},
    invalidate: () => {},
    ensureType: async () => [],
    getItem: async () => null,
    getItemsByType: () => [],
    getTypeStatus: () => 'ready',
  } as unknown as MetadataContextValue;
}

const crm = { name: 'crm', label: 'CRM', navigation: [{ id: 'n0', type: 'object', objectName: 'task' }] };

beforeEach(() => {
  for (const fn of Object.values(mockClient)) (fn as unknown as { mockClear: () => void }).mockClear();
  saveItem.mockClear();
  server.code = null;
  server.overlay = null;
  window.localStorage.setItem('metadata-admin:autosave', '0');
  registerMetadataPreview('page', StubPageCanvas as never);
});

afterEach(() => {
  cleanup();
  window.localStorage.removeItem('metadata-admin:autosave');
  if (realPagePreview) registerMetadataPreview('page', realPagePreview);
  window.history.replaceState(null, '', '/');
});

async function settle() {
  await act(async () => {
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
  });
}

/** Open the editor on the page, with `search` on both urls the page reads. */
async function openEditor(search = '', apps: unknown[] = [crm]) {
  const path = `/metadata/page/${NAME}${search}`;
  window.history.replaceState(null, '', path);
  render(
    <AdapterCtx.Provider value={adapter}>
      <MetadataCtx.Provider value={metaValue(apps)}>
        <MemoryRouter initialEntries={[path]}>
          <MetadataResourceEditPage type="page" name={NAME} />
        </MemoryRouter>
      </MetadataCtx.Provider>
    </AdapterCtx.Provider>,
  );
  await waitFor(() => expect(mockClient.layered).toHaveBeenCalled(), { timeout: 8000 });
  await settle();
}

async function publishOnce(times: number) {
  const button = await screen.findAllByRole('button', { name: /^Publish$/ }, { timeout: 8000 });
  await waitFor(() => expect(button[0]).toBeEnabled(), { timeout: 8000 });
  fireEvent.click(button[0]!);
  await waitFor(() => expect(mockClient.publish).toHaveBeenCalledTimes(times), { timeout: 8000 });
  await settle();
}

/** Every navigation the editor wrote into an app, as [app, entry types and names]. */
const written = () =>
  saveItem.mock.calls.map((call) => {
    const [, app, schema] = call as unknown as [string, string, { navigation: Record<string, unknown>[] }];
    return [app, schema.navigation.map((e) => e.pageName ?? e.objectName)];
  });

describe('ResourceEditPage writes app navigation at a page create (objectstack#28680)', () => {
  it('the first publish of a package-less page adds it to the app once; a second publish adds nothing', async () => {
    await openEditor();

    await publishOnce(1);
    await waitFor(() => expect(saveItem).toHaveBeenCalledTimes(1));
    expect(written()).toEqual([['crm', ['task', NAME]]]);
    const entry = (saveItem.mock.calls[0] as unknown as [string, string, { navigation: Record<string, unknown>[] }])[2]
      .navigation[1];
    expect(entry).toMatchObject({ type: 'page', pageName: NAME });
    expect(entry).not.toHaveProperty('label');

    // The page now holds a published layer: the next publish is an update.
    await publishOnce(2);
    expect(saveItem).toHaveBeenCalledTimes(1);
  });

  it('a publish of a page that already had a published layer writes nothing', async () => {
    server.overlay = PAGE;
    await openEditor();

    await publishOnce(1);
    expect(saveItem).not.toHaveBeenCalled();
  });

  it('a publish bound to a package writes nothing: the package ships its own navigation', async () => {
    await openEditor('?package=com.acme.crm');

    await publishOnce(1);
    expect(saveItem).not.toHaveBeenCalled();
  });
});

describe('ResourceEditPage writes app navigation at a page delete (objectstack#28680)', () => {
  const crmWithPage = {
    ...crm,
    navigation: [...crm.navigation, { id: 'n1', type: 'page', pageName: NAME }],
  };

  async function confirmResetOrDelete() {
    fireEvent.click(await screen.findByTestId('reset-or-delete-button', {}, { timeout: 8000 }));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByTestId('resource-edit-confirm-action'));
    await waitFor(() => expect(mockClient.reset).toHaveBeenCalledTimes(1), { timeout: 8000 });
    await settle();
  }

  it('a real delete (no baseline remains) removes the page from the app', async () => {
    server.overlay = PAGE;
    await openEditor('', [crmWithPage]);

    await confirmResetOrDelete();
    await waitFor(() => expect(saveItem).toHaveBeenCalledTimes(1));
    expect(written()).toEqual([['crm', ['task']]]);
  });

  it('a reset to a packaged baseline leaves navigation alone', async () => {
    server.code = PAGE;
    server.overlay = { ...PAGE, label: 'Customised' };
    await openEditor('', [crmWithPage]);

    await confirmResetOrDelete();
    expect(saveItem).not.toHaveBeenCalled();
  });
});
