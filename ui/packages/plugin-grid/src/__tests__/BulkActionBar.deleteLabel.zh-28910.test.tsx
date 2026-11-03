/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#28910 — the built-in string bulk action `delete` reads the
 * grid's translation key.
 *
 * An object with no declared bulk actions gets the string action `delete`,
 * and the bar drew it with `formatActionLabel`, so under zh it read "Delete".
 * `useBulkActionItems` now resolves the label once, so the bar's button and
 * the selection's context menu read `grid.delete` from the pack. Any other
 * string name is still formatted from itself, and a declared def keeps its
 * own label. Strings are read from the packs, never from literals.
 */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { I18nProvider } from '@object-ui/react';
import { DropdownMenu, DropdownMenuContent } from '@object-ui/components';
import { en, zh } from '@object-ui/i18n/locales';
import type { BulkActionDef } from '@object-ui/types';
import { BulkActionBar } from '../components/BulkActionBar';
import { SelectionContextMenuItems } from '../components/RowContextMenu';

afterEach(cleanup);

const ROWS = [{ id: '1' }, { id: '2' }];

const inLanguage = (language: string, node: React.ReactNode) => (
  <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }} persistLanguage={false}>
    {node}
  </I18nProvider>
);

const renderBar = (language: string, actions: string[], actionDefs?: BulkActionDef[]) =>
  render(inLanguage(language, <BulkActionBar selectedRows={ROWS} actions={actions} actionDefs={actionDefs} />));

const renderMenu = (language: string, actions: string[]) =>
  render(
    inLanguage(
      language,
      <DropdownMenu open>
        <DropdownMenuContent>
          <SelectionContextMenuItems selectedRows={ROWS} actions={actions} />
        </DropdownMenuContent>
      </DropdownMenu>,
    ),
  );

describe('the built-in bulk delete reads grid.delete (objectstack#28910)', () => {
  it('the zh pack translates the key, so the zh pins below can tell the two apart', () => {
    expect(zh.grid.delete).not.toBe(en.grid.delete);
  });

  it('under zh, the bar button reads the zh pack, not the English name', async () => {
    renderBar('zh', ['delete']);
    const button = await screen.findByTestId('bulk-action-delete');
    expect(button).toHaveTextContent(zh.grid.delete);
    expect(button).not.toHaveTextContent(en.grid.delete);
  });

  it('under en, the bar button reads the en pack', async () => {
    renderBar('en', ['delete']);
    expect(await screen.findByTestId('bulk-action-delete')).toHaveTextContent(en.grid.delete);
  });

  it("under zh, the selection's context menu reads the same zh label", async () => {
    renderMenu('zh', ['delete']);
    const item = await screen.findByTestId('row-context-bulk-delete');
    expect(item).toHaveTextContent(zh.grid.delete);
    expect(item).not.toHaveTextContent(en.grid.delete);
  });

  it('another string name is still formatted from itself', async () => {
    renderBar('zh', ['mark_paid']);
    expect(await screen.findByTestId('bulk-action-mark_paid')).toHaveTextContent('Mark Paid');
  });

  it('a declared bulk def keeps its own label', async () => {
    const def = { name: 'delete', label: 'Purge selected', operation: 'delete' } as BulkActionDef;
    renderBar('zh', [], [def]);
    expect(await screen.findByText('Purge selected')).toBeInTheDocument();
    expect(screen.queryByText(zh.grid.delete)).toBeNull();
  });
});
