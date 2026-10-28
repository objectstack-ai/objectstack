/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#27052 — the record page's panel toggles: whether the timeline
 * and the related column are shown is each reader's switch, per object, with
 * a default derived from the object and never metadata.
 *
 * Measured from a real `RecordDetailView` mount (the `recordPageTiers-26678`
 * harness: the view root's measured width is the one input varied).
 *
 *  - a worked object (its status options declare lifecycle kinds) opens with
 *    three columns; switching the timeline off draws details | related with
 *    the timeline folded into a 「动态」 card, and switching it on restores;
 *  - the choice survives a remount (a reload reads the same storage) and is
 *    per object;
 *  - an object that is not worked opens with the timeline off;
 *  - `⌘⇧T` / `⌘⇧R` flip the switches, and do nothing while a text field has
 *    focus;
 *  - the toggles are drawn only in a column tier: not in the tabbed tier, not
 *    in the drawer / split pane.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MetadataCtx } from '@object-ui/react';
import { RelatedCountStore } from '@object-ui/components';

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u1', name: 'Ada', image: null }, activeOrganization: null }),
  createAuthenticatedFetch: () => vi.fn(),
}));

vi.mock('@object-ui/collaboration', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useRecordPresence: () => [],
  PresenceAvatars: () => null,
}));

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    loading: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

// Orthogonal chrome — stubbed so the only asynchrony here is the page's own.
vi.mock('./ActionConfirmDialog', () => ({ ActionConfirmDialog: () => null }));
vi.mock('./ActionParamDialog', () => ({ ActionParamDialog: () => null }));
vi.mock('./ActionResultDialog', () => ({ ActionResultDialog: () => null }));
vi.mock('./FlowRunner', () => ({ FlowRunner: () => null }));
vi.mock('./MetadataInspector', () => ({
  MetadataPanel: () => null,
  useMetadataInspector: () => ({ showDebug: false, toggle: () => {} }),
}));

import { RecordDetailView } from './RecordDetailView';

const LEAD = 'crm_lead';
const PRODUCT = 'crm_product';

const BASE_FIELDS = {
  id: { type: 'text', label: 'Id' },
  name: { type: 'text', label: 'Name' },
};

const OBJECTS = [
  {
    name: LEAD,
    label: 'Lead',
    pluralLabel: 'Leads',
    managedBy: 'platform',
    // Worked: the status options declare lifecycle kinds.
    fields: {
      ...BASE_FIELDS,
      status: {
        type: 'select',
        label: 'Status',
        options: [
          { value: 'new', label: 'New', kind: 'open' },
          { value: 'converted', label: 'Converted', kind: 'won' },
        ],
      },
    },
  },
  { name: PRODUCT, label: 'Product', pluralLabel: 'Products', managedBy: 'platform', fields: BASE_FIELDS },
  {
    name: 'crm_note',
    label: 'Note',
    pluralLabel: 'Notes',
    managedBy: 'platform',
    fields: {
      ...BASE_FIELDS,
      lead: { type: 'lookup', reference: LEAD, label: 'Lead' },
      product: { type: 'lookup', reference: PRODUCT, label: 'Product' },
    },
  },
];

let rootWidth = 0;

function makeDataSource() {
  return {
    find: vi.fn(async () => ({ data: [], total: 0 })),
    create: vi.fn(async (_o: string, row: unknown) => row),
    findOne: vi.fn(async (_o: string, recordId: string) => ({ id: recordId, name: `Record ${recordId}` })),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
  };
}

function renderPage({ object = LEAD, width = 1440, embedded = false }: { object?: string; width?: number; embedded?: boolean } = {}) {
  rootWidth = width;
  const metadata = {
    objects: OBJECTS,
    pages: [],
    loading: false,
    error: null,
    refresh: async () => {},
    invalidate: () => {},
    ensureType: async () => [],
    getItem: async () => null,
    getItemsByType: () => [],
  } as never;
  return render(
    <MemoryRouter initialEntries={[`/app/demo/${object}/r-1`]}>
      <MetadataCtx.Provider value={metadata}>
        <RecordDetailView
          dataSource={makeDataSource() as never}
          objects={OBJECTS}
          onEdit={() => {}}
          objectNameOverride={object}
          recordIdOverride="r-1"
          embedded={embedded}
        />
      </MetadataCtx.Provider>
    </MemoryRouter>,
  );
}

const shown = (container: HTMLElement) =>
  container.querySelector('[data-record-columns]')?.getAttribute('data-record-columns-shown') ?? null;
const toggle = (name: RegExp) => screen.getByRole('button', { name });
const press = (key: string, target: Element = document.body) =>
  fireEvent.keyDown(target, { key, metaKey: true, shiftKey: true, bubbles: true });

