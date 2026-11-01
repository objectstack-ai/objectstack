/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#27052 / objectstack#27524 (Target 4) — the record page's
 * right-column switch ⊟ (「右栏」): whether the right column (the 动态 panel
 * and the related panels) is drawn beside the details is each reader's
 * switch, per object, on by default and never metadata.
 *
 * Measured from a real `RecordDetailView` mount (the `recordPageTiers-26678`
 * harness: the view root's measured width is the one input varied).
 *
 *  - every object opens with the right column, worked or not: the resident
 *    timeline column, its switch and its derived default retired;
 *  - ⊟ off draws the details alone, the full width; on restores; the choice
 *    survives a remount (a reload reads the same storage) and is per object;
 *  - `⌘⇧,` flips it, matched by the physical key (Shift types `<` there) or,
 *    for an event that carries no `code`, by the character it typed
 *    (objectstack#27241), and does nothing while a text field has focus;
 *    `⌘⇧.` (the timeline column's) is no longer the page's;
 *  - ⊟ is ONE icon, named by its label, in the record's top bar
 *    (objectstack#27524, Target 7: after the step group, before ⤢ / ⤡) — not
 *    in the header's action row, which keeps the business actions, and the
 *    crumb row is gone; a record drawn with no top bar of its own (a host's
 *    plain overlay) keeps it at the end of that row (objectstack#27241);
 *  - it is drawn only where the tier has a right column: both two-column
 *    tiers, the embedded record at those widths too, never the one column;
 *  - the chord is the topmost record view's: a drawer wide enough for its
 *    own right column flips its own switch, never the page's under it.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
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
const PRICE_BOOK = 'crm_price_book';

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
  // A container: it owns its entries through their `master_detail`, and
  // declares no stage, no lifecycle kinds and no files.
  { name: PRICE_BOOK, label: 'Price Book', pluralLabel: 'Price Books', managedBy: 'platform', fields: BASE_FIELDS },
  {
    name: 'crm_price_book_entry',
    label: 'Price Book Entry',
    pluralLabel: 'Price Book Entries',
    managedBy: 'platform',
    fields: { ...BASE_FIELDS, price_book: { type: 'master_detail', reference: PRICE_BOOK, label: 'Price Book' } },
  },
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
/** A record view inside a dialog (a drawer over the page) measures this, when set. */
let dialogRootWidth: number | null = null;

function makeDataSource() {
  return {
    find: vi.fn(async () => ({ data: [], total: 0 })),
    create: vi.fn(async (_o: string, row: unknown) => row),
    findOne: vi.fn(async (_o: string, recordId: string) => ({ id: recordId, name: `Record ${recordId}` })),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
  };
}

function renderPage({
  object = LEAD,
  width = 1440,
  embedded = false,
  container,
}: { object?: string; width?: number; embedded?: boolean; container?: HTMLElement } = {}) {
  if (!container) rootWidth = width;
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
    container ? { container } : undefined,
  );
}

const shown = (container: HTMLElement) =>
  container.querySelector('[data-record-columns]')?.getAttribute('data-record-columns-shown') ?? null;
const rightColumnSwitch = () => screen.getByRole('button', { name: /^Right column$/ });
// What a browser hands the page for ⌘⇧, (and the retired ⌘⇧.) on a US
// layout: Shift types `<` / `>`, and `code` names the key itself.
const CHORD_KEYS = { related: { key: '<', code: 'Comma' }, timeline: { key: '>', code: 'Period' } } as const;
const press = (chord: keyof typeof CHORD_KEYS | { key: string; code: string }, target: Element = document.body) =>
  fireEvent.keyDown(target, {
    ...(typeof chord === 'string' ? CHORD_KEYS[chord] : chord),
    metaKey: true,
    shiftKey: true,
    bubbles: true,
  });
const RIGHT_KEY = (object: string) => `os:pref:record.columns.related@object:${object}`;

beforeEach(() => {
  cleanup();
  dialogRootWidth = null;
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
    const width = dialogRootWidth !== null && this.closest('[role="dialog"]') ? dialogRootWidth : rootWidth;
    return { x: 0, y: 0, top: 0, left: 0, right: width, bottom: 800, width, height: 800, toJSON: () => ({}) } as DOMRect;
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('RecordDetailView — the right-column switch ⊟ (objectstack#27052, objectstack#27524)', () => {
  it('one ⊟ icon at the end of the header\'s action row, on; off draws the details alone; on restores', async () => {
    const { container } = renderPage();
    const group = await screen.findByRole('group', { name: 'Panels' }, { timeout: 5000 });
    // objectstack#27524, Target 7 — in the page's top bar, among its frame
    // controls: no list context on a direct open, so no step group before it.
    const bar = group.closest('[data-record-top-bar]')!;
    expect(bar).not.toBeNull();
    expect(group.closest('[data-record-top-bar-controls]')).not.toBeNull();
    expect(bar.querySelector('[data-record-top-bar-step]')).toBeNull();
    // Not in the header's action row any more, and the crumb row is gone.
    expect(group.closest('[role="toolbar"]')).toBeNull();
    expect(container.querySelector('[data-page-header-trailing]')).toBeNull();
    expect(container.querySelector('[data-record-crumb-row]')).toBeNull();
    // The bar sits above the record header.
    const header = container.querySelector('[role="toolbar"]')!;
    expect(bar.compareDocumentPosition(header) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // ONE switch, an icon named by its label: the segmented text control and
    // the timeline segment are gone.
    expect(group.querySelectorAll('button')).toHaveLength(1);
    expect(group.querySelector('button')!.getAttribute('aria-label')).toBe('Right column');
    expect(rightColumnSwitch().textContent).toBe('');
    expect(rightColumnSwitch().getAttribute('aria-pressed')).toBe('true');
    expect(shown(container)).toBe('details right');

    fireEvent.click(rightColumnSwitch());
    await waitFor(() => expect(shown(container)).toBe('details'));
    expect(rightColumnSwitch().getAttribute('aria-pressed')).toBe('false');
    expect(container.querySelector('[data-record-column="right"]')).toBeNull();
    expect(container.querySelector('[data-record-timeline-panel]')).toBeNull();

    fireEvent.click(rightColumnSwitch());
    await waitFor(() => expect(shown(container)).toBe('details right'));
    expect(container.querySelector('[data-record-column="right"] > [data-record-timeline-panel]')).not.toBeNull();
  });

  it('the choice survives a remount and is per object', async () => {
    const first = renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /^Right column$/ }, { timeout: 5000 }));
    await waitFor(() => expect(shown(first.container)).toBe('details'));
    first.unmount();

    const again = renderPage();
    await screen.findByRole('group', { name: 'Panels' }, { timeout: 5000 });
    expect(shown(again.container)).toBe('details');
    expect(rightColumnSwitch().getAttribute('aria-pressed')).toBe('false');
    again.unmount();

    // The product's switch is its own: still on.
    const product = renderPage({ object: PRODUCT });
    await screen.findByRole('group', { name: 'Panels' }, { timeout: 5000 });
    expect(window.localStorage.getItem(RIGHT_KEY(PRODUCT))).toBeNull();
    expect(shown(product.container)).toBe('details right');
  });

  it.each([
    ['an object that is not worked', PRODUCT],
    ['an object that is only another object\'s `master_detail` parent', PRICE_BOOK],
  ])('%s opens with the right column too, 动态 first', async (_name, object) => {
    const { container } = renderPage({ object });
    await screen.findByRole('group', { name: 'Panels' }, { timeout: 5000 });
    expect(shown(container)).toBe('details right');
    expect(rightColumnSwitch().getAttribute('aria-pressed')).toBe('true');
    expect(container.querySelector('[data-record-column="right"]')?.firstElementChild?.hasAttribute('data-record-timeline-panel')).toBe(true);
  });

  it('⌘⇧, flips ⊟; with a text field focused it does nothing; ⌘⇧. is not the page\'s any more', async () => {
    const { container } = renderPage();
    await screen.findByRole('group', { name: 'Panels' }, { timeout: 5000 });

    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    press('related', input);
    expect(shown(container)).toBe('details right');
    input.remove();

    // The browser's hard reload is not the page's; nor is the retired ⌘⇧.
    press({ key: 'R', code: 'KeyR' });
    press('timeline');
    expect(shown(container)).toBe('details right');
    expect(window.localStorage.getItem(RIGHT_KEY(LEAD))).toBeNull();
    expect(window.localStorage.getItem(`os:pref:record.columns.timeline@object:${LEAD}`)).toBeNull();

    press('related');
    await waitFor(() => expect(shown(container)).toBe('details'));
    expect(rightColumnSwitch().getAttribute('aria-pressed')).toBe('false');
    press('related');
    await waitFor(() => expect(shown(container)).toBe('details right'));
  });

  it('an event that carries no `code` still flips ⊟ by the character it typed (objectstack#27241)', async () => {
    const { container } = renderPage();
    await screen.findByRole('group', { name: 'Panels' }, { timeout: 5000 });
    press({ key: '<', code: '' });
    await waitFor(() => expect(shown(container)).toBe('details'));
    press({ key: ',', code: '' });
    await waitFor(() => expect(shown(container)).toBe('details right'));
  });

  it('the two-column tier draws the same control; off, the details take the row (no rail to fall back to)', async () => {
    const { container } = renderPage({ width: 900 });
    const group = await screen.findByRole('group', { name: 'Panels' }, { timeout: 5000 });
    expect(container.querySelector('[data-record-page-tier]')?.getAttribute('data-record-page-tier')).toBe('two-column');
    expect(group.closest('[data-record-top-bar]')).not.toBeNull();
    expect(shown(container)).toBe('details right');
    fireEvent.click(rightColumnSwitch());
    await waitFor(() => expect(shown(container)).toBe('details'));
    expect(screen.queryByTestId('record-related-rail-toggle')).toBeNull();
    expect(container.querySelector('[data-record-column="right"]')).toBeNull();
  });

  it('the tooltip names the shortcut, and the shortcut is announced', async () => {
    renderPage();
    await screen.findByRole('group', { name: 'Panels' }, { timeout: 5000 });
    expect(rightColumnSwitch().getAttribute('aria-keyshortcuts')).toMatch(/^(Meta|Control)\+Shift\+,$/);
  });

  it('not drawn in the one column, where there is no right column to hide; the shortcut does nothing there. The embedded record at 1440 px has one, and draws it', async () => {
    const stacked = renderPage({ width: 700 });
    await waitFor(() => expect(stacked.container.querySelector('[data-record-page-tier]')?.getAttribute('data-record-page-tier')).toBe('stack'), { timeout: 5000 });
    expect(screen.queryByRole('group', { name: 'Panels' })).toBeNull();
    press('related');
    expect(window.localStorage.getItem(RIGHT_KEY(LEAD))).toBeNull();
    // The panels follow the details there, whatever the switch.
    expect(stacked.container.querySelector('[data-record-column="right"]')).not.toBeNull();
    stacked.unmount();

    const embedded = renderPage({ width: 1440, embedded: true });
    await screen.findByRole('group', { name: 'Panels' }, { timeout: 5000 });
    expect(shown(embedded.container)).toBe('details right');
  });

  it('⌘⇧, flips the topmost record view\'s switch alone: a 1000 px drawer over a 1440 px page (objectstack#27524)', async () => {
    // A record page keeps its own tree mounted under the drawer its rows and
    // lookups open (`RecordPageDrawerHost`), and the drawer's sheet is
    // portaled after it, to the end of the body. A drawer dragged to 1000 px
    // has a right column of its own, so both views draw ⊟: the chord is the
    // drawer's, and never writes the hidden page's stored choice.
    dialogRootWidth = 1000;
    const page = renderPage();
    await waitFor(() => expect(shown(page.container)).toBe('details right'), { timeout: 5000 });
    const sheet = document.createElement('div');
    sheet.setAttribute('role', 'dialog');
    document.body.appendChild(sheet);
    const drawer = renderPage({ object: PRODUCT, embedded: true, container: sheet });
    await waitFor(() => expect(shown(sheet)).toBe('details right'), { timeout: 5000 });
    expect(sheet.querySelector('[data-record-page-tier]')?.getAttribute('data-record-page-tier')).toBe('two-column');
    expect(within(sheet).queryByRole('group', { name: 'Panels' })).not.toBeNull();

    press('related');
    await waitFor(() => expect(shown(sheet)).toBe('details'));
    expect(window.localStorage.getItem(RIGHT_KEY(PRODUCT))).toContain('off');
    expect(shown(page.container)).toBe('details right');
    expect(window.localStorage.getItem(RIGHT_KEY(LEAD))).toBeNull();

    // The drawer closes: the chord is the page's again.
    drawer.unmount();
    sheet.remove();
    press('related');
    await waitFor(() => expect(shown(page.container)).toBe('details'));
  });
});
