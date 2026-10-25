/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Timeline scale ↔ spec vocabulary parity + behavior (#2942).
 *
 * Two drifts lived here: the renderer read its own `timeScale` key, so the
 * spec's `scale` (`TimelineConfigSchema`) was ignored for ALL six values;
 * and the header generator only knew month/week/day, so `hour` / `quarter` /
 * `year` produced zero header columns — a blank gantt axis.
 *
 * #2942 fixed the first drift by preferring `scale` and keeping `timeScale` as
 * a fallback. objectui#6355 finishes it: the alias is RETIRED, so `scale` is
 * the single axis spelling here. The refusal that keeps that retirement from
 * being a silent revert is pinned in `@object-ui/types`
 * (`__tests__/timeline-timescale-retired.test.ts`).
 */
import { describe, it, expect } from 'vitest';
import { TimelineConfigSchema } from '@objectstack/spec/ui';
import { shapeEnumOptions } from '@object-ui/test-support';
import { TIMELINE_SCALES, resolveTimelineScale, generateTimeScaleHeaders } from '../renderer';

describe('timeline covers the spec scale vocabulary', () => {
  const specNames = shapeEnumOptions(TimelineConfigSchema, 'scale');

  it('reads a non-empty enum from the spec', () => {
    expect(specNames, 'could not read TimelineConfigSchema.shape.scale options from the spec').not.toEqual([]);
  });

  it('declares exactly the spec scales', () => {
    expect([...TIMELINE_SCALES].sort()).toEqual([...specNames].sort());
  });

  it('every spec scale generates a non-empty gantt header row', () => {
    for (const scale of specNames) {
      const headers = generateTimeScaleHeaders(scale, '2026-01-01', '2026-01-02');
      expect(headers.length, `scale '${scale}' blanked the axis`).toBeGreaterThan(0);
    }
  });

  it('quarter and year headers read as buckets, not blanks', () => {
    expect(generateTimeScaleHeaders('quarter', '2026-01-15', '2026-08-01')).toEqual(['Q1 2026', 'Q2 2026', 'Q3 2026']);
    expect(generateTimeScaleHeaders('year', '2025-06-01', '2027-01-01')).toEqual(['2025', '2026', '2027']);
  });
});

describe('resolveTimelineScale reads the spec key, and only it', () => {
  it('reads the spec `scale` key', () => {
    expect(resolveTimelineScale({ scale: 'quarter' })).toBe('quarter');
  });

  it("absent/unknown values keep the renderer's historical month default", () => {
    expect(resolveTimelineScale({})).toBe('month');
    expect(resolveTimelineScale({ scale: 'fortnight' })).toBe('month');
  });

  it('no longer reads the RETIRED `timeScale` alias (objectui#6355)', () => {
    // This replaces two assertions that pinned the alias branch — "keeps the
    // legacy timeScale dialect" and "the spec key wins when both are present".
    // Neither could survive the retirement honestly: the first pinned exactly
    // the branch being deleted, and the second would have kept passing for a
    // NEW reason (the alias ignored outright rather than losing a precedence
    // contest), which is a pin that reads green while measuring nothing.
    //
    // The reversion below is REAL and is the accepted cost of the ruling
    // (2026-08-27: immediate retirement, no phased window, startup stage). It
    // is not left silent — that is the whole point of the retirement's other
    // half. `@object-ui/types` tombstones the key on BOTH surfaces
    // (`TimelineSchema.timeScale?: never` and the Zod twin's `z.never()`), so a
    // document that still spells it is refused at the authoring boundary before
    // it can ever reach this resolver and quietly re-bucket the chart. The pin
    // for that refusal lives in
    // `packages/types/src/__tests__/timeline-timescale-retired.test.ts`.
    // A stored document exactly as it sits on disk today: axis spelled the old way.
    const storedDocument: Record<string, unknown> = { variant: 'gantt', timeScale: 'day' };
    expect(resolveTimelineScale(storedDocument)).toBe('month');
  });

  it('the retired alias cannot override an authored `scale`', () => {
    // Counter-probe: the canonical key still wins, and still works, on a
    // document that carries both. Without this the assertion above is satisfied
    // by a resolver that returns 'month' for everything.
    const bothSpellings: Record<string, unknown> = { variant: 'gantt', scale: 'year', timeScale: 'day' };
    expect(resolveTimelineScale(bothSpellings)).toBe('year');
  });
});
