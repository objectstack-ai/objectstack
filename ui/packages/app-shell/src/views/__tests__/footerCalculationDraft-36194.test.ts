// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36194 + objectstack#36195 — the pure halves of the footer's
 * calculations as a part of the list's draft, and of what a refused view save
 * says:
 *
 *  - `columnsWithSummaries` lays the draft's calculations over the columns the
 *    list draws and the body a save stores; `columnSummaryOf` reads a column's
 *    own calculation (the one a pick of it drops from the draft);
 *  - the draft store keeps the part, and an emptied part is no part;
 *  - `buildPersonalViewConfig` (「Save to this view」 on the reader's own view
 *    and 「Save as my view」) stores the calculations on the columns it keeps,
 *    in a body spec's closed `ListViewSchema` accepts;
 *  - `viewSaveRefusalText` says a package's view in the reader's words, never
 *    the door's English text.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { ListViewSchema } from '@objectstack/spec/ui';
import { columnSummaryOf, columnsWithSummaries } from '../columnSummaryWrite';
import { listDraftScope, patchListDraft, readListDraft, resetListDraftStoreForTests } from '../listDraftStore';
import { buildPersonalViewConfig } from '../personalViews';
import { viewSaveRefusalText } from '../viewSaveRefusal';

describe('columnsWithSummaries / columnSummaryOf (objectstack#36194)', () => {
  it('lays each calculation on its column, the columns in the object form', () => {
    expect(columnsWithSummaries(['name', 'amount', 'closed_at'], { amount: 'sum', closed_at: 'max' })).toEqual([
      { field: 'name' }, { field: 'amount', summary: 'sum' }, { field: 'closed_at', summary: 'max' },
    ]);
  });
  it('None takes a column\'s own calculation off', () => {
    expect(columnsWithSummaries([{ field: 'amount', summary: 'avg' }], { amount: null })).toEqual([{ field: 'amount' }]);
  });
  it('a calculation on a field the columns do not hold is dropped; nothing to lay hands the same array back', () => {
    const columns = ['name'];
    expect(columnsWithSummaries(columns, { amount: 'sum' })).toBe(columns);
    expect(columnsWithSummaries(columns, undefined)).toBe(columns);
    expect(columnsWithSummaries(undefined, { amount: 'sum' })).toBeUndefined();
  });
  it('reads a column\'s own calculation in either spelling, else null', () => {
    const columns = [{ field: 'a', summary: 'sum' as const }, { field: 'b', summary: { type: 'avg' as const } }, { field: 'c' }];
    expect(columnSummaryOf(columns, 'a')).toBe('sum');
    expect(columnSummaryOf(columns, 'b')).toBe('avg');
    expect(columnSummaryOf(columns, 'c')).toBeNull();
    expect(columnSummaryOf(['a'], 'a')).toBeNull();
  });
});

describe('the draft store keeps the calculations (objectstack#36194)', () => {
  beforeEach(() => resetListDraftStoreForTests());
  const scope = listDraftScope('u1', 'crm_deal', 'all');
  it('a pick is held; an emptied part is no part', () => {
    patchListDraft(scope, { summaries: { amount: 'sum' } });
    expect(readListDraft(scope)).toEqual({ summaries: { amount: 'sum' } });
    patchListDraft(scope, { summaries: {} });
    expect(readListDraft(scope)).toEqual({});
  });
});

describe('buildPersonalViewConfig stores the draft\'s calculations (objectstack#36194)', () => {
  const VIEW = { id: 'all', type: 'grid', columns: ['name', 'amount', 'stage'], data: { provider: 'object', object: 'crm_deal' } };
  it('on the columns it keeps, the reader\'s added ones included, in a body spec accepts', () => {
    const built = buildPersonalViewConfig('crm_deal', VIEW, {
      url: {},
      preference: { addedFields: ['owner'], hiddenFields: ['stage'] },
      summaries: { amount: 'sum', owner: 'count_unique', stage: 'count' },
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.config.columns).toEqual([
      { field: 'name' }, { field: 'amount', summary: 'sum' }, { field: 'owner', summary: 'count_unique' },
    ]);
    expect(ListViewSchema.safeParse(built.config).success).toBe(true);
  });
  it('with no calculation in the draft the columns are stored as before', () => {
    const built = buildPersonalViewConfig('crm_deal', VIEW, { url: {} });
    expect(built.ok && built.config.columns).toEqual(['name', 'amount', 'stage']);
  });
});

describe('viewSaveRefusalText (objectstack#36195)', () => {
  const t = (key: string) => `t:${key}`;
  const refusal = (status: number, code?: string, message = "'view/crm_account.all_accounts' ships in 'app.objectstack.hotcrm': save it into …") =>
    Object.assign(new Error(message), { status, ...(code ? { code } : {}) });
  it('a view a package ships: the reader\'s sentence, never the door\'s text', () => {
    expect(viewSaveRefusalText(refusal(403, 'NOT_OVERRIDABLE'), t)).toBe('t:console.objectView.saveRefused.packaged');
  });
  it('any other refusal keeps the door\'s own words, which name the reader\'s missing grant', () => {
    expect(viewSaveRefusalText(refusal(403, 'PERMISSION_DENIED', 'Saving views requires the Manage Metadata permission'), t))
      .toBe('Saving views requires the Manage Metadata permission');
  });
  it('a refusal that lists field issues keeps the list', () => {
    const err = Object.assign(new Error('1 issue'), {
      status: 422,
      issues: [{ path: 'columns.0.summary', message: 'Invalid enum value', userMessage: 'Pick a calculation this field offers' }],
    });
    expect(viewSaveRefusalText(err, t)).toBe('• columns.0.summary — Pick a calculation this field offers');
  });
});
