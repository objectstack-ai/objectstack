/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#35941 — the record page names the owner ONCE when its body draws
 * `owner_id`.
 *
 * The maintainer's ruling (7056427422, option A): when a field group on the
 * record page renders `owner_id`, the bottom meta line leaves the owner out,
 * so the owner appears once, as the body field, where it can be changed; when
 * no group renders it, the meta line shows the owner as before; the body's
 * groups stay as declared.
 *
 * The page is composed here the way `RecordDetailView` composes the default
 * page: the sections from `deriveRecordDetailSections` (the declared groups,
 * the "Other" bucket, or the auto split), the page from
 * `buildDefaultPageSchema`, its columns from `buildDefaultPageColumns`, and
 * `RecordPageColumns` drawing the real `record:details` block with the
 * `RecordMetaFooter` closing the details column. So "the body draws the owner"
 * is read from the sections the block actually mounts, and the owner is
 * counted over the whole page.
 *
 * On the laid-out page the meta line is the details column's last group,
 * 「系统信息」 (objectstack#36147), folded until opened: the owner the line
 * kept is that group's Owner row, read here with the group opened.
 *
 * The strip half of the rule (a highlight strip that draws the owner) is
 * pinned in `@object-ui/plugin-detail`'s `RecordMetaFooter.ownerOnce-28868`
 * and `RecordMetaFooter.drawnStrip-28909`, unchanged.
 */

import * as React from 'react';
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent, within } from '@testing-library/react';
import { RecordContextProvider } from '@object-ui/react';
// Module scope, so the registry's cold transform lands in the import phase.
import {
  RecordMetaFooter,
  RecordPageColumns,
  buildDefaultPageColumns,
  buildDefaultPageSchema,
} from '@object-ui/plugin-detail';
import { deriveRecordDetailSections } from './recordDetailSections';

const OBJECT = 'os_35941_contact';
const OWNER_NAME = 'Ada Owner';

/** Distinct values, so every value is read off the page by what it paints. */
const RECORD = {
  id: 'C-35941',
  name: 'Grace Hopper',
  email: 'grace@example.com',
  phone: 'phone-value',
  owner_id: { id: 'u-ada', name: OWNER_NAME },
  created_at: '2026-10-16T00:00:00.000Z',
  updated_at: '2026-10-18T00:00:00.000Z',
};

const FIELDS = {
  name: { type: 'text', label: 'Name' },
  email: { type: 'email', label: 'Email' },
  phone: { type: 'text', label: 'Phone' },
  owner_id: { type: 'lookup', label: 'Owner', reference: 'sys_user' },
};

type ObjectDef = { name: string; fields: Record<string, Record<string, unknown>>; fieldGroups?: unknown[] };

/** The default record page of `objectDef`, laid out wide, with its meta line. */
function renderDefaultPage(objectDef: ObjectDef) {
  const sections = deriveRecordDetailSections(objectDef, { moreDetails: 'More details', ungrouped: 'Other' });
  type SynthOptions = NonNullable<Parameters<typeof buildDefaultPageSchema>[1]>;
  const page = buildDefaultPageSchema(objectDef as Parameters<typeof buildDefaultPageSchema>[0], {
    sections: sections as SynthOptions['sections'],
  });
  const columns = buildDefaultPageColumns(page);
  expect(columns, 'the default page must lay out into columns').not.toBeNull();
  const dataSource = { getObjectSchema: async () => objectDef };
  return render(
    <RecordContextProvider
      objectName={objectDef.name}
      recordId={RECORD.id}
      data={RECORD}
      objectSchema={objectDef}
      dataSource={dataSource as never}
    >
      <RecordPageColumns
        tier="wide"
        columns={columns!}
        footer={<RecordMetaFooter data={RECORD} objectSchema={objectDef} objectName={objectDef.name} />}
      />
    </RecordContextProvider>,
  );
}

const footerOf = (container: HTMLElement) =>
  container.querySelector('[data-testid="record-meta-footer"]') as HTMLElement | null;
/** Open the 「系统信息」 group the meta line is on the laid-out page (objectstack#36147). */
function openSystemInfo(container: HTMLElement) {
  const toggle = within(footerOf(container)!).getByRole('button', { name: 'System information' });
  if (toggle.getAttribute('aria-expanded') !== 'true') fireEvent.click(toggle);
}
/** The system group's Owner row, or `null` when it has none. */
const footerOwner = (container: HTMLElement) => {
  const footer = footerOf(container);
  if (!footer) return null;
  const label = Array.from(footer.querySelectorAll('[data-detail-field-label]')).find((el) => el.textContent === 'Owner');
  return (label?.closest('[data-detail-field-row]') as HTMLElement | null) ?? null;
};
const detailsColumn = (container: HTMLElement) =>
  container.querySelector('[data-record-column="details"]') as HTMLElement;
