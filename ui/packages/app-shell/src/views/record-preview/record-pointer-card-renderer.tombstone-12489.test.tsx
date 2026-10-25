/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The pointer face draws a platform-asserted deletion as a tombstone
 * (objectui#12489).
 *
 * `RecordPreviewCard` leaves "a deletion the platform asserts" to its caller,
 * and the pointer renderer is that caller. The real details grid
 * (`DetailSection`) resolves the pair through `resolveRecordPointer`, which
 * reads the field's `referenceDeletedWhen`; on a row that holds the declared
 * option, this renderer draws the option's own label, reads nothing and links
 * nothing.
 *
 * The object below declares `record_id` the way objectstack's `plugin-approvals`
 * does: `referenceVia: 'object_name'` and
 * `referenceDeletedWhen: { field: 'cancel_reason', value: 'record_deleted' }`.
 * Reads are counted on the adapter's own `findOne` spy; links under a host that
 * builds record URLs, so a missing link is not just a missing builder.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import { AdapterCtx, MetadataCtx, RelatedRecordActionsProvider } from '@object-ui/react';
import { I18nProvider, type I18nConfig } from '@object-ui/i18n';
import { DetailSection } from '@object-ui/plugin-detail';
import type { DetailViewSection } from '@object-ui/types';
import './record-pointer-card-renderer';

beforeAll(() => Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 }));
afterEach(() => cleanup());

const HOST_OBJECT = 'sys_approval_request';
const DELETED_LABEL = 'Related record deleted';

const REQUEST_SCHEMA = {
  fields: {
    object_name: { type: 'text', label: 'Object' },
    record_id: {
      type: 'text',
      label: 'Record',
      referenceVia: 'object_name',
      referenceDeletedWhen: { field: 'cancel_reason', value: 'record_deleted' },
    },
    cancel_reason: {
      type: 'select',
      label: 'Cancel Reason',
      options: [
        { value: 'record_deleted', label: DELETED_LABEL },
        { value: 'withdrawn', label: 'Withdrawn' },
      ],
    },
  },
};

const DEFS: Record<string, unknown> = {
  invoice: {
    name: 'invoice',
    label: 'Invoice',
    nameField: 'subject',
    highlightFields: [],
    fields: { subject: { type: 'text', label: 'Subject' } },
  },
};

function mount(data: Record<string, unknown>, wrap: (ui: React.ReactElement) => React.ReactElement = (ui) => ui) {
  const findOne = vi.fn(async (_objectName: string, id: string) => (id === 'inv_1' ? { id, subject: 'Laptop refresh' } : null));
  const metadata = {
    apps: [], objects: [], dashboards: [], reports: [], pages: [],
    loading: false, error: null,
    refresh: async () => {}, invalidate: () => {}, ensureType: async () => [],
    getItem: vi.fn(async (type: string, name: string) => (type === 'object' ? (DEFS[name] ?? null) : null)),
    getItemsByType: () => [],
    getTypeStatus: () => 'ready' as const,
  };
  const host = {
    resolve: () => ({}),
    recordHref: (objectName: string, recordId: string | number) =>
      `/apps/probe_app/${objectName}/record/${encodeURIComponent(String(recordId))}`,
    openRecord: vi.fn(),
  };
  const utils = render(
    wrap(
      <MetadataCtx.Provider value={metadata as never}>
        <AdapterCtx.Provider value={{ findOne } as never}>
          <RelatedRecordActionsProvider value={host}>
            <DetailSection
              section={{ title: 'Details', fields: [{ name: 'record_id', label: 'Record' }] } as DetailViewSection}
              data={data}
              objectSchema={REQUEST_SCHEMA}
              objectName={HOST_OBJECT}
            />
          </RelatedRecordActionsProvider>
        </AdapterCtx.Provider>
      </MetadataCtx.Provider>,
    ),
  );
  return { ...utils, findOne, getItem: metadata.getItem };
}

const DELETED_ROW = { object_name: 'invoice', record_id: 'inv_1', status: 'cancelled', cancel_reason: 'record_deleted' };

describe('the pointer face draws the platform-asserted deletion (objectui#12489)', () => {
  it("draws the tombstone in the declared option's label", () => {
    const { container } = mount(DELETED_ROW);
    const tombstone = container.querySelector('[data-record-pointer="deleted"]');
    expect(tombstone).not.toBeNull();
    expect(tombstone?.textContent).toBe(DELETED_LABEL);
  });

  it('reads nothing: no record read and no definition read for the target', async () => {
    const { findOne, getItem } = mount(DELETED_ROW);
    // Give a read that would be made a chance to land before counting.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(findOne).not.toHaveBeenCalled();
    expect(getItem).not.toHaveBeenCalled();
  });

  it('links nothing and does not mount the card, under a host that builds record links', () => {
    const { container } = mount(DELETED_ROW);
    expect(container.querySelectorAll('a[href]')).toHaveLength(0);
    expect(container.querySelector('[data-record-preview]')).toBeNull();
  });

  it('does not show the record id inside the tombstone', () => {
    const { container } = mount(DELETED_ROW);
    const tombstone = container.querySelector('[data-record-pointer="deleted"]') as HTMLElement;
    expect(tombstone.textContent).not.toContain('inv_1');
    expect(tombstone.innerHTML).not.toContain('inv_1');
  });

  it("the label goes through the grid's option translation: a localized bundle names the tombstone", async () => {
    const ZH: I18nConfig = {
      defaultLanguage: 'zh-CN',
      detectBrowserLanguage: false,
      resources: {
        'zh-CN': {
          platform: {
            objects: {},
            fieldOptions: { [HOST_OBJECT]: { cancel_reason: { record_deleted: '关联记录已删除' } } },
          },
        },
      },
    };
    const { container } = mount(DELETED_ROW, (ui) => (
      <I18nProvider config={ZH} persistLanguage={false}>{ui}</I18nProvider>
    ));
    await waitFor(() =>
      expect(container.querySelector('[data-record-pointer="deleted"]')?.textContent).toBe('关联记录已删除'),
    );
  });

  it('CONTROL: another option of the sibling draws the card and reads the target', async () => {
    const { container, findOne } = mount({ ...DELETED_ROW, cancel_reason: 'withdrawn' });
    await waitFor(() =>
      expect(container.querySelector('[data-record-preview]')?.getAttribute('data-record-preview')).toBe('readable'),
    );
    expect(container.querySelector('[data-record-pointer="deleted"]')).toBeNull();
    expect(findOne.mock.calls.map((call) => call.slice(0, 2))).toEqual([['invoice', 'inv_1']]);
  });

  it('CONTROL: an unreadable target on a row the platform did not flag stays cause-free, with no tombstone', async () => {
    const { container } = mount({ object_name: 'invoice', record_id: 'inv_404', status: 'approved' });
    await waitFor(() =>
      expect(container.querySelector('[data-record-preview]')?.getAttribute('data-record-preview')).toBe('unreadable'),
    );
    expect(container.querySelector('[data-record-pointer="deleted"]')).toBeNull();
    expect(container.textContent).not.toContain(DELETED_LABEL);
  });
});
