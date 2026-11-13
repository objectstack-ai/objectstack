/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A2's record card is the details grid's face for a `referenceVia` pointer
 * pair (objectui#12045, B1 of objectui#2763).
 *
 * The real details grid (`DetailSection` from `@object-ui/plugin-detail`)
 * resolves the pair; this package's registration draws it as
 * `RecordPreviewCard`, which reads the target through the console's adapter.
 * Pinned on `sys_approval_request.record_id` and on a non-approval pair,
 * `sys_activity.source_id`, whose sibling column is not called `object_name`.
 *
 * States are read from the card's `data-record-preview` attribute and the
 * target from the adapter's own call log, never from copy.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { AdapterCtx, MetadataCtx, RelatedRecordActionsProvider } from '@object-ui/react';
import { getCellRenderer, RECORD_POINTER_CARD_TYPE } from '@object-ui/fields';
import { DetailSection } from '@object-ui/plugin-detail';
import type { DetailViewSection } from '@object-ui/types';
import { RecordPointerCardRenderer } from './record-pointer-card-renderer';
import { appRecordPath, routableObjectNames } from '../RelatedRecordActionsBridge';

afterEach(() => cleanup());

const DEFS: Record<string, unknown> = {
  invoice: {
    name: 'invoice',
    label: 'Invoice',
    nameField: 'subject',
    highlightFields: ['amount'],
    fields: { subject: { type: 'text', label: 'Subject' }, amount: { type: 'number', label: 'Amount' } },
  },
  sys_email: {
    name: 'sys_email',
    label: 'Email',
    nameField: 'subject',
    highlightFields: [],
    fields: { subject: { type: 'text', label: 'Subject' } },
  },
};

const RECORDS: Record<string, Record<string, unknown>> = {
  'invoice::inv_1': { id: 'inv_1', subject: 'Laptop refresh', amount: 4200 },
  'sys_email::em_7': { id: 'em_7', subject: 'Re: renewal terms' },
};

function mount(
  objectSchema: Record<string, unknown>,
  fields: string[],
  data: Record<string, unknown>,
  wrap: (ui: React.ReactElement) => React.ReactElement = (ui) => ui,
  apps: unknown[] = [],
) {
  const findOne = vi.fn(async (objectName: string, id: string) => RECORDS[`${objectName}::${id}`] ?? null);
  const metadata = {
    apps, objects: [], dashboards: [], reports: [], pages: [],
    loading: false, error: null,
    refresh: async () => {}, invalidate: () => {}, ensureType: async () => [],
    getItem: async (type: string, name: string) => (type === 'object' ? (DEFS[name] ?? null) : null),
    getItemsByType: () => [],
    getTypeStatus: () => 'ready' as const,
  };
  const utils = render(
    <MetadataCtx.Provider value={metadata as never}>
      <AdapterCtx.Provider value={{ findOne } as never}>
        {wrap(
          <DetailSection
            section={{ title: 'Details', fields: fields.map((name) => ({ name, label: name })) } as DetailViewSection}
            data={data}
            objectSchema={objectSchema}
            objectName="probe_12045"
          />,
        )}
      </AdapterCtx.Provider>
    </MetadataCtx.Provider>,
  );
  return { ...utils, findOne };
}

const cardState = (container: HTMLElement) =>
  container.querySelector('[data-record-preview]')?.getAttribute('data-record-preview');

describe('the record card is the pointer face (objectui#12045)', () => {
  it('is what the registry answers for the pointer key once this package is loaded', () => {
    expect(getCellRenderer(RECORD_POINTER_CARD_TYPE)).toBe(RecordPointerCardRenderer);
  });

  it('sys_approval_request.record_id draws the target invoice as a card', async () => {
    const { container, findOne } = mount(
      {
        fields: {
          object_name: { type: 'text', label: 'Object' },
          record_id: { type: 'text', label: 'Record', referenceVia: 'object_name' },
        },
      },
      ['record_id'],
      { object_name: 'invoice', record_id: 'inv_1' },
    );
    await waitFor(() => expect(cardState(container)).toBe('readable'));
    expect(findOne).toHaveBeenCalledTimes(1);
    expect(findOne.mock.calls[0].slice(0, 2)).toEqual(['invoice', 'inv_1']);
    expect(container.textContent).toContain('Laptop refresh');
  });

  it('a non-approval pair, sys_activity.source_id, draws the record its own sibling names', async () => {
    const { container, findOne } = mount(
      {
        fields: {
          source_object: { type: 'text', label: 'Source Object' },
          source_id: { type: 'text', label: 'Source ID', referenceVia: 'source_object' },
        },
      },
      ['source_id'],
      { source_object: 'sys_email', source_id: 'em_7', object_name: 'contact' },
    );
    await waitFor(() => expect(cardState(container)).toBe('readable'));
    expect(findOne.mock.calls.map((call) => call.slice(0, 2))).toEqual([['sys_email', 'em_7']]);
    expect(container.textContent).toContain('Re: renewal terms');
  });

  it('control: a plain text field with no referenceVia draws no card and reads nothing', async () => {
    const { container, findOne } = mount(
      { fields: { object_name: { type: 'text' }, record_id: { type: 'text', label: 'Record' } } },
      ['record_id'],
      { object_name: 'invoice', record_id: 'inv_1' },
    );
    expect(container.textContent).toContain('inv_1');
    expect(cardState(container)).toBeUndefined();
    expect(findOne).not.toHaveBeenCalled();
  });
});

describe("the pointer card's link sits in the details row without firing it (objectui#12557)", () => {
  const APPROVAL = {
    fields: {
      object_name: { type: 'text', label: 'Object' },
      record_id: { type: 'text', label: 'Record', referenceVia: 'object_name' },
    },
  };

  /** The record page's builder, reduced: one route shape, any object it can route to. */
  function underHost(ui: React.ReactElement) {
    const value = {
      resolve: () => ({}),
      recordHref: (objectName: string, recordId: string | number) =>
        `/apps/probe_app/${objectName}/record/${encodeURIComponent(String(recordId))}`,
      openRecord: vi.fn(),
    };
    return { value, ui: <RelatedRecordActionsProvider value={value}>{ui}</RelatedRecordActionsProvider> };
  }

  let writeText: ReturnType<typeof vi.fn>;
  const ownClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  beforeEach(() => {
    writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  });
  afterEach(() => {
    if (ownClipboard) Object.defineProperty(navigator, 'clipboard', ownClipboard);
    else delete (navigator as { clipboard?: unknown }).clipboard;
  });

  it('a click on the link opens the record and does not copy the row; Enter on it is not cancelled by the row', async () => {
    let host: ReturnType<typeof underHost>['value'] | null = null;
    const { container } = mount(APPROVAL, ['record_id'], { object_name: 'invoice', record_id: 'inv_1' }, (ui) => {
      const h = underHost(ui);
      host = h.value;
      return h.ui;
    });
    await waitFor(() => expect(cardState(container)).toBe('readable'));

    const link = container.querySelector('[data-record-preview] a[href]') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/apps/probe_app/invoice/record/inv_1');
    // The host this pin is about: the row is the details grid's copy button.
    expect(link.closest('[role="button"]')).not.toBeNull();

    fireEvent.click(link, { button: 0 });
    expect(host!.openRecord).toHaveBeenCalledWith('invoice', 'inv_1');
    expect(writeText).not.toHaveBeenCalled();

    expect(fireEvent.keyDown(link, { key: 'Enter' })).toBe(true);
    expect(writeText).not.toHaveBeenCalled();
  });

  it("CONTROL: the row's own copy still answers a click beside the card", async () => {
    const { container } = mount(APPROVAL, ['record_id'], { object_name: 'invoice', record_id: 'inv_1' }, (ui) => underHost(ui).ui);
    await waitFor(() => expect(cardState(container)).toBe('readable'));

    fireEvent.click(container.querySelector('[data-record-preview]')!.closest('[role="button"]')!);
    expect(writeText).toHaveBeenCalledWith('inv_1');
  });

  it('CONTROL: an unreadable target under the same host draws no link', async () => {
    const { container } = mount(APPROVAL, ['record_id'], { object_name: 'invoice', record_id: 'inv_404' }, (ui) => underHost(ui).ui);
    await waitFor(() => expect(cardState(container)).toBe('unreadable'));
    expect(container.querySelectorAll('a[href]')).toHaveLength(0);
  });
});

describe("on an approval request's page the pointer card opens the record in the app that owns it (objectstack#32667)", () => {
  const APPROVAL = {
    fields: {
      object_name: { type: 'text', label: 'Object' },
      record_id: { type: 'text', label: 'Record', referenceVia: 'object_name' },
    },
  };
  /** The app the request page was opened under: it lists another object only. */
  const CALLER = { name: 'leave', _packageId: 'com.example.leave', navigation: [{ type: 'object', objectName: 'leave_request' }] };
  /** The app that lists the request's record, one group down. */
  const OWNER = {
    name: 'finance',
    _packageId: 'com.example.finance',
    navigation: [{ type: 'group', label: 'Billing', children: [{ type: 'object', objectName: 'invoice' }] }],
  };
  const SETUP = { name: 'setup', _packageId: 'com.objectstack.setup', navigation: [{ type: 'object', objectName: 'sys_user' }] };
  const REQUEST_ROUTE = `/apps/${CALLER._packageId}/sys_approval_request/record/req_1`;
  /**
   * What the request page's bridge can route to: its route scope, the objects
   * the served page binds. The request's record is not one of them.
   */
  const PAGE_SCOPE = routableObjectNames([{ name: 'sys_approval_request' }, { name: 'sys_approval_action' }]);

  function Where() {
    const location = useLocation();
    return <output data-testid="where">{location.pathname}</output>;
  }

  /** The record page's builder over a scope, under the request page's route. */
  function underRequestPage(scope: ReadonlySet<string>) {
    const value = {
      resolve: () => ({}),
      recordHref: (objectName: string, recordId: string | number) =>
        appRecordPath(CALLER._packageId, scope, objectName, recordId),
      openRecord: vi.fn(),
    };
    const wrap = (ui: React.ReactElement) => (
      <MemoryRouter initialEntries={[REQUEST_ROUTE]}>
        <Routes>
          <Route
            path="/apps/:appName/*"
            element={
              <>
                <Where />
                <RelatedRecordActionsProvider value={value}>{ui}</RelatedRecordActionsProvider>
              </>
            }
          />
        </Routes>
      </MemoryRouter>
    );
    return { value, wrap };
  }

  let writeText: ReturnType<typeof vi.fn>;
  const ownClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  beforeEach(() => {
    writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  });
  afterEach(() => {
    if (ownClipboard) Object.defineProperty(navigator, 'clipboard', ownClipboard);
    else delete (navigator as { clipboard?: unknown }).clipboard;
  });

  async function linkOf(container: HTMLElement): Promise<HTMLAnchorElement | null> {
    await waitFor(() => expect(cardState(container)).toBe('readable'));
    return container.querySelector('[data-record-preview] a[href]');
  }

  it("the page's own bridge cannot route to the record: its scope does not hold the record's object", () => {
    expect(appRecordPath(CALLER._packageId, PAGE_SCOPE, 'invoice', 'inv_1')).toBeNull();
  });

  it("the title links to the record under the app that lists its object, not the request page's app, and opens it there", async () => {
    const page = underRequestPage(PAGE_SCOPE);
    const { container, getByTestId } = mount(APPROVAL, ['record_id'], { object_name: 'invoice', record_id: 'inv_1' }, page.wrap, [CALLER, OWNER, SETUP]);
    const link = await linkOf(container);
    expect(link?.getAttribute('href')).toBe('/apps/com.example.finance/invoice/record/inv_1');

    fireEvent.click(link!, { button: 0 });
    expect(getByTestId('where').textContent).toBe('/apps/com.example.finance/invoice/record/inv_1');
    expect(writeText).not.toHaveBeenCalled();
  });

  it('no app lists the object: the record opens under Setup, never under the unrelated app', async () => {
    const page = underRequestPage(PAGE_SCOPE);
    const { container } = mount(APPROVAL, ['record_id'], { object_name: 'invoice', record_id: 'inv_1' }, page.wrap, [CALLER, SETUP]);
    const link = await linkOf(container);
    expect(link?.getAttribute('href')).toBe('/apps/com.objectstack.setup/invoice/record/inv_1');
  });

  it("CONTROL: when the request page's app lists the object, the record opens there", async () => {
    const callerListingIt = { ...CALLER, navigation: [...CALLER.navigation, { type: 'object', objectName: 'invoice' }] };
    const page = underRequestPage(PAGE_SCOPE);
    const { container } = mount(APPROVAL, ['record_id'], { object_name: 'invoice', record_id: 'inv_1' }, page.wrap, [callerListingIt, OWNER]);
    const link = await linkOf(container);
    expect(link?.getAttribute('href')).toBe('/apps/com.example.leave/invoice/record/inv_1');
  });

  it("CONTROL: a bridge that can route to the object keeps its own link and its own open", async () => {
    const page = underRequestPage(new Set([...PAGE_SCOPE, 'invoice']));
    const { container } = mount(APPROVAL, ['record_id'], { object_name: 'invoice', record_id: 'inv_1' }, page.wrap, [CALLER, OWNER]);
    const link = await linkOf(container);
    expect(link?.getAttribute('href')).toBe('/apps/com.example.leave/invoice/record/inv_1');
    fireEvent.click(link!, { button: 0 });
    expect(page.value.openRecord).toHaveBeenCalledWith('invoice', 'inv_1');
  });
});
