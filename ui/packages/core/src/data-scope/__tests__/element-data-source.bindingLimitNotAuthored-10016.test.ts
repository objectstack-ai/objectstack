/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * objectui#10016 — the BINDING's own `limit`, the other operand of the row-cap
 * chain, gets the positivity check objectui#9928 gave the saved view's.
 *
 * Maintainer ruling, option A: a binding `limit` the contract refuses is NOT
 * AUTHORED. It yields exactly as an absent one does, to the view's usable cap
 * and then to the consumer's own default. One rule for both operands, the rule
 * objectui#10009 set one layer up (a refused value is not authored, the other
 * source wins).
 *
 * The file is the ruling's truth table, binding {absent, usable, refused} ×
 * view {no cap, usable, refused}, on the pure composer and on
 * `ViewDataProvider`, the caller with no renderer and no guard of its own. The
 * renderer caller, `ElementDataSourceGate`, pins the same rows in its own
 * suite.
 *
 * Only the rows with a refused binding may change what is RESOLVED. Elsewhere
 * only the warnings may change, and only in one row: a usable binding cap over
 * a refused view cap. There the view's warning said the fetch falls back to a
 * default, which was false because the binding's cap is what gets used. That
 * is the defect carried on the card's thread (comment 5814132982).
 *
 * ⚠️ Every CONTROL row passes both BEFORE and AFTER the change. A change that
 * stopped honouring any binding cap would pass the refused rows and fail them.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  composeElementDataSource,
  elementDataSourceRefusedLimitMessage,
} from '../element-data-source';
import { ViewDataProvider, type DataFetcher } from '../ViewDataProvider';

/**
 * What the contract refuses for a binding `limit`. The string is a value the
 * binding's `??` used to pass through verbatim, so it is refused here too.
 */
const REFUSED: readonly unknown[] = [0, -10, 25.5, '20'];

/** The view operand's three states. */
const VIEW_NO_CAP = { label: 'Hot' };
const VIEW_USABLE = { pagination: { pageSize: 25 } };
const VIEW_REFUSED = { pagination: { pageSize: 0 } };

const bound = (limit?: unknown) =>
  ({ object: 'account', view: 'hot', ...(limit === undefined ? {} : { limit }) }) as {
    object: string;
    view: string;
    limit?: number;
  };