/** How many times the owner's name is painted on the whole page. */
const ownerCount = (container: HTMLElement) => container.textContent!.split(OWNER_NAME).length - 1;

beforeAll(() => Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 }));

beforeEach(() => {
  // `useRecordEditable` asks the explain endpoint; its answer is orthogonal to
  // which fields the body draws, so a double answers it.
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ allowed: true }),
    text: async () => '{"allowed":true}',
  })) as never);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('the body draws owner_id: the meta line leaves the owner out (objectstack#35941)', () => {
  it('a declared group holding owner_id: the owner is painted once, in the body', () => {
    const { container } = renderDefaultPage({
      name: OBJECT,
      fieldGroups: [
        { key: 'basics', label: 'Basics' },
        { key: 'ownership', label: 'Ownership' },
      ],
      fields: {
        name: { ...FIELDS.name, group: 'basics' },
        email: { ...FIELDS.email, group: 'basics' },
        phone: { ...FIELDS.phone, group: 'basics' },
        owner_id: { ...FIELDS.owner_id, group: 'ownership' },
      },
    });
    // Live control: the body and the meta line both drew.
    expect(within(detailsColumn(container)).getByText('grace@example.com')).toBeTruthy();
    openSystemInfo(container);
    expect(within(footerOf(container)!).getByText('C-35941')).toBeTruthy();

    expect(footerOwner(container)).toBeNull();
    expect(ownerCount(container)).toBe(1);
    // The group stays as declared: its heading and the owner row are there.
    expect(within(detailsColumn(container)).getByText('Ownership')).toBeTruthy();
    expect(footerOf(container)!.textContent).not.toContain(OWNER_NAME);
  });

  it('no declared groups: owner_id lands in the auto-derived section, and is painted once', () => {
    const { container } = renderDefaultPage({ name: OBJECT, fields: FIELDS });
    expect(within(detailsColumn(container)).getByText('grace@example.com')).toBeTruthy();
    expect(footerOf(container)).not.toBeNull();
    openSystemInfo(container);

    expect(footerOwner(container)).toBeNull();
    expect(ownerCount(container)).toBe(1);
  });

  it('declared groups that leave owner_id out: it lands in the "Other" bucket, and is painted once', () => {
    const { container } = renderDefaultPage({
      name: OBJECT,
      fieldGroups: [{ key: 'basics', label: 'Basics' }],
      fields: {
        name: { ...FIELDS.name, group: 'basics' },
        email: { ...FIELDS.email, group: 'basics' },
        phone: FIELDS.phone,
        owner_id: FIELDS.owner_id,
      },
    });
    expect(within(detailsColumn(container)).getByText('Other')).toBeTruthy();
    openSystemInfo(container);

    expect(footerOwner(container)).toBeNull();
    expect(ownerCount(container)).toBe(1);
  });
});

describe('the body does not draw owner_id: the meta line keeps the owner (objectstack#35941)', () => {
  it('groups that leave owner_id out, and owner_id drawn nowhere else (hidden): the owner is on the meta line', () => {
    const { container } = renderDefaultPage({
      name: OBJECT,
      fieldGroups: [{ key: 'basics', label: 'Basics' }],
      fields: {
        name: { ...FIELDS.name, group: 'basics' },
        email: { ...FIELDS.email, group: 'basics' },
        phone: { ...FIELDS.phone, group: 'basics' },
        owner_id: { ...FIELDS.owner_id, hidden: true },
      },
    });
    expect(within(detailsColumn(container)).getByText('grace@example.com')).toBeTruthy();
    openSystemInfo(container);

    expect(footerOwner(container)).not.toBeNull();
    expect(footerOwner(container)!.textContent).toContain(OWNER_NAME);
    expect(ownerCount(container)).toBe(1);
  });

  it('a collapsed group holding owner_id: the owner is on the meta line until the group opens, then in the body', () => {
    const { container } = renderDefaultPage({
      name: OBJECT,
      fieldGroups: [
        { key: 'basics', label: 'Basics' },
        { key: 'ownership', label: 'Ownership', collapse: 'collapsed' },
      ],
      fields: {
        name: { ...FIELDS.name, group: 'basics' },
        email: { ...FIELDS.email, group: 'basics' },
        phone: { ...FIELDS.phone, group: 'basics' },
        owner_id: { ...FIELDS.owner_id, group: 'ownership' },
      },
    });
    // Collapsed, the group draws its heading and no rows.
    openSystemInfo(container);
    expect(footerOwner(container)).not.toBeNull();
    expect(ownerCount(container)).toBe(1);

    fireEvent.click(within(detailsColumn(container)).getByRole('button', { name: /Ownership/ }));
    expect(footerOwner(container)).toBeNull();
    expect(ownerCount(container)).toBe(1);
  });
});
