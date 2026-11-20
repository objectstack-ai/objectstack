/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The list's condition controls: the shared field list, the quick filter (a
 * field, then its values by type, applied on every pick), the sort panel and
 * the condition row of sort chips, the view's own locked chips and the
 * reader's filter chips. Click budgets are counted from the view bar trigger,
 * which the host owns: one click is spent before any of these panels mounts.
 */

import { describe, it, expect, vi } from 'vitest';
import * as React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import type { FilterBuilderRowGroup, SortItem } from '@object-ui/components';
import { FieldList, fieldTypeIcon, moveFieldInOrder, orderFieldList } from '../FieldList';
import { FilterValuePanel, quickDateWindowValue } from '../FilterValuePanel';
import { ConditionChipRow, FilterPanel, SortPanel, describeConditionValue, sortDirectionLabel } from '../ListConditionControls';
import {
  addSortLevel,
  chipsAreIndependent,
  quickFilterFamily,
  readViewConditions,
  type ConditionField,
} from '../conditionModel';
import { LIST_CONDITION_DEFAULT_TRANSLATIONS } from '../conditionTranslations';

const STAGE: ConditionField = {
  value: 'stage',
  label: 'Stage',
  type: 'select',
  options: [
    { value: 'prospecting', label: 'Prospecting', color: 'blue' },
    { value: 'proposal', label: 'Proposal', color: '#f59e0b' },
    { value: 'negotiation', label: 'Negotiation', color: 'green' },
    { value: 'closed_won', label: 'Closed won', color: 'gray' },
  ],
};
const FIELDS: ConditionField[] = [
  { value: 'name', label: 'Name', type: 'text' },
  STAGE,
  { value: 'amount', label: 'Amount', type: 'currency' },
  { value: 'close_date', label: 'Close date', type: 'date' },
  { value: 'is_won', label: 'Won', type: 'boolean' },
  { value: 'account', label: 'Account', type: 'lookup', referenceTo: 'account' },
  { value: 'secret_note', label: 'Internal note', type: 'textarea' },
];
const SHOWN = ['name', 'amount', 'stage'];
const EMPTY: FilterBuilderRowGroup = { id: 'root', logic: 'and', conditions: [] };

/** Echo the host: hold the group the panel hands back and hand it in again. */
function ControlledFilterPanel({ onGroup }: { onGroup: (g: FilterBuilderRowGroup) => void }) {
  const [group, setGroup] = React.useState<FilterBuilderRowGroup>(EMPTY);
  return (
    <FilterPanel
      fields={FIELDS}
      shownFields={SHOWN}
      value={group}
      onChange={(next) => {
        setGroup(next);
        onGroup(next);
      }}
      renderAdvanced={() => <div data-testid="advanced-builder">advanced</div>}
    />
  );
}

describe('FieldList — the shared field list', () => {
  it('lists the fields the view shows first, in column order, then the hidden ones', () => {
    render(<FieldList fields={FIELDS} shownFields={SHOWN} onPick={() => {}} />);
    const shown = within(screen.getByTestId('field-list-shown')).getAllByRole('option').map((o) => o.getAttribute('data-field'));
    const hidden = within(screen.getByTestId('field-list-hidden')).getAllByRole('option').map((o) => o.getAttribute('data-field'));
    expect(shown).toEqual(['name', 'amount', 'stage']);
    expect(hidden).toEqual(['close_date', 'is_won', 'account', 'secret_note']);
    expect(screen.getByText(LIST_CONDITION_DEFAULT_TRANSLATIONS['listConditions.fieldList.hidden'])).toBeTruthy();
  });

  it('draws a type icon on every row, one icon per type family', () => {
    render(<FieldList fields={FIELDS} shownFields={SHOWN} onPick={() => {}} />);
    expect(screen.getAllByTestId('field-list-icon')).toHaveLength(FIELDS.length);
    expect(fieldTypeIcon('date')).not.toBe(fieldTypeIcon('text'));
    expect(fieldTypeIcon('select')).not.toBe(fieldTypeIcon('lookup'));
    expect(fieldTypeIcon('no_such_type')).toBe(fieldTypeIcon('text'));
  });

  it('narrows to the search on label or name, and Enter picks the first match', () => {
    const onPick = vi.fn();
    render(<FieldList fields={FIELDS} shownFields={SHOWN} onPick={onPick} />);
    const search = screen.getByTestId('field-list-search');
    fireEvent.change(search, { target: { value: 'sta' } });
    expect(screen.getAllByRole('option').map((o) => o.getAttribute('data-field'))).toEqual(['stage']);
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ value: 'stage' }));
    fireEvent.change(search, { target: { value: 'zzz' } });
    expect(screen.getByTestId('field-list-empty')).toBeTruthy();
  });

  it('orderFieldList keeps a shown name the field list does not carry out of both halves', () => {
    const { shown, hidden } = orderFieldList(FIELDS.slice(0, 2), ['ghost', 'stage']);
    expect(shown.map((f) => f.value)).toEqual(['stage']);
    expect(hidden.map((f) => f.value)).toEqual(['name']);
  });
});

