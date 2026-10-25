/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * An empty gallery draws the grid's empty state (objectui#12217).
 *
 * ## The defect this pins
 *
 * `ObjectGallery`'s empty branch returned one hard-coded English line, "No
 * items to display", in every locale, and `ListView` drew its authored /
 * translated empty state only for the `grid` visualization: a gallery was
 * handed the empty list and drew that line instead. So an empty gallery in the
 * zh-CN console said it in English, and a view's authored `emptyState` was
 * ignored on a gallery.
 *
 * Both paths a gallery reaches now draw `ListEmptyState`, the component the
 * grid's branch was moved into:
 *
 * - UNDER `ListView` (the console's object list, an interface list page whose
 *   visualization is `gallery`): `ListView` draws it for `gallery` as it does
 *   for `grid`, with the view's authored `emptyState`, the view filter, the
 *   user's query and the add-record action.
 * - STANDALONE (`ObjectGallery` rendered by an authored `object-gallery` node
 *   or `ObjectView`'s own non-grid path): the gallery draws it with what it
 *   knows. The node declares no `emptyState`, and there is no search box, user
 *   filter or add-record control, so it is the localized generic copy, the
 *   view-filter wording when the gallery's own `filter` emptied its own query.
 *
 * ## Which rows discriminate
 *
 * RED against the unfixed source: every row that waits for
 * `[data-testid="empty-state"]` on a gallery (the old branch drew a bare `div`
 * with no test id), and every row reading copy other than the old English
 * line. GREEN in both worlds: the two positive controls, which prove the
 * gallery visualization really is the one mounted (a gallery that silently fell
 * back to the grid would draw this same empty state and pass every row
 * vacuously).
 *
 * ## Locale channels
 *
 * The zh rows mount the real `I18nProvider` with the built-in `zh` pack, so the
 * copy is the pack's, read through the same `list.*` keys the grid reads. The
 * inline-map rows drive the display locale through `LocalizationProvider`, as
 * `ListView.emptyStateI18nLabel-11227.test.tsx` does; each map lists `en`
 * FIRST, so a resolver that fell back to `en` or to the first entry would
 * paint English and fail.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, waitFor, screen } from '@testing-library/react';
import { I18nProvider, LocalizationProvider } from '@object-ui/i18n';
import { SchemaRendererProvider } from '@object-ui/react';
import type { DataSource, ListViewSchema, ObjectGallerySchema } from '@object-ui/types';
import { ListView } from '../ListView';
import { ObjectGallery } from '../ObjectGallery';

const ZH = { defaultLanguage: 'zh', detectBrowserLanguage: false } as const;

/** The built-in `zh` pack's `list.*` rows the empty state reads. */
const ZH_FIRST_RUN_TITLE = '这里还没有数据';
const ZH_FIRST_RUN_MESSAGE = '创建第一条记录即可开始。';
const ZH_ADD_RECORD = '添加记录';

/** The line the unfixed gallery drew in every locale. */
const OLD_LINE = /No items to display/i;

const OBJECT_DEF = { name: 'task', fields: { name: { type: 'text', label: 'Name' } } };

/**
 * A partial stub carrying only the members these paths call: every query
 * answers `rows`, so an empty `rows` makes the view draw its empty state.
 */
const dataSourceAnswering = (rows: Record<string, unknown>[]) => ({
  find: vi.fn().mockResolvedValue(rows),
  findOne: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  getObjectSchema: vi.fn().mockResolvedValue(OBJECT_DEF),
});

const EMPTY_STATE = '[data-testid="empty-state"]';
const headingOf = (state: Element) => state.querySelector('h3')?.textContent ?? null;
const messageOf = (state: Element) => state.querySelector('p')?.textContent ?? null;

/** Wraps `ui` in the locale channel a row asks for. */
function withLocale(ui: React.ReactElement, locale: 'zh-pack' | { inline: string } | 'none') {
  if (locale === 'zh-pack') {
    return <I18nProvider config={ZH} persistLanguage={false}>{ui}</I18nProvider>;
  }
  if (locale === 'none') return ui;
  return <LocalizationProvider value={{ locale: locale.inline }}>{ui}</LocalizationProvider>;
}

