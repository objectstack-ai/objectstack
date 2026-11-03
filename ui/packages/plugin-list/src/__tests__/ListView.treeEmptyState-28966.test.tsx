/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * An empty `tree` list view draws the view's empty state (objectstack#28966).
 *
 * ## The defect this pins
 *
 * `ListView` drew `ListEmptyState` (the authored `emptyState`, otherwise the
 * localized `list.*` copy) only for the `grid` and `gallery` visualizations. A
 * tree view was handed the empty set and `ObjectTree`, which reads no
 * `emptyState`, drew the generic `common.noData` line instead. An administrator
 * who authored guidance on a view saw it on the grid and lost it the moment the
 * same view was a tree, as Setup's business units are by default.
 *
 * ## Which rows discriminate
 *
 * RED against the unfixed condition: every row that waits for
 * `[data-testid="empty-state"]` on a tree view (the tree stand-in was mounted
 * instead). GREEN in both worlds: the CONTROL with a row, which proves the
 * tree visualization is the one mounted, so an empty state drawn for some
 * other reason (a view that silently fell back to the grid) cannot pass the
 * other rows vacuously.
 *
 * The tree is a stand-in registered under `object-tree`: this package does not
 * depend on `plugin-tree`, and what is pinned is `ListView`'s branch, which
 * decides whether the tree is mounted at all.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, waitFor, screen } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import { I18nProvider, LocalizationProvider } from '@object-ui/i18n';
import { SchemaRendererProvider } from '@object-ui/react';
import type { DataSource, ListViewSchema } from '@object-ui/types';
import { ListView } from '../ListView';

ComponentRegistry.register(
  'object-tree',
  () => <div data-testid="object-tree-standin" />,
  { namespace: 'test', label: 'object-tree stand-in', category: 'view' },
);

const ZH = { defaultLanguage: 'zh', detectBrowserLanguage: false } as const;

/** The built-in `zh` pack's `list.*` first-run rows. */
const ZH_FIRST_RUN_TITLE = '这里还没有数据';
const ZH_FIRST_RUN_MESSAGE = '创建第一条记录即可开始。';

const OBJECT_DEF = {
  name: 'business_unit',
  fields: {
    name: { type: 'text', label: 'Name' },
    parent: { type: 'lookup', reference: 'business_unit', label: 'Parent' },
  },
};

const dataSourceAnswering = (rows: Record<string, unknown>[]) => ({
  find: vi.fn().mockResolvedValue(rows),
  findOne: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  getObjectSchema: vi.fn().mockResolvedValue(OBJECT_DEF),
});

const EMPTY_STATE = '[data-testid="empty-state"]';
const TREE = '[data-testid="object-tree-standin"]';
const headingOf = (state: Element) => state.querySelector('h3')?.textContent ?? null;
const messageOf = (state: Element) => state.querySelector('p')?.textContent ?? null;

type Locale = 'zh-pack' | { inline: string } | 'none';

function withLocale(ui: React.ReactElement, locale: Locale) {
  if (locale === 'zh-pack') {
    return <I18nProvider config={ZH} persistLanguage={false}>{ui}</I18nProvider>;
  }
  if (locale === 'none') return ui;
  return <LocalizationProvider value={{ locale: locale.inline }}>{ui}</LocalizationProvider>;
}

function mountListView(
  viewType: 'grid' | 'tree',
  extra: Partial<ListViewSchema>,
  locale: Locale,
  rows: Record<string, unknown>[] = [],
) {
  const ds = dataSourceAnswering(rows);
  const schema = {
    type: 'list-view',
    objectName: 'business_unit',
    viewType,
    columns: ['name'],
    ...(viewType === 'tree' ? { tree: { parentField: 'parent' } } : {}),
    ...extra,
  } as ListViewSchema;
  return render(
    withLocale(
      <SchemaRendererProvider dataSource={ds as unknown as DataSource}>
        <ListView schema={schema} dataSource={ds as unknown as DataSource} />
      </SchemaRendererProvider>,
      locale,
    ),
  );
}

async function emptyStateOf(
  viewType: 'grid' | 'tree',
  extra: Partial<ListViewSchema>,
  locale: Locale,
): Promise<HTMLElement> {
  const { container } = mountListView(viewType, extra, locale);
  await waitFor(() => expect(container.querySelector(EMPTY_STATE)).not.toBeNull());
  return container.querySelector(EMPTY_STATE) as HTMLElement;
}

afterEach(() => cleanup());

describe('an empty tree list view draws the view empty state (objectstack#28966)', () => {
  it('CONTROL: with a row, the tree visualization is the one mounted, and no empty state', async () => {
    const { container } = mountListView('tree', {}, 'none', [{ id: 'b1', name: 'Head office' }]);
    await waitFor(() => expect(container.querySelector(TREE)).not.toBeNull());
    expect(container.querySelector(EMPTY_STATE)).toBeNull();
  });

  it('an authored plain-string `emptyState` is drawn as written, in place of the tree', async () => {
    const state = await emptyStateOf(
      'tree',
      { emptyState: { title: 'No business units yet', message: 'Add the head office first.' } },
      'none',
    );
    expect(headingOf(state)).toBe('No business units yet');
    expect(messageOf(state)).toBe('Add the head office first.');
    expect(state.ownerDocument.querySelector(TREE)).toBeNull();
  });

  it('an authored `emptyState` inline locale map paints its zh-CN entries', async () => {
    const state = await emptyStateOf(
      'tree',
      {
        emptyState: {
          title: { en: 'No business units yet', 'zh-CN': '还没有业务单元' },
          message: { en: 'Add the head office first.', 'zh-CN': '请先添加总部。' },
        },
      },
      { inline: 'zh-CN' },
    );
    expect(headingOf(state)).toBe('还没有业务单元');
    expect(messageOf(state)).toBe('请先添加总部。');
  });

  it('zh, nothing authored: the localized first-run copy, not the tree generic line', async () => {
    const state = await emptyStateOf('tree', {}, 'zh-pack');
    expect(headingOf(state)).toBe(ZH_FIRST_RUN_TITLE);
    expect(messageOf(state)).toBe(ZH_FIRST_RUN_MESSAGE);
    expect(state.ownerDocument.body.textContent).not.toContain('暂无数据');
  });

  it('the list toolbar stays on screen above the empty tree', async () => {
    // The wide toolbar (objectui#12423: the compact form is the default), so
    // its Filter and Refresh buttons are named controls a test can find. The
    // empty state replaces the visualization below the toolbar, never the
    // toolbar: the reader keeps Filter to widen the query and Refresh.
    const state = await emptyStateOf(
      'tree',
      { compactToolbar: false, emptyState: { title: 'No business units yet' } } as Partial<ListViewSchema>,
      'none',
    );
    expect(screen.getByTestId('toolbar-filter-trigger')).toBeTruthy();
    expect(screen.getByTestId('refresh-button')).toBeTruthy();
    expect(headingOf(state)).toBe('No business units yet');
  });

  it('the tree and the grid draw the SAME empty state, node for node', async () => {
    const view: Partial<ListViewSchema> = {
      emptyState: { title: { en: 'Nothing here', 'zh-CN': '这里什么都没有' }, message: 'Start with one.' },
    };
    const grid = (await emptyStateOf('grid', view, { inline: 'zh-CN' })).outerHTML;
    cleanup();
    const tree = (await emptyStateOf('tree', view, { inline: 'zh-CN' })).outerHTML;
    expect(tree).toBe(grid);
    // Non-vacuity: what both drew is the authored, resolved copy.
    expect(grid).toContain('这里什么都没有');
  });
});