/** Echo ux-3's host (Options → Fields): hold the columns and their order, and hand them in again. */
function ManagedFieldList({
  spy,
  initialShown = SHOWN,
  initialOrder,
  addable,
  searchPlaceholder,
}: {
  spy: { order: (o: string[]) => void; hide: (n: string) => void; show: (n: string) => void; add: (n: string) => void };
  initialShown?: string[];
  initialOrder?: string[];
  addable?: string[];
  searchPlaceholder?: string;
}) {
  const [shown, setShown] = React.useState<string[]>(initialShown);
  const [order, setOrder] = React.useState<string[]>(initialOrder ?? initialShown);
  const [extra, setExtra] = React.useState<string[] | undefined>(addable);
  return (
    <FieldList
      fields={FIELDS}
      shownFields={shown}
      order={order}
      onOrderChange={(next) => {
        spy.order(next);
        setOrder(next);
      }}
      onHide={(name) => {
        spy.hide(name);
        setShown((s) => s.filter((n) => n !== name));
      }}
      onShow={(name) => {
        spy.show(name);
        setShown((s) => [...s, name]);
        setOrder((o) => [...o.filter((n) => n !== name), name]);
      }}
      addable={extra}
      onAdd={(name) => {
        spy.add(name);
        setExtra((e) => e?.filter((n) => n !== name));
        setShown((s) => [...s, name]);
        setOrder((o) => [...o, name]);
      }}
      searchPlaceholder={searchPlaceholder}
      testId="columns"
    />
  );
}

const spies = () => ({ order: vi.fn(), hide: vi.fn(), show: vi.fn(), add: vi.fn() });
const shownNames = (testId = 'columns') =>
  Array.from(screen.getByTestId(`${testId}-shown`).querySelectorAll('[data-field]')).map((el) => el.getAttribute('data-field'));
const hiddenNames = (testId = 'columns') =>
  Array.from(screen.getByTestId(`${testId}-hidden`).querySelectorAll('[data-field]')).map((el) => el.getAttribute('data-field'));

