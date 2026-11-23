/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#36290, part ③ — one field's change history, opened in place.
 *
 * 1. The card lists only that field's changes on the record, newest first:
 *    who, when, old → new in the reader's words (an option by its label), ten
 *    at a time with "Load more".
 * 2. It reads the record's activity by record, never by a change column, and
 *    pages past rows of other fields until it finds the field's changes.
 * 3. A field never changed: 「No changes recorded」 and who created the record.
 * 4. A refused read says so.
 * 5. The record page's field offers it only for a field of the object the
 *    reader may read: a field the reader may not read has no entry.
 * 6. One open, and each "Load more", reads a bounded number of batches; a
 *    rarely-changed field on a busy record stops there and offers "Load more".
 * 7. A field whose old → new values the writer never records (history off on
 *    the field or the object, a default-off type, a credential) has no entry.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent, within } from '@testing-library/react';
import '@testing-library/jest-dom';

const permissions = vi.hoisted(() => ({ denied: new Set<string>() }));
vi.mock('@object-ui/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/permissions')>();
  return {
    ...actual,
    usePermissions: () => ({
      ...actual.usePermissions(),
      isLoaded: true,
      checkField: (_object: string, field: string) => !permissions.denied.has(field),
    }),
  };
});

import { RecordContextProvider } from '@object-ui/react';
import {
  FieldHistoryCard,
  FIELD_HISTORY_PAGE_SIZE,
  FIELD_HISTORY_SCAN_BATCH,
  FIELD_HISTORY_SCAN_BATCHES_PER_LOAD,
} from '../FieldHistory';
import { DetailSection } from '../DetailSection';

afterEach(() => {
  cleanup();
  permissions.denied.clear();
});

const OBJECT = 'crm_account';
const SCHEMA = {
  name: OBJECT,
  fields: {
    notes: { type: 'textarea', label: 'Customer notes' },
    phone: { type: 'phone', label: 'Phone' },
    stage: {
      type: 'select',
      label: 'Stage',
      options: [
        { value: 'prospect', label: 'Prospect' },
        { value: 'won', label: 'Closed won' },
      ],
    },
  },
};

type Side = Record<string, unknown>;
/** An `updated` row as plugin-audit serves it: the field-change code narrowed to the reader. */
const updated = (id: string, at: string, actor: string, changes: Array<{ field: string; from: Side; to: Side }>) => ({
  id,
  type: 'updated',
  summary: 'stored summary',
  timestamp: at,
  actor_name: actor,
  metadata: JSON.stringify({ summary_message: { key: 'fieldChanges', object: OBJECT, changes } }),
});
const created = (at: string, actor: string) => ({ id: 'c0', type: 'created', summary: 'Created', timestamp: at, actor_name: actor });

/** A data source whose `sys_activity` read pages `rows` (newest first) by `$skip` / `$top`. */
function pagingSource(rows: unknown[], fail?: unknown) {
  return {
    find: vi.fn(async (_object: string, params: { $skip?: number; $top?: number }) => {
      if (fail) throw fail;
      const skip = params.$skip ?? 0;
      return { data: rows.slice(skip, skip + (params.$top ?? rows.length)) };
    }),
  };
}

const mountCard = (source: ReturnType<typeof pagingSource>, field = 'notes') =>
  render(
    <FieldHistoryCard dataSource={source as any} objectName={OBJECT} recordId="rec-1" field={field} objectSchema={SCHEMA} />,
  );

const entriesOf = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('[data-field-history-entry]')).map((entry) => ({
    actor: entry.querySelector('[data-field-history-actor]')?.textContent,
    old: entry.querySelector('[data-field-change-side="old"]')?.textContent,
    new: entry.querySelector('[data-field-change-side="new"]')?.textContent,
  }));

