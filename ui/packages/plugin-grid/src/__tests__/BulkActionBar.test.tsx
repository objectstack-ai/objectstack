/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#35678 — the selection bar: 「已选 N 条」 and ×, up to three
 * labelled actions (all of them when the selection offers no more than three,
 * Delete included), the rest behind More; 「选择全部 N 条」 when every loaded
 * row is selected and more match; × and Esc clear the selection.
 */
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent, within, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { I18nProvider } from '@object-ui/react';
import type { BulkActionDef } from '@object-ui/types';
import {
  BulkActionBar,
  SELECTION_EXPOSED_ACTIONS,
  planExposedEntries,
  singleRecordEntries,
} from '../components/SelectionBar';
import type { RowActionMenuPlan } from '../components/RowActionMenu';

afterEach(cleanup);

const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ id: String(i + 1) }));
const def = (name: string, extra: Partial<BulkActionDef> = {}): BulkActionDef => ({ name, label: name, ...extra });

// The bar surfaces its strings via useObjectTranslation, so tests wrap in an
// English i18n provider — otherwise `{{count}}` interpolation never runs and
// the raw templates leak into the DOM.
const renderBar = (ui: React.ReactElement) =>
  render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }} persistLanguage={false}>
      {ui}
    </I18nProvider>,
  );

const exposedNames = () =>
  within(screen.getByTestId('bulk-actions-bar'))
    .queryAllByRole('button')
    .map((b) => b.getAttribute('data-testid'))
    .filter((id) => id !== 'bulk-selection-clear' && id !== 'selection-actions-more');

describe('planExposedEntries', () => {
  const entries = (...keys: string[]) => keys.map((key) => ({ key, destructive: key.startsWith('delete') }));
  const notDestructive = (e: { destructive: boolean }) => !e.destructive;

  it('the budget is three', () => {
    expect(SELECTION_EXPOSED_ACTIONS).toBe(3);
  });

  it('exposes every entry, Delete included, when there are no more than the budget', () => {
    const all = entries('a', 'b', 'delete');
    expect(planExposedEntries(all, notDestructive, 3)).toEqual({ exposed: all, rest: [] });
    const lone = entries('delete');
    expect(planExposedEntries(lone, notDestructive, 3)).toEqual({ exposed: lone, rest: [] });
  });

  it('over the budget, exposes the first entries the predicate admits and leaves the rest in menu order', () => {
    const all = entries('a', 'b', 'c', 'd', 'delete');
    const { exposed, rest } = planExposedEntries(all, notDestructive, 3);
    expect(exposed.map((e) => e.key)).toEqual(['a', 'b', 'c']);
    expect(rest.map((e) => e.key)).toEqual(['d', 'delete']);
  });

  it('a narrower fit gives the trailing exposed entries back to the menu, in order', () => {
    const all = entries('a', 'b', 'c', 'delete');
    const { exposed, rest } = planExposedEntries(all, notDestructive, 3, 1);
    expect(exposed.map((e) => e.key)).toEqual(['a']);
    expect(rest.map((e) => e.key)).toEqual(['b', 'c', 'delete']);
    expect(planExposedEntries(all, notDestructive, 3, 0).exposed).toEqual([]);
  });
});

describe('singleRecordEntries', () => {
  it("lists one record's actions in its row menu's order, Delete last", () => {
    const plan: RowActionMenuPlan = {
      inline: [{ name: 'approve' }],
      custom: [{ name: 'share' }],
      edit: true,
      remove: true,
      legacy: ['archive'],
      menuCount: 4,
    };
    expect(singleRecordEntries(plan).map((e) => e.key)).toEqual(['def:approve', 'def:share', 'edit', 'legacy:archive', 'delete']);
  });
});