describe('FieldList — the field manager (Options → Fields), every change applied at once', () => {
  it('reorders a shown field by drag and hands back the whole new order', () => {
    const spy = spies();
    render(<ManagedFieldList spy={spy} />);
    const stage = screen.getByTestId('columns-row-stage');
    expect(stage.getAttribute('draggable')).toBe('true');
    fireEvent.dragStart(stage);
    fireEvent.dragOver(screen.getByTestId('columns-row-name'));
    fireEvent.drop(screen.getByTestId('columns-row-name'));
    expect(spy.order).toHaveBeenCalledTimes(1);
    expect(spy.order).toHaveBeenLastCalledWith(['stage', 'name', 'amount']);
    expect(shownNames()).toEqual(['stage', 'name', 'amount']);
  });

  it('keeps the places of hidden fields the order names when a shown field moves', () => {
    expect(moveFieldInOrder(['name', 'secret_note', 'amount', 'stage'], 'stage', 'amount')).toEqual([
      'name',
      'secret_note',
      'stage',
      'amount',
    ]);
    const spy = spies();
    render(<ManagedFieldList spy={spy} initialOrder={['name', 'secret_note', 'amount', 'stage']} />);
    fireEvent.dragStart(screen.getByTestId('columns-row-stage'));
    fireEvent.drop(screen.getByTestId('columns-row-amount'));
    expect(spy.order).toHaveBeenLastCalledWith(['name', 'secret_note', 'stage', 'amount']);
  });

  it('reorders by keyboard from a grip handle with an accessible name, and keeps focus on it', () => {
    const spy = spies();
    render(<ManagedFieldList spy={spy} />);
    const grip = screen.getByRole('button', { name: 'Move Stage' });
    expect(grip.getAttribute('aria-describedby')).toBe('columns-move-hint');
    expect(document.getElementById('columns-move-hint')?.textContent).toMatch(/arrow keys/);
    grip.focus();
    fireEvent.keyDown(grip, { key: 'ArrowUp' });
    expect(spy.order).toHaveBeenLastCalledWith(['name', 'stage', 'amount']);
    expect(shownNames()).toEqual(['name', 'stage', 'amount']);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Move Stage' }));
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' });
    expect(shownNames()).toEqual(['stage', 'name', 'amount']);
    // At the top there is nowhere to go: no change is handed back.
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' });
    expect(spy.order).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    expect(shownNames()).toEqual(['name', 'stage', 'amount']);
  });

  it('turns reordering off while a search narrows the list', () => {
    render(<ManagedFieldList spy={spies()} />);
    fireEvent.change(screen.getByTestId('columns-search'), { target: { value: 'a' } });
    expect(screen.queryByTestId('columns-move-stage')).toBeNull();
    expect(screen.getByTestId('columns-row-stage').getAttribute('draggable')).toBeNull();
  });

  it('hides a shown field with its eye toggle and shows a hidden one again with one click', () => {
    const spy = spies();
    render(<ManagedFieldList spy={spy} />);
    fireEvent.click(screen.getByRole('button', { name: 'Hide Amount' }));
    expect(spy.hide).toHaveBeenCalledWith('amount');
    expect(shownNames()).toEqual(['name', 'stage']);
    expect(hiddenNames()).toContain('amount');
    // No eye toggle on a hidden row; the row itself shows it.
    expect(screen.queryByTestId('columns-hide-amount')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show Amount' }));
    expect(spy.show).toHaveBeenCalledWith('amount');
    expect(shownNames()).toEqual(['name', 'stage', 'amount']);
    expect(screen.queryByRole('button', { name: /^apply$/i })).toBeNull();
  });

  it('lists the addable fields under the hidden ones and adds one with one click', () => {
    const spy = spies();
    render(<ManagedFieldList spy={spy} addable={['account', 'close_date']} />);
    const sections = Array.from(screen.getByTestId('columns').querySelectorAll('[data-testid="columns-shown"], [data-testid="columns-hidden"], [data-testid="columns-addable"]')).map((el) => el.getAttribute('data-testid'));
    expect(sections).toEqual(['columns-shown', 'columns-hidden', 'columns-addable']);
    const addable = Array.from(screen.getByTestId('columns-addable').querySelectorAll('[data-field]')).map((el) => el.getAttribute('data-field'));
    expect(addable).toEqual(['account', 'close_date']);
    expect(hiddenNames()).not.toContain('account');
    fireEvent.click(screen.getByRole('button', { name: 'Add Account' }));
    expect(spy.add).toHaveBeenCalledWith('account');
    expect(shownNames()).toEqual(['name', 'amount', 'stage', 'account']);
  });

  it('takes a custom search placeholder as the placeholder and the accessible name', () => {
    render(<ManagedFieldList spy={spies()} searchPlaceholder="Search columns" />);
    const search = screen.getByTestId('columns-search');
    expect(search.getAttribute('placeholder')).toBe('Search columns');
    expect(screen.getByRole('textbox', { name: 'Search columns' })).toBe(search);
  });

  it('CONTROL: without the manager props the filter and sort list only picks — no grip, eye, add section or reorder', () => {
    const onPick = vi.fn();
    render(<FieldList fields={FIELDS} shownFields={SHOWN} addable={['account']} onPick={onPick} />);
    expect(screen.getByTestId('field-list-search').getAttribute('placeholder')).toBe('Search fields');
    expect(screen.getByRole('listbox')).toBeTruthy();
    expect(screen.queryByTestId('field-list-addable')).toBeNull();
    expect(screen.queryAllByRole('button', { name: /^(Move|Hide|Show|Add) / })).toHaveLength(0);
    expect(screen.getByTestId('field-list').querySelector('[draggable]')).toBeNull();
    // A hidden row still picks, as the filter and sort panels need.
    fireEvent.click(screen.getByTestId('field-list-item-account'));
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ value: 'account' }));
    expect(hiddenNames('field-list')).toContain('account');
  });
});

