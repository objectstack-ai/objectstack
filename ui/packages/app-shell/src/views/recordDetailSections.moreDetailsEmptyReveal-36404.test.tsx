/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#36404 — on the default record page an empty field the "More
 * details" split leaves to its synthesized section is counted by the field
 * list's one 「显示 N 个空字段」 row and, shown, drawn in read mode in that
 * section, the same as an empty row of any other group (objectstack#36147
 * ruling item 4: one row at the end of the field area, folded by default).
 *
 * Drawn the way the running page draws it: the sections `RecordDetailView`
 * derives (`deriveRecordDetailSections`), through `buildDefaultPageSchema`'s
 * `record:details` node, the real renderer, and `RecordPageColumns` — the
 * laid-out page that mounts the field list and draws its last row.
 */

import * as React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { RecordContextProvider } from '@object-ui/react';
import { RecordPageColumns, buildDefaultPageSchema } from '@object-ui/plugin-detail';
import { deriveRecordDetailSections } from './recordDetailSections';

afterEach(cleanup);

/**
 * No `fieldGroups`, and `notes` is long text, so the split draws an untitled
 * primary section and the "More details" section holding `notes` alone.
 * `name` is the page H1 and left out of the body by the renderer.
 */
const leadDef = {
  name: 'os_36404_lead',
  label: 'Lead',
  fields: {
    name: { label: 'Name', type: 'text' },
    company: { label: 'Company', type: 'text' },
    phone: { label: 'Phone', type: 'text' },
    notes: { label: 'Notes', type: 'textarea' },
  },
};

const LABELS = { moreDetails: 'More details', ungrouped: 'Other' };

/** The details body of the default page, as `RecordPageColumns` takes it. */
function columnsFor(def: typeof leadDef) {
  const sections = deriveRecordDetailSections(def, LABELS);
  const page = buildDefaultPageSchema(def as any, { sections: sections as any, hideDiscussion: true });
  const details: any[] = [];
  const walk = (n: unknown) => {
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (!n || typeof n !== 'object') return;
    const rec = n as Record<string, any>;
    if (rec.type === 'record:details') { details.push(rec); return; }
    Object.values(rec).forEach(walk);
  };
  walk(page);
  expect(details, 'the page carries exactly one record:details node').toHaveLength(1);
  return { header: [], strip: [], details, timeline: [], related: [] };
}

function drawPage(def: typeof leadDef, data: Record<string, unknown>) {
  return render(
    <RecordContextProvider
      objectName={def.name}
      recordId="L1"
      data={data}
      objectSchema={def}
      dataSource={{ find: vi.fn(async () => ({ data: [], total: 0 })), getObjectSchema: vi.fn(async () => def) } as any}
    >
      <RecordPageColumns tier="stack" columns={columnsFor(def)} />
    </RecordContextProvider>,
  );
}

const emptyRow = (container: HTMLElement) => container.querySelector('[data-empty-fields-row]') as HTMLElement | null;

describe('objectstack#36404 — the synthesized "More details" section on the field list', () => {
  it('its empty field is counted by the list’s one row, and shown it draws in that section', () => {
    const { container } = drawPage(leadDef, { id: 'L1', name: 'Ada', company: 'Acme', phone: null, notes: null });
    // Firing control: the split yields the "More details" section holding `notes`.
    expect(deriveRecordDetailSections(leadDef, LABELS).map((s) => (s.fields as any[]).map((f) => f.name))).toEqual([
      ['name', 'company', 'phone'],
      ['notes'],
    ]);
    expect(screen.getByText('Acme')).toBeTruthy();
    const row = emptyRow(container);
    expect(row).not.toBeNull();
    // phone (primary section) + notes (More details).
    expect(row!.getAttribute('data-empty-fields-count')).toBe('2');
    expect(screen.queryByText('Notes', { exact: true })).toBeNull();
    expect(screen.queryByText('More details')).toBeNull();

    act(() => {
      fireEvent.click(within(row!).getByRole('button'));
    });
    const heading = screen.getByText('More details');
    const section = heading.closest('[data-detail-section-list]') as HTMLElement;
    expect(section).not.toBeNull();
    expect(within(section).getByText('Notes', { exact: true })).toBeTruthy();
    expect(screen.getByText('Phone', { exact: true })).toBeTruthy();
  });

  it('CONTROL: a filled "More details" section draws its field before any reveal, and adds nothing to the count', () => {
    const { container } = drawPage(leadDef, { id: 'L1', name: 'Ada', company: 'Acme', phone: null, notes: 'Met at expo' });
    expect(screen.getByText('More details')).toBeTruthy();
    expect(screen.getByText('Met at expo')).toBeTruthy();
    expect(emptyRow(container)!.getAttribute('data-empty-fields-count')).toBe('1');
  });
});
