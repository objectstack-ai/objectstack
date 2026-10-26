/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * Unit tests for the scatter / treemap / sankey drill-event mappers. These lock
 * the Recharts-payload → { category, series, value } contract that ObjectChart's
 * drill drawer depends on.
 */
import { describe, it, expect } from 'vitest';
import { mapScatterClick, mapTreemapClick, mapSankeyClick } from '../chartDrillEvents';

const series = [{ dataKey: 'sales' }];

describe('mapScatterClick', () => {
  it('reads category (xAxisKey) and value from node.payload', () => {
    const node = { payload: { region: 'West', sales: 4200 } };
    expect(mapScatterClick(node, 'region', series)).toEqual({
      category: 'West',
      series: 'sales',
      value: 4200,
    });
  });

  it('falls back to top-level node fields when no payload', () => {
    const node = { region: 'East', sales: 9 };
    expect(mapScatterClick(node, 'region', series)).toEqual({
      category: 'East',
      series: 'sales',
      value: 9,
    });
  });

  it('coerces a non-string category and omits a non-numeric value', () => {
    const node = { payload: { region: 2025, sales: 'n/a' } };
    expect(mapScatterClick(node, 'region', series)).toEqual({
      category: '2025',
      series: 'sales',
      value: undefined,
    });
  });

  it('returns null when there is no category', () => {
    expect(mapScatterClick({ payload: { sales: 1 } }, 'region', series)).toBeNull();
    expect(mapScatterClick(null, 'region', series)).toBeNull();
  });

  it('defaults the series key to "value"', () => {
    expect(mapScatterClick({ x: 'A', value: 3 }, 'x', undefined)?.series).toBe('value');
  });
});

describe('mapTreemapClick', () => {
  it('maps tile name + value', () => {
    expect(mapTreemapClick({ name: 'Tech', value: 1200 }, series)).toEqual({
      category: 'Tech',
      series: 'sales',
      value: 1200,
    });
  });

  it('falls back to size, then payload.name', () => {
    expect(mapTreemapClick({ name: 'A', size: 7 }, series)?.value).toBe(7);
    expect(mapTreemapClick({ payload: { name: 'B' } }, series)?.category).toBe('B');
  });

  it('returns null without a name', () => {
    expect(mapTreemapClick({ value: 1 }, series)).toBeNull();
    expect(mapTreemapClick(null, series)).toBeNull();
  });
});

describe('mapSankeyClick', () => {
  it('drills on a category node', () => {
    expect(mapSankeyClick({ payload: { name: 'Web', depth: 1, value: 500 } }, series)).toEqual({
      category: 'Web',
      series: 'sales',
      value: 500,
    });
  });

  it('ignores the synthetic root node (depth 0)', () => {
    expect(mapSankeyClick({ payload: { name: 'Total', depth: 0 } }, series)).toBeNull();
  });

  it('ignores links (no name)', () => {
    expect(mapSankeyClick({ payload: { source: 0, target: 1, value: 5 } }, series)).toBeNull();
    expect(mapSankeyClick(null, series)).toBeNull();
  });
});