describe('FilterPanel — field, then values by type, applied on every pick', () => {
  it('filters on one stage in two clicks after the trigger (three in all) and on two stages in four', () => {
    const groups: FilterBuilderRowGroup[] = [];
    render(<ControlledFilterPanel onGroup={(g) => groups.push(g)} />);
    // click 2: the field
    fireEvent.click(screen.getByTestId('filter-panel-fields-item-stage'));
    // click 3: a value — the list filters now, no Apply
    fireEvent.click(within(screen.getByTestId('filter-panel-values-option-negotiation')).getByRole('checkbox'));
    expect(groups).toHaveLength(1);
    expect(groups[0].conditions).toEqual([
      expect.objectContaining({ field: 'stage', operator: 'in', value: ['negotiation'] }),
    ]);
    // click 4: a second value, applied again at once
    fireEvent.click(within(screen.getByTestId('filter-panel-values-option-proposal')).getByRole('checkbox'));
    expect(groups).toHaveLength(2);
    expect(groups[1].conditions[0]).toEqual(expect.objectContaining({ operator: 'in', value: ['negotiation', 'proposal'] }));
    // one row, edited in place
    expect(groups[1].conditions[0].id).toBe(groups[0].conditions[0].id);
  });

  it('removes the row once its last value is unpicked, and hands nothing up before a value is picked', () => {
    const groups: FilterBuilderRowGroup[] = [];
    render(<ControlledFilterPanel onGroup={(g) => groups.push(g)} />);
    fireEvent.click(screen.getByTestId('filter-panel-fields-item-stage'));
    expect(groups).toHaveLength(0);
    const box = () => within(screen.getByTestId('filter-panel-values-option-negotiation')).getByRole('checkbox');
    fireEvent.click(box());
    fireEvent.click(box());
    expect(groups.at(-1)?.conditions).toEqual([]);
  });

  it('draws option values as coloured pills with checkboxes (a multi-pick), never a single-pick dropdown', () => {
    render(<ControlledFilterPanel onGroup={() => {}} />);
    fireEvent.click(screen.getByTestId('filter-panel-fields-item-stage'));
    const options = STAGE.options!.map((o) => screen.getByTestId(`filter-panel-values-option-${o.value}`));
    expect(options).toHaveLength(4);
    expect(screen.getByRole('listbox').getAttribute('aria-multiselectable')).toBe('true');
    // the declared hex reaches the pill through custom properties only
    const hexPill = within(options[1]).getByText('Proposal');
    expect(hexPill.getAttribute('style') ?? '').toContain('--os-badge-bg');
    expect(hexPill.getAttribute('style') ?? '').not.toMatch(/(^|;)\s*(background-color|color)\s*:/);
  });

  it('a text field filters on what is typed (contains), after the typing pauses', () => {
    vi.useFakeTimers();
    try {
      const groups: FilterBuilderRowGroup[] = [];
      render(<ControlledFilterPanel onGroup={(g) => groups.push(g)} />);
      fireEvent.click(screen.getByTestId('filter-panel-fields-item-name'));
      fireEvent.change(screen.getByTestId('filter-panel-values-text'), { target: { value: 'acme' } });
      expect(groups).toHaveLength(0);
      act(() => {
        vi.advanceTimersByTime(300);
      });
      expect(groups.at(-1)?.conditions[0]).toEqual(expect.objectContaining({ field: 'name', operator: 'contains', value: 'acme' }));
    } finally {
      vi.useRealTimers();
    }
  });

  it('a date field offers relative windows, stored as the spec preset macros', () => {
    const groups: FilterBuilderRowGroup[] = [];
    render(<ControlledFilterPanel onGroup={(g) => groups.push(g)} />);
    fireEvent.click(screen.getByTestId('filter-panel-fields-item-close_date'));
    fireEvent.click(screen.getByTestId('filter-panel-values-window-this_month'));
    expect(groups.at(-1)?.conditions[0]).toEqual(
      expect.objectContaining({ operator: 'between', value: quickDateWindowValue('this_month') }),
    );
    expect(screen.getByTestId('filter-panel-values-custom')).toBeTruthy();
  });

  it('a boolean field is yes / no; a number field is ≥ and a value', () => {
    const groups: FilterBuilderRowGroup[] = [];
    render(<ControlledFilterPanel onGroup={(g) => groups.push(g)} />);
    fireEvent.click(screen.getByTestId('filter-panel-fields-item-is_won'));
    fireEvent.click(screen.getByTestId('filter-panel-values-boolean-false'));
    expect(groups.at(-1)?.conditions[0]).toEqual(expect.objectContaining({ field: 'is_won', operator: 'equals', value: false }));
    fireEvent.click(screen.getByTestId('filter-panel-values-back'));
    fireEvent.click(screen.getByTestId('filter-panel-fields-item-amount'));
    fireEvent.change(screen.getByTestId('filter-panel-values-number'), { target: { value: '5000' } });
    expect(groups.at(-1)?.conditions[1]).toEqual(
      expect.objectContaining({ field: 'amount', operator: 'greater_than_or_equal', value: 5000 }),
    );
  });

  it('opens the host’s advanced panel from its footer, and straight away on an OR group', () => {
    const { unmount } = render(<ControlledFilterPanel onGroup={() => {}} />);
    fireEvent.click(screen.getByTestId('filter-panel-open-advanced'));
    expect(screen.getByTestId('advanced-builder')).toBeTruthy();
    unmount();
    const orGroup: FilterBuilderRowGroup = {
      id: 'root',
      logic: 'or',
      conditions: [
        { id: 'a', field: 'stage', operator: 'in', value: ['proposal'] },
        { id: 'b', field: 'amount', operator: 'greater_than_or_equal', value: 10 },
      ],
    };
    expect(chipsAreIndependent(orGroup)).toBe(false);
    render(<FilterPanel fields={FIELDS} value={orGroup} onChange={() => {}} renderAdvanced={() => <div data-testid="advanced-builder" />} />);
    expect(screen.getByTestId('advanced-builder')).toBeTruthy();
  });

  it('never says 「Where」 / 「其中」', () => {
    const { container } = render(<ControlledFilterPanel onGroup={() => {}} />);
    fireEvent.click(screen.getByTestId('filter-panel-fields-item-stage'));
    expect(container.textContent).not.toMatch(/Where|其中/);
  });
});

