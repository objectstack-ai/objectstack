/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `ObjectTree`'s loading and empty placeholders speak the session locale: they
 * read the bundle's `common.loading` / `common.noData`, the pair the sibling
 * renderers (`element:repeater`, `element:record_picker`) read for theirs.
 *
 * The zh cases are the ones that were red while the two placeholders were the
 * English literals `Loading…` / `No records`. The en cases pin the English the
 * `en` pack spells for the same keys.
 *
 * The provider-less path (the factory's English defaults table) is held by the
 * package's other tests, which render without an `I18nProvider` and read the
 * same English strings.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { I18nProvider } from '@object-ui/i18n';
import { ObjectTree } from './ObjectTree';

/** A data source whose `find` answers `rows`, or never answers when `rows` is null. */
function makeDataSource(rows: Array<Record<string, unknown>> | null) {
  return {
    find: vi.fn(
      (_object: string, _query?: unknown) =>
        rows === null
          ? new Promise<never>(() => {})
          : Promise.resolve({ data: rows, total: rows.length }),
    ),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn(async (object: string) => ({
      name: object,
      fields: { name: { type: 'text' }, parent_id: { type: 'text' } },
    })),
  };
}

function renderTreeIn(language: string, ds: ReturnType<typeof makeDataSource>) {
  return render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }}>
      <ObjectTree
        schema={{
          type: 'object-tree',
          objectName: 'category',
          parentField: 'parent_id',
          labelField: 'name',
        } as never}
        dataSource={ds as never}
      />
    </I18nProvider>,
  );
}

afterEach(() => {
  cleanup();
});

describe('ObjectTree placeholders read the bundle', () => {
  it('draws the zh loading line while its read is pending', async () => {
    const ds = makeDataSource(null);
    renderTreeIn('zh', ds);
    await waitFor(() => expect(ds.find).toHaveBeenCalled());

    expect(screen.getByText('加载中…')).toBeInTheDocument();
    expect(screen.queryByText('Loading…')).toBeNull();
  });

  it('draws the zh empty line for an empty result', async () => {
    const ds = makeDataSource([]);
    renderTreeIn('zh', ds);

    expect(await screen.findByText('暂无数据')).toBeInTheDocument();
    expect(screen.queryByText('No records')).toBeNull();
    expect(screen.queryByText('No data')).toBeNull();
  });

  it('draws the en loading line while its read is pending', async () => {
    const ds = makeDataSource(null);
    renderTreeIn('en', ds);
    await waitFor(() => expect(ds.find).toHaveBeenCalled());

    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });

  it('draws the en empty line for an empty result', async () => {
    const ds = makeDataSource([]);
    renderTreeIn('en', ds);

    expect(await screen.findByText('No data')).toBeInTheDocument();
  });
});