describe('BulkActionBar', () => {
  it('renders nothing when selection empty', () => {
    renderBar(<BulkActionBar selectedRows={[]} actions={['delete']} />);
    expect(screen.queryByTestId('bulk-actions-bar')).toBeNull();
  });

  it('shows the count and × even with no actions, and no More', () => {
    renderBar(<BulkActionBar selectedRows={rows(2)} actions={[]} />);
    expect(screen.getByTestId('bulk-selection-count')).toHaveTextContent('2 selected');
    expect(screen.getByTestId('bulk-selection-clear')).toHaveAccessibleName('Clear');
    expect(screen.queryByTestId('selection-actions-more')).toBeNull();
    expect(exposedNames()).toEqual([]);
  });

  it('a selection whose only action is Delete shows Delete as a button, not behind More', () => {
    renderBar(<BulkActionBar selectedRows={rows(2)} actions={['delete']} />);
    expect(screen.getByTestId('bulk-action-delete')).toHaveTextContent('Delete');
    expect(screen.queryByTestId('selection-actions-more')).toBeNull();
  });

  it('three actions are three buttons; a fourth sends Delete and the overflow behind More', () => {
    const { unmount } = renderBar(
      <BulkActionBar selectedRows={rows(2)} actions={['delete']} actionDefs={[def('assign'), def('tag')]} />,
    );
    expect(exposedNames()).toEqual(['bulk-action-assign', 'bulk-action-tag', 'bulk-action-delete']);
    expect(screen.queryByTestId('selection-actions-more')).toBeNull();
    unmount();

    renderBar(
      <BulkActionBar
        selectedRows={rows(2)}
        actions={['delete']}
        actionDefs={[def('assign'), def('tag'), def('export'), def('merge')]}
      />,
    );
    expect(exposedNames()).toEqual(['bulk-action-assign', 'bulk-action-tag', 'bulk-action-export']);
    expect(screen.getByTestId('selection-actions-more')).toHaveTextContent('More');
  });

  it('More opens the actions not exposed, Delete last', async () => {
    const onAction = vi.fn();
    renderBar(
      <BulkActionBar
        selectedRows={rows(2)}
        actions={['delete']}
        actionDefs={[def('assign'), def('tag'), def('export'), def('merge')]}
        onAction={onAction}
      />,
    );
    const more = screen.getByTestId('selection-actions-more');
    fireEvent.pointerDown(more, { button: 0, pointerType: 'mouse' });
    const menu = await screen.findByRole('menu');
    const items = within(menu).getAllByRole('menuitem').map((i) => i.textContent);
    expect(items).toEqual(['merge', 'Delete']);
    fireEvent.click(within(menu).getByText('Delete'));
    expect(onAction).toHaveBeenCalledWith('delete', rows(2));
  });

  it("one selected record offers that record's own actions, not the bulk ones", () => {
    const row = { id: '7' };
    const onEdit = vi.fn();
    renderBar(
      <BulkActionBar
        selectedRows={[row]}
        actions={['delete']}
        actionDefs={[def('assign')]}
        singleRowMenu={{ row, canEdit: true, onEdit, canDelete: true, onDelete: () => {}, rowActionDefs: [{ name: 'share', label: 'Share' }] }}
      />,
    );
    expect(screen.getByTestId('bulk-selection-count')).toHaveTextContent('1 selected');
    expect(screen.queryByTestId('bulk-action-assign')).toBeNull();
    // Share, Edit and Delete: three, so all three are buttons.
    expect(exposedNames()).toEqual(['row-action-inline-share', 'selection-action-edit', 'selection-action-delete']);
    fireEvent.click(screen.getByTestId('selection-action-edit'));
    expect(onEdit).toHaveBeenCalledWith(row);
  });

  it("over three of one record's actions, Delete stays behind More", () => {
    const row = { id: '7' };
    renderBar(
      <BulkActionBar
        selectedRows={[row]}
        actions={[]}
        singleRowMenu={{
          row,
          canEdit: true,
          onEdit: () => {},
          canDelete: true,
          onDelete: () => {},
          rowActionDefs: [{ name: 'share', label: 'Share' }, { name: 'clone', label: 'Clone' }],
        }}
      />,
    );
    expect(exposedNames()).toEqual(['row-action-inline-share', 'row-action-inline-clone', 'selection-action-edit']);
    expect(screen.queryByTestId('selection-action-delete')).toBeNull();
    expect(screen.getByTestId('selection-actions-more')).toBeInTheDocument();
  });

  it('offers 「Select all N」 when every loaded row is selected and more match', () => {
    const onSelectAll = vi.fn();
    renderBar(
      <BulkActionBar
        selectedRows={rows(10)}
        actions={['delete']}
        pageSize={10}
        totalMatching={137}
        onSelectAllMatching={onSelectAll}
      />,
    );
    const cta = screen.getByTestId('bulk-select-all-matching');
    expect(cta).toHaveTextContent('Select all 137');
    fireEvent.click(cta);
    expect(onSelectAll).toHaveBeenCalledTimes(1);
  });

  it('does not offer it when nothing more matches', () => {
    renderBar(<BulkActionBar selectedRows={rows(5)} actions={['delete']} pageSize={5} totalMatching={5} onSelectAllMatching={() => {}} />);
    expect(screen.queryByTestId('bulk-select-all-matching')).toBeNull();
  });

  it('counts every match once the user opts in', () => {
    renderBar(
      <BulkActionBar selectedRows={rows(10)} actions={['delete']} pageSize={10} totalMatching={137} allMatchingSelected />,
    );
    expect(screen.getByTestId('bulk-selection-count')).toHaveTextContent('137 selected (all matches)');
    expect(screen.queryByTestId('bulk-select-all-matching')).toBeNull();
  });

  it('× clears the selection', () => {
    const onClear = vi.fn();
    renderBar(<BulkActionBar selectedRows={rows(2)} actions={['delete']} onClearSelection={onClear} />);
    fireEvent.click(screen.getByTestId('bulk-selection-clear'));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it('Esc clears the selection, unless it belongs to a field or another open layer', () => {
    const onClear = vi.fn();
    renderBar(
      <>
        <input data-testid="field" />
        <BulkActionBar selectedRows={rows(2)} actions={['delete']} onClearSelection={onClear} />
      </>,
    );
    fireEvent.keyDown(screen.getByTestId('field'), { key: 'Escape' });
    expect(onClear).not.toHaveBeenCalled();

    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    document.body.appendChild(dialog);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onClear).not.toHaveBeenCalled();
    dialog.remove();

    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it('Esc inside the dialog that holds the bar still clears it (a grid in the record drawer)', () => {
    const onClear = vi.fn();
    renderBar(
      <div role="dialog">
        <BulkActionBar selectedRows={rows(2)} actions={['delete']} onClearSelection={onClear} />
      </div>,
    );
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});