describe('FieldHistoryCard — one field\'s changes (objectstack#36290)', () => {
  it('lists only this field\'s changes, newest first: who, when, old → new; a save of two fields gives this one\'s line', async () => {
    const source = pagingSource([
      updated('u3', '2026-11-22T10:00:00.000Z', 'Grace', [{ field: 'notes', from: { text: 'Second' }, to: { text: 'Third' } }]),
      updated('u2', '2026-11-21T10:00:00.000Z', 'Ada', [
        { field: 'phone', from: { text: '1' }, to: { text: '2' } },
        { field: 'notes', from: { text: 'First' }, to: { text: 'Second' } },
      ]),
      updated('u1', '2026-11-20T10:00:00.000Z', 'Ada', [{ field: 'phone', from: { text: '0' }, to: { text: '1' } }]),
      created('2026-11-19T10:00:00.000Z', 'Ada'),
    ]);
    const { container } = mountCard(source);
    await waitFor(() => expect(container.querySelectorAll('[data-field-history-entry]')).toHaveLength(2));
    expect(entriesOf(container)).toEqual([
      { actor: 'Grace', old: 'Second', new: 'Third' },
      { actor: 'Ada', old: 'First', new: 'Second' },
    ]);
    expect(container.querySelector('[data-field-history-label]')).toHaveTextContent('Customer notes');
    // Each line is the values; the card names the field once, above.
    expect(container.querySelector('[data-field-history-entry] [data-field-change-label]')).toBeNull();
    expect(container.querySelector('[data-field-history-entry] time')?.getAttribute('datetime')).toBe('2026-11-22T10:00:00.000Z');
    expect(container.querySelector('[data-field-history-none]')).toBeNull();
    expect(container.querySelector('[data-field-history-more]')).toBeNull();
  });

  it('reads by record only: the read names no change column', async () => {
    const source = pagingSource([created('2026-11-19T10:00:00.000Z', 'Ada')]);
    mountCard(source);
    await waitFor(() => expect(source.find).toHaveBeenCalled());
    const [object, params] = source.find.mock.calls[0] as [string, Record<string, any>];
    expect(object).toBe('sys_activity');
    expect(params.$filter).toEqual({ object_name: OBJECT, record_id: 'rec-1' });
    expect(params.$orderby).toEqual({ timestamp: 'desc' });
    expect(JSON.stringify(params)).not.toMatch(/changed_fields|metadata/);
  });

  it('an option reads as its label; an empty side as the word for empty', async () => {
    const source = pagingSource([
      updated('u1', '2026-11-20T10:00:00.000Z', 'Ada', [
        { field: 'stage', from: { text: '∅' }, to: { text: 'won', option: 'won' } },
      ]),
    ]);
    const { container } = mountCard(source, 'stage');
    await waitFor(() => expect(container.querySelectorAll('[data-field-history-entry]')).toHaveLength(1));
    expect(entriesOf(container)).toEqual([{ actor: 'Ada', old: 'Empty', new: 'Closed won' }]);
  });

  it(`shows the newest ${FIELD_HISTORY_PAGE_SIZE}, and "Load more" shows the rest`, async () => {
    const rows = Array.from({ length: 13 }, (_, i) =>
      updated(`u${i}`, new Date(Date.UTC(2026, 10, 20, 12 - i)).toISOString(), 'Ada', [
        { field: 'notes', from: { text: `v${i + 1}` }, to: { text: `v${i}` } },
      ]),
    );
    const { container } = mountCard(pagingSource(rows));
    await waitFor(() => expect(container.querySelectorAll('[data-field-history-entry]')).toHaveLength(FIELD_HISTORY_PAGE_SIZE));
    expect(entriesOf(container)[0].new).toBe('v0');
    fireEvent.click(await screen.findByText('Load more'));
    await waitFor(() => expect(container.querySelectorAll('[data-field-history-entry]')).toHaveLength(13));
    expect(entriesOf(container)[12].new).toBe('v12');
    expect(container.querySelector('[data-field-history-more]')).toBeNull();
  });

  it('pages past rows of other fields until it finds this field\'s changes', async () => {
    const others = Array.from({ length: FIELD_HISTORY_SCAN_BATCH + 5 }, (_, i) =>
      updated(`p${i}`, new Date(Date.UTC(2026, 10, 22, 0, 0, 0) - i * 60_000).toISOString(), 'Ada', [
        { field: 'phone', from: { text: `${i + 1}` }, to: { text: `${i}` } },
      ]),
    );
    const source = pagingSource([
      ...others,
      updated('n1', '2026-11-01T10:00:00.000Z', 'Grace', [{ field: 'notes', from: { text: 'Before' }, to: { text: 'After' } }]),
    ]);
    const { container } = mountCard(source);
    await waitFor(() => expect(container.querySelectorAll('[data-field-history-entry]')).toHaveLength(1));
    expect(entriesOf(container)).toEqual([{ actor: 'Grace', old: 'Before', new: 'After' }]);
    expect(source.find).toHaveBeenCalledTimes(2);
    expect((source.find.mock.calls[1] as [string, Record<string, unknown>])[1].$skip).toBe(FIELD_HISTORY_SCAN_BATCH);
  });

  it(`one open reads at most ${FIELD_HISTORY_SCAN_BATCHES_PER_LOAD} batches, then "Load more" reads on`, async () => {
    const capped = FIELD_HISTORY_SCAN_BATCHES_PER_LOAD * FIELD_HISTORY_SCAN_BATCH;
    const others = Array.from({ length: capped + 10 }, (_, i) =>
      updated(`p${i}`, new Date(Date.UTC(2026, 10, 22, 0, 0, 0) - i * 60_000).toISOString(), 'Ada', [
        { field: 'phone', from: { text: `${i + 1}` }, to: { text: `${i}` } },
      ]),
    );
    const source = pagingSource([
      ...others,
      updated('n1', '2026-10-01T10:00:00.000Z', 'Grace', [{ field: 'notes', from: { text: 'Before' }, to: { text: 'After' } }]),
      created('2026-09-01T10:00:00.000Z', 'Grace'),
    ]);
    const { container } = mountCard(source);
    // The open stops at its batches: the recent activity holds no change of
    // the field, which the card says, and it does not say "never changed".
    await waitFor(() => expect(container.querySelector('[data-field-history-none-recent]')).not.toBeNull());
    expect(container.querySelector('[data-field-history-none-recent]')).toHaveTextContent('No changes in the recent activity');
    expect(source.find).toHaveBeenCalledTimes(FIELD_HISTORY_SCAN_BATCHES_PER_LOAD);
    expect(container.querySelector('[data-field-history-none]')).toBeNull();
    // Nothing more is read without a click.
    await new Promise((r) => setTimeout(r, 20));
    expect(source.find).toHaveBeenCalledTimes(FIELD_HISTORY_SCAN_BATCHES_PER_LOAD);
    fireEvent.click(container.querySelector('[data-field-history-more]') as HTMLElement);
    await waitFor(() => expect(container.querySelectorAll('[data-field-history-entry]')).toHaveLength(1));
    expect(entriesOf(container)).toEqual([{ actor: 'Grace', old: 'Before', new: 'After' }]);
    expect(source.find).toHaveBeenCalledTimes(FIELD_HISTORY_SCAN_BATCHES_PER_LOAD + 1);
    expect((source.find.mock.calls[FIELD_HISTORY_SCAN_BATCHES_PER_LOAD] as [string, Record<string, unknown>])[1].$skip).toBe(capped);
    expect(container.querySelector('[data-field-history-none-recent]')).toBeNull();
    expect(container.querySelector('[data-field-history-more]')).toBeNull();
  });

  it('a field never changed: 「No changes recorded」 and who created the record, when', async () => {
    const source = pagingSource([
      updated('u1', '2026-11-20T10:00:00.000Z', 'Ada', [{ field: 'phone', from: { text: '0' }, to: { text: '1' } }]),
      created('2026-11-19T10:00:00.000Z', 'Grace'),
    ]);
    const { container } = mountCard(source);
    await waitFor(() => expect(container.querySelector('[data-field-history-none]')).not.toBeNull());
    expect(container.querySelector('[data-field-history-none]')).toHaveTextContent('No changes recorded');
    const createdLine = container.querySelector('[data-field-history-created]') as HTMLElement;
    expect(createdLine).toHaveTextContent('Created by Grace');
    expect(createdLine.querySelector('time')?.getAttribute('datetime')).toBe('2026-11-19T10:00:00.000Z');
    expect(container.querySelector('[data-field-history-entry]')).toBeNull();
  });

  it('a refused read says the reader may not see this record\'s activity', async () => {
    const { container } = mountCard(pagingSource([], Object.assign(new Error('Forbidden'), { status: 403 })));
    await waitFor(() => expect(container.querySelector('[data-field-history-denied]')).not.toBeNull());
    expect(container.querySelector('[data-field-history-none]')).toBeNull();
  });
});

