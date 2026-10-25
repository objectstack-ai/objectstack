/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A required, empty grid cell names itself in the session locale
 * (objectui#11160).
 *
 * The grid built that text as the column label followed by the English
 * ` is required`, at three sites: the plain cell's `title`, and the `error`
 * the lookup and file cells take. Under a `zh` session the Add button read
 * `添加行` while the invalid cell's tooltip read `Qty is required`. All three
 * now read the pack's `validation.required` (`{{field}}不能为空` in zh) with
 * the column's label in `{{field}}`, through one expression.
 *
 * The lookup and file cells only read their `error` for `aria-invalid` today,
 * so the text they are handed is observed at the prop: each module is wrapped,
 * and the wrapper records the `error` it was given before rendering the real
 * component.
 *
 * The provider-less English is the `.no-provider` companion of this file.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import * as React from 'react';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';
import { GridField } from './GridField';

/** The `error` each wrapped cell control was last handed, by kind. */
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

afterEach(() => {
  cleanup();
  seen.lookup.length = 0;
  seen.file.length = 0;
});

/** One required column of each kind, every cell empty. */
const columns = [
  { name: 'qty', label: 'Qty', type: 'number' as const, required: true },
  { name: 'product', label: 'Product', type: 'lookup' as const, reference: 'product', required: true },
  { name: 'receipt', label: 'Receipt', type: 'file' as const, required: true },
];
const emptyRow = [{ qty: null, product: null, receipt: null }];

function grid(language: 'zh' | 'en', cols: unknown[] = columns) {
  return render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }}>
      <GridField value={emptyRow} onChange={() => {}} field={{ columns: cols } as never} />
    </I18nProvider>,
  );
}

/** The invalid cell's `title` on the data row. */
const cellTitle = (name: string) => screen.getByTestId(`line-items-invalid-0-${name}`).getAttribute('title');

/** The last defined `error` a cell control was handed (the ghost row's is undefined). */
const lastError = (kind: 'lookup' | 'file') => seen[kind].filter((e) => e !== undefined).at(-1);

describe('GridField: a required, empty cell reads validation.required in the session locale (objectui#11160)', () => {
  it('zh: the plain cell\'s title reads Qty不能为空', async () => {
    grid('zh');

    // `waitFor`: the zh catalogue loads after the first render.
    await waitFor(() => expect(cellTitle('qty')).toBe('Qty不能为空'));
  });

  it('zh: the lookup cell is handed Product不能为空 as its error, and its title says the same', async () => {
    grid('zh');

    await waitFor(() => expect(lastError('lookup')).toBe('Product不能为空'));
    expect(cellTitle('product')).toBe('Product不能为空');
  });

  it('zh: the file cell is handed Receipt不能为空 as its error, and its title says the same', async () => {
    grid('zh');

    await waitFor(() => expect(lastError('file')).toBe('Receipt不能为空'));
    expect(cellTitle('receipt')).toBe('Receipt不能为空');
  });

  it('zh: no invalid cell keeps the English sentence', async () => {
    const { container } = grid('zh');

    await waitFor(() => expect(cellTitle('qty')).toBe('Qty不能为空'));
    const titles = Array.from(container.querySelectorAll('[data-testid^="line-items-invalid-"]')).map((td) =>
      td.getAttribute('title'),
    );
    expect(titles).toHaveLength(3);
    for (const text of [...titles, lastError('lookup'), lastError('file')]) {
      expect(text).not.toContain('is required');
    }
  });

  it('CONTROL zh: the authored label fills the hole as written, and a column with no label falls back to its name', async () => {
    grid('zh', [
      { name: 'qty', label: '数量', type: 'number', required: true },
      { name: 'sku_code', type: 'text', required: true },
    ]);

    await waitFor(() => expect(cellTitle('qty')).toBe('数量不能为空'));
    expect(cellTitle('sku_code')).toBe('sku_code不能为空');
  });

  it('CONTROL en: all three sites read the English sentence, byte for byte', async () => {
    grid('en');

    await waitFor(() => expect(cellTitle('qty')).toBe('Qty is required'));
    expect(cellTitle('product')).toBe('Product is required');
    expect(cellTitle('receipt')).toBe('Receipt is required');
    expect(lastError('lookup')).toBe('Product is required');
    expect(lastError('file')).toBe('Receipt is required');
  });
});
