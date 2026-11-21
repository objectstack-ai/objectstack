/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { createSafeTranslation } from '@object-ui/i18n';

/**
 * English fallbacks for the condition controls (field list, quick filter,
 * sort panel, condition row), used only outside an I18nProvider. The packs
 * carry the same keys under `listConditions`; the date choices reuse the
 * dashboard filter bar's keys, so both surfaces name a window the same way.
 */
export const LIST_CONDITION_DEFAULT_TRANSLATIONS: Record<string, string> = {
  'listConditions.fieldList.search': 'Search fields',
  'listConditions.phone.toolbar': 'List tools',
  'listConditions.phone.sortCount_one': 'Sort, {{count}} level',
  'listConditions.phone.sortCount_other': 'Sort, {{count}} levels',
  'listConditions.phone.filterCount_one': 'Filter, {{count}} in use',
  'listConditions.phone.filterCount_other': 'Filter, {{count}} in use',
  'listConditions.phone.back': 'Back',
  'listConditions.phone.discard': 'Discard changes',
  'listConditions.phone.close': 'Close',
  'listConditions.phone.apply': 'Apply',
  'listConditions.phone.advancedNotice': 'This view uses an advanced filter. Change it on a computer.',
  'listConditions.phone.filterEmpty': 'No filter yet. Add one to show only the records that match.',
  'listConditions.phone.itemOptions': 'Options for {{label}}',
  'listConditions.phone.edit': 'Edit',
  'listConditions.phone.remove': 'Remove',
  'listConditions.fieldList.shown': 'In this view',
  'listConditions.fieldList.hidden': 'Hidden fields',
  'listConditions.fieldList.empty': 'No field matches',
  'listConditions.fieldList.addable': 'Not in the view yet',
  'listConditions.fieldList.add': 'Add {{label}}',
  'listConditions.fieldList.show': 'Show {{label}}',
  'listConditions.fieldList.hide': 'Hide {{label}}',
  'listConditions.fieldList.move': 'Move {{label}}',
  'listConditions.fieldList.moveHint': 'Drag, or press the up and down arrow keys, to change the order',
  'listConditions.filter.advanced': 'Advanced filter',
  'listConditions.filter.back': 'Back to fields',
  'listConditions.filter.operator': 'Condition',
  'listConditions.filter.searchOptions': 'Search options',
  'listConditions.filter.noOptions': 'No options',
  'listConditions.filter.textPlaceholder': 'Type to filter',
  'listConditions.filter.numberPlaceholder': 'Enter a number',
  'listConditions.filter.from': 'From',
  'listConditions.filter.to': 'To',
  'listConditions.filter.yes': 'Yes',
  'listConditions.filter.no': 'No',
  'listConditions.filter.customRange': 'Custom range',
  'listConditions.operators.in': 'is any of',
  'listConditions.operators.not_in': 'is none of',
  'listConditions.operators.is_empty': 'is empty',
  'listConditions.operators.is_not_empty': 'is not empty',
  'listConditions.operators.contains': 'contains',
  'listConditions.operators.not_contains': 'does not contain',
  'listConditions.operators.equals': 'equals',
  'listConditions.operators.starts_with': 'starts with',
  'listConditions.operators.greater_than_or_equal': '≥',
  'listConditions.operators.less_than_or_equal': '≤',
  'listConditions.operators.between': 'between',
  'listConditions.operators.before': 'before',
  'listConditions.operators.after': 'after',
  'listConditions.sort.advanced': 'All sort levels',
  'listConditions.sort.direction': 'Direction',
  'listConditions.sort.ascending': 'Ascending',
  'listConditions.sort.descending': 'Descending',
  'listConditions.sort.time_asc': 'Oldest → Newest',
  'listConditions.sort.time_desc': 'Newest → Oldest',
  'listConditions.sort.size_asc': 'Low → High',
  'listConditions.sort.size_desc': 'High → Low',
  'listConditions.sort.alphabet_asc': 'A → Z',
  'listConditions.sort.alphabet_desc': 'Z → A',
  'listConditions.chips.region': 'Sort and filter conditions',
  'listConditions.chips.pattern': '{{field}}: {{value}}',
  'listConditions.chips.listJoiner': ', ',
  'listConditions.chips.or': ' or ',
  'listConditions.chips.addFilter': 'Add filter',
  'listConditions.chips.sort': 'Sort',
  'listConditions.chips.filter': 'Filter',
  'listConditions.chips.sortedBy': 'Sorted by {{field}}',
  'listConditions.chips.reset': 'Reset',
  'listConditions.chips.resetHint': 'Back to the view as saved',
  'listConditions.chips.remove': 'Remove {{label}}',
  'listConditions.chips.dragSort': 'Drag to change the sort priority',
  'listConditions.chips.viewOwn': 'Part of this view; it cannot be removed here',
  'listConditions.chips.viewFilter': 'View filter',
  'dashboard.filters.range.today': 'Today',
  'dashboard.filters.range.this_week': 'This week',
  'dashboard.filters.range.this_month': 'This month',
  'dashboard.filters.range.last_30_days': 'Last 30 days',
};

export const useListConditionTranslation = createSafeTranslation(
  LIST_CONDITION_DEFAULT_TRANSLATIONS,
  'listConditions.chips.reset',
);

type Translate = ReturnType<typeof useListConditionTranslation>['t'];

/** An operator's words in the quick filter. Each key literal, so the i18n call-site and dead-key gates read it. */
export function quickOperatorLabel(operator: string, t: Translate): string {
  switch (operator) {
    case 'in': return t('listConditions.operators.in');
    case 'not_in': return t('listConditions.operators.not_in');
    case 'is_empty': return t('listConditions.operators.is_empty');
    case 'is_not_empty': return t('listConditions.operators.is_not_empty');
    case 'contains': return t('listConditions.operators.contains');
    case 'not_contains': return t('listConditions.operators.not_contains');
    case 'equals': return t('listConditions.operators.equals');
    case 'starts_with': return t('listConditions.operators.starts_with');
    case 'greater_than_or_equal': return t('listConditions.operators.greater_than_or_equal');
    case 'less_than_or_equal': return t('listConditions.operators.less_than_or_equal');
    case 'between': return t('listConditions.operators.between');
    case 'before': return t('listConditions.operators.before');
    case 'after': return t('listConditions.operators.after');
    // An operator only the advanced panel writes keeps its stored id.
    default: return operator;
  }
}

/** A relative date window's words, read from the dashboard filter bar's keys. */
export function quickDateWindowLabel(window: 'today' | 'this_week' | 'this_month' | 'last_30_days', t: Translate): string {
  switch (window) {
    case 'today': return t('dashboard.filters.range.today');
    case 'this_week': return t('dashboard.filters.range.this_week');
    case 'this_month': return t('dashboard.filters.range.this_month');
    case 'last_30_days': return t('dashboard.filters.range.last_30_days');
  }
}
