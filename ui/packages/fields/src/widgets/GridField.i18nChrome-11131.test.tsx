/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The line-items grid's own chrome speaks the session locale (objectui#11131).
 *
 * Three English literals rendered beside a Chinese page under a `zh` session:
 * the Add button's `Add line`, the list-mode empty text `No items yet — click
 * “Add” to begin.` and the read-only grid's `No items`. They now read the
 * catalogue through the fields package's `useFieldTranslation`:
 * `fields.grid.addLine`, `fields.grid.noItemsAddHint` (whose `{{label}}` is the
 * authored `addLabel`, or `detail.add`) and `fields.grid.noItems`.
 *
 * Only the DEFAULTS move. The `CONTROL` case pins the other half: an authored
 * `addLabel` is the button's label exactly as written, and it is the label
 * the empty text names, under the same zh session.
 *
 * The provider-less English is the `.no-provider` companion of this file.
 */

import { describe, it, expect, afterEach } from 'vitest';
import * as React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';
import { GridField } from './GridField';

afterEach(() => cleanup());

const columns = [{ name: 'description', label: 'Description', type: 'text' as const }];

function inZh(node: React.ReactNode) {
  return render(
    <I18nProvider config={{ defaultLanguage: 'zh', detectBrowserLanguage: false }}>{node}</I18nProvider>,
  );
}

describe('GridField chrome resolves through the i18n catalogue (objectui#11131)', () => {
  it('zh: the Add button reads 添加行', async () => {
    inZh(<GridField value={[]} onChange={() => {}} field={{ columns } as never} />);

    expect(await screen.findByRole('button', { name: '添加行' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Add line/ })).toBeNull();
  });

  it('zh: the list-mode empty text is the zh sentence, naming the zh `detail.add`', async () => {
    inZh(
      <GridField value={[]} onChange={() => {}} field={{ columns } as never} displayMode="list" onAdd={() => {}} />,
    );

    expect(await screen.findByText('暂无条目，点击“添加”开始添加。')).toBeInTheDocument();
    expect(screen.queryByText(/No items yet/)).toBeNull();
  });

  it('zh: the read-only grid over no rows reads 暂无条目', async () => {
    inZh(<GridField value={[]} onChange={() => {}} field={{ columns } as never} readonly />);

    expect(await screen.findByText('暂无条目')).toBeInTheDocument();
    expect(screen.queryByText('No items')).toBeNull();
  });

  it('CONTROL — an authored `addLabel` is the button label and the label the empty text names', async () => {
    inZh(
      <GridField
        value={[]}
        onChange={() => {}}
        field={{ columns, addLabel: 'Add invoice line' } as never}
        displayMode="list"
        onAdd={() => {}}
      />,
    );

    expect(await screen.findByRole('button', { name: 'Add invoice line' })).toBeInTheDocument();
    expect(screen.getByText('暂无条目，点击“Add invoice line”开始添加。')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '添加行' })).toBeNull();
  });
});
