/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The ⌘K palette labels a record hit from the record as the viewer may READ it
 * (objectui#10500).
 *
 * `useRecordSearch` labels each hit with `getRecordDisplayName`. It used to be
 * handed the raw served row, so on a backend that does not strip denied
 * fields, a `titleFormat` token or declared `nameField` the loaded policy
 * denies printed as the hit's label, and also rode the cmdk item's filter
 * value. The hook now removes the denied fields (`id` kept) before any
 * resolver reads the row, when the caller passes the policy, and the palette
 * passes `usePermissions()`. The resolver then falls through to its next rung,
 * the label ObjectStack's `FieldMasker` row already yields.
 *
 * Pinned against the real `PermissionProvider` and the real
 * `CommandPaletteProvider` (opened through its `?palette=1` deep link), over
 * both of the hook's data paths (the per-object `find` fanout, and `searchAll`
 * hits that carry the record but no server title):
 *
 *  - a denied `titleFormat` token or `nameField` never reaches the DOM (text or
 *    attribute), and the label falls through to the derived `name` field;
 *  - CONTROLS: a loaded policy denying a field the label does not read, and no
 *    provider at all (`isLoaded` false), print the served row's label.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { PermissionProvider } from '@object-ui/permissions';

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u1' }, activeOrganization: null }),
}));

import { CommandPalette } from './CommandPalette';
import { CommandPaletteProvider } from '../context/CommandPaletteProvider';

const OBJECT = 'contact_10500';
const REC = 'K1';
const DENIED_VALUE = 'ada@example.com';

const FIELDS = {
  name: { label: 'Name', type: 'text' },
  email: { label: 'Email', type: 'text' },
  phone: { label: 'Phone', type: 'text' },
};

const RECORD = { id: REC, name: 'Ada Lovelace', email: DENIED_VALUE, phone: '555-0100' };

const APP = {
  name: 'crm',
  label: 'CRM',
  navigation: [{ id: 'n1', type: 'object', objectName: OBJECT, label: 'Contacts' }],
};

type Wrap = (node: React.ReactElement) => React.ReactElement;
const bare: Wrap = (node) => node;

/** The real role-based provider, denying the named fields of the object to `viewer`. */
function denying(...fields: string[]): Wrap {
  const permissions = [
    {
      object: OBJECT,
      roles: {
        viewer: { actions: ['read'], fieldPermissions: fields.map((field) => ({ field, read: false })) },
      },
    },
  ];
  return (node) => (
    <PermissionProvider roles={[]} userRoles={['viewer']} permissions={permissions as never}>
      {node}
    </PermissionProvider>
  );
}

/** The two data paths `useRecordSearch` labels a hit on. Neither strips a denied field. */
const ADAPTERS: Array<[string, () => Record<string, unknown>]> = [
  ['the per-object `find` fanout', () => ({ find: vi.fn(async () => ({ data: [{ ...RECORD }] })) })],
  [
    '`searchAll` hits with no server title',
    () => ({
      find: vi.fn(async () => ({ data: [] })),
      searchAll: vi.fn(async () => ({ hits: [{ object: OBJECT, id: REC, record: { ...RECORD } }] })),
    }),
  ],
];

function mount(adapter: () => Record<string, unknown>, objectSchema: Record<string, unknown>, wrap: Wrap) {
  const objects = [{ name: OBJECT, label: 'Contact', fields: FIELDS, ...objectSchema }];
  const ds = adapter();
  render(
    wrap(
      <MemoryRouter initialEntries={['/apps/crm?palette=1']}>
        <CommandPaletteProvider>
          <CommandPalette apps={[APP]} activeApp={APP} objects={objects} onAppChange={() => {}} dataSource={ds} />
        </CommandPaletteProvider>
      </MemoryRouter>,
    ),
  );
  const input = document.querySelector('[cmdk-input]');
  if (!input) throw new Error('the palette did not open');
  fireEvent.change(input, { target: { value: 'ada' } });
}

/** The record hit's cmdk item, once it is on screen (the hook debounces 250ms). */
async function hitItem(): Promise<Element> {
  return waitFor(
    () => {
      const item = document.querySelector('[cmdk-item][data-value^="record "]');
      if (!item) throw new Error('the record hit is not on screen yet');
      return item;
    },
    { timeout: 4000 },
  );
}

/** The label the palette prints for the hit. */
async function hitLabel(): Promise<string> {
  const item = await hitItem();
  return item.querySelector('span.truncate')?.textContent ?? '';
}

afterEach(() => cleanup());

describe.each(ADAPTERS)('objectui#10500 — the ⌘K palette labels a hit from the readable row, over %s', (_path, adapter) => {
  it('a denied `titleFormat` token does not print; the label falls through to `name`', async () => {
    mount(adapter, { titleFormat: '{email}' }, denying('email'));
    expect(await hitLabel()).toBe('Ada Lovelace');
    expect(document.body.innerHTML).not.toContain(DENIED_VALUE);
  });

  it('a denied `nameField` does not print; the label falls through to `name`', async () => {
    mount(adapter, { nameField: 'email' }, denying('email'));
    expect(await hitLabel()).toBe('Ada Lovelace');
    expect(document.body.innerHTML).not.toContain(DENIED_VALUE);
  });

  it('CONTROL: a policy denying a field the label does not read prints the allowed field', async () => {
    mount(adapter, { titleFormat: '{email}' }, denying('phone'));
    expect(await hitLabel()).toBe(DENIED_VALUE);
  });

  it('CONTROL: with no provider (`isLoaded` false) the served row labels the hit', async () => {
    mount(adapter, { nameField: 'email' }, bare);
    expect(await hitLabel()).toBe(DENIED_VALUE);
  });
});
