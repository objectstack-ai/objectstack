/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * With no `I18nProvider` mounted, a required, empty grid cell's text is the
 * English it was before objectui#11160 moved it onto `validation.required`:
 * the column label followed by ` is required`, at all three sites (the plain
 * cell's `title`, and the `error` the lookup and file cells take).
 *
 * This is the provider-less path, served by the grid's inline default. The zh
 * half is `GridField.requiredCell.i18n-11160.test.tsx`.
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
import { GridField } from './GridField';

/** Every `error` each wrapped cell control was handed, by kind. */
const seen = vi.hoisted(() => ({ lookup: [] as unknown[], file: [] as unknown[] }));

vi.mock('./LookupField', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./LookupField')>();
  const { createElement } = await import('react');
  return {
    ...actual,
    LookupField: (props: Parameters<typeof actual.LookupField>[0]) => {
      seen.lookup.push(props.error);
      return createElement(actual.LookupField, props);
    },
  };
});

vi.mock('./FileField', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./FileField')>();
  const { createElement } = await import('react');
  return {
    ...actual,
    FileCell: (props: Parameters<typeof actual.FileCell>[0]) => {
      seen.file.push(props.error);
      return createElement(actual.FileCell, props);
    },
  };
});

describe('GridField required-cell text with no i18n provider (objectui#11160)', () => {
  it('renders the English sentence at all three sites, byte for byte', () => {
    render(
      <GridField
        value={[{ qty: null, product: null, receipt: null }]}
        onChange={() => {}}
        field={{
          columns: [
            { name: 'qty', label: 'Qty', type: 'number', required: true },
            { name: 'product', label: 'Product', type: 'lookup', reference: 'product', required: true },
            { name: 'receipt', label: 'Receipt', type: 'file', required: true },
          ],
        } as never}
      />,
    );

    const title = (name: string) => screen.getByTestId(`line-items-invalid-0-${name}`).getAttribute('title');
    expect(title('qty')).toBe('Qty is required');
    expect(title('product')).toBe('Product is required');
    expect(title('receipt')).toBe('Receipt is required');
    // The data row's control is handed the sentence (on every render); the
    // ghost row's is handed none.
    const handed = (kind: 'lookup' | 'file') => [...new Set(seen[kind].filter((e) => e !== undefined))];
    expect(handed('lookup')).toEqual(['Product is required']);
    expect(handed('file')).toEqual(['Receipt is required']);
  });
});