describe('FilterValuePanel', () => {
  it('names the operator on top and keeps a row’s own operator selectable', () => {
    render(
      <FilterValuePanel
        field={STAGE}
        row={{ id: 'r', field: 'stage', operator: 'equals', value: 'proposal' }}
        onChange={() => {}}
      />,
    );
    expect(screen.getByTestId('filter-values-operator').textContent).toBe('equals');
  });
});

describe('SortPanel — the same field list with the direction on top', () => {
  it('sorts by amount descending in two clicks after the trigger (three in all)', () => {
    const onChange = vi.fn();
    const onDone = vi.fn();
    render(<SortPanel fields={FIELDS} shownFields={SHOWN} value={[]} onChange={onChange} onDone={onDone} />);
    expect(screen.getByTestId('sort-panel-order-asc').getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByTestId('sort-panel-order-desc'));
    fireEvent.click(screen.getByTestId('sort-panel-fields-item-amount'));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toEqual([expect.objectContaining({ field: 'amount', order: 'desc' })]);
    expect(onDone).toHaveBeenCalled();
  });

  it('adds a second level after the first; a field already sorting takes the new direction instead', () => {
    const first: SortItem[] = [{ id: '1', field: 'stage', order: 'asc' }];
    expect(addSortLevel(first, 'amount', 'desc', '2').map((s) => [s.field, s.order])).toEqual([
      ['stage', 'asc'],
      ['amount', 'desc'],
    ]);
    expect(addSortLevel(first, 'stage', 'desc', '2')).toEqual([{ id: '1', field: 'stage', order: 'desc' }]);
  });

  it('opens every sort level as its advanced step from the footer, as the filter panel does', () => {
    render(
      <SortPanel
        fields={FIELDS}
        shownFields={SHOWN}
        value={[]}
        onChange={() => {}}
        renderAdvanced={() => <div data-testid="sort-builder">all levels</div>}
      />,
    );
    expect(screen.queryByTestId('sort-builder')).toBeNull();
    fireEvent.click(screen.getByTestId('sort-panel-open-advanced'));
    expect(screen.getByTestId('sort-panel-advanced')).toContainElement(screen.getByTestId('sort-builder'));
    expect(screen.queryByTestId('sort-panel-fields')).toBeNull();
  });

  it('CONTROL: without renderAdvanced the sort panel has no footer entry', () => {
    render(<SortPanel fields={FIELDS} shownFields={SHOWN} value={[]} onChange={() => {}} />);
    expect(screen.queryByTestId('sort-panel-open-advanced')).toBeNull();
  });

  it('words the direction by type: time for dates, size for numbers, the alphabet for text', () => {
    const t = (key: string) => LIST_CONDITION_DEFAULT_TRANSLATIONS[key] ?? key;
    expect(sortDirectionLabel('date', 'asc', t as never)).toBe('Oldest → Newest');
    expect(sortDirectionLabel('currency', 'desc', t as never)).toBe('High → Low');
    expect(sortDirectionLabel('text', 'asc', t as never)).toBe('A → Z');
  });
});

