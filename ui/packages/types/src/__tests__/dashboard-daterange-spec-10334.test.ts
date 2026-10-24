/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10334 (objectui#7759 group F residue) — `DashboardComponentSchema.dateRange`
 * takes the spec's AUTHORING member on both faces, by reference.
 *
 * Before: the Zod mirror restated the element as a stripping `z.object` whose
 * `defaultRange` was a bare `z.string()`, while the TypeScript twin bound
 * `defaultRange` to the spec's `DateRangeDefaultRange`. The mirror therefore
 * admitted preset names `tsc` refused (a typo such as `last_7_dayz` parsed green
 * and then silently resolved to no default window) — the `WiderThanDeclared`
 * row `complex.zod.ts#DashboardComponentSchema::dateRange`.
 *
 * `@objectstack/spec` declares the key (`DashboardSchema.dateRange`, a strict
 * object over `DATE_RANGE_DEFAULT_RANGES`), so by objectui#7759 rule 1 and
 * proposal F1 both faces point at that authoring shape: `dateRange` left
 * `DASHBOARD_SPEC_EXCLUDED` and flows through the same projection as every other
 * spec-owned dashboard key.
 *
 * The type half is enforced by `tsconfig.test.json` (chained from this package's
 * `type-check`); the runtime half asserts the mirror gives the spec's verdict and
 * the spec's issue envelope (`code` + `path`), and authors no default.
 */

import { describe, it, expect } from 'vitest';
import type { z } from 'zod';
import { DashboardSchema as SpecDashboardSchema, DATE_RANGE_DEFAULT_RANGES } from '@objectstack/spec/ui';
import type { Dashboard } from '@objectstack/spec/ui';
import type { DashboardComponentSchema } from '../complex';
import { DashboardComponentSchema as DashboardMirror, DASHBOARD_SPEC_EXCLUDED } from '../zod/complex.zod';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;

const dashboard = (dateRange: unknown) => ({ type: 'dashboard', widgets: [], dateRange });

describe('dateRange: both faces are the spec authoring member (objectui#10334)', () => {
  it('the TypeScript twin and the mirror input equal the spec document member', () => {
    const twin: Equal<DashboardComponentSchema['dateRange'], Dashboard['dateRange']> = true;
    const mirror: Equal<z.input<typeof DashboardMirror>['dateRange'], Dashboard['dateRange']> = true;
    // Control: the bare-string element the mirror used to carry is NOT the spec member.
    const control: Equal<
      { field?: string; defaultRange?: string; allowCustomRange?: boolean } | undefined,
      Dashboard['dateRange']
    > = false;
    expect([twin, mirror, control]).toEqual([true, true, false]);
  });

  it('is no longer on the exclusion list both faces read', () => {
    expect(DASHBOARD_SPEC_EXCLUDED as readonly string[]).not.toContain('dateRange');
  });
});

describe('dateRange: the mirror gives the spec verdict and envelope', () => {
  it('refuses a preset name outside DATE_RANGE_DEFAULT_RANGES at dateRange.defaultRange', () => {
    const r = DashboardMirror.safeParse(dashboard({ defaultRange: 'last_7_dayz' }));
    expect(r.success).toBe(false);
    expect(r.error?.issues.map((i) => ({ code: i.code, path: i.path }))).toEqual([
      { code: 'invalid_value', path: ['dateRange', 'defaultRange'] },
    ]);
  });

  it('refuses an unknown key inside dateRange instead of stripping it', () => {
    const r = DashboardMirror.safeParse(dashboard({ field: 'created_at', bogus: 1 }));
    expect(r.success).toBe(false);
    expect(r.error?.issues.map((i) => ({ code: i.code, path: i.path }))).toEqual([
      { code: 'unrecognized_keys', path: ['dateRange'] },
    ]);
  });

  it('accepts every preset in DATE_RANGE_DEFAULT_RANGES, including the custom sentinel', () => {
    expect(DATE_RANGE_DEFAULT_RANGES).toContain('custom');
    for (const defaultRange of DATE_RANGE_DEFAULT_RANGES) {
      const r = DashboardMirror.safeParse(dashboard({ field: 'closed_at', defaultRange, allowCustomRange: false }));
      expect(r.success, defaultRange).toBe(true);
    }
  });

  it('authors no default into the parsed document (stripImportedDefaults)', () => {
    const r = DashboardMirror.safeParse(dashboard({ field: 'created_at' }));
    expect(r.success).toBe(true);
    expect(r.success && r.data.dateRange).toEqual({ field: 'created_at' });
  });

  it('agrees with the spec schema on every sample', () => {
    const specDateRange = SpecDashboardSchema.shape.dateRange;
    const samples: unknown[] = [
      {},
      { field: 'created_at', defaultRange: 'last_30_days', allowCustomRange: true },
      { defaultRange: 'custom' },
      { defaultRange: 'last_7_dayz' },
      { defaultRange: 30 },
      { preset: 'today' },
      { bogus: 1 },
      { allowCustomRange: 'yes' },
    ];
    for (const sample of samples) {
      expect(
        DashboardMirror.safeParse(dashboard(sample)).success,
        JSON.stringify(sample),
      ).toBe(specDateRange.safeParse(sample).success);
    }
  });
});
