/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * `object-grid`'s `emptyState` members, through the registry, with the
 * `I18nLabel` arm on `title` and `message` (objectui#11227).
 *
 * `@objectstack/spec` 17.6.0 declares `emptyState` on its
 * `ComponentPropsMap['object-grid']` row as the list view's own
 * `EmptyStateSchema`: strict over `{ title, message, icon }`, with `title` and
 * `message` typed `I18nLabel` (a plain string or an inline per-locale map) and
 * `icon` a string. `ObjectGrid` drew the two text members raw. A map reached
 * `DataEmptyState` as an object CHILD, which React refuses ("Objects are not
 * valid as a React child"), so the block failed to render. Each member is now
 * resolved against the display locale, as `label` and `description` are.
 *
 * This file is the member pin the console parity gate registers for
 * `object-grid.emptyState` (`MEMBER_PINS` in
 * `registry-inputs-spec-parity.test.ts`): it mounts the `{ type, properties }`
 * document a page carries through the real `SchemaRenderer` and the registered
 * block, over a grid with no record, and reads what each of the three members
 * draws. The string arm, the empty-search case and the not-drawn-with-rows case
 * are `ObjectGrid.declaredKeys-11068.test.tsx`'s rows and are not repeated here.
 *
 * No regional locale is provided, so the display locale is the UI language.
 * Every map lists `en` FIRST, so under `zh` a resolver that fell back to `en`
 * or to the first entry would paint English and fail the row.
 */

import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { I18nProvider } from '@object-ui/i18n';
import { ActionProvider, SchemaRenderer } from '@object-ui/react';
// Registers `object-grid`, the block under test.
import '../index';

afterEach(() => cleanup());

/** `en` first on purpose; see the file header. */
const TITLE = { en: 'No contacts yet', 'zh-CN': '还没有联系人' };
const MESSAGE = { en: 'Add one to get started', 'zh-CN': '添加一个联系人开始使用' };

/** The table's own empty-row heading: the default an authored `title` replaces. */
const TABLE_EMPTY_HEADING = 'No results found';

/** A JSON document: the node and its `properties` bag over no record at all. */
const doc = (emptyState: unknown) => ({
  type: 'object-grid',
  properties: {
    objectName: 'contacts',
    columns: [{ field: 'name', label: 'Name' }],
    data: { provider: 'value', items: [] },
    emptyState,
  },
});

function mountIn(language: string, emptyState: unknown) {
  return render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }}>
      <ActionProvider>
        <SchemaRenderer schema={doc(emptyState) as never} />
      </ActionProvider>
    </I18nProvider>,
  );
}

/** The drawn empty state, once it is on screen; a render failure fails here. */
async function emptyStateOf(container: HTMLElement): Promise<HTMLElement> {
  await waitFor(() => expect(container.querySelector('[data-testid="object-grid-empty-state"]')).not.toBeNull());
  // The defect's own signature: an object child throws, and the block is
  // replaced by its error boundary instead of drawing anything.
  expect(container.textContent ?? '').not.toContain('failed to render');
  expect(container.textContent ?? '').not.toContain('[object Object]');
  return container.querySelector('[data-testid="object-grid-empty-state"]') as HTMLElement;
}

const headingOf = (state: HTMLElement) => state.querySelector('h3')?.textContent ?? null;
const messageOf = (state: HTMLElement) => state.querySelector('p')?.textContent ?? null;

describe('object-grid `emptyState.title` / `.message` resolve an inline locale map (objectui#11227)', () => {
  it('zh: the heading and the line below it paint the zh-CN entries, with the authored icon', async () => {
    const { container } = mountIn('zh', { title: TITLE, message: MESSAGE, icon: 'users' });
    const state = await emptyStateOf(container);
    expect(headingOf(state)).toBe('还没有联系人');
    expect(messageOf(state)).toBe('添加一个联系人开始使用');
    // `icon` stays a plain Lucide name, read off the same object.
    expect(state.querySelector('svg.lucide-users')).not.toBeNull();
    // It replaces the table, as the string arm does.
    expect(container.querySelector('table')).toBeNull();
  });

  it('en: the same maps paint the en entries', async () => {
    const { container } = mountIn('en', { title: TITLE, message: MESSAGE });
    const state = await emptyStateOf(container);
    expect(headingOf(state)).toBe('No contacts yet');
    expect(messageOf(state)).toBe('Add one to get started');
  });

  it('the members resolve independently: a map title beside a plain-string message', async () => {
    const { container } = mountIn('zh', { title: TITLE, message: 'Add one to get started' });
    const state = await emptyStateOf(container);
    expect(headingOf(state)).toBe('还没有联系人');
    expect(messageOf(state)).toBe('Add one to get started');
  });

  it('a map with no usable entry keeps that member’s default: the table’s heading, and no line', async () => {
    // Under `en`, where the default heading is the English one this file names
    // (under `zh` the locale pack translates it).
    const { container } = mountIn('en', { title: {}, message: {} });
    const state = await emptyStateOf(container);
    expect(headingOf(state)).toBe(TABLE_EMPTY_HEADING);
    expect(state.querySelector('p')).toBeNull();
  });

  it('CONTROL: plain-string members render exactly as authored, under zh', async () => {
    const { container } = mountIn('zh', { title: 'No contacts yet', message: 'Add one to get started' });
    const state = await emptyStateOf(container);
    expect(headingOf(state)).toBe('No contacts yet');
    expect(messageOf(state)).toBe('Add one to get started');
  });
});
