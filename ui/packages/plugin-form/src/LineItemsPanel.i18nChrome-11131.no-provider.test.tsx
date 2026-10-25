/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * With no `I18nProvider` mounted, the `record:line_items` panel's chrome is
 * the English it rendered before objectui#11131 moved it onto pack keys: the
 * title `Line Items`, the `Save` button and the grid's `Add line`.
 *
 * This is the provider-less path — a standalone embed, this package's own
 * tests — served by the panel's `createSafeTranslation` table and the grid's
 * inline defaults. The zh half is `LineItemsPanel.i18nChrome-11131.test.tsx`.
 *
 * Its own FILE on purpose: `createI18n` registers its instance as
 * react-i18next's module-global default, and that registration outlives
 * `cleanup()`, so one provider mount earlier in a file would answer every
 * later "no provider" render in it. Do not import or mount `I18nProvider`
 * here.
 */

import { describe, it, expect, vi } from 'vitest';
import * as React from 'react';
import { render, screen } from '@testing-library/react';
import { registerAllFields } from '@object-ui/fields';
import { SchemaRendererProvider } from '@object-ui/react';
import { LineItemsPanel } from './LineItemsPanel';

registerAllFields();

describe('record:line_items chrome with no i18n provider (objectui#11131)', () => {
  it('renders the English it rendered before: `Line Items`, `Save`, `Add line`', async () => {
    const ds = {
      getObjectSchema: vi.fn().mockResolvedValue(null),
      find: vi.fn(async () => ({ data: [] })),
    };
    render(
      <SchemaRendererProvider dataSource={ds as never}>
        <LineItemsPanel
          schema={{
            childObject: 'po_line',
            relationshipField: 'po',
            parentObject: 'po',
            parentId: 'p1',
            columns: [{ name: 'amount', label: 'Amount', type: 'number' }],
          } as never}
        />
      </SchemaRendererProvider>,
    );

    expect(await screen.findByText('Line Items')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Add line' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
  });
});
