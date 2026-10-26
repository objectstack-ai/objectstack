/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * With no `I18nProvider` mounted, the line-items chrome objectui#11145 moved
 * onto pack keys is the English it rendered before: the panel's states and
 * error fallbacks, its grid's footer `Total`, and `MasterDetailForm`'s
 * untitled collection heading `Line Items`.
 *
 * This is the provider-less path (a standalone embed, this package's own
 * tests), served by the panel's and the form's `createSafeTranslation` tables
 * and the grid's inline defaults. The zh half is
 * `lineItemsChrome.i18n-11145.test.tsx`.
 *
 * Its own FILE on purpose: `createI18n` registers its instance as
 * react-i18next's module-global default, and that registration outlives
 * `cleanup()`, so one provider mount earlier in a file would answer every
 * later "no provider" render in it. Do not import or mount `I18nProvider`
 * here.
 */

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import * as React from 'react';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { registerAllFields } from '@object-ui/fields';
import { SchemaRendererProvider } from '@object-ui/react';
import { LineItemsPanel } from './LineItemsPanel';
import { MasterDetailForm } from './MasterDetailForm';

registerAllFields();

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
});

const PANEL = {
  childObject: 'po_line',
  relationshipField: 'po',
  parentObject: 'po',
  parentId: 'p1',
  columns: [{ name: 'amount', label: 'Amount', type: 'number' }],
};

function panel(panelSchema: Record<string, unknown>, ds: unknown) {
  return render(
    <SchemaRendererProvider dataSource={ds as never}>
      <LineItemsPanel schema={panelSchema as never} />
    </SchemaRendererProvider>,
  );
}

const banner = () => document.body.querySelector('p.text-destructive');

describe('line-items chrome with no i18n provider (objectui#11145)', () => {
  it('a panel with no parent record bound reads the English sentence', async () => {
    panel({ ...PANEL, parentId: undefined }, { getObjectSchema: vi.fn().mockResolvedValue(null), find: vi.fn() });

    expect(await screen.findByText('Save the record first to add line items.')).toBeInTheDocument();
  });

  it('the footer of a panel with a `totalField` reads `Total`', async () => {
    panel(
      { ...PANEL, totalField: 'total', amountField: 'amount' },
      {
        getObjectSchema: vi.fn().mockResolvedValue(null),
        find: vi.fn(async () => ({ data: [{ id: 'l1', amount: 10 }] })),
      },
    );

    await waitFor(() => expect(screen.getByTestId('line-items-total').textContent).toBe('10'));
    expect(screen.getByText('Total')).toBeInTheDocument();
  });

  it('the loading line reads `Loading…`', async () => {
    panel(PANEL, { getObjectSchema: vi.fn().mockResolvedValue(null), find: vi.fn(() => new Promise(() => {})) });

    expect(await screen.findByText('Loading…')).toBeInTheDocument();
  });

  it('a failed load the server did not describe reads `Failed to load line items`', async () => {
    panel(PANEL, { getObjectSchema: vi.fn().mockResolvedValue(null), find: vi.fn().mockRejectedValue({}) });

    await waitFor(() => expect(banner()?.textContent).toBe('Failed to load line items'));
  });

  it('a failed load the server described reads the server\'s words', async () => {
    panel(PANEL, {
      getObjectSchema: vi.fn().mockResolvedValue(null),
      find: vi.fn().mockRejectedValue(new Error('po_line is not readable')),
    });

    await waitFor(() => expect(banner()?.textContent).toBe('po_line is not readable'));
  });

  it('a panel with no `childObject` reads the English hint, byte for byte, with the property as code', async () => {
    panel({ ...PANEL, childObject: undefined }, { getObjectSchema: vi.fn().mockResolvedValue(null), find: vi.fn() });

    const hint = await screen.findByTestId('line-items-no-child-object');
    expect(hint.textContent).toBe(
      'This panel has no child object configured: set childObject to the object whose rows it lists.',
    );
    expect(hint.querySelector('code')?.textContent).toBe('childObject');
  });

  it('`MasterDetailForm`: an untitled collection is headed `Line Items`', async () => {
    const ds = {
      getObjectSchema: vi.fn(async (o: string) =>
        o === 'po_line'
          ? {
              name: 'po_line',
              fields: {
                line_total: { type: 'number', label: 'Line Total' },
                po: { type: 'master_detail', label: 'PO', reference: 'po' },
              },
            }
          : { name: 'po', fields: { ref: { type: 'text', label: 'Ref' } } },
      ),
      find: vi.fn().mockResolvedValue({ data: [] }),
      create: vi.fn(),
      update: vi.fn(),
      batchTransaction: vi.fn(),
    };
    render(
      <MasterDetailForm
        schema={
          {
            objectName: 'po',
            mode: 'create',
            fields: ['ref'],
            details: [
              {
                childObject: 'po_line',
                relationshipField: 'po',
                columns: [{ name: 'line_total', label: 'Line Total', type: 'number' }],
              },
            ],
          } as never
        }
        dataSource={ds as never}
      />,
    );

    await waitFor(() =>
      expect(Array.from(document.body.querySelectorAll('section > h3')).map((h) => h.textContent)).toEqual([
        'Line Items',
      ]),
    );
  });
});
