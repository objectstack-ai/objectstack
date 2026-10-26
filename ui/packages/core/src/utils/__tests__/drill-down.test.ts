/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 */

import { describe, it, expect } from 'vitest';
import {
  interpolate,
  computeDrillFilter,
  resolveDrillTitle,
  isDrillEnabled,
} from '../drill-down.js';

describe('drill-down helpers', () => {
  describe('interpolate', () => {
    it('replaces ${event.x} placeholders', () => {
      expect(interpolate('Hello ${event.name}', { name: 'world' } as any)).toBe('Hello world');
    });

    it('returns input unchanged when no placeholder is present', () => {
      expect(interpolate('plain text', {} as any)).toBe('plain text');
    });

    it('replaces unknown keys with empty string', () => {
      expect(interpolate('a=${event.missing}b', {} as any)).toBe('a=b');
    });
  });

  describe('isDrillEnabled', () => {
    it('false when undefined', () => expect(isDrillEnabled(undefined)).toBe(false));
    it('true when {} (treated as enabled)', () => expect(isDrillEnabled({})).toBe(true));
    it('true when enabled:true', () => expect(isDrillEnabled({ enabled: true })).toBe(true));
    it('false when enabled:false', () => expect(isDrillEnabled({ enabled: false })).toBe(false));
  });

  describe('computeDrillFilter', () => {
    it('uses explicit filter and interpolates string templates', () => {
      const f = computeDrillFilter(
        { filter: { stage: '${event.rowKey}', source: '${event.colKey}' } },
        { rowKey: 'won', colKey: 'web' },
      );
      expect(f).toEqual({ stage: 'won', source: 'web' });
    });

    it('preserves typed (number) values in whole-string templates', () => {
      const f = computeDrillFilter(
        { filter: { count: '${event.value}' } },
        { value: 42 },
      );
      expect(f.count).toBe(42);
    });

    it('falls back to defaults when no filter config', () => {
      const f = computeDrillFilter(undefined, { rowKey: 'won', colKey: 'web', scope: 'cell' }, {
        rowField: 'stage',
        columnField: 'lead_source',
      });
      expect(f).toEqual({ stage: 'won', lead_source: 'web' });
    });

    it('row scope only emits row filter', () => {
      const f = computeDrillFilter(undefined, { rowKey: 'won', scope: 'row' }, {
        rowField: 'stage',
        columnField: 'lead_source',
      });
      expect(f).toEqual({ stage: 'won' });
    });

    it('column scope only emits column filter', () => {
      const f = computeDrillFilter(undefined, { colKey: 'web', scope: 'column' }, {
        rowField: 'stage',
        columnField: 'lead_source',
      });
      expect(f).toEqual({ lead_source: 'web' });
    });

    it('total scope emits empty filter', () => {
      const f = computeDrillFilter(undefined, { scope: 'total' }, {
        rowField: 'stage',
        columnField: 'lead_source',
      });
      expect(f).toEqual({});
    });

    it('chart-style category resolves via groupByField', () => {
      const f = computeDrillFilter(undefined, { category: 'won' }, { groupByField: 'stage' });
      expect(f).toEqual({ stage: 'won' });
    });

    it('coerces empty-string sentinel to null', () => {
      const f = computeDrillFilter(undefined, { rowKey: '', scope: 'row' }, { rowField: 'stage' });
      expect(f).toEqual({ stage: null });
    });
  });

  describe('resolveDrillTitle', () => {
    it('uses interpolated config.title', () => {
      const t = resolveDrillTitle({ title: '${event.rowLabel} × ${event.colLabel}' }, { rowLabel: 'Won', colLabel: 'Web' });
      expect(t).toBe('Won × Web');
    });

    it('falls back to row/col labels when title omitted', () => {
      expect(resolveDrillTitle(undefined, { rowLabel: 'Won', colLabel: 'Web' })).toBe('Won × Web');
    });

    it('returns generic fallback when nothing useful', () => {
      expect(resolveDrillTitle(undefined, {}, 'X')).toBe('X');
    });
  });
});
