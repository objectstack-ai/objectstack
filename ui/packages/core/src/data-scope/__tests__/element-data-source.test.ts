/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * `ElementDataSource` resolution — the pure half of objectstack#5576.
 *
 * The spec declares `PageComponentSchema.dataSource` as
 * `{ object, view?, filter?, sort?, limit? }`. Until #5576 the renderer dropped
 * `view` entirely, so "reference a saved view by name" was published and inert.
 * These tests pin the two decisions that make it real: telling the BINDING apart
 * from a runtime data-source ADAPTER (they collide by name, and the collision
 * broke the component outright), and the per-key composition rule.
 */

import { describe, it, expect } from 'vitest';
import {
  collectSavedViews,
  composeElementDataSource,
  elementDataSourceViewNotFoundMessage,
  isElementDataSourceConfig,
  resolveSavedView,
} from '../element-data-source';

describe('isElementDataSourceConfig', () => {
  it('accepts the spec binding', () => {
    expect(isElementDataSourceConfig({ object: 'account' })).toBe(true);
    expect(isElementDataSourceConfig({ object: 'account', view: 'hot' })).toBe(true);
  });

  it('rejects a runtime data-source adapter', () => {
    // The collision this guard exists for: `ListView`'s `dataSource` prop is the
    // injected adapter, and a page component's `dataSource` is metadata. An
    // adapter reaching the metadata read path (or vice versa) is the #5576 bug.
    const adapter = {
      find: () => Promise.resolve({ data: [] }),
      getObjectSchema: () => Promise.resolve({}),
    };
    expect(isElementDataSourceConfig(adapter)).toBe(false);
    // Even one carrying an `object` field, which a wrapper adapter might.
    expect(isElementDataSourceConfig({ ...adapter, object: 'account' })).toBe(false);
  });

  it('rejects everything that is not a binding', () => {
    for (const v of [null, undefined, 'account', 42, [], {}, { object: '' }, { object: 1 }]) {
      expect(isElementDataSourceConfig(v)).toBe(false);
    }
  });
});

describe('collectSavedViews', () => {
  it('flattens an embedded map and an overlay array, overlay last wins', () => {
    const embedded = { hot: { label: 'Metadata hot' }, cold: { label: 'Cold' } };
    const overlay = [{ name: 'hot', label: 'Saved hot' }, { id: 'mine', label: 'Mine' }];
    expect(collectSavedViews(embedded, overlay)).toEqual({
      hot: { name: 'hot', label: 'Saved hot' },
      cold: { label: 'Cold' },
      mine: { id: 'mine', label: 'Mine' },
    });
  });

  it('skips entries with no usable identity and non-object sources', () => {
    expect(collectSavedViews(undefined, null, 'nope', [{ label: 'anonymous' }, 7])).toEqual({});
  });
});

describe('resolveSavedView', () => {
  const views = {
    'account.tabular': { columns: ['name'] },
    all: { columns: ['id'] },
  };

  it('matches short and qualified spellings in both directions (#2217 parity)', () => {
    expect(resolveSavedView(views, 'tabular', 'account')).toBe(views['account.tabular']);
    expect(resolveSavedView(views, 'account.tabular', 'account')).toBe(views['account.tabular']);
    expect(resolveSavedView(views, 'all', 'account')).toBe(views.all);
    expect(resolveSavedView(views, 'account.all', 'account')).toBe(views.all);
  });

  it('returns undefined for a name the object does not have', () => {
    expect(resolveSavedView(views, 'hot', 'account')).toBeUndefined();
    expect(resolveSavedView(views, undefined, 'account')).toBeUndefined();
    expect(resolveSavedView({}, 'hot', 'account')).toBeUndefined();
  });
});