describe('ConditionChipRow — the row under the view bar', () => {
  const twoStages: FilterBuilderRowGroup = {
    id: 'root',
    logic: 'and',
    conditions: [{ id: 'r1', field: 'stage', operator: 'in', value: ['negotiation', 'proposal'] }],
  };

  function Row(props: Partial<React.ComponentProps<typeof ConditionChipRow>>) {
    return (
      <ConditionChipRow
        sort={[]}
        sortFields={FIELDS}
        onSortChange={() => {}}
        filters={EMPTY}
        filterFields={FIELDS}
        onFiltersChange={() => {}}
        renderAdvanced={() => <div data-testid="advanced-builder" />}
        {...props}
      />
    );
  }


  it('a filter chip names the field and its values; × removes it', () => {
    const onFiltersChange = vi.fn();
    render(<Row filters={twoStages} onFiltersChange={onFiltersChange} />);
    expect(screen.getByTestId('filter-chip-stage').textContent).toContain('Stage: Negotiation, Proposal');
    fireEvent.click(screen.getByTestId('filter-chip-remove-stage'));
    expect(onFiltersChange).toHaveBeenCalledWith(expect.objectContaining({ conditions: [] }));
  });

  it('clicking a filter chip reopens that condition’s values', () => {
    render(<Row filters={twoStages} />);
    fireEvent.click(screen.getByTestId('filter-chip-open-stage'));
    const panel = screen.getByTestId('condition-panel-r1-values');
    expect(panel.getAttribute('data-field')).toBe('stage');
    expect(within(panel).getByTestId('condition-panel-r1-values-option-negotiation').getAttribute('data-checked')).toBe('true');
  });

  it('draws the view’s own conditions as locked chips with no ×', () => {
    render(
      <Row
        viewFilter={[
          { field: 'stage', operator: 'not_in', value: ['closed_won'] },
          ['amount', '>=', 10],
          { or: [{ field: 'is_won', operator: 'equals', value: false }, { field: 'name', operator: 'contains', value: 'x' }] },
        ]}
      />,
    );
    const chips = screen.getAllByTestId('view-condition-chip');
    expect(chips).toHaveLength(3);
    expect(chips[0].textContent).toBe('Stage: is none of Closed won');
    expect(chips[0].getAttribute('data-locked')).toBe('true');
    for (const chip of chips) expect(within(chip).queryByRole('button')).toBeNull();
    expect(chips[2].textContent).toContain(' or ');
  });



  it('「Reset」 calls the host, and is not drawn at all while the host passes none (objectstack#35727)', () => {
    const onReset = vi.fn();
    const { rerender } = render(<Row filters={twoStages} onReset={onReset} />);
    fireEvent.click(screen.getByTestId('condition-reset'));
    expect(onReset).toHaveBeenCalledTimes(1);
    // The list is the view's own: the host passes no `onReset`, and the row
    // draws no 「Reset」, disabled or otherwise, beside the locked chip.
    rerender(<Row viewFilter={[['amount', '>=', 10]]} />);
    expect(screen.getByTestId('view-condition-chip')).toBeInTheDocument();
    expect(screen.queryByTestId('condition-reset')).toBeNull();
  });

  describe('conditions the host draws itself, and lookup names (objectstack#35727)', () => {
    const ACCOUNT_DEF = { name: 'account', fields: { title: { type: 'text' } }, nameField: 'title' };
    function lookupSource(answer: () => Promise<{ data: unknown[] }>) {
      return {
        find: vi.fn(answer),
        getObjectSchema: vi.fn(async () => ACCOUNT_DEF),
      };
    }

    it('a field the host draws gets no locked chip; the view\'s other conditions keep theirs', () => {
      render(<Row viewFilter={[['account', '=', 'a1'], ['amount', '>=', 10]]} hostDrawnFields={['account']} />);
      const chips = screen.getAllByTestId('view-condition-chip');
      expect(chips.map((c) => c.getAttribute('data-field'))).toEqual(['amount']);
    });

    it('CONTROL: without `hostDrawnFields` both conditions are locked chips', () => {
      render(<Row viewFilter={[['account', '=', 'a1'], ['amount', '>=', 10]]} />);
      expect(screen.getAllByTestId('view-condition-chip').map((c) => c.getAttribute('data-field'))).toEqual(['account', 'amount']);
    });


    it('a locked lookup chip names the record it points at, read through the data source', async () => {
      const ds = lookupSource(async () => ({ data: [{ id: 'a1', title: 'Globex' }] }));
      render(<Row viewFilter={[['account', '=', 'a1']]} dataSource={ds as never} />);
      const chip = screen.getByTestId('view-condition-chip');
      await vi.waitFor(() => expect(chip.textContent).toBe('Account: = Globex'));
      expect(ds.find).toHaveBeenCalledWith('account', { $top: 1, $filter: { id: { $in: ['a1'] } } });
      expect(chip.textContent).not.toContain('a1');
    });

    it('the reader\'s own lookup chip names the record too', async () => {
      const ds = lookupSource(async () => ({ data: [{ id: 'a1', title: 'Globex' }, { id: 'a2', title: 'Initech' }] }));
      const filters: FilterBuilderRowGroup = {
        id: 'root',
        logic: 'and',
        conditions: [{ id: 'c1', field: 'account', operator: 'in', value: ['a1', 'a2'] }],
      };
      render(<Row filters={filters} dataSource={ds as never} />);
      await vi.waitFor(() => expect(screen.getByTestId('filter-chip-open-account').textContent).toBe('Account: Globex, Initech'));
    });

    it('falls back to the id when the name cannot be read', async () => {
      const ds = lookupSource(async () => {
        throw new Error('offline');
      });
      render(<Row viewFilter={[['account', '=', 'a1']]} dataSource={ds as never} />);
      await vi.waitFor(() => expect(ds.find).toHaveBeenCalled());
      await act(async () => {});
      expect(screen.getByTestId('view-condition-chip').textContent).toBe('Account: = a1');
    });
  });

  it('an OR group is one chip that opens the advanced panel', () => {
    render(
      <Row
        filters={{
          id: 'root',
          logic: 'or',
          conditions: [
            { id: 'a', field: 'stage', operator: 'in', value: ['proposal'] },
            { id: 'b', field: 'name', operator: 'contains', value: 'x' },
          ],
        }}
      />,
    );
    expect(screen.queryByTestId('filter-chip-stage')).toBeNull();
    fireEvent.click(screen.getByTestId('filter-chip-open-advanced'));
    expect(screen.getByTestId('advanced-builder')).toBeTruthy();
  });

});

