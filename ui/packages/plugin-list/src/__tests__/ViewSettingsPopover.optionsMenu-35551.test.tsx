/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The list's Options menu: one row per setting, its name on the left and its
 * current value on the right, each opening a second level.
 *
 * Pinned here:
 *   - the first level's rows and values, and the view's name at the top
 *     (renamed in place only where the host passes `onRename`);
 *   - Fields: search, the eye hides a shown field, one click shows a hidden
 *     one or adds an addable one; three clicks from the trigger hide a column
 *     and three show it again;
 *   - dragging (and the arrow keys on the handle) reorders the SHOWN fields
 *     and writes the whole order, a hidden field keeping its relative place
 *     (the level is the list's shared `FieldList`);
 *   - Row height lists three heights when the host can set one;
 *   - 保存 sits beside 恢复默认 when the host hands a save over, and the host
 *     may say when 恢复默认 is live (`resetDisabled`);
 *   - no control of the menu is an icon without a name, and no line speaks
 *     the developer wording the menu dropped (asserted against the zh pack).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within, act } from '@testing-library/react';
import { I18nProvider, useObjectTranslation } from '@object-ui/i18n';
import { en, zh as zhPack } from '@object-ui/i18n/locales';
import {
  ViewSettingsPopover,
  orderFields,
  type ViewSettingsPopoverProps,
} from '../components/ViewSettingsPopover';
import { ViewSwitcherDropdown } from '../ViewSwitcher';

afterEach(cleanup);

const FIELDS = [
  { name: 'name', label: 'Name' },
  { name: 'stage', label: 'Stage' },
  { name: 'amount', label: 'Amount' },
  { name: 'probability', label: 'Probability' },
];

type Overrides = Partial<Omit<ViewSettingsPopoverProps, 't'>>;

function Harness(props: Overrides) {
  const { t } = useObjectTranslation();
  return (
    <ViewSettingsPopover
      t={t as (key: string, opts?: any) => string}
      allFields={FIELDS}
      showHideFields
      hiddenFields={new Set()}
      updateHiddenFields={() => {}}
      {...props}
    />
  );
}

function openMenu(props: Overrides = {}, language = 'en') {
  const view = render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }} persistLanguage={false}>
      <Harness {...props} />
    </I18nProvider>,
  );
  fireEvent.click(screen.getByTestId('toolbar-display-trigger'));
  return view;
}

const value = (testId: string) => screen.getByTestId(`${testId}-value`).textContent;

describe('Options menu — the first level', () => {
  it('draws one row per offered setting, its current value on the right', () => {
    openMenu({
      hiddenFields: new Set(['amount']),
      layout: (closeMenu) => (
        <ViewSwitcherDropdown currentView="grid" availableViews={['grid', 'kanban']} onViewChange={closeMenu} />
      ),
      showGroup: true,
      setGroupingConfig: () => {},
      groupingConfig: { fields: [{ field: 'stage', order: 'asc' }] },
      showDensity: true,
      density: { mode: 'comfortable', cycle: () => {}, setMode: () => {} },
    });
    expect(value('options-row-layout')).toBe('Grid');
    // objectstack#35878: the shown columns are in place on this level.
    expect(screen.getByTestId('options-columns-list')).toBeInTheDocument();
    expect(value('options-row-group')).toBe('Stage');
    expect(value('options-row-row-height')).toBe('Standard');
    // objectstack#35878: no More level on this panel.
    expect(screen.queryByTestId('options-row-more')).toBeNull();
  });

  it('opens a second level per row, and its back control returns to the menu', () => {
    openMenu({ showDensity: true, density: { mode: 'compact', cycle: () => {}, setMode: () => {} } });
    fireEvent.click(screen.getByTestId('options-row-row-height'));
    expect(screen.getByTestId('options-page-row-height')).toBeTruthy();
    expect(screen.queryByTestId('options-menu')).toBeNull();
    fireEvent.click(screen.getByTestId('options-back'));
    expect(screen.getByTestId('options-menu')).toBeTruthy();
  });

  it('the layout level lists every layout by its words, and choosing one closes the menu', () => {
    const onViewChange = vi.fn();
    openMenu({
      layout: (closeMenu) => (
        <ViewSwitcherDropdown
          currentView="grid"
          availableViews={['grid', 'kanban', 'calendar', 'gallery', 'map']}
          onViewChange={(v) => { closeMenu(); onViewChange(v); }}
          animated={false}
        />
      ),
    });
    fireEvent.click(screen.getByTestId('options-row-layout'));
    const list = screen.getByTestId('view-switcher-list');
    expect(within(list).getAllByRole('radio').map((r) => r.textContent)).toEqual(['Grid', 'Kanban', 'Calendar', 'Gallery', 'Map']);
    fireEvent.click(within(list).getByRole('radio', { name: 'Kanban' }));
    expect(onViewChange).toHaveBeenCalledWith('kanban');
    expect(screen.queryByTestId('view-settings-content')).toBeNull();
  });

  it('a host that can only step through heights gets a row that steps', () => {
    const cycle = vi.fn();
    openMenu({ showDensity: true, density: { mode: 'spacious', cycle } });
    expect(screen.queryByTestId('options-row-row-height')).toBeNull();
    fireEvent.click(screen.getByTestId('view-settings-density-cycle'));
    expect(cycle).toHaveBeenCalledTimes(1);
  });

  it('Row height lists compact, standard and spacious and sets the one picked', () => {
    const setMode = vi.fn();
    openMenu({ showDensity: true, density: { mode: 'comfortable', cycle: () => {}, setMode } });
    fireEvent.click(screen.getByTestId('options-row-row-height'));
    const radios = screen.getAllByRole('radio');
    expect(radios.map((r) => r.textContent)).toEqual(['Compact', 'Standard', 'Spacious']);
    expect(radios[1].getAttribute('aria-checked')).toBe('true');
    fireEvent.click(radios[0]);
    expect(setMode).toHaveBeenCalledWith('compact');
  });
});

