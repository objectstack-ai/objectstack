/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#36370 — 视图设置 on a board: the board's own settings in place
 * of the table's.
 *
 * Pinned here:
 *   - the first level shows the lane field, 「5 / 7」 shown lanes, the card
 *     fields in place, the two card toggles and the lane statistic, and none
 *     of the table's 「Shown columns」, Group, Row height or Row colour;
 *   - the lane field level lists the fields offered and writes a pick;
 *   - the lanes level hides a lane, shows a hidden one at the end, and keeps
 *     the last lane (no eye on it);
 *   - the card fields hide in place, and 「+ Add field」 adds one at the end;
 *   - each toggle writes its next value; the statistic level offers none,
 *     count and a number field's sum (no average) and writes the pick (`null`
 *     for None);
 *   - the zh pack names every row.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { I18nProvider, useObjectTranslation } from '@object-ui/i18n';
import {
  ViewSettingsPopover,
  type ViewSettingsKanban,
  type ViewSettingsPopoverProps,
} from '../components/ViewSettingsPopover';

afterEach(cleanup);

const FIELDS = [
  { name: 'name', label: 'Name' },
  { name: 'stage', label: 'Stage' },
];

function kanbanOf(overrides: Partial<ViewSettingsKanban> = {}): ViewSettingsKanban {
  return {
    laneField: 'stage',
    laneFieldOptions: [{ value: 'stage', label: 'Stage' }, { value: 'owner', label: 'Owner' }],
    onLaneFieldChange: vi.fn(),
    lanes: [
      { value: 'new', label: 'New' },
      { value: 'proposal', label: 'Proposal' },
      { value: 'won', label: 'Won' },
    ],
    shownLanes: ['new', 'proposal'],
    onShownLanesChange: vi.fn(),
    cardFields: ['amount', 'account'],
    cardFieldCandidates: [
      { name: 'amount', label: 'Amount' },
      { name: 'account', label: 'Account' },
      { name: 'close_date', label: 'Close date' },
    ],
    onCardFieldsChange: vi.fn(),
    showFieldLabels: { value: true, onChange: vi.fn() },
    hideEmptyFields: { value: true, onChange: vi.fn() },
    summary: {
      value: { type: 'sum', field: 'amount' },
      numberFields: [{ value: 'amount', label: 'Amount' }],
      onChange: vi.fn(),
    },
    ...overrides,
  };
}

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
      showGroup
      setGroupingConfig={() => {}}
      showDensity
      density={{ mode: 'comfortable', cycle: () => {}, setMode: () => {} }}
      showColor
      setRowColorConfig={() => {}}
      {...props}
    />
  );
}

function openMenu(props: Overrides, language = 'en') {
  const view = render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }} persistLanguage={false}>
      <Harness {...props} />
    </I18nProvider>,
  );
  fireEvent.click(screen.getByTestId('toolbar-display-trigger'));
  return view;
}

const value = (testId: string) => screen.getByTestId(`${testId}-value`).textContent;