describe('condition model', () => {
  it('picks the value control from the field type', () => {
    expect(quickFilterFamily(STAGE)).toBe('option');
    expect(quickFilterFamily({ type: 'lookup' })).toBe('lookup');
    expect(quickFilterFamily({ type: 'currency' })).toBe('number');
    expect(quickFilterFamily({ type: 'datetime' })).toBe('date');
    expect(quickFilterFamily({ type: 'boolean' })).toBe('boolean');
    expect(quickFilterFamily(undefined)).toBe('text');
  });

  it('reads a view filter of rules, triples and any-of groups; any other shape is one unnamed chip', () => {
    expect(readViewConditions(undefined)).toEqual([]);
    expect(readViewConditions([])).toEqual([]);
    expect(readViewConditions(['status', '=', 'open'])).toEqual([{ key: 'view-0', field: 'status', operator: '=', value: 'open' }]);
    expect(readViewConditions({ status: { $ne: 'closed' } })).toEqual([{ key: 'view-0' }]);
    expect(readViewConditions(['and', ['a', '=', 1], ['b', '=', 2]])).toEqual([{ key: 'view-0' }]);
  });

  it('describes a chip value by operator: a bare list for 「is any of」, the operator named otherwise', () => {
    const t = (key: string, o?: Record<string, unknown>) =>
      (LIST_CONDITION_DEFAULT_TRANSLATIONS[key] ?? key).replace(/\{\{(\w+)\}\}/g, (_, k) => String(o?.[k] ?? ''));
    expect(describeConditionValue(STAGE, 'in', ['proposal', 'negotiation'], t as never)).toBe('Proposal, Negotiation');
    expect(describeConditionValue(FIELDS[2], 'greater_than_or_equal', 100, t as never)).toBe('≥ 100');
    expect(describeConditionValue(FIELDS[3], 'between', quickDateWindowValue('today'), t as never)).toBe('Today');
    expect(describeConditionValue(STAGE, 'is_empty', undefined, t as never)).toBe('is empty');
  });
});