describe('Options menu — 保存 and 恢复默认', () => {
  it('a host with a save gets 保存 beside 恢复默认; it closes the menu and saves', () => {
    const onSave = vi.fn();
    const onReset = vi.fn();
    openMenu({ onSave, onReset, resetDisabled: false }, 'zh');
    const save = screen.getByTestId('display-save-button');
    const reset = screen.getByTestId('display-reset-button');
    expect(save).toHaveTextContent('保存');
    expect(reset).toHaveTextContent('恢复默认');
    // Side by side, 保存 first.
    expect(save.parentElement).toBe(reset.parentElement);
    expect(save.compareDocumentPosition(reset) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(save);
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onReset).not.toHaveBeenCalled();
    expect(screen.queryByTestId('display-save-button')).toBeNull();
  });

  it('no save, no 保存; the host decides when 恢复默认 is live', () => {
    openMenu({ onReset: () => {}, resetDisabled: true });
    expect(screen.queryByTestId('display-save-button')).toBeNull();
    expect(screen.getByTestId('display-reset-button')).toBeDisabled();
    cleanup();
    openMenu({ onReset: () => {}, resetDisabled: false });
    expect(screen.getByTestId('display-reset-button')).toBeEnabled();
  });

  it('without `resetDisabled`, 恢复默认 is live only once a setting changed', () => {
    openMenu({ onReset: () => {} });
    expect(screen.getByTestId('display-reset-button')).toBeDisabled();
  });
});