function mountListView(
  viewType: 'grid' | 'gallery',
  extra: Partial<ListViewSchema>,
  locale: 'zh-pack' | { inline: string } | 'none',
  rows: Record<string, unknown>[] = [],
) {
  const ds = dataSourceAnswering(rows);
  const schema = {
    type: 'list-view',
    objectName: 'task',
    viewType,
    columns: ['name'],
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

async function listViewEmptyState(
  viewType: 'grid' | 'gallery',
  extra: Partial<ListViewSchema>,
  locale: 'zh-pack' | { inline: string } | 'none',
): Promise<HTMLElement> {
  const { container } = mountListView(viewType, extra, locale);
  await waitFor(() => expect(container.querySelector(EMPTY_STATE)).not.toBeNull());
  return container.querySelector(EMPTY_STATE) as HTMLElement;
}

function mountGallery(
  schema: Omit<ObjectGallerySchema, 'type'>,
  locale: 'zh-pack' | 'none',
  rows: Record<string, unknown>[] = [],
) {
  const ds = dataSourceAnswering(rows);
  const result = render(
    withLocale(
      <SchemaRendererProvider dataSource={ds as unknown as DataSource}>
        <ObjectGallery schema={{ type: 'object-gallery', ...schema }} />
      </SchemaRendererProvider>,
      locale,
    ),
  );
  return { ...result, ds };
}

async function galleryEmptyState(
  schema: Omit<ObjectGallerySchema, 'type'>,
  locale: 'zh-pack' | 'none',
): Promise<HTMLElement> {
  const { container } = mountGallery(schema, locale);
  await waitFor(() => expect(container.querySelector(EMPTY_STATE)).not.toBeNull());
  return container.querySelector(EMPTY_STATE) as HTMLElement;
}

/**
 * The state's markup once its glyph has drawn. An authored icon name resolves
 * through the shared icon seam, which may load the glyph after the first
 * paint, so two captures taken at different moments differ in the `svg`'s
 * children alone. Waiting for them makes the comparison about the state.
 */
async function drawnIcon(state: HTMLElement): Promise<string> {
  await waitFor(() => expect(state.querySelector('svg')?.childElementCount ?? 0).toBeGreaterThan(0));
  return state.outerHTML;
}

afterEach(() => cleanup());

describe('an empty gallery under ListView draws the grid empty state (objectui#12217)', () => {
  it('CONTROL: with a row, the gallery visualization is the one mounted (cards, no table)', async () => {
    const { container } = mountListView('gallery', {}, 'none', [{ id: 't1', name: 'Write the spec' }]);
    await waitFor(() => expect(screen.getByText('Write the spec')).toBeTruthy());
    expect(container.querySelector('table')).toBeNull();
    expect(container.querySelector(EMPTY_STATE)).toBeNull();
  });

  it('zh: the localized first-run copy and the localized add-record action, not the English line', async () => {
    const state = await listViewEmptyState('gallery', { addRecord: { enabled: true } }, 'zh-pack');
    expect(headingOf(state)).toBe(ZH_FIRST_RUN_TITLE);
    expect(messageOf(state)).toBe(ZH_FIRST_RUN_MESSAGE);
    expect(state.querySelector('[data-testid="empty-state-add-record"]')?.textContent).toBe(ZH_ADD_RECORD);
    expect(state.ownerDocument.body.textContent).not.toMatch(OLD_LINE);
  });

  it('an authored `emptyState` inline locale map paints its zh-CN entries', async () => {
    const state = await listViewEmptyState(
      'gallery',
      {
        emptyState: {
          title: { en: 'No packages yet', 'zh-CN': '还没有软件包' },
          message: { en: 'Packages you publish appear here.', 'zh-CN': '你发布的软件包会显示在这里。' },
        },
      },
      { inline: 'zh-CN' },
    );
    expect(headingOf(state)).toBe('还没有软件包');
    expect(messageOf(state)).toBe('你发布的软件包会显示在这里。');
  });

  it('an authored plain-string `emptyState` is drawn as written', async () => {
    const state = await listViewEmptyState(
      'gallery',
      { emptyState: { title: 'No packages yet', message: 'Packages you publish appear here.' } },
      'none',
    );
    expect(headingOf(state)).toBe('No packages yet');
    expect(messageOf(state)).toBe('Packages you publish appear here.');
  });

  it('the gallery and the grid draw the SAME empty state, node for node', async () => {
    const view: Partial<ListViewSchema> = {
      emptyState: { title: { en: 'Nothing open', 'zh-CN': '没有未完成的' }, icon: 'package' },
    };
    const grid = await drawnIcon(await listViewEmptyState('grid', view, { inline: 'zh-CN' }));
    cleanup();
    const gallery = await drawnIcon(await listViewEmptyState('gallery', view, { inline: 'zh-CN' }));
    expect(gallery).toBe(grid);
    // Non-vacuity: what both drew is the authored, resolved copy.
    expect(grid).toContain('没有未完成的');
  });
});

describe('a standalone empty ObjectGallery draws the shared empty state (objectui#12217)', () => {
  it('CONTROL: with a row, the standalone gallery draws its card and no empty state', async () => {
    const { container } = mountGallery({ data: [{ id: 't1', name: 'Write the spec' }], titleField: 'name' }, 'none');
    await waitFor(() => expect(screen.getByText('Write the spec')).toBeTruthy());
    expect(container.querySelector(EMPTY_STATE)).toBeNull();
  });

  it('zh: authored-empty `data` draws the localized first-run copy, not the English line', async () => {
    const state = await galleryEmptyState({ data: [] }, 'zh-pack');
    expect(headingOf(state)).toBe(ZH_FIRST_RUN_TITLE);
    expect(messageOf(state)).toBe(ZH_FIRST_RUN_MESSAGE);
    expect(state.ownerDocument.body.textContent).not.toMatch(OLD_LINE);
  });

  it('no provider: the built-in English first-run copy, and no add-record action (the gallery has no such control)', async () => {
    const state = await galleryEmptyState({ data: [] }, 'none');
    expect(headingOf(state)).toBe('Nothing here yet');
    expect(messageOf(state)).toBe('Create your first record to get started.');
    expect(state.querySelector('[data-testid="empty-state-add-record"]')).toBeNull();
  });

  it('a query the gallery issued under its own `filter` says the filter emptied it', async () => {
    const state = await galleryEmptyState({ objectName: 'task', filter: [['status', '=', 'open']] }, 'none');
    expect(headingOf(state)).toBe('No matching records');
    expect(messageOf(state)).toBe('No records match this view’s filter.');
  });

  it('CONTROL: the same query with no `filter` keeps the first-run copy', async () => {
    const state = await galleryEmptyState({ objectName: 'task' }, 'none');
    expect(headingOf(state)).toBe('Nothing here yet');
  });
});
