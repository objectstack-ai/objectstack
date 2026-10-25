/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * objectui#9928 — a saved view's row cap that the contract refuses must not be
 * lowered into the composed `limit`.
 *
 * `savedViewLimit` admitted its carrier on `typeof … === 'number'` alone, so
 * `0`, negatives and fractions lowered unchecked. This is the LOWERING layer
 * that sits under the repaired read points, and the value it produces has two
 * consumers that behave differently — which is why both are pinned here:
 *
 *  - a RENDERER, which has a guard of its own, so the refused value was dropped
 *    there and the block drew its own default: the named view's cap went
 *    missing and the read went WIDER than the view asked for;
 *  - `ViewDataProvider.resolveElementDataSource`, which forwards this key
 *    straight to `DataFetcher.fetchRecords` with NO guard of its own, so the
 *    refused value reached the fetcher verbatim and nothing said so.
 *
 * ⚠️ Every CONTROL in this file passes both BEFORE and AFTER the repair. That
 * is deliberate: a change that simply stopped lowering any view cap at all
 * would satisfy the refusals and fail the controls.
 *
 * The BINDING's own `limit`, the other operand of the chain, was a known gap
 * when this file was written, and it was deliberately left unpinned here
 * because it raised a precedence question this card did not own. objectui#10016
 * settled it (a refused binding cap is not authored and yields to the view's),
 * and its truth table lives in
 * `element-data-source.bindingLimitNotAuthored-10016.test.ts`. Nothing in this
 * file asserted the old answer, so nothing here had to be rewritten.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  composeElementDataSource,
  elementDataSourceRefusedLimitMessage,
} from '../element-data-source';
import { ViewDataProvider, type DataFetcher } from '../ViewDataProvider';

/** The values the contract refuses, in both carriers a saved view may use. */
const REFUSED = [0, -10, 25.5, -0.5] as const;

const bind = { object: 'account', view: 'hot' } as const;