describe('Options menu — the view name', () => {
  it('is renamed in place: Enter keeps a changed name', async () => {
    const onRename = vi.fn().mockResolvedValue(true);
    openMenu({ viewName: { label: 'Open deals', onRename } });
    const input = screen.getByTestId('options-view-name-input') as HTMLInputElement;
    expect(input.value).toBe('Open deals');
    fireEvent.change(input, { target: { value: 'My open deals' } });
    await act(async () => { fireEvent.keyDown(input, { key: 'Enter' }); });
    expect(onRename).toHaveBeenCalledWith('My open deals');
  });

  it('opening the menu does not put the cursor in the name: a key pressed then renames nothing', () => {
    const onRename = vi.fn();
    openMenu({ viewName: { label: 'Hot deals', onRename } });
    const input = screen.getByTestId('options-view-name-input');
    expect(document.activeElement).not.toBe(input);
    expect(screen.getByTestId('view-settings-content').contains(document.activeElement)).toBe(true);
  });

  it('a refused rename shows the name it had; Escape puts it back too', async () => {
    const onRename = vi.fn().mockResolvedValue(false);
    openMenu({ viewName: { label: 'Open deals', onRename } });
    const input = screen.getByTestId('options-view-name-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Taken' } });
    await act(async () => { fireEvent.keyDown(input, { key: 'Enter' }); });
    expect(input.value).toBe('Open deals');
    fireEvent.change(input, { target: { value: 'Draft' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(input.value).toBe('Open deals');
  });

  it('without `onRename` the name is shown, not edited', () => {
    openMenu({ viewName: { label: 'All deals' } });
    expect(screen.getByTestId('options-view-name').textContent).toBe('All deals');
    expect(screen.queryByTestId('options-view-name-input')).toBeNull();
  });
});

describe('Options menu — Fields', () => {
  it('hides a column in three clicks from the trigger, and shows it again in three', () => {
    const updateHiddenFields = vi.fn();
    openMenu({ updateHiddenFields });
    // 1 = the trigger (openMenu), 2 = Fields, 3 = the eye.
    fireEvent.click(screen.getByTestId('options-add-column'));
    fireEvent.click(screen.getByTestId('options-fields-hide-probability'));
    expect([...updateHiddenFields.mock.calls[0][0]]).toEqual(['probability']);
    cleanup();

    const show = vi.fn();
    openMenu({ hiddenFields: new Set(['probability']), updateHiddenFields: show });
    fireEvent.click(screen.getByTestId('options-add-column'));
    fireEvent.click(screen.getByTestId('options-fields-item-probability'));
    expect([...show.mock.calls[0][0]]).toEqual([]);
  });

  it('search narrows both lists; an addable field is added with one click', () => {
    const onAddField = vi.fn();
    openMenu({ addableFields: [{ name: 'close_date', label: 'Close date' }], onAddField });
    fireEvent.click(screen.getByTestId('options-add-column'));
    fireEvent.change(screen.getByTestId('options-fields-search'), { target: { value: 'clo' } });
    expect(screen.queryByTestId('options-fields-shown')).toBeNull();
    fireEvent.click(screen.getByTestId('options-fields-item-close_date'));
    expect(onAddField).toHaveBeenCalledWith('close_date');
    fireEvent.change(screen.getByTestId('options-fields-search'), { target: { value: 'zzz' } });
    expect(screen.getByTestId('options-fields-empty')).toBeTruthy();
  });

  it('dragging a shown field writes the whole order, a hidden field keeping its relative place', () => {
    const onFieldOrderChange = vi.fn();
    openMenu({ hiddenFields: new Set(['stage']), onFieldOrderChange, fieldOrder: ['name', 'stage', 'amount', 'probability'] });
    fireEvent.click(screen.getByTestId('options-add-column'));
    const dataTransfer = { setData: vi.fn(), getData: vi.fn(() => 'probability'), effectAllowed: '', dropEffect: '' };
    fireEvent.dragStart(screen.getByTestId('options-fields-row-probability'), { dataTransfer });
    fireEvent.dragOver(screen.getByTestId('options-fields-row-name'), { dataTransfer });
    fireEvent.drop(screen.getByTestId('options-fields-row-name'), { dataTransfer });
    expect(onFieldOrderChange).toHaveBeenCalledWith(['probability', 'name', 'stage', 'amount']);
  });

  it('the handle moves a field with the arrow keys', () => {
    const onFieldOrderChange = vi.fn();
    openMenu({ onFieldOrderChange });
    fireEvent.click(screen.getByTestId('options-add-column'));
    fireEvent.keyDown(screen.getByTestId('options-fields-move-name'), { key: 'ArrowDown' });
    expect(onFieldOrderChange).toHaveBeenCalledWith(['stage', 'name', 'amount', 'probability']);
  });

  it('offers no drag without a host to write the order, and none while searching', () => {
    openMenu({ onFieldOrderChange: undefined });
    fireEvent.click(screen.getByTestId('options-add-column'));
    expect(screen.queryByTestId('options-fields-move-name')).toBeNull();
    cleanup();
    openMenu({ onFieldOrderChange: () => {} });
    fireEvent.click(screen.getByTestId('options-add-column'));
    expect(screen.getByTestId('options-fields-move-name')).toBeTruthy();
    fireEvent.change(screen.getByTestId('options-fields-search'), { target: { value: 'a' } });
    expect(screen.queryByTestId('options-fields-move-name')).toBeNull();
  });
});

describe('Options menu — words', () => {
  it('every control in the menu and on each level has a name', () => {
    openMenu({
      viewName: { label: 'Open deals', onRename: () => true },
      onFieldOrderChange: () => {},
      hiddenFields: new Set(['amount']),
      onReset: () => {},
      changedCount: 1,
    }, 'zh');
    const named = (root: HTMLElement) => {
      for (const control of within(root).queryAllByRole('button').concat(within(root).queryAllByRole('textbox'))) {
        const name = control.getAttribute('aria-label') || control.textContent?.trim();
        expect(name, control.outerHTML).toBeTruthy();
      }
    };
    named(screen.getByTestId('view-settings-content'));
    expect(screen.getByTestId('display-reset-button').textContent).toBe(zhPack.list.optionsMenu.restoreDefaults);
    fireEvent.click(screen.getByTestId('options-add-column'));
    named(screen.getByTestId('view-settings-content'));
  });


  it('every new key is in the en pack', () => {
    expect(Object.keys(en.list.optionsMenu).sort()).toEqual(Object.keys(zhPack.list.optionsMenu).sort());
  });
});

describe('field order helpers', () => {
  it('orderFields puts the listed names first, the rest in their own order', () => {
    expect(orderFields(FIELDS, ['amount', 'name']).map((f) => f.name)).toEqual(['amount', 'name', 'stage', 'probability']);
    expect(orderFields(FIELDS, undefined).map((f) => f.name)).toEqual(['name', 'stage', 'amount', 'probability']);
  });
});