describe('视图设置 on a board (objectstack#36370)', () => {
  it('shows the board settings and none of the table ones', () => {
    openMenu({ kanban: kanbanOf() });
    expect(value('options-row-lane-field')).toBe('Stage');
    expect(value('options-row-lanes')).toBe('2 / 3');
    expect(screen.getByTestId('options-card-fields-list-row-amount')).toBeTruthy();
    expect(screen.getByTestId('options-toggle-field-labels')).toBeTruthy();
    expect(screen.getByTestId('options-toggle-hide-empty')).toBeTruthy();
    expect(value('options-row-lane-summary')).toBe('Sum · Amount');
    for (const gone of ['options-columns', 'options-row-group', 'options-row-row-height', 'options-row-color']) {
      expect(screen.queryByTestId(gone)).toBeNull();
    }
  });

  it('picks another lane field', () => {
    const kanban = kanbanOf();
    openMenu({ kanban });
    fireEvent.click(screen.getByTestId('options-row-lane-field'));
    fireEvent.click(screen.getByTestId('options-lane-field-owner'));
    expect(kanban.onLaneFieldChange).toHaveBeenCalledWith('owner');
  });

  it('hides a lane, shows a hidden one at the end, and keeps the last lane', () => {
    const kanban = kanbanOf();
    openMenu({ kanban });
    fireEvent.click(screen.getByTestId('options-row-lanes'));
    // Lanes are no fields: their own heading over the hidden ones, no type icon.
    expect(screen.getByTestId('options-page-lanes').textContent).toContain('Hidden columns');
    expect(screen.queryByTestId('options-lanes-icon')).toBeNull();
    fireEvent.click(screen.getByTestId('options-lanes-hide-new'));
    expect(kanban.onShownLanesChange).toHaveBeenLastCalledWith(['proposal']);
    fireEvent.click(screen.getByTestId('options-lanes-item-won'));
    expect(kanban.onShownLanesChange).toHaveBeenLastCalledWith(['new', 'proposal', 'won']);
    cleanup();

    openMenu({ kanban: kanbanOf({ shownLanes: ['won'] }) });
    fireEvent.click(screen.getByTestId('options-row-lanes'));
    expect(screen.queryByTestId('options-lanes-hide-won')).toBeNull();
  });

  it('hides a card field in place and adds one at the end', () => {
    const kanban = kanbanOf();
    openMenu({ kanban });
    fireEvent.click(screen.getByTestId('options-card-fields-list-hide-amount'));
    expect(kanban.onCardFieldsChange).toHaveBeenLastCalledWith(['account']);
    fireEvent.click(screen.getByTestId('options-add-card-field'));
    fireEvent.click(screen.getByTestId('options-card-field-candidates-item-close_date'));
    expect(kanban.onCardFieldsChange).toHaveBeenLastCalledWith(['amount', 'account', 'close_date']);
  });

  it('writes each toggle and the statistic', () => {
    // The board counts today, so each pick below is a change (picking the
    // current statistic writes nothing).
    const kanban = kanbanOf({
      summary: { value: { type: 'count' }, numberFields: [{ value: 'amount', label: 'Amount' }], onChange: vi.fn() },
    });
    openMenu({ kanban });
    fireEvent.click(screen.getByTestId('options-toggle-field-labels-switch'));
    expect(kanban.showFieldLabels!.onChange).toHaveBeenCalledWith(false);
    fireEvent.click(screen.getByTestId('options-toggle-hide-empty-switch'));
    expect(kanban.hideEmptyFields!.onChange).toHaveBeenCalledWith(false);
    fireEvent.click(screen.getByTestId('options-row-lane-summary'));
    fireEvent.click(screen.getByTestId('options-lane-summary-count'));
    expect(kanban.summary!.onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('options-row-lane-summary'));
    // The board computes a count or a sum (`KanbanLaneSummarySchema`): no average.
    expect(screen.queryByTestId('options-lane-summary-avg:amount')).toBeNull();
    fireEvent.click(screen.getByTestId('options-lane-summary-sum:amount'));
    expect(kanban.summary!.onChange).toHaveBeenLastCalledWith({ type: 'sum', field: 'amount' });
    fireEvent.click(screen.getByTestId('options-row-lane-summary'));
    fireEvent.click(screen.getByTestId('options-lane-summary-none'));
    expect(kanban.summary!.onChange).toHaveBeenLastCalledWith(null);
  });

  it('names every board row in the zh pack', () => {
    openMenu({ kanban: kanbanOf() }, 'zh');
    const text = screen.getByTestId('options-menu').textContent ?? '';
    for (const words of ['分列字段', '显示哪几列', '卡片上显示的字段', '添加字段', '显示字段名', '隐藏空字段', '列底统计']) {
      expect(text).toContain(words);
    }
  });
});
