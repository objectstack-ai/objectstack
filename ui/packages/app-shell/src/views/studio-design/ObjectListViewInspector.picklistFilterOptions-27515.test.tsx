// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#27515 — the list-view panel's filter offers a picklist field's
 * options and stores the option's value.
 *
 * Measured on the card: Studio, Interfaces, a list view's Filter, Add filter,
 * Status, Equals — the value was a plain text box. The author typed the label
 * they see (`New Request`), the view saved `value: 'New Request'`, and the
 * runtime list matched no record, because the stored value is `new`.
 *
 * The panel mounts the runtime `FilterBuilder`, which already draws a picklist
 * column as a picker over its options; the field catalog it was handed had
 * dropped `options` on the way (`useObjectFields`, the panel's catalog, the
 * `filter-builder` widget). The REAL hook (`useObjectListViewDraft`), the REAL
 * panel and the REAL `useObjectFields` over a REAL `MetadataClient` here, so
 * all three layers are crossed.
 *
 * Pinned:
 *  - a picklist rule's value is a picker over the field's options, showing the
 *    option's LABEL for the stored value, with no free-text box;
 *  - picking an option writes the option's VALUE (`new`, not `New Request`);
 *  - CONTROL: a number field keeps its plain value input.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MetadataCtx, type MetadataContextValue } from '@object-ui/react';
import { MetadataClient } from '@object-ui/data-objectstack';

// The builder lives inside a Radix popover, which does not open in jsdom.
// Rendering the popover parts inline is this directory's existing way of
// reaching it (`widgets.filterBuilderHeldRow-26738.test.tsx`); the rest of the
// barrel stays real — the value picker included. No JSX in the factory:
// `vi.mock` is hoisted above the imports.
vi.mock('@object-ui/components', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@object-ui/components');
  const Pass = ({ children }: { children?: unknown }) => children as never;
  return { ...actual, Popover: Pass, PopoverTrigger: Pass, PopoverContent: Pass };
});

const PKG = 'com.acme.app';
const VIEW = 'acme_work_order.default';

const OBJECT_DEF = {
  name: 'acme_work_order',
  label: 'Work Order',
  fields: {
    status: {
      name: 'status',
      label: 'Status',
      type: 'select',
      options: [
        { value: 'new', label: 'New Request' },
        { value: 'done', label: 'Completed' },
      ],
    },
    estimated_hours: { name: 'estimated_hours', label: 'Estimated Hours', type: 'number' },
  },
};

const gridView = (extra: Record<string, unknown> = {}) => ({
  name: VIEW,
  object: 'acme_work_order',
  viewKind: 'list',
  isDefault: true,
  config: { type: 'grid', data: { provider: 'object', object: 'acme_work_order' }, columns: ['status'], ...extra },
});

const server = { active: new Map<string, Record<string, unknown>>() };

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

async function serve(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const method = (init?.method ?? 'GET').toUpperCase();
  const url = new URL(String(input), 'http://studio.test');
  const meta = url.pathname.match(/^\/api\/v1\/meta\/(.+)$/);
  if (!meta) return json(404, { error: { code: 'NOT_FOUND', message: 'absent' } });
  const seg = meta[1].split('/').map(decodeURIComponent);
  const key = `${seg[0]}/${seg[1]}`;
  if (seg[0] === '_drafts') return json(200, { drafts: [] });
  if (method === 'PUT') return json(200, { success: true, version: 'v2', state: 'draft' });
  if (seg[0] === 'object' && seg.length === 2) return json(200, { type: 'object', name: seg[1], item: OBJECT_DEF });
  if (seg.length === 3 && seg[2] === 'layers') {
    const row = server.active.get(key);
    return row
      ? json(200, { code: null, overlay: row, overlayScope: 'env', effective: row })
      : json(404, { error: { code: 'NOT_FOUND', message: 'absent' } });
  }
  // No view draft is pending in this suite.
  if (seg.length === 2 && url.searchParams.get('state') === 'draft') {
    return json(404, { error: { code: 'NO_DRAFT', message: 'absent' } });
  }
  const row = server.active.get(key);
  return row ? json(200, { type: seg[0], name: seg[1], item: row }) : json(404, { error: { code: 'NOT_FOUND', message: 'absent' } });
}

const client = new MetadataClient({ baseUrl: '', fetch: vi.fn(serve) as unknown as typeof fetch });

vi.mock('../metadata-admin/useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../metadata-admin/useMetadata')>();
  return { ...mod, useMetadataClient: () => client };
});

import { ObjectListViewInspector, useObjectListViewDraft } from './ObjectListViewInspector';
import type { Surface } from './navSurface';

const METADATA: MetadataContextValue = {
  apps: [],
  objects: [OBJECT_DEF],
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
};

