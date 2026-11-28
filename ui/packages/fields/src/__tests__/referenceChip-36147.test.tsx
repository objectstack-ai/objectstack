/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#36147 item 4 — on a record page's field area a referenced
 * record is a chip: the referenced object's colour tile (`ObjectSchema.color`
 * and `icon`, objectstack#35985), then the record's whole name, wrapping, not
 * cut. A click opens that record and is not the row's. Everywhere else a
 * reference keeps its link face.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import React from 'react';

import { LookupCellRenderer, ReferenceChipContext } from '../index';
import { RelatedRecordActionsProvider, SchemaRendererProvider } from '@object-ui/react';

afterEach(() => cleanup());

const ACCOUNT = { name: 'account', label: 'Account', nameField: 'name', color: 'blue', icon: 'building', fields: { name: { type: 'text' } } };
const LONG_NAME = 'Shenzhen Xinghe E-Commerce Company Limited';

function makeSource() {
  return {
    find: vi.fn(async () => ({ data: [] })),
    findOne: vi.fn(async () => null),
    getObjectSchema: vi.fn(async (objectName: string) => (objectName === 'account' ? ACCOUNT : undefined)),
  };
}

function makeHost() {
  return {
    resolve: () => ({}),
    recordHref: (objectName: string, recordId: string | number) => `/apps/crm/${objectName}/record/${recordId}`,
    openRecord: vi.fn(),
  } as any;
}

function renderCell({ chip, host }: { chip: boolean; host: any }) {
  const onRowClick = vi.fn();
  const utils = render(
    <SchemaRendererProvider dataSource={makeSource() as any}>
      <RelatedRecordActionsProvider value={host}>
        <ReferenceChipContext.Provider value={chip}>
          <div data-testid="row" onClick={onRowClick}>
            <LookupCellRenderer value={{ id: 'acc-1', name: LONG_NAME }} field={{ type: 'lookup', reference: 'account' } as any} />
          </div>
        </ReferenceChipContext.Provider>
      </RelatedRecordActionsProvider>
    </SchemaRendererProvider>,
  );
  return { ...utils, onRowClick };
}

describe('a reference drawn as a chip (objectstack#36147 item 4)', () => {
  it('draws the referenced object colour tile and the whole name, on a pill that opens the record', async () => {
    const host = makeHost();
    const { container, onRowClick } = renderCell({ chip: true, host });
    const chip = container.querySelector('a[data-record-chip]') as HTMLAnchorElement;
    expect(chip).not.toBeNull();
    expect(chip.getAttribute('href')).toBe('/apps/crm/account/record/acc-1');
    await waitFor(() => expect(chip.querySelector('[data-object-icon-tile="blue"]')).not.toBeNull());
    const name = Array.from(chip.querySelectorAll('span')).find((el) => el.textContent === LONG_NAME)!;
    expect(name).toBeTruthy();
    expect(name.className).not.toMatch(/\btruncate\b/);
    expect(name.className).toContain('break-words');
    // Not the link face: no primary-coloured text.
    expect(chip.className).not.toContain('text-primary');

    fireEvent.click(chip);
    expect(host.openRecord).toHaveBeenCalledWith('account', 'acc-1');
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it('with no route to the record, the chip is the same pill and not a link', () => {
    const { container } = renderCell({ chip: true, host: null });
    expect(container.querySelector('a')).toBeNull();
    const pill = container.querySelector('span[data-record-chip]');
    expect(pill?.textContent).toBe(LONG_NAME);
    expect(pill?.querySelector('[data-object-icon-tile]')).not.toBeNull();
  });

  it('outside a field area a reference keeps its link face', () => {
    const { container } = renderCell({ chip: false, host: makeHost() });
    const link = container.querySelector('a[data-record-link]') as HTMLAnchorElement;
    expect(link.hasAttribute('data-record-chip')).toBe(false);
    expect(link.className).toContain('text-primary');
    expect(link.querySelector('[data-object-icon-tile]')).toBeNull();
  });
});