describe('objectui#9928 — savedViewLimit drops a cap the contract refuses', () => {
  describe('the composed `limit`', () => {
    it.each(REFUSED)('`pagination.pageSize: %s` is not lowered', (bad) => {
      const composed = composeElementDataSource(bind, { pagination: { pageSize: bad } });
      expect(composed.limit).toBeUndefined();
      expect('limit' in composed).toBe(false);
    });

    it.each(REFUSED)('a flat `limit: %s` is not lowered either', (bad) => {
      // The same function's second carrier. The card's excerpt stopped above
      // this branch, but it admits on `typeof … === 'number'` in exactly the
      // same way, so leaving it would have left the defect reachable by the
      // legacy spelling.
      const composed = composeElementDataSource(bind, { limit: bad });
      expect(composed.limit).toBeUndefined();
      expect('limit' in composed).toBe(false);
    });

    // ---------------------------------------------------------------- CONTROLS
    it('CONTROL — a legitimate `pagination.pageSize` still lowers', () => {
      expect(composeElementDataSource(bind, { pagination: { pageSize: 7 } }).limit).toBe(7);
      expect(composeElementDataSource(bind, { pagination: { pageSize: 25 } }).limit).toBe(25);
    });

    it('CONTROL — a legitimate flat `limit` still lowers', () => {
      expect(composeElementDataSource(bind, { limit: 7 }).limit).toBe(7);
    });

    it('CONTROL — the binding still overrides a legitimate view cap', () => {
      const composed = composeElementDataSource(
        { object: 'account', view: 'hot', limit: 5 },
        { pagination: { pageSize: 7 } },
      );
      expect(composed.limit).toBe(5);
    });

    it('CONTROL — a view with no cap at all still composes without one', () => {
      expect(composeElementDataSource(bind, { label: 'Hot' }).limit).toBeUndefined();
      expect(composeElementDataSource({ object: 'account' }).limit).toBeUndefined();
    });

    it('CONTROL — carrier PRECEDENCE is unchanged: a non-numeric `pagination.pageSize` still falls through to the flat `limit`', () => {
      // Only the positivity question is new. The `typeof === 'number'`
      // selection that picks BETWEEN the two carriers is untouched, so a view
      // storing a string page size keeps resolving to its flat `limit`.
      const composed = composeElementDataSource(bind, {
        pagination: { pageSize: 'twenty' },
        limit: 20,
      });
      expect(composed.limit).toBe(20);
    });

    it('CONTROL — the other composed keys compose as before when the cap is usable', () => {
      const composed = composeElementDataSource(bind, {
        pagination: { pageSize: 7 },
        columns: ['name'],
        type: 'kanban',
      });
      expect(composed.columns).toEqual(['name']);
      expect(composed.viewType).toBe('kanban');
      expect(composed.limit).toBe(7);
    });

    // ⚠️ Deliberately NOT labelled a control: it asserts the drop, so it is one
    // of the tests that must go red when the guard is ablated. The reverse
    // verification caught an earlier version of this file calling it a control
    // — every name carrying CONTROL or SILENCE below passes on both sides of
    // the guard, and this one does not.
    it('leaves the other composed keys alone while dropping the cap', () => {
      const composed = composeElementDataSource(bind, {
        pagination: { pageSize: 0 },
        columns: ['name'],
        type: 'kanban',
      });
      expect(composed.columns).toEqual(['name']);
      expect(composed.viewType).toBe('kanban');
      expect(composed.limit).toBeUndefined();
    });
  });

  describe('the message — the half that tells the author', () => {
    it.each(REFUSED)('names the refused value %s, the view and the object', (bad) => {
      const msg = elementDataSourceRefusedLimitMessage(
        { pagination: { pageSize: bad } },
        'hot',
        'account',
      );
      expect(msg).toContain(String(bad));
      expect(msg).toContain('hot');
      expect(msg).toContain('account');
      expect(msg).toContain('positive integer');
    });

    it('reports the flat carrier too', () => {
      expect(elementDataSourceRefusedLimitMessage({ limit: 0 }, 'hot', 'account'))
        .toContain('row cap of 0');
    });

    // -------------------------------------------------------- SILENCE CONTROLS
    // Without these the message is an always-on marker that states nothing.
    it('SILENCE — says nothing when the view carries a usable cap', () => {
      expect(elementDataSourceRefusedLimitMessage({ pagination: { pageSize: 7 } }, 'hot', 'account'))
        .toBeNull();
      expect(elementDataSourceRefusedLimitMessage({ limit: 7 }, 'hot', 'account')).toBeNull();
    });

    it('SILENCE — says nothing when the view carries no cap at all', () => {
      expect(elementDataSourceRefusedLimitMessage({ label: 'Hot' }, 'hot', 'account')).toBeNull();
      expect(elementDataSourceRefusedLimitMessage({ pagination: {} }, 'hot', 'account')).toBeNull();
    });

    it('SILENCE — says nothing when there is no view', () => {
      expect(elementDataSourceRefusedLimitMessage(null, 'hot', 'account')).toBeNull();
      expect(elementDataSourceRefusedLimitMessage(undefined, undefined, 'account')).toBeNull();
    });

    it('SILENCE — says nothing about a carrier this layer never lowered', () => {
      // A non-numeric page size did not become a limit before this repair and
      // does not now, so this layer has nothing to report about it.
      expect(elementDataSourceRefusedLimitMessage(
        { pagination: { pageSize: 'twenty' } },
        'hot',
        'account',
      )).toBeNull();
    });

    it('still names the object when the view name is absent', () => {
      const msg = elementDataSourceRefusedLimitMessage({ limit: -1 }, undefined, 'account');
      expect(msg).toContain('account');
      expect(msg).toContain('-1');
    });
  });

  describe('ViewDataProvider — the consumer with no guard of its own', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    const resolveWith = async (viewConfig: Record<string, unknown>) => {
      const fetchRecords = vi.fn<DataFetcher['fetchRecords']>(
        async () => ({ records: [], total: 0 }),
      );
      const provider = new ViewDataProvider();
      provider.setFetcher({
        fetchRecords,
        fetchViews: async () => ({ hot: viewConfig }),
      });
      await provider.resolveElementDataSource({ object: 'account', view: 'hot' });
      return fetchRecords.mock.calls[0]?.[1];
    };

    it.each(REFUSED)('does not forward %s to the fetcher', async (bad) => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const options = await resolveWith({ pagination: { pageSize: bad } });
      expect(options?.limit).toBeUndefined();
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]?.[0])).toContain(String(bad));
    });

    it('CONTROL — forwards a legitimate cap, and says nothing', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const options = await resolveWith({ pagination: { pageSize: 7 } });
      expect(options?.limit).toBe(7);
      expect(warn).not.toHaveBeenCalled();
    });

    it('CONTROL — says nothing for a view that declares no cap', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const options = await resolveWith({ label: 'Hot' });
      expect(options?.limit).toBeUndefined();
      expect(warn).not.toHaveBeenCalled();
    });
  });
});