const LEAF: Surface = { type: 'object', name: 'acme_work_order', label: 'Work Orders' };

/** The panel, and the view item its edits leave in the buffer. */
function Host() {
  const listView = useObjectListViewDraft({ client, packageId: PKG, leaf: LEAF, publishNonce: 0 });
  return (
    <>
      <ObjectListViewInspector listView={listView} readOnly={false} locale="en" />
      <pre data-testid="buffered-row">{JSON.stringify(listView.row)}</pre>
    </>
  );
}

async function settle() {
  await act(async () => {
    for (let i = 0; i < 25; i++) await new Promise((r) => setTimeout(r, 0));
  });
}

async function openFilter(): Promise<HTMLElement> {
  render(
    <MetadataCtx.Provider value={METADATA}>
      <Host />
    </MetadataCtx.Provider>,
  );
  await settle();
  return within(screen.getByTestId('studio-list-view-inspector')).getByTestId('list-view-filter');
}

const bufferedFilter = () =>
  (JSON.parse(screen.getByTestId('buffered-row').textContent ?? 'null') as { config?: { filter?: unknown } } | null)
    ?.config?.filter;

// Radix Select opens on pointer events jsdom does not implement
// (`option-value-round-trip.test.tsx` in `@object-ui/components`).
const savedPointer = {
  PointerEvent: (window as { PointerEvent?: unknown }).PointerEvent,
  hasPointerCapture: (HTMLElement.prototype as { hasPointerCapture?: unknown }).hasPointerCapture,
  releasePointerCapture: (HTMLElement.prototype as { releasePointerCapture?: unknown }).releasePointerCapture,
};
beforeAll(() => {
  class MockPointerEvent extends Event {
    button: number;
    ctrlKey: boolean;
    pointerType: string;
    constructor(type: string, props: { button?: number; ctrlKey?: boolean; pointerType?: string } & EventInit = {}) {
      super(type, props);
      this.button = props.button ?? 0;
      this.ctrlKey = props.ctrlKey ?? false;
      this.pointerType = props.pointerType ?? 'mouse';
    }
  }
  (window as { PointerEvent?: unknown }).PointerEvent = MockPointerEvent;
  (HTMLElement.prototype as { hasPointerCapture?: unknown }).hasPointerCapture = vi.fn();
  (HTMLElement.prototype as { releasePointerCapture?: unknown }).releasePointerCapture = vi.fn();
});
afterAll(() => {
  (window as { PointerEvent?: unknown }).PointerEvent = savedPointer.PointerEvent;
  (HTMLElement.prototype as { hasPointerCapture?: unknown }).hasPointerCapture = savedPointer.hasPointerCapture;
  (HTMLElement.prototype as { releasePointerCapture?: unknown }).releasePointerCapture = savedPointer.releasePointerCapture;
});

beforeEach(() => {
  server.active.clear();
});
afterEach(cleanup);

describe('ObjectListViewInspector — a picklist filter offers the field’s options (objectstack#27515)', () => {
  it('a picklist rule’s value is a picker showing the option label for the stored value, not a text box', async () => {
    server.active.set(`view/${VIEW}`, gridView({ filter: [{ field: 'status', operator: 'equals', value: 'new' }] }));
    const filter = await openFilter();

    expect(within(filter).queryAllByPlaceholderText('Value')).toHaveLength(0);
    const pickers = within(filter).getAllByRole('combobox');
    expect(pickers.map((p) => p.textContent)).toContain('New Request');
    // Opening it is a read: nothing is written.
    expect(bufferedFilter()).toEqual([{ field: 'status', operator: 'equals', value: 'new' }]);
  });

  it('picking an option writes the option’s value, not its label', async () => {
    server.active.set(`view/${VIEW}`, gridView());
    const filter = await openFilter();

    fireEvent.click(within(filter).getByRole('button', { name: 'Add filter' }));
    // The new row starts on the first field, `status`, and offers its options.
    const valuePicker = within(filter)
      .getAllByRole('combobox')
      .find((p) => p.textContent === 'Select value');
    expect(valuePicker).toBeTruthy();
    fireEvent.pointerDown(valuePicker!, { button: 0 });
    expect(screen.getByRole('option', { name: 'Completed' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('option', { name: 'New Request' }));

    expect(bufferedFilter()).toEqual([{ field: 'status', operator: 'equals', value: 'new' }]);
  });

  it('CONTROL: a number field keeps its plain value input', async () => {
    server.active.set(`view/${VIEW}`, gridView({ filter: [{ field: 'estimated_hours', operator: 'equals', value: 4 }] }));
    const filter = await openFilter();

    const inputs = within(filter).getAllByPlaceholderText('Value') as HTMLInputElement[];
    expect(inputs).toHaveLength(1);
    expect(inputs[0].value).toBe('4');
  });
});
