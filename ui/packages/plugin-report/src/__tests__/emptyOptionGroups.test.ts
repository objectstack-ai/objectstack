// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36722 — `fillEmptyOptionGroups`, the rows `chart.showEmptyGroups`
 * adds. The renderer-level cases live in `DatasetReportRenderer.test.tsx`
 * (describe "chart.showEmptyGroups"); these pin the walk itself.
 */
import { describe, it, expect } from 'vitest';
import { fillEmptyOptionGroups } from '../emptyOptionGroups';

const OPTIONS = [
  { value: 'open', label: 'Open' },
  { value: 'won', label: 'Won' },
  { value: 'lost', label: 'Lost' },
];

describe('fillEmptyOptionGroups (objectstack#36722)', () => {
  it('a row may carry the stored value, the authored label or the translated label: all three count as present', () => {
    const rows = [{ s: 'open', n: 1 }, { s: 'Won', n: 2 }, { s: '输', n: 3 }];
    const localized = [
      { value: 'open', label: '进行中' },
      { value: 'won', label: '赢' },
      { value: 'lost', label: '输' },
    ];
    const out = fillEmptyOptionGroups(rows, { xAxis: 's', measures: ['n'], aggregate: 'count', options: OPTIONS, localizedOptions: localized });
    expect(out).toBe(rows);
  });

  it('a row with a raw twin is matched by its STORED value, not by a label the two sides spell differently', () => {
    // The server relabelled `won` as "Gewonnen" (its own translation at the
    // request locale); the client knows only "Won" and "赢". The raw twin
    // states `won`, so Won is present and only the two empty options are added.
    const rows = [{ s: 'Gewonnen', n: 2 }];
    const rawRows = [{ s: 'won' }];
    const localized = [
      { value: 'open', label: '进行中' },
      { value: 'won', label: '赢' },
      { value: 'lost', label: '输' },
    ];
    const out = fillEmptyOptionGroups(rows, { xAxis: 's', measures: ['n'], aggregate: 'count', options: OPTIONS, localizedOptions: localized, rawRows });
    expect(out.slice(1)).toEqual([{ s: 'open', n: 0 }, { s: 'lost', n: 0 }]);
    // CONTROL: without the raw twin the label matches nothing, and Won is added
    // as a false zero beside its own real group, the case the raw value prevents.
    const blind = fillEmptyOptionGroups(rows, { xAxis: 's', measures: ['n'], aggregate: 'count', options: OPTIONS, localizedOptions: localized });
    expect(blind.slice(1).map((r) => r.s)).toEqual(['open', 'won', 'lost']);
  });

  it('a raw twin that states the stored value overrules a display spelling another option carries', () => {
    // The row reads "Lost" on screen but its stored value is `open`: only
    // `open` is present, so `won` and `lost` are added.
    const out = fillEmptyOptionGroups([{ s: 'Lost', n: 1 }], { xAxis: 's', measures: ['n'], aggregate: 'count', options: OPTIONS, rawRows: [{ s: 'open' }] });
    expect(out.slice(1).map((r) => r.s)).toEqual(['won', 'lost']);
  });

  it('a row with no raw twin (or one without the x-axis key) falls back to spellings', () => {
    const rows = [{ s: 'Won', n: 2 }, { s: 'open', n: 1 }];
    const out = fillEmptyOptionGroups(rows, { xAxis: 's', measures: ['n'], aggregate: 'count', options: OPTIONS, rawRows: [{ other: 1 }] });
    expect(out.slice(2)).toEqual([{ s: 'lost', n: 0 }]);
  });

  it('appends after the answer, so every index below rows.length still addresses the answer', () => {
    const rows = [{ s: 'Won', n: 2 }];
    const out = fillEmptyOptionGroups(rows, { xAxis: 's', measures: ['n'], aggregate: 'count_distinct', options: OPTIONS });
    expect(out[0]).toBe(rows[0]);
    expect(out.slice(1)).toEqual([{ s: 'open', n: 0 }, { s: 'lost', n: 0 }]);
  });

  it('an aggregate the answer does not state gets no value (never a guessed 0)', () => {
    const out = fillEmptyOptionGroups([{ s: 'Won', n: 2 }], { xAxis: 's', measures: ['n'], aggregate: undefined, options: OPTIONS });
    expect(out.slice(1)).toEqual([{ s: 'open' }, { s: 'lost' }]);
  });

  it('min and max are left empty, like avg', () => {
    for (const aggregate of ['min', 'max', 'avg']) {
      const out = fillEmptyOptionGroups([{ s: 'Won', n: 2 }], { xAxis: 's', measures: ['n'], aggregate, options: OPTIONS });
      expect(out.slice(1).every((r) => !('n' in r))).toBe(true);
    }
  });

  it('with a split: one row per series value the answer holds, the null series included', () => {
    const rows = [{ s: 'Won', o: 'amy', n: 1 }, { s: 'Won', o: null, n: 1 }];
    const out = fillEmptyOptionGroups(rows, { xAxis: 's', seriesBy: 'o', measures: ['n'], aggregate: 'sum', options: [OPTIONS[0], OPTIONS[1]] });
    expect(out.slice(2)).toEqual([{ s: 'open', o: 'amy', n: 0 }, { s: 'open', o: null, n: 0 }]);
  });

  it('a compared measure fills its __compare column with the same value', () => {
    const out = fillEmptyOptionGroups([{ s: 'Won', n: 2, n__compare: 1 }], { xAxis: 's', measures: ['n', 'n__compare'], aggregate: 'count', options: [OPTIONS[0], OPTIONS[1]] });
    expect(out.slice(1)).toEqual([{ s: 'open', n: 0, n__compare: 0 }]);
  });

  it('bare-string options, a duplicate declaration, and no options at all', () => {
    expect(fillEmptyOptionGroups([{ s: 'a' }], { xAxis: 's', measures: ['n'], aggregate: 'count', options: ['a', 'b', 'b'] }).slice(1))
      .toEqual([{ s: 'b', n: 0 }]);
    const rows = [{ s: 'a' }];
    expect(fillEmptyOptionGroups(rows, { xAxis: 's', measures: ['n'], aggregate: 'count', options: undefined })).toBe(rows);
    expect(fillEmptyOptionGroups(rows, { xAxis: 's', measures: ['n'], aggregate: 'count', options: [] })).toBe(rows);
  });
});
