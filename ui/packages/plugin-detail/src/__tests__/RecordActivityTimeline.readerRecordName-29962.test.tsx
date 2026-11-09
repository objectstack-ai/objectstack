/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The activity feed names the page record as the READER reads it
 * (objectstack#29962).
 *
 * Found by an app whose child objects are named by a formula `display_name`
 * over `label(record.FIELD)`: the record H1 follows the reader's locale, the
 * activity panel did not. plugin-audit stores `sys_activity.record_label` (and
 * interpolates the same text, quoted, into `summary`) when the write happens,
 * in the writer's language; the server composes the rest of the summary in
 * the reader's language on read, but the name stays the writer's. So an en-US
 * reader of a review a zh-CN user created read
 * `Created Review "法务 · Legal Counsel 1"`.
 *
 * Real subjects: `activityRowToFeedItem` (the mapper the record page and the
 * `record:activity` block both use) and `RecordActivityTimeline` under the
 * page's `RecordContextProvider`. The rows are `sys_activity` rows as the
 * reader is served them: `summary` in the reader's language around the
 * writer's name, `record_label` the writer's name.
 */

import * as React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import type { FeedItem } from '@object-ui/types';
import { RecordContextProvider } from '@object-ui/react';
import { RecordActivityTimeline } from '../RecordActivityTimeline';
import {
  activityRowToFeedItem,
  readerRecordNameOf,
  readerRecordSummary,
  withReaderRecordName,
  type SysActivityRow,
} from '../renderers/recordActivityFeed';

afterEach(cleanup);

/** A child object named by a formula over `label(...)`, as the app declares it. */
const REVIEW_SCHEMA = {
  name: 'clm_review',
  label: 'Review',
  nameField: 'display_name',
  fields: {
    display_name: { name: 'display_name', type: 'formula', label: 'Name' },
    role: { name: 'role', type: 'select', label: 'Role' },
    reviewer: { name: 'reviewer', type: 'text', label: 'Reviewer' },
  },
};

/** The same object named by a stored text field. */
const PLAIN_SCHEMA = {
  ...REVIEW_SCHEMA,
  fields: { ...REVIEW_SCHEMA.fields, display_name: { name: 'display_name', type: 'text', label: 'Name' } },
};

const WRITER_NAME = '法务 · Legal Counsel 1';
const READER_NAME = 'Legal · Legal Counsel 1';

/** The review as the en-US reader's page read it: the formula composed in the reader's language. */
const READER_RECORD = { id: 'rv-1', display_name: READER_NAME, role: 'legal', reviewer: 'Legal Counsel 1' };

function row(over: Partial<SysActivityRow> = {}): SysActivityRow {
  return {
    id: 'act-1',
    type: 'created',
    summary: `Created Review "${WRITER_NAME}"`,
    timestamp: '2026-11-03T08:00:00.000Z',
    actor_id: { id: 'u-li', name: 'Li Wei' },
    object_name: 'clm_review',
    record_id: 'rv-1',
    record_label: WRITER_NAME,
    ...over,
  };
}

function itemsOf(...rows: SysActivityRow[]): FeedItem[] {
  return rows.map((r) => activityRowToFeedItem(r, 'System')).filter((i): i is FeedItem => i !== null);
}

function mount(
  items: FeedItem[],
  opts: { schema?: unknown; record?: unknown; variant?: 'panel' | 'stream' | 'peek' } = {},
) {
  return render(
    <RecordContextProvider
      objectName="clm_review"
      recordId="rv-1"
      objectSchema={opts.schema ?? REVIEW_SCHEMA}
      data={opts.record ?? READER_RECORD}
    >
      <RecordActivityTimeline items={items} variant={opts.variant} />
    </RecordContextProvider>,
  );
}

describe('the activity feed names the record as the reader reads it (objectstack#29962)', () => {
  for (const variant of ['panel', 'stream', 'peek'] as const) {
    it(`an en-US reader of a row a zh-CN user wrote reads the H1's name (${variant})`, () => {
      const { container } = mount(itemsOf(row()), { variant });
      expect(container.textContent).toContain(`Created Review "${READER_NAME}"`);
      expect(container.textContent).not.toContain(WRITER_NAME);
    });
  }

  it("a system update's row names the record in the reader's language", () => {
    const { container } = mount(
      itemsOf(
        row({
          id: 'act-2',
          type: 'updated',
          actor_id: null,
          summary: '更新了 合同版本 "v6 · Clean"',
          record_label: 'v6 · Clean',
        }),
      ),
      { record: { ...READER_RECORD, display_name: 'v6 · 清洁稿' } },
    );
    expect(container.textContent).toContain('更新了 合同版本 "v6 · 清洁稿"');
    expect(container.textContent).not.toContain('v6 · Clean');
  });

  it('a ja-JP summary quotes the name in 「」 and is answered the same way', () => {
    const { container } = mount(itemsOf(row({ summary: `レビュー「${WRITER_NAME}」を作成しました` })));
    expect(container.textContent).toContain(`レビュー「${READER_NAME}」を作成しました`);
  });

  it('an object named by a stored field keeps the stored name: a rename does not rewrite older rows', () => {
    const { container } = mount(itemsOf(row({ summary: 'Created Review "Old name"', record_label: 'Old name' })), {
      schema: PLAIN_SCHEMA,
      record: { ...READER_RECORD, display_name: 'New name' },
    });
    expect(container.textContent).toContain('Created Review "Old name"');
    expect(container.textContent).not.toContain('New name');
  });

  it("a row about another record keeps that record's name", () => {
    const { container } = mount(itemsOf(row({ record_id: 'rv-2', summary: 'Created Review "Other"', record_label: 'Other' })));
    expect(container.textContent).toContain('Created Review "Other"');
  });

  it('a timeline with no record around it draws the summary as served', () => {
    const { container } = render(<RecordActivityTimeline items={itemsOf(row())} />);
    expect(container.textContent).toContain(`Created Review "${WRITER_NAME}"`);
  });

  it('a page whose record has no name to show keeps the stored one', () => {
    const { container } = mount(itemsOf(row()), { record: { ...READER_RECORD, display_name: '' } });
    expect(container.textContent).toContain(`Created Review "${WRITER_NAME}"`);
  });

  it('the summary is the only text touched: actor and activity row stay as served', () => {
    mount(itemsOf(row()));
    expect(screen.getAllByText('Li Wei').length).toBeGreaterThan(0);
  });
});

describe('the pure half (objectstack#29962)', () => {
  it('readerRecordNameOf answers a formula name field only, on the page record', () => {
    expect(readerRecordNameOf(REVIEW_SCHEMA, READER_RECORD, 'rv-1')).toEqual({ recordId: 'rv-1', name: READER_NAME });
    expect(readerRecordNameOf(PLAIN_SCHEMA, READER_RECORD, 'rv-1')).toBeNull();
    expect(readerRecordNameOf(REVIEW_SCHEMA, READER_RECORD, null)).toBeNull();
    expect(readerRecordNameOf(undefined, READER_RECORD, 'rv-1')).toBeNull();
    expect(readerRecordNameOf(REVIEW_SCHEMA, undefined, 'rv-1')).toBeNull();
  });

  it('readerRecordSummary replaces the first quoted stored name and nothing else', () => {
    expect(readerRecordSummary('Updated Review "A": Name', 'A', 'B')).toBe('Updated Review "B": Name');
    // Unquoted text equal to the name (a field-change value) is not the name.
    expect(readerRecordSummary('Name: A → C', 'A', 'B')).toBe('Name: A → C');
    expect(readerRecordSummary('Created Review "A"', 'A', 'A')).toBe('Created Review "A"');
  });

  it('withReaderRecordName hands back the same feed when no row changes', () => {
    const items = itemsOf(row({ summary: `Created Review "${READER_NAME}"`, record_label: READER_NAME }));
    expect(withReaderRecordName(items, { recordId: 'rv-1', name: READER_NAME })).toBe(items);
    expect(withReaderRecordName(items, null)).toBe(items);
  });

  it('a row with no stored record columns carries nothing to replace', () => {
    const items = itemsOf(row({ record_id: undefined, record_label: undefined }));
    expect(withReaderRecordName(items, { recordId: 'rv-1', name: READER_NAME })).toBe(items);
  });
});