beforeEach(() => {
  cleanup();
  window.localStorage.clear();
  RelatedCountStore._reset();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'content-type': 'application/json' } }),
    ),
  );
  const measure = HTMLElement.prototype.getBoundingClientRect;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (!this.hasAttribute('data-record-page-root')) return measure.call(this);
    return { x: 0, y: 0, top: 0, left: 0, right: rootWidth, bottom: 800, width: rootWidth, height: 800, toJSON: () => ({}) } as DOMRect;
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('RecordDetailView — the panel toggles (objectstack#27052)', () => {
  it('a worked object opens with three columns; timeline off draws details | related with a folded 「动态」 card; on restores', async () => {
    const { container } = renderPage();
    const group = await screen.findByRole('group', { name: 'Panels' }, { timeout: 5000 });
    expect(group.closest('[data-record-crumb-row]')).not.toBeNull();
    expect(shown(container)).toBe('details timeline related');
    expect(toggle(/^Timeline$/).getAttribute('aria-pressed')).toBe('true');
    expect(toggle(/^Related column$/).getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(toggle(/^Timeline$/));
    await waitFor(() => expect(shown(container)).toBe('details related'));
    expect(toggle(/^Timeline$/).getAttribute('aria-pressed')).toBe('false');
    const related = container.querySelector('[data-record-column="related"]')!;
    expect(related.querySelector('[data-record-folded-timeline]')).not.toBeNull();

    fireEvent.click(toggle(/^Timeline$/));
    await waitFor(() => expect(shown(container)).toBe('details timeline related'));
    expect(container.querySelector('[data-record-folded-timeline]')).toBeNull();
  });

  it('the choice survives a remount and is per object', async () => {
    const first = renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /^Timeline$/ }, { timeout: 5000 }));
    await waitFor(() => expect(shown(first.container)).toBe('details related'));
    first.unmount();

    const again = renderPage();
    await screen.findByRole('group', { name: 'Panels' }, { timeout: 5000 });
    expect(shown(again.container)).toBe('details related');
    expect(toggle(/^Timeline$/).getAttribute('aria-pressed')).toBe('false');
    again.unmount();

    // The product's switch is its own: still its default.
    const product = renderPage({ object: PRODUCT });
    await screen.findByRole('group', { name: 'Panels' }, { timeout: 5000 });
    expect(window.localStorage.getItem(`os:pref:record.columns.timeline@object:${PRODUCT}`)).toBeNull();
    expect(shown(product.container)).toBe('details related');
  });

  it('an object that is not worked opens with the timeline off: two columns, details | related', async () => {
    const { container } = renderPage({ object: PRODUCT });
    await screen.findByRole('group', { name: 'Panels' }, { timeout: 5000 });
    expect(shown(container)).toBe('details related');
    expect(toggle(/^Timeline$/).getAttribute('aria-pressed')).toBe('false');
    expect(container.querySelector('[data-record-folded-timeline]')).not.toBeNull();
  });

  it('⌘⇧T / ⌘⇧R flip the switches; with a text field focused they do nothing', async () => {
    const { container } = renderPage();
    await screen.findByRole('group', { name: 'Panels' }, { timeout: 5000 });

    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    press('T', input);
    press('R', input);
    expect(shown(container)).toBe('details timeline related');
    input.remove();

    press('T');
    await waitFor(() => expect(shown(container)).toBe('details related'));
    press('R');
    await waitFor(() => expect(shown(container)).toBe('details'));
    expect(toggle(/^Related column$/).getAttribute('aria-pressed')).toBe('false');
    press('T');
    await waitFor(() => expect(shown(container)).toBe('details timeline'));
  });

  it('the tooltip names each shortcut, and the shortcut is announced', async () => {
    renderPage();
    await screen.findByRole('group', { name: 'Panels' }, { timeout: 5000 });
    expect(toggle(/^Timeline$/).getAttribute('aria-keyshortcuts')).toMatch(/^(Meta|Control)\+Shift\+T$/);
    expect(toggle(/^Related column$/).getAttribute('aria-keyshortcuts')).toMatch(/^(Meta|Control)\+Shift\+R$/);
  });

  it('not drawn in the tabbed tier, nor in the drawer / split pane; the shortcut does nothing there', async () => {
    const tabbed = renderPage({ width: 900 });
    expect(await screen.findByRole('tablist', undefined, { timeout: 5000 })).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Panels' })).toBeNull();
    press('T');
    expect(window.localStorage.getItem(`os:pref:record.columns.timeline@object:${LEAD}`)).toBeNull();
    tabbed.unmount();

    renderPage({ width: 1440, embedded: true });
    expect(await screen.findByRole('tablist', undefined, { timeout: 5000 })).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Panels' })).toBeNull();
  });
});
