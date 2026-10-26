/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The list view's authored empty state resolves the inline locale map
 * (objectui#11227).
 *
 * ## The defect this pins
 *
 * `ListViewSchema.emptyState` is the spec's `EmptyStateSchema`, by reference:
 * `title` and `message` are `I18nLabel`, a plain string OR an inline locale map
 * (`{ en, 'zh-CN' }`). The read site was
 *
 *     typeof schema.emptyState?.title === 'string' ? schema.emptyState.title : undefined
 *
 * (and the same for `message`), which is a type test, not a resolution. Its
 * else-arm is "absent", so a map, which the contract entitles an author to
 * write, silently drew the DEFAULT copy ("Nothing here yet" / "No matching
 * records") in every locale. Nothing threw and nothing warned, and the compiler
 * could not see it either: the else-arm is well-typed. Only an executed
 * assertion holds this site.
 *
 * Each member is now resolved with the spec's `resolveI18nLabel` against the
 * display locale. A string passes through unchanged, and a map with no usable
 * entry resolves to nothing and keeps the default, which is what the old
 * else-arm did for every map.
 *
 * ## Locale channel
 *
 * `LocalizationProvider` drives the first limb of `useDisplayLocale()`, as
 * `ListView.descriptionInlineLocale-7199.test.tsx` does, so the locale is
 * pinned without a react-i18next global instance. No i18n provider is mounted,
 * so the default copy is the built-in English. Every map lists `en` FIRST, so
 * under `zh-CN` a resolver that fell back to `en` or to the first entry would
 * paint English and fail the row.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { LocalizationProvider } from '@object-ui/i18n';
import { SchemaRendererProvider } from '@object-ui/react';
import type { DataSource, ListViewSchema } from '@object-ui/types';
import { ListView } from '../ListView';

/**
 * A partial stub carrying only the members this path calls (the same crossing
 * `ListView.descriptionInlineLocale-7199.test.tsx` marks): every query answers
 * zero rows, so the grid view draws its empty state.
 */
const emptyDataSource = () => ({
  find: vi.fn().mockResolvedValue([]),
  findOne: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
});

/** `en` first on purpose; see the file header. */
const TITLE = { en: 'No open work', 'zh-CN': '没有未完成的工作' };
const MESSAGE = { en: 'Everything is done.', 'zh-CN': '全部完成。' };

async function emptyStateFor(emptyState: unknown, locale: string): Promise<HTMLElement> {
  const ds = emptyDataSource();
  const schema = {
    type: 'list-view',
    objectName: 'tasks',
    viewType: 'grid',
    columns: ['name'],
    emptyState,
  } as ListViewSchema;
  const { container } = render(
    <LocalizationProvider value={{ locale }}>
      <SchemaRendererProvider dataSource={ds as unknown as DataSource}>
        <ListView schema={schema} dataSource={ds as unknown as DataSource} />
      </SchemaRendererProvider>
    </LocalizationProvider>,
  );
  await waitFor(() => expect(container.querySelector('[data-testid="empty-state"]')).not.toBeNull());
  return container.querySelector('[data-testid="empty-state"]') as HTMLElement;
}

const headingOf = (state: HTMLElement) => state.querySelector('h3')?.textContent ?? null;
const messageOf = (state: HTMLElement) => state.querySelector('p')?.textContent ?? null;

afterEach(() => cleanup());

describe('ListView `emptyState.title` / `.message` resolve the inline locale map (objectui#11227)', () => {
  it('zh-CN: the heading and the message paint the zh-CN entries, not the default copy', async () => {
    const state = await emptyStateFor({ title: TITLE, message: MESSAGE }, 'zh-CN');
    expect(headingOf(state)).toBe('没有未完成的工作');
    expect(messageOf(state)).toBe('全部完成。');
    // The exact thing the `typeof` else-arm produced for a map.
    expect(state.textContent).not.toMatch(/Nothing here yet/i);
  });

  it('en: the same maps paint the en entries', async () => {
    const state = await emptyStateFor({ title: TITLE, message: MESSAGE }, 'en');
    expect(headingOf(state)).toBe('No open work');
    expect(messageOf(state)).toBe('Everything is done.');
  });

  it('a map with no usable entry keeps the default copy, as an absent member does', async () => {
    const absent = await emptyStateFor({}, 'en');
    const defaults = [headingOf(absent), messageOf(absent)];
    cleanup();
    const unusable = await emptyStateFor({ title: {}, message: {} }, 'en');
    expect([headingOf(unusable), messageOf(unusable)]).toEqual(defaults);
    // Non-vacuity: the default is real copy, not an empty node.
    expect(defaults[0]).toMatch(/Nothing here yet/i);
  });

  it('CONTROL: plain-string members pass through unchanged, under zh-CN', async () => {
    const state = await emptyStateFor({ title: 'No open work', message: 'Everything is done.' }, 'zh-CN');
    expect(headingOf(state)).toBe('No open work');
    expect(messageOf(state)).toBe('Everything is done.');
  });
});