describe('the record page field\'s 「Change history」 entry (objectstack#36290)', () => {
  const SECTION_FIELDS = [{ name: 'notes', label: 'Customer notes' }, { name: 'phone', label: 'Phone' }, { name: 'created_at', label: 'Created' }];
  const SECTION_DATA = { id: 'rec-1', notes: 'Third', phone: '2', created_at: '2026-11-19T10:00:00.000Z' };
  const mountSection = (
    source: ReturnType<typeof pagingSource>,
    schema: Record<string, unknown> = SCHEMA,
    fields: Array<{ name: string; label: string }> = SECTION_FIELDS,
    data: Record<string, unknown> = SECTION_DATA,
  ) =>
    render(
      <RecordContextProvider
        objectName={OBJECT}
        recordId="rec-1"
        data={data}
        objectSchema={schema as any}
        dataSource={source as any}
      >
        <DetailSection
          section={{ title: 'Details', fields } as any}
          data={data}
          objectSchema={schema}
          objectName={OBJECT}
          dataSource={source}
        />
      </RecordContextProvider>,
    );
  const triggers = (container: HTMLElement) =>
    Array.from(container.querySelectorAll('[data-field-history-trigger]')).map((el) => el.getAttribute('data-field-history-trigger'));

  it('each field of the object offers it; a platform column does not; it opens the card in place', async () => {
    const source = pagingSource([
      updated('u1', '2026-11-20T10:00:00.000Z', 'Ada', [{ field: 'notes', from: { text: 'Second' }, to: { text: 'Third' } }]),
    ]);
    const { container } = mountSection(source);
    expect(triggers(container)).toEqual(['notes', 'phone']);
    expect(source.find).not.toHaveBeenCalled();
    fireEvent.click(container.querySelector('[data-field-history-trigger="notes"]') as HTMLElement);
    const card = await waitFor(() => {
      const el = document.querySelector('[data-field-history="notes"]');
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    await waitFor(() => expect(card.querySelectorAll('[data-field-history-entry]')).toHaveLength(1));
    expect(within(card).getByText('Third')).toBeInTheDocument();
  });

  it('a field the reader may not read has no entry (control: the readable one keeps it)', () => {
    permissions.denied.add('notes');
    const { container } = mountSection(pagingSource([]));
    expect(triggers(container)).toEqual(['phone']);
  });

  it('a field whose values are not recorded has no entry (control: a default-off type that opts in keeps it)', () => {
    const schema = {
      name: OBJECT,
      fields: {
        notes: { type: 'textarea', label: 'Customer notes' },
        quiet: { type: 'text', label: 'Quiet', fieldHistory: false },
        spec: { type: 'json', label: 'Spec' },
        spec_on: { type: 'json', label: 'Spec (on)', fieldHistory: true },
        secret: { type: 'password', label: 'Secret' },
      },
    };
    const fields = [
      { name: 'notes', label: 'Customer notes' },
      { name: 'quiet', label: 'Quiet' },
      { name: 'spec', label: 'Spec' },
      { name: 'spec_on', label: 'Spec (on)' },
      { name: 'secret', label: 'Secret' },
    ];
    const data = { id: 'rec-1', notes: 'Third', quiet: 'q', spec: '{"a":1}', spec_on: '{"b":2}', secret: '••••' };
    const { container } = mountSection(pagingSource([]), schema, fields, data);
    expect(triggers(container)).toEqual(['notes', 'spec_on']);
  });

  it('an object with field history off offers none (control: the same object with it on)', () => {
    const on = mountSection(pagingSource([]));
    expect(triggers(on.container)).toEqual(['notes', 'phone']);
    cleanup();
    const { container } = mountSection(pagingSource([]), { ...SCHEMA, enable: { fieldHistory: false } });
    expect(triggers(container)).toEqual([]);
  });

  it('a section not drawing the page\'s record offers none', () => {
    const source = pagingSource([]);
    const { container } = render(
      <DetailSection
        section={{ title: 'Details', fields: [{ name: 'notes', label: 'Customer notes' }] } as any}
        data={{ id: 'rec-1', notes: 'Third' }}
        objectSchema={SCHEMA}
        objectName={OBJECT}
        dataSource={source}
      />,
    );
    expect(triggers(container)).toEqual([]);
  });
});
