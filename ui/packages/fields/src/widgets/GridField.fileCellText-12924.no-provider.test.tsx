/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * With no `I18nProvider` mounted, a line-items grid's file cell reads the
 * English the literals it replaced read, byte for byte (objectui#12924):
 * `2 files` for a cell holding two files and `File` for a nameless file.
 *
 * This is the provider-less path, served by each call site's inline
 * `defaultValue` (the `en` pack's value, held to it by `pnpm check:i18n-keys`)
 * through `createSafeTranslation`'s fallback. The zh / ru half is
 * `GridField.fileCellText-12924.test.tsx`.
 *
 * Its own FILE on purpose: `createI18n` registers its instance as
 * react-i18next's module-global default, and that registration outlives
 * `cleanup()`, so one provider mount earlier in a file would answer every
 * later "no provider" render in it. Do not import or mount `I18nProvider`
 * here.
 */

import { describe, it, expect, afterEach } from 'vitest';
import * as React from 'react';
import { render, cleanup } from '@testing-library/react';
import { GridField } from './GridField';

afterEach(() => cleanup());

const columns = [{ name: 'docs', label: 'Docs', type: 'file' as const, multiple: true }];
const file = (n: number) => ({ id: `f_${n}`, name: `att-${n}.pdf`, url: `/api/v1/storage/files/f_${n}` });
const rows = [{ docs: [file(1), file(2)] }, { docs: { url: '/api/v1/storage/files/f_9' } }, { docs: [file(3)] }];

/** Each row's file cell text, in row order: the first cell is the row number, the second the file column. */
const fileCells = (container: HTMLElement): string[] =>
  Array.from(container.querySelectorAll('tbody tr')).map((tr) => tr.querySelectorAll('td')[1]?.textContent ?? '');

describe("GridField's file cell text with no i18n provider (objectui#12924)", () => {
  it('the list-mode cell reads `2 files`, `File` and a named file by its name', () => {
    const { container } = render(
      <GridField value={rows} onChange={() => {}} field={{ columns } as never} displayMode="list" onAdd={() => {}} />,
    );
    expect(fileCells(container)).toEqual(['2 files', 'File', 'att-3.pdf']);
  });

  it('the read-only table reads the same', () => {
    const { container } = render(<GridField value={rows} onChange={() => {}} field={{ columns } as never} readonly />);
    expect(fileCells(container)).toEqual(['2 files', 'File', 'att-3.pdf']);
  });
});
