/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * With no `I18nProvider` mounted, a master-detail collection's three
 * configuration hints are the English they were before objectui#11160 moved
 * them onto `form.masterDetail.*`, byte for byte, with the same code elements.
 *
 * This is the provider-less path, served by `formChrome.ts`'s table. The zh
 * half is `MasterDetailForm.configHints.i18n-11160.test.tsx`.
 *
 * Its own FILE on purpose: `createI18n` registers its instance as
 * react-i18next's module-global default, and that registration outlives
 * `cleanup()`, so one provider mount earlier in a file would answer every
 * later "no provider" render in it. Do not import or mount `I18nProvider`
 * here.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { render, waitFor, cleanup, screen } from '@testing-library/react';
import { registerAllFields } from '@object-ui/fields';
import { MasterDetailForm } from './MasterDetailForm';

registerAllFields();

const PARENT = 'purchase_order';

function form(details: unknown[], failing: string[] = []) {
  const ds = {
    getObjectSchema: vi.fn(async (obj: string) => {
      if (failing.includes(obj)) throw new Error(`SCHEMA_UNAVAILABLE: ${obj}`);
      return obj === PARENT
        ? { name: PARENT, fields: { ref: { type: 'text', label: 'Ref' } } }
        : { name: 'po_line', fields: { amount: { type: 'number', label: 'Amount' } } };
    }),
    find: vi.fn().mockResolvedValue({ data: [] }),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    bulk: vi.fn(),
  };
  return render(
    <MasterDetailForm
      schema={{ objectName: PARENT, mode: 'create', fields: ['ref'], details } as never}
      dataSource={ds as never}
    />,
  );
}

const read = (testId: string) => {
  const hint = screen.getByTestId(testId);
  return {
    text: hint.textContent,
    code: Array.from(hint.querySelectorAll('code')).map((c) => c.textContent),
  };
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('MasterDetailForm config hints with no i18n provider (objectui#11160)', () => {
  it('no `childObject`: the English hint, with `childObject` as code', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    form([{ title: 'Unconfigured' }]);

    await waitFor(() =>
      expect(read('md-detail-no-child-object')).toEqual({
        text: 'This collection has no child object configured: set childObject to the object whose rows it lists.',
        code: ['childObject'],
      }),
    );
  });

  it('a child schema that failed to load: the English hint, with the object name as code', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    form([{ childObject: 'po_line', title: 'PO lines' }], ['po_line']);

    await waitFor(() =>
      expect(read('md-detail-schema-unavailable')).toEqual({
        text:
          'Could not load the schema of po_line, so this collection has no columns to show. '
          + 'Check that the object exists and is readable, then reload.',
        code: ['po_line'],
      }),
    );
  });

  it('no field linking the child to the parent: the English hint, with both object names and `relationshipField` as code', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    form([{ childObject: 'po_line', title: 'PO lines' }]);

    await waitFor(() =>
      expect(read('md-detail-no-relationship-field')).toEqual({
        text:
          'Could not work out how po_line links to purchase_order: no lookup or master_detail field on it '
          + 'references the parent. Set relationshipField on this collection to the field that holds the parent record.',
        code: ['po_line', PARENT, 'relationshipField'],
      }),
    );
  });
});
