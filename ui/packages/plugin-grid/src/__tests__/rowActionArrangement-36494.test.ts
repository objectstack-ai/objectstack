/**
 * objectstack#36494 — the record scope arrangement's order for a row's menus:
 * `pinned` first, then `more`, each in the arm's order, then the rest in the
 * menu's own order; no arm lists as before.
 */

import { describe, it, expect } from 'vitest';
import { rankRowActionDefs, orderRowMenuActions } from '../rowActionArrangement';

const defs = ['a', 'b', 'c', 'd', 'e'].map((name) => ({ name }));
const names = (list: readonly { name?: unknown }[]) => list.map((d) => d.name);

describe('rankRowActionDefs + orderRowMenuActions', () => {
  it('lists pinned, then more, in the arm order, then the rest in incoming order', () => {
    const ranked = rankRowActionDefs(defs, { pinned: ['d', 'b'], more: ['e'] });
    expect(names(ranked)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(names(orderRowMenuActions(ranked))).toEqual(['d', 'b', 'e', 'a', 'c']);
  });

  it('answers the defs themselves when the object sets no arm', () => {
    expect(rankRowActionDefs(defs, undefined)).toBe(defs);
    expect(rankRowActionDefs(defs, { more: ['a'] })).toBe(defs);
    expect(rankRowActionDefs(defs, { pinned: ['zz'] })).toBe(defs);
    expect(names(orderRowMenuActions(defs))).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('skips names that match no def, ranks a repeated name once, and a pinned name in `more` stays pinned', () => {
    const ranked = rankRowActionDefs(defs, { pinned: ['zz', 'c', 'c'], more: ['c', 'a'] });
    expect(names(orderRowMenuActions(ranked))).toEqual(['c', 'a', 'b', 'd', 'e']);
  });

  it('keeps the order through a filter that drops defs (the per-row `visible`)', () => {
    const ranked = rankRowActionDefs(defs, { pinned: ['e', 'a'] });
    const survivors = ranked.filter((d) => d.name !== 'a');
    expect(names(orderRowMenuActions(survivors))).toEqual(['e', 'b', 'c', 'd']);
  });

  it('leaves the defs it does not rank untouched and copies the ones it ranks', () => {
    const ranked = rankRowActionDefs(defs, { pinned: ['b'] });
    expect(ranked[0]).toBe(defs[0]);
    expect(ranked[1]).not.toBe(defs[1]);
    expect(ranked[1]).toEqual(defs[1]);
  });
});