describe('ConditionChipRow — the resident row of the two-row toolbar (objectstack#35878)', () => {
  const sortPanel = (close: () => void) => (
    <button type="button" data-testid="sort-panel-stand-in" onClick={close}>panel</button>
  );
  function TwoRow(props: Partial<React.ComponentProps<typeof ConditionChipRow>>) {
    return (
      <ConditionChipRow
        sort={[]}
        sortFields={FIELDS}
        onSortChange={() => {}}
        filters={EMPTY}
        filterFields={FIELDS}
        onFiltersChange={() => {}}
        renderAdvanced={() => <div data-testid="advanced-builder" />}
        renderSortPanel={sortPanel}
        {...props}
      />
    );
  }
  const stageFilter: FilterBuilderRowGroup = {
    id: 'root',
    logic: 'and',
    conditions: [{ id: 'c1', field: 'stage', operator: 'in', value: ['negotiation'] }],
  };

  it('with nothing set it is there, with the dashed 「Sort」 and 「Filter」 buttons and nothing else', () => {
    render(<TwoRow />);
    expect(screen.getByTestId('condition-sort')).toHaveTextContent('Sort');
    expect(screen.getByTestId('condition-sort')).toHaveAttribute('data-levels', '0');
    expect(screen.getByTestId('condition-add-filter')).toHaveTextContent('Filter');
    expect(screen.getByTestId('condition-add-filter')).toHaveAttribute('data-empty', 'true');
    expect(screen.getByTestId('condition-sort').className).toContain('border-dashed');
    expect(screen.queryByTestId('condition-reset')).toBeNull();
  });

  it('a sort of any number of levels is ONE chip, 「Sorted by X」 with 「+N」, and it opens the sort panel', () => {
    const sort: SortItem[] = [
      { id: 's1', field: 'amount', order: 'desc' },
      { id: 's2', field: 'name', order: 'asc' },
      { id: 's3', field: 'stage', order: 'asc' },
    ];
    render(<TwoRow sort={sort} />);
    const chips = screen.getAllByTestId('condition-sort');
    expect(chips).toHaveLength(1);
    expect(chips[0]).toHaveTextContent('Sorted by Amount');
    expect(screen.getByTestId('sort-chip-more')).toHaveTextContent('+2');
    fireEvent.click(chips[0]);
    expect(screen.getByTestId('sort-panel-stand-in')).toBeInTheDocument();
    // The panel's close closes the popover.
    fireEvent.click(screen.getByTestId('sort-panel-stand-in'));
    expect(screen.queryByTestId('sort-panel-stand-in')).toBeNull();
  });

  it('CONTROL: one level reads no 「+N」', () => {
    render(<TwoRow sort={[{ id: 's1', field: 'name', order: 'asc' }]} />);
    expect(screen.getByTestId('condition-sort')).toHaveTextContent('Sorted by Name');
    expect(screen.queryByTestId('sort-chip-more')).toBeNull();
  });

  it('with a filter of the reader\'s own: its chip, then 「+」, which opens the field list', () => {
    render(<TwoRow filters={stageFilter} />);
    expect(screen.getByTestId('filter-chip-stage')).toBeInTheDocument();
    const add = screen.getByTestId('condition-add-filter');
    expect(add).not.toHaveAttribute('data-empty');
    expect(add).toHaveAccessibleName('Add filter');
    expect(add.compareDocumentPosition(screen.getByTestId('filter-chip-stage')) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
    fireEvent.click(add);
    expect(screen.getByTestId('filter-panel-fields')).toBeInTheDocument();
  });

  it('the host\'s end takes the place of the row\'s own Reset', () => {
    render(<TwoRow filters={stageFilter} onReset={() => {}} end={<span data-testid="host-end">Personalized</span>} />);
    expect(screen.getByTestId('condition-row-end')).toContainElement(screen.getByTestId('host-end'));
    expect(screen.queryByTestId('condition-reset')).toBeNull();
  });

  it('without a sort panel or a filter to offer, and nothing set, the row draws nothing', () => {
    const { container } = render(<TwoRow renderSortPanel={undefined} filterOffered={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('one line: what does not fit scrolls sideways', () => {
    render(<TwoRow filters={stageFilter} />);
    const row = screen.getByTestId('condition-chips');
    expect(row.className.split(/\s+/)).toEqual(expect.arrayContaining(['flex-nowrap', 'overflow-x-auto']));
  });
});