describe('objectui#10016 — a refused binding `limit` is not authored', () => {
  describe('the composed `limit` — the truth table', () => {
    it.each(REFUSED)('binding %s + view with no cap ⇒ no cap (the consumer default)', (bad) => {
      const composed = composeElementDataSource(bound(bad), VIEW_NO_CAP);
      expect(composed.limit).toBeUndefined();
      expect('limit' in composed).toBe(false);
    });

    it.each(REFUSED)('binding %s + usable view cap ⇒ the view’s cap', (bad) => {
      expect(composeElementDataSource(bound(bad), VIEW_USABLE).limit).toBe(25);
    });

    it.each(REFUSED)('binding %s + refused view cap ⇒ no cap', (bad) => {
      const composed = composeElementDataSource(bound(bad), VIEW_REFUSED);
      expect(composed.limit).toBeUndefined();
      expect('limit' in composed).toBe(false);
    });

    it.each(REFUSED)('binding %s and no view at all ⇒ no cap', (bad) => {
      const composed = composeElementDataSource({ object: 'account', limit: bad as number });
      expect(composed.limit).toBeUndefined();
    });

    it('binding 0 + legacy flat view `limit` ⇒ the view’s cap (the view’s second carrier)', () => {
      expect(composeElementDataSource(bound(0), { limit: 9 }).limit).toBe(9);
    });

    // ---------------------------------------------------------------- CONTROLS
    it('CONTROL — usable binding + view with no cap ⇒ the binding’s cap', () => {
      expect(composeElementDataSource(bound(3), VIEW_NO_CAP).limit).toBe(3);
    });

    it('CONTROL — usable binding + usable view cap ⇒ the binding’s cap', () => {
      expect(composeElementDataSource(bound(3), VIEW_USABLE).limit).toBe(3);
    });

    it('CONTROL — usable binding + refused view cap ⇒ the binding’s cap', () => {
      expect(composeElementDataSource(bound(3), VIEW_REFUSED).limit).toBe(3);
    });

    it('CONTROL — no binding cap: no view cap, a usable one, a refused one', () => {
      expect(composeElementDataSource(bound(), VIEW_NO_CAP).limit).toBeUndefined();
      expect(composeElementDataSource(bound(), VIEW_USABLE).limit).toBe(25);
      expect(composeElementDataSource(bound(), VIEW_REFUSED).limit).toBeUndefined();
    });

    it('CONTROL — a `null` binding `limit` stays what `??` made it: absent', () => {
      expect(composeElementDataSource(bound(null), VIEW_USABLE).limit).toBe(25);
    });
  });

  describe('the message — each operand in its own words', () => {
    it.each(REFUSED)('the binding operand names the binding, the object and the refused %s', (bad) => {
      const msg = elementDataSourceRefusedLimitMessage(VIEW_USABLE, 'hot', 'account', bound(bad), 'binding');
      expect(msg).not.toBeNull();
      expect(msg).toContain('binding on account');
      expect(msg).toContain(typeof bad === 'string' ? JSON.stringify(bad) : String(bad));
      expect(msg).toContain('positive integer');
    });

    it('the binding operand speaks whatever the view carries', () => {
      for (const view of [VIEW_NO_CAP, VIEW_USABLE, VIEW_REFUSED, undefined]) {
        expect(elementDataSourceRefusedLimitMessage(view, 'hot', 'account', bound(0), 'binding')).not.toBeNull();
      }
    });

    it('both refused ⇒ two messages, and they are told apart by the operand they name', () => {
      const binding = elementDataSourceRefusedLimitMessage(VIEW_REFUSED, 'hot', 'account', bound(0), 'binding');
      const view = elementDataSourceRefusedLimitMessage(VIEW_REFUSED, 'hot', 'account', bound(0), 'view');
      expect(binding).not.toBeNull();
      expect(view).not.toBeNull();
      expect(binding).not.toBe(view);
      expect(binding).toContain('binding on account');
      expect(view).toContain('saved view "hot" on account');
      expect(view).not.toContain('binding on account');
    });

    it('a usable binding cap silences the VIEW’s refusal, which changed nothing (the carried defect)', () => {
      expect(elementDataSourceRefusedLimitMessage(VIEW_REFUSED, 'hot', 'account', bound(3))).toBeNull();
      expect(elementDataSourceRefusedLimitMessage(VIEW_REFUSED, 'hot', 'account', bound(3), 'view')).toBeNull();
    });

    it('a refused binding cap does NOT silence the view’s refusal: neither supplied a cap', () => {
      expect(elementDataSourceRefusedLimitMessage(VIEW_REFUSED, 'hot', 'account', bound(0))).not.toBeNull();
    });

    // -------------------------------------------------------- SILENCE CONTROLS
    it('SILENCE — the binding operand says nothing for an absent, `null` or usable `limit`', () => {
      for (const limit of [undefined, null, 3]) {
        expect(elementDataSourceRefusedLimitMessage(VIEW_REFUSED, 'hot', 'account', bound(limit), 'binding'))
          .toBeNull();
      }
      expect(elementDataSourceRefusedLimitMessage(VIEW_REFUSED, 'hot', 'account', undefined, 'binding')).toBeNull();
    });

    it('SILENCE CONTROL — the view operand reads as before when no binding is passed', () => {
      expect(elementDataSourceRefusedLimitMessage(VIEW_REFUSED, 'hot', 'account')).not.toBeNull();
      expect(elementDataSourceRefusedLimitMessage(VIEW_USABLE, 'hot', 'account')).toBeNull();
      expect(elementDataSourceRefusedLimitMessage(VIEW_REFUSED, 'hot', 'account', bound())).not.toBeNull();
    });
  });

  describe('ViewDataProvider — the caller with no renderer and no guard of its own', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    /** Resolve one row: what reached the fetcher, and what was said. */
    const row = async (limit: unknown, viewConfig: Record<string, unknown> | null) => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const fetchRecords = vi.fn<DataFetcher['fetchRecords']>(async () => ({ records: [], total: 0 }));
      const provider = new ViewDataProvider();
      provider.setFetcher({
        fetchRecords,
        fetchViews: async () => ({ hot: viewConfig ?? {} }),
      });
      const config = viewConfig === null
        ? { object: 'account', ...(limit === undefined ? {} : { limit }) }
        : bound(limit);
      await provider.resolveElementDataSource(config as { object: string; limit?: number });
      const said = warn.mock.calls.map((c) => String(c[0]));
      return { limit: fetchRecords.mock.calls[0]?.[1]?.limit, said };
    };

    const bindingSentence = (bad: unknown) =>
      elementDataSourceRefusedLimitMessage(null, 'hot', 'account', { limit: bad }, 'binding');
    const viewSentence = elementDataSourceRefusedLimitMessage(VIEW_REFUSED, 'hot', 'account');

    it.each(REFUSED)('binding %s + usable view cap ⇒ `limit` 25 and ONE binding warning', async (bad) => {
      const { limit, said } = await row(bad, VIEW_USABLE);
      expect(limit).toBe(25);
      expect(said).toEqual([bindingSentence(bad)]);
    });

    it.each(REFUSED)('binding %s + view with no cap ⇒ no `limit` and ONE binding warning', async (bad) => {
      const { limit, said } = await row(bad, VIEW_NO_CAP);
      expect(limit).toBeUndefined();
      expect(said).toEqual([bindingSentence(bad)]);
    });

    it('binding 0 and no view named ⇒ no `limit` and ONE binding warning', async () => {
      const { limit, said } = await row(0, null);
      expect(limit).toBeUndefined();
      expect(said).toHaveLength(1);
      expect(said[0]).toContain('binding on account');
    });

    it('binding 0 + refused view cap ⇒ no `limit`, and one warning per refused operand', async () => {
      const { limit, said } = await row(0, VIEW_REFUSED);
      expect(limit).toBeUndefined();
      expect(said).toEqual([bindingSentence(0), viewSentence]);
    });

    it('binding 3 + refused view cap ⇒ `limit` 3 and NO view warning (the carried defect)', async () => {
      const { limit, said } = await row(3, VIEW_REFUSED);
      expect(limit).toBe(3);
      expect(said).toEqual([]);
    });

    // ---------------------------------------------------------------- CONTROLS
    it('CONTROL — no binding cap + refused view cap ⇒ no `limit` and the view warning, as before', async () => {
      const { limit, said } = await row(undefined, VIEW_REFUSED);
      expect(limit).toBeUndefined();
      expect(said).toEqual([viewSentence]);
    });

    it('CONTROL — binding 3 + usable view cap ⇒ `limit` 3, and nothing said', async () => {
      const { limit, said } = await row(3, VIEW_USABLE);
      expect(limit).toBe(3);
      expect(said).toEqual([]);
    });

    it('CONTROL — binding 3 + view with no cap ⇒ `limit` 3, and nothing said', async () => {
      const { limit, said } = await row(3, VIEW_NO_CAP);
      expect(limit).toBe(3);
      expect(said).toEqual([]);
    });

    it('CONTROL — no binding cap + usable view cap ⇒ `limit` 25, and nothing said', async () => {
      const { limit, said } = await row(undefined, VIEW_USABLE);
      expect(limit).toBe(25);
      expect(said).toEqual([]);
    });

    it('CONTROL — no binding cap + view with no cap ⇒ no `limit`, and nothing said', async () => {
      const { limit, said } = await row(undefined, VIEW_NO_CAP);
      expect(limit).toBeUndefined();
      expect(said).toEqual([]);
    });
  });
});