describe('composeElementDataSource', () => {
  const view = {
    type: 'kanban',
    columns: ['name', 'stage'],
    filter: [['stage', '=', 'won']],
    sort: [{ field: 'name', order: 'asc' }],
    pagination: { pageSize: 25 },
  };

  it('forwards the binding unchanged when no view is named', () => {
    expect(
      composeElementDataSource({
        object: 'account',
        filter: { rating: 'hot' },
        sort: [{ field: 'name', order: 'desc' }],
        limit: 10,
      }),
    ).toEqual({
      object: 'account',
      // A LONE filter passes through in the shape it was authored in — lowering
      // a stored filter to an ObjectQL AST belongs at the last hop before the
      // wire, not here.
      filter: { rating: 'hot' },
      sort: [{ field: 'name', order: 'desc' }],
      limit: 10,
    });
  });

  it('takes the view whole when the binding declares only `object` + `view`', () => {
    expect(composeElementDataSource({ object: 'account', view: 'won' }, view)).toEqual({
      object: 'account',
      columns: ['name', 'stage'],
      filter: [['stage', '=', 'won']],
      sort: [{ field: 'name', order: 'asc' }],
      limit: 25,
      viewType: 'kanban',
    });
  });

  it('AND-combines the two filters — the binding narrows, never widens', () => {
    // The spec describes `dataSource.filter` as "Additional filter criteria",
    // which is the whole reason this is a merge and not an override. A binding
    // filter that REPLACED the view's would silently expose the rows the saved
    // view excludes.
    const composed = composeElementDataSource(
      { object: 'account', view: 'won', filter: { owner: 'me' } },
      view,
    );
    expect(composed.filter).toEqual([
      'and',
      [['stage', '=', 'won']],
      ['owner', '=', 'me'],
    ]);
  });

  it('lets an explicit sort / limit override the view', () => {
    const composed = composeElementDataSource(
      { object: 'account', view: 'won', sort: [{ field: 'amount', order: 'desc' }], limit: 5 },
      view,
    );
    expect(composed.sort).toEqual([{ field: 'amount', order: 'desc' }]);
    expect(composed.limit).toBe(5);
  });

  it('reads the legacy view spellings (`fields`, `viewType`, flat `limit`)', () => {
    expect(
      composeElementDataSource({ object: 'account', view: 'legacy' }, {
        viewType: 'gallery',
        fields: ['name'],
        limit: 7,
      }),
    ).toEqual({ object: 'account', columns: ['name'], limit: 7, viewType: 'gallery' });
  });

  it('emits no key at all for what neither side supplies', () => {
    expect(composeElementDataSource({ object: 'account', view: 'bare' }, {})).toEqual({
      object: 'account',
    });
  });
});

describe('elementDataSourceViewNotFoundMessage', () => {
  it('names the view, the object and what the object does have', () => {
    const msg = elementDataSourceViewNotFoundMessage('account', 'hot', ['all', 'account.tabular']);
    expect(msg).toContain('"hot"');
    expect(msg).toContain('"account"');
    // Sorted, so the list reads the same however the sources were enumerated.
    expect(msg).toContain('account.tabular, all');
  });

  /**
   * objectui#8900 — the empty branch used to read "This object has no saved
   * views.", which is a claim about the OBJECT derived from a count that is
   * equally zero when the read never happened: `ObjectStackAdapter.listViews`
   * degrades every failure to `[]` on the RESOLVED path, and the hook's own
   * discrimination only catches a rejection. objectstack#13906 decision 1
   * option A (*a thing that could not be READ is not a thing that is ABSENT*)
   * therefore binds this branch to what is true in BOTH worlds.
   */
  it('names both worlds for an empty view list, because it cannot tell them apart', () => {
    const msg = elementDataSourceViewNotFoundMessage('account', 'hot', []);

    // The two CONTROLS. Both are green before and after the objectui#8900 fix,
    // by design: they guard the wrong fix of deleting the empty-case sentence
    // (or the whole message) instead of correcting what it asserts — an author
    // who loses the view name and the object name is worse off than one who
    // read an over-confident second sentence.
    expect(msg).toContain('"hot"');
    expect(msg).toContain('"account"');

    // The SUBJECT. Red before the fix, green after.
    expect(msg).not.toContain('has no saved views');
    expect(msg).toContain('could not be read');
  });
});
