/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#35892 — what a reader changes on a record page's related tab
 * holds while they stay on the record, across its tabs, and is gone on
 * another record; 「Discard」 clears one tab.
 */

import { afterEach, describe, expect, it } from 'vitest';
import {
  EMPTY_RELATED_TAB_CONDITIONS,
  discardRelatedTabConditions,
  patchRelatedTabConditions,
  readRelatedTabConditions,
  relatedTabConditionsChanged,
  resetRelatedTabConditionsForTests,
} from '../relatedTabConditions';

const SORT = [{ id: 'sort-amount', field: 'amount', order: 'desc' as const }];

afterEach(() => resetRelatedTabConditionsForTests());

describe('related tab conditions (objectstack#35892)', () => {
  it('starts at the default and counts nothing as a change', () => {
    expect(readRelatedTabConditions('opportunity:1', 'quote.opportunity')).toBe(EMPTY_RELATED_TAB_CONDITIONS);
    expect(relatedTabConditionsChanged(EMPTY_RELATED_TAB_CONDITIONS)).toBe(false);
  });

  it('holds each tab of the record apart', () => {
    patchRelatedTabConditions('opportunity:1', 'quote.opportunity', { sort: SORT });
    patchRelatedTabConditions('opportunity:1', 'task.what', { summaries: { amount: 'sum' } });
    expect(readRelatedTabConditions('opportunity:1', 'quote.opportunity').sort).toEqual(SORT);
    expect(readRelatedTabConditions('opportunity:1', 'quote.opportunity').summaries).toEqual({});
    expect(readRelatedTabConditions('opportunity:1', 'task.what').summaries).toEqual({ amount: 'sum' });
  });

  it('drops the last record\'s tabs once another record is written', () => {
    patchRelatedTabConditions('opportunity:1', 'quote.opportunity', { sort: SORT });
    patchRelatedTabConditions('opportunity:2', 'quote.opportunity', { filterNode: ['amount', '>', 10] });
    expect(readRelatedTabConditions('opportunity:1', 'quote.opportunity')).toBe(EMPTY_RELATED_TAB_CONDITIONS);
    expect(readRelatedTabConditions('opportunity:2', 'quote.opportunity').filterNode).toEqual(['amount', '>', 10]);
  });

  it('Discard puts one tab back and leaves the others', () => {
    patchRelatedTabConditions('opportunity:1', 'quote.opportunity', { sort: SORT });
    patchRelatedTabConditions('opportunity:1', 'task.what', { sort: SORT });
    discardRelatedTabConditions('opportunity:1', 'quote.opportunity');
    expect(readRelatedTabConditions('opportunity:1', 'quote.opportunity')).toBe(EMPTY_RELATED_TAB_CONDITIONS);
    expect(readRelatedTabConditions('opportunity:1', 'task.what').sort).toEqual(SORT);
  });

  it('a change undone by hand is no change', () => {
    patchRelatedTabConditions('opportunity:1', 'quote.opportunity', { sort: SORT });
    patchRelatedTabConditions('opportunity:1', 'quote.opportunity', { sort: [] });
    expect(readRelatedTabConditions('opportunity:1', 'quote.opportunity')).toBe(EMPTY_RELATED_TAB_CONDITIONS);
  });
});
