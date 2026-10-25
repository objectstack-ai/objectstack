/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10545 — the toolbar's lookup filter labels its values by the display
 * field the object definition DECLARES.
 *
 * `resolveFields` used to read `display_field ?? reference_field` and
 * `id_field` off the object-schema def, spellings `FieldSchema` refuses, and
 * never `displayField`, the one it declares. The value picker then fell back to
 * `name`, so a spec-compliant lookup's chip showed the wrong label. The ruling
 * (triage 5831112408): read the declared `displayField`, with no fallback to
 * the refused spellings.
 *
 * The measurement is the picker's own label resolution: a restored selection
 * is resolved by one `dataSource.find` on the referenced object, and the trigger
 * shows the label that came back. The record carries a DIFFERENT value under
 * every field the picker could read, so the label names the field it used.
 */
import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { DataSource } from '@object-ui/types';
import { SchemaRendererProvider } from '@object-ui/react';
import { UserFilters } from '../UserFilters';

/** The referenced record: one distinct value per field the picker could read. */
const ACCOUNT = { id: 'a1', code: 'ACME', full_name: 'Ada Lovelace', name: 'ada' };

const BARE_LOOKUP = { type: 'lookup', label: 'Account', reference: 'crm_account' } as const;

function renderLookupFilter(accountDef: Record<string, unknown>) {
  const dataSource = {
    find: vi.fn().mockResolvedValue({ data: [ACCOUNT], total: 1 }),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn(),
  };
  render(
    <SchemaRendererProvider dataSource={dataSource as unknown as DataSource}>
      <UserFilters
        config={{ element: 'dropdown', fields: [{ field: 'account_id' }] }}
        objectDef={{ name: 'crm_contact', fields: { account_id: accountDef } }}
        data={[]}
        onFilterChange={() => {}}
        initialSelections={{ account_id: [ACCOUNT.id] }}
      />
    </SchemaRendererProvider>,
  );
  fireEvent.click(screen.getByTestId('filter-badge-account_id'));
  // Non-vacuity: the remote lookup picker is what rendered, not a plain list.
  expect(screen.getByTestId('filter-lookup-account_id')).toBeTruthy();
  return dataSource;
}

/** The label the picker's trigger shows once the selection has resolved. */
async function resolvedLabel(dataSource: { find: ReturnType<typeof vi.fn> }): Promise<string> {
  await waitFor(() => expect(dataSource.find).toHaveBeenCalled());
  const trigger = screen.getByTestId('lookup-picker-account_id');
  // Before resolution the trigger shows the raw id; wait until it does not.
  await waitFor(() => expect(trigger.textContent).not.toBe(ACCOUNT.id));
  return trigger.textContent ?? '';
}

afterEach(() => {
  cleanup();
});

describe('objectui#10545 — `UserFilters` lookup picker reads the declared `displayField`', () => {
  it('control: a def declaring no display field labels the value by the picker default, `name`', async () => {
    const dataSource = renderLookupFilter(BARE_LOOKUP);
    expect(await resolvedLabel(dataSource)).toBe(ACCOUNT.name);
  });

  it('a lookup declaring `displayField` resolves its label by that field', async () => {
    const dataSource = renderLookupFilter({ ...BARE_LOOKUP, displayField: 'full_name' });
    expect(await resolvedLabel(dataSource)).toBe(ACCOUNT.full_name);
  });

  it('a def carrying only `display_field` no longer sets the display field', async () => {
    const dataSource = renderLookupFilter({ ...BARE_LOOKUP, display_field: 'full_name' });
    expect(await resolvedLabel(dataSource)).toBe(ACCOUNT.name);
  });

  it('a def carrying only `reference_field` no longer sets the display field', async () => {
    const dataSource = renderLookupFilter({ ...BARE_LOOKUP, reference_field: 'full_name' });
    expect(await resolvedLabel(dataSource)).toBe(ACCOUNT.name);
  });

  it('no id column is read off the def: `id_field` no longer re-keys the lookup, identity stays `id`', async () => {
    const dataSource = renderLookupFilter({ ...BARE_LOOKUP, displayField: 'full_name', id_field: 'code' });
    expect(await resolvedLabel(dataSource)).toBe(ACCOUNT.full_name);
    const [, params] = dataSource.find.mock.calls[0] as [string, { $filter: Record<string, unknown> }];
    expect(Object.keys(params.$filter)).toEqual(['id']);
  });
});
