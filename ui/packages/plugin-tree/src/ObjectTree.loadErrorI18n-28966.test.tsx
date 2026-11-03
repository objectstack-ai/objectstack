/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `ObjectTree`'s load failure speaks the session locale (objectstack#28966).
 *
 * It printed the English literal "Failed to load tree: MESSAGE" on every page.
 * It is now the failure panel (`DataErrorState`, `role="alert"`) titled by the
 * list's own `list.loadErrorTitle`, with the error's message under it, the
 * shape `ObjectGrid` gives its failure. The zh row is the one that was red; the
 * provider-less row pins the English the factory's defaults table supplies.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import { I18nProvider } from '@object-ui/i18n';
import { ObjectTree } from './ObjectTree';

const SERVER_SENTENCE = 'upstream refused the read';

function failingDataSource() {
  return {
    find: vi.fn(() => Promise.reject(new Error(SERVER_SENTENCE))),
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

const tree = (ds: ReturnType<typeof failingDataSource>) => (
  <ObjectTree
    schema={{
      type: 'object-tree',
      objectName: 'category',
      parentField: 'parent_id',
      labelField: 'name',
    } as never}
    dataSource={ds as never}
  />
);

afterEach(() => cleanup());

describe('ObjectTree load failure is translated', () => {
  it('zh: the translated title and the error message, in an alert, no English literal', async () => {
    render(
      <I18nProvider config={{ defaultLanguage: 'zh', detectBrowserLanguage: false }}>
        {tree(failingDataSource())}
      </I18nProvider>,
    );
    const panel = await screen.findByRole('alert');
    expect(panel).toHaveAttribute('data-testid', 'tree-load-error');
    expect(panel.querySelector('h3')?.textContent).toBe('无法加载记录');
    expect(panel.querySelector('p')?.textContent).toBe(SERVER_SENTENCE);
    expect(document.body.textContent).not.toMatch(/Failed to load tree/);
  });

  it('no provider: the English title from the defaults table, and the error message', async () => {
    render(tree(failingDataSource()));
    const panel = await screen.findByRole('alert');
    expect(panel.querySelector('h3')?.textContent).toBe('Couldn’t load records');
    expect(panel.querySelector('p')?.textContent).toBe(SERVER_SENTENCE);
  });
});
