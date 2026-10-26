/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  resolveDashboardFilterDefs,
  dashboardFilterVariableDefs,
  buildFilterCondition,
  buildWidgetScopedFilter,
  resetDashboardFilterWarnings,
  DATE_RANGE_FILTER_NAME,
  DATE_RANGE_PRESETS,
  type DashboardFilterDef,
} from '../dashboard-filters';
import { mergeFilters } from '../merge-filters';
import { DashboardSchema as SpecDashboardSchema } from '@objectstack/spec/ui';

const regionDef: DashboardFilterDef = {
  name: 'region',
  field: 'region',
  type: 'select',
  options: [
    { value: 'EMEA', label: 'EMEA' },
    { value: 'APAC', label: 'APAC' },
    { value: 'AMER', label: 'AMER' },
  ],
};

const dateDef: DashboardFilterDef = {
  name: DATE_RANGE_FILTER_NAME,
  field: 'created_at',
  type: 'dateRange',
};

describe('resolveDashboardFilterDefs', () => {
  it('normalizes spec {value,label} objects, and DROPS a bare-string member rather than lifting it (objectui#4356)', () => {
    // The dropped member is reported once by a dev-mode `console.warn`, so this
    // case captures it rather than letting it reach the suite's output — the
    // warning must be audible to AUTHORS, not to our own test log. Its own pins
    // are in the `[#4356]` block at the foot of this file.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    resetDashboardFilterWarnings();
    let defs;
    try {
      defs = resolveDashboardFilterDefs({
        globalFilters: [
          // @objectstack/spec object form — rendering this un-normalized as a
          // React child crashed the Revenue Pulse dashboard (caught in dogfood).
          { name: 'region', field: 'region', type: 'select', options: [{ value: 'amer', label: 'AMER' }, { value: 'emea', label: 'EMEA' }] },
          // The RETIRED bare-string shorthand (#4356) — yields no option at all.
          { name: 'status', field: 'status', type: 'select', options: ['draft', 'paid'] },
        ] as any,
      });
    } finally {
      warn.mockRestore();
    }
    expect(defs[0].options).toEqual([
      { value: 'amer', label: 'AMER' },
      { value: 'emea', label: 'EMEA' },
    ]);
    expect(defs[1].options).toBeUndefined();
  });

  it('maps dateRange to the reserved name with a created_at field default', () => {
    const defs = resolveDashboardFilterDefs({
      dateRange: { defaultRange: 'last_30_days' },
    });
    expect(defs).toHaveLength(1);
    expect(defs[0]).toMatchObject({
      name: DATE_RANGE_FILTER_NAME,
      field: 'created_at',
      type: 'dateRange',
      defaultValue: { preset: 'last_30_days' },
    });
  });

  it('honors an explicit dateRange.field and skips a custom default preset', () => {
    const defs = resolveDashboardFilterDefs({
      dateRange: { field: 'closed_at', defaultRange: 'custom' },
    });
    expect(defs[0].field).toBe('closed_at');
    expect(defs[0].defaultValue).toBeUndefined();
  });

  // objectui#10339 — the spec declares `dateRange.defaultRange` with a default,
  // so a `dateRange` that omits it is a FILTERED dashboard, not an unfiltered one.
  it('applies the spec default preset (this_month) when an authored dateRange omits defaultRange', () => {
    const defs = resolveDashboardFilterDefs({ dateRange: { field: 'created_at' } });
    expect(defs).toHaveLength(1);
    expect(defs[0]).toMatchObject({
      name: DATE_RANGE_FILTER_NAME,
      field: 'created_at',
      type: 'dateRange',
      defaultValue: { preset: 'this_month' },
    });
    // The filter it seeds is a real bound, not an empty value.
    expect(buildFilterCondition(defs[0], defs[0].defaultValue)).toEqual({
      $gte: '{current_month_start}',
      $lte: '{current_month_end}',
    });
  });

  it('reads the omitted-defaultRange preset from the spec schema, not from a local copy', () => {
    const specDefault = SpecDashboardSchema.shape.dateRange.parse({})?.defaultRange;
    expect(specDefault).toBeDefined();
    const defs = resolveDashboardFilterDefs({ dateRange: {} });
    expect(defs[0].field).toBe('created_at');
    expect(defs[0].defaultValue).toEqual({ preset: specDefault });
  });

  it('leaves an explicit defaultRange and allowCustomRange exactly as authored', () => {
    const defs = resolveDashboardFilterDefs({
      dateRange: { field: 'created_at', defaultRange: 'last_7_days', allowCustomRange: false },
    });
    expect(defs[0].defaultValue).toEqual({ preset: 'last_7_days' });
    expect(defs[0].allowCustomRange).toBe(false);
    // No authored dateRange ⇒ no built-in filter at all; the default applies to
    // an authored element only.
    expect(resolveDashboardFilterDefs({})).toEqual([]);
  });

  it('defaults a global filter name to its field and preserves declared names', () => {
    const defs = resolveDashboardFilterDefs({
      globalFilters: [
        { field: 'region' },
        { name: 'owner', field: 'owner_id', type: 'lookup' },
      ],
    });
    expect(defs.map((d) => d.name)).toEqual(['region', 'owner']);
    expect(defs[0].type).toBe('text');
    expect(defs[1].field).toBe('owner_id');
  });

  it('skips entries without a field and lets duplicate names win last', () => {
    const defs = resolveDashboardFilterDefs({
      globalFilters: [
        { field: '' } as any,
        { name: 'region', field: 'region' },
        { name: 'region', field: 'sales_region' },
      ],
    });
    expect(defs).toHaveLength(1);
    expect(defs[0].field).toBe('sales_region');
  });

  // ---------------------------------------------------------------------
  // framework#4475 — a `date` globalFilter's preset-name default.
  //
  // Setup → System Overview rendered EVERY KPI tile as 0 while its period
  // selector read "All time". The dashboard declares
  //   globalFilters: [{ field: 'created_at', type: 'date',
  //                     defaultValue: 'last_7_days' }]
  // and `GlobalFilterSchema.defaultValue` is `string | number | boolean`, so
  // a bare preset name is the ONLY spelling an author can write — but only
  // the built-in `dateRange` declaration was ever lifted to `{ preset }`.
  // The raw string then flowed to `buildFilterCondition`, hit its
  // "bare string date means equality" branch, and the backend compiled
  //   SELECT COUNT(*) … FROM "sys_user" WHERE created_at = $1
  // (verified against a live server) — 200 OK, zero rows, no error anywhere.
  // The same missing lift is why the control showed "All time": DateRangeFilter
  // reads `.preset`/`.from`/`.to`, all undefined on a string.
  // ---------------------------------------------------------------------
  it('[#4475] lifts a date filter\'s preset-name default to { preset }', () => {
    const defs = resolveDashboardFilterDefs({
      globalFilters: [
        { field: 'created_at', type: 'date', label: 'Date Range', defaultValue: 'last_7_days' },
      ] as any,
    });
    expect(defs[0].defaultValue).toEqual({ preset: 'last_7_days' });
  });

  it('[#4475] the lifted default produces a RANGE, never an equality', () => {
    // The end-to-end assertion: what the dashboard declares must reach the
    // query as bounds. Pre-fix this was the literal string 'last_7_days'.
    const [def] = resolveDashboardFilterDefs({
      globalFilters: [
        { field: 'created_at', type: 'date', defaultValue: 'last_7_days' },
      ] as any,
    });
    expect(buildFilterCondition(def, def.defaultValue)).toEqual({
      $gte: '{7_days_ago}',
      $lte: '{today}',
    });
    // And the widget-scoped shape a dataset widget forwards as runtimeFilter.
    expect(buildWidgetScopedFilter({ id: 'w' }, [def], { created_at: def.defaultValue })).toEqual({
      created_at: { $gte: '{7_days_ago}', $lte: '{today}' },
    });
  });

  it('[#4475] leaves a genuine ISO date default as an equality', () => {
    // The documented bare-string behaviour is unchanged — only names this
    // module actually knows as presets are lifted.
    const defs = resolveDashboardFilterDefs({
      globalFilters: [
        { field: 'created_at', type: 'date', defaultValue: '2026-01-15' },
      ] as any,
    });
    expect(defs[0].defaultValue).toBe('2026-01-15');
    expect(buildFilterCondition(defs[0], defs[0].defaultValue)).toBe('2026-01-15');
  });

  it('[#4475] does not touch non-date filters that share a preset-like default', () => {
    const defs = resolveDashboardFilterDefs({
      globalFilters: [
        { field: 'bucket', type: 'select', defaultValue: 'last_7_days' },
        { field: 'score', type: 'number', defaultValue: 7 },
      ] as any,
    });
    expect(defs[0].defaultValue).toBe('last_7_days');
    expect(defs[1].defaultValue).toBe(7);
  });
});

describe('dashboardFilterVariableDefs', () => {
  it('produces page-variable definitions keyed by filter name', () => {
    const vars = dashboardFilterVariableDefs([dateDef, regionDef]);
    expect(vars).toEqual([
      { name: DATE_RANGE_FILTER_NAME, type: 'object', defaultValue: undefined },
      { name: 'region', type: 'string', defaultValue: undefined },
    ]);
  });
});

describe('buildFilterCondition', () => {
  it('maps a date preset to symbolic macro-token bounds', () => {
    expect(buildFilterCondition(dateDef, { preset: 'last_30_days' })).toEqual({
      $gte: '{30_days_ago}',
      $lte: '{today}',
    });
    expect(buildFilterCondition(dateDef, { preset: 'this_month' })).toEqual({
      $gte: '{current_month_start}',
      $lte: '{current_month_end}',
    });
  });

  it('passes custom ISO bounds through and omits a missing bound', () => {
    expect(buildFilterCondition(dateDef, { from: '2026-01-01', to: '2026-06-30' })).toEqual({
      $gte: '2026-01-01',
      $lte: '2026-06-30',
    });
    expect(buildFilterCondition(dateDef, { from: '2026-01-01' })).toEqual({
      $gte: '2026-01-01',
    });
  });

  it('maps select values to equality and arrays to $in', () => {
    expect(buildFilterCondition(regionDef, 'EMEA')).toBe('EMEA');
    expect(buildFilterCondition(regionDef, ['EMEA', 'APAC'])).toEqual({ $in: ['EMEA', 'APAC'] });
  });

  it('maps text to $contains and numbers to equality', () => {
    expect(buildFilterCondition({ name: 'q', field: 'name', type: 'text' }, 'acme')).toEqual({
      $contains: 'acme',
    });
    expect(buildFilterCondition({ name: 'n', field: 'amount', type: 'number' }, 42)).toBe(42);
  });

  it('returns undefined for empty values', () => {
    expect(buildFilterCondition(regionDef, undefined)).toBeUndefined();
    expect(buildFilterCondition(regionDef, '')).toBeUndefined();
    expect(buildFilterCondition(regionDef, [])).toBeUndefined();
    expect(buildFilterCondition(dateDef, {})).toBeUndefined();
    expect(buildFilterCondition(dateDef, { preset: undefined })).toBeUndefined();
  });

  // ---------------------------------------------------------------------
  // #3151 — a date value that is neither a known preset nor an ISO date.
  //
  // The sister case of framework#4475, and the more deceptive direction of
  // the same failure: a misspelled preset ('last_7_dayz') used to fall
  // through to the "bare string means equality" branch and emit
  //   SELECT COUNT(*) … WHERE created_at = 'last_7_dayz'
  // — 200 OK, zero rows, no warning anywhere, indistinguishable from a range
  // that genuinely has no data. It is now skipped and named out loud, the
  // same strictness buildWidgetScopedFilter applies to unknown field names.
  // ---------------------------------------------------------------------
  describe('[#3151] unrecognised date values', () => {
    const withWarn = (fn: (warn: ReturnType<typeof vi.spyOn>) => void) => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        fn(warn);
      } finally {
        warn.mockRestore();
      }
    };

    it('skips a misspelled preset string and warns, naming the filter and the value', () => {
      withWarn((warn) => {
        expect(buildFilterCondition(dateDef, 'last_7_dayz')).toBeUndefined();
        expect(warn).toHaveBeenCalledTimes(1);
        const msg = String(warn.mock.calls[0][0]);
        expect(msg).toContain('skipping filter "dateRange"');
        expect(msg).toContain('last_7_dayz');
        // The remedy travels with the rejection.
        expect(msg).toContain('last_7_days');
      });
    });

    it('keeps a valid ISO date string as an equality, with no warning', () => {
      withWarn((warn) => {
        expect(buildFilterCondition(dateDef, '2026-01-15')).toBe('2026-01-15');
        expect(buildFilterCondition(dateDef, '2026-01-15T08:30:00Z')).toBe('2026-01-15T08:30:00Z');
        expect(warn).not.toHaveBeenCalled();
      });
    });

    it('keeps a date-macro token as an equality, with no warning', () => {
      // Macro tokens stay symbolic in the condition and are resolved at query
      // time by resolveDateMacros — the same vocabulary PRESET_RANGES emits.
      withWarn((warn) => {
        expect(buildFilterCondition(dateDef, '{today}')).toBe('{today}');
        expect(buildFilterCondition(dateDef, '{7_days_ago}')).toBe('{7_days_ago}');
        expect(warn).not.toHaveBeenCalled();
      });
    });

    it('rejects a string that only looks like a date or a macro', () => {
      withWarn((warn) => {
        expect(buildFilterCondition(dateDef, '{last_7_dayz}')).toBeUndefined();
        expect(buildFilterCondition(dateDef, '15/01/2026')).toBeUndefined();
        expect(buildFilterCondition(dateDef, '2026-13-45')).toBeUndefined();
        expect(warn).toHaveBeenCalledTimes(3);
      });
    });

    it('[#4475 regression] a valid preset name still becomes a RANGE, with no warning', () => {
      withWarn((warn) => {
        const [def] = resolveDashboardFilterDefs({
          globalFilters: [
            { field: 'created_at', type: 'date', defaultValue: 'last_7_days' },
          ] as any,
        });
        expect(buildFilterCondition(def, def.defaultValue)).toEqual({
          $gte: '{7_days_ago}',
          $lte: '{today}',
        });
        expect(warn).not.toHaveBeenCalled();
      });
    });

    it('skips an unknown object preset and warns (was a silent drop)', () => {
      withWarn((warn) => {
        expect(buildFilterCondition(dateDef, { preset: 'last_7_dayz' })).toBeUndefined();
        expect(warn).toHaveBeenCalledTimes(1);
        const msg = String(warn.mock.calls[0][0]);
        expect(msg).toContain('skipping filter "dateRange"');
        expect(msg).toContain('unknown date range preset "last_7_dayz"');
      });
    });

    it('keeps explicit bounds when an unknown preset rides along, and says so', () => {
      withWarn((warn) => {
        expect(
          buildFilterCondition(dateDef, { preset: 'last_7_dayz', from: '2026-01-01' }),
        ).toEqual({ $gte: '2026-01-01' });
        expect(warn).toHaveBeenCalledTimes(1);
        expect(String(warn.mock.calls[0][0])).toContain('ignoring unknown date range preset');
      });
    });

    it('drops the filter end-to-end: no runtimeFilter reaches the widget query', () => {
      withWarn((warn) => {
        // What the dashboard actually forwards as `runtimeFilter`. Pre-fix
        // this was { created_at: 'last_7_dayz' } — the zero-row query.
        const [def] = resolveDashboardFilterDefs({
          globalFilters: [
            { field: 'created_at', type: 'date', defaultValue: 'last_7_dayz' },
          ] as any,
        });
        expect(
          buildWidgetScopedFilter({ id: 'kpi_users' }, [def], { created_at: def.defaultValue }),
        ).toBeUndefined();
        expect(warn).toHaveBeenCalledTimes(1);
        expect(String(warn.mock.calls[0][0])).toContain('last_7_dayz');
      });
    });
  });
});

describe('buildWidgetScopedFilter', () => {
  const defs = [dateDef, regionDef];

  it('applies the default binding (the filter\'s own field)', () => {
    const scoped = buildWidgetScopedFilter({ id: 'w1' }, defs, { region: 'EMEA' });
    expect(scoped).toEqual({ region: 'EMEA' });
  });

  it('lets filterBindings override the target field per widget', () => {
    const scoped = buildWidgetScopedFilter(
      { id: 'w1', filterBindings: { dateRange: 'signed_at', region: 'sales_region' } },
      defs,
      { dateRange: { preset: 'last_7_days' }, region: 'APAC' },
    );
    expect(scoped).toEqual({
      $and: [
        { signed_at: { $gte: '{7_days_ago}', $lte: '{today}' } },
        { sales_region: 'APAC' },
      ],
    });
  });

  it('opts a widget out with filterBindings: false', () => {
    const scoped = buildWidgetScopedFilter(
      { id: 'w1', filterBindings: { region: false } },
      defs,
      { region: 'EMEA' },
    );
    expect(scoped).toBeUndefined();
  });

  it('honors the legacy targetWidgets allow-list for default bindings', () => {
    const gated: DashboardFilterDef = { ...regionDef, targetWidgets: ['w2'] };
    expect(buildWidgetScopedFilter({ id: 'w1' }, [gated], { region: 'EMEA' })).toBeUndefined();
    expect(buildWidgetScopedFilter({ id: 'w2' }, [gated], { region: 'EMEA' })).toEqual({
      region: 'EMEA',
    });
    // Explicit binding wins over the allow-list.
    expect(
      buildWidgetScopedFilter({ id: 'w1', filterBindings: { region: 'area' } }, [gated], {
        region: 'EMEA',
      }),
    ).toEqual({ area: 'EMEA' });
  });

  it('combines several active filters with $and and returns undefined when none apply', () => {
    const scoped = buildWidgetScopedFilter({ id: 'w1' }, defs, {
      dateRange: { preset: 'today' },
      region: 'EMEA',
    });
    expect(scoped).toEqual({
      $and: [
        { created_at: { $gte: '{today}', $lte: '{today}' } },
        { region: 'EMEA' },
      ],
    });
    expect(buildWidgetScopedFilter({ id: 'w1' }, defs, {})).toBeUndefined();
  });

  it('skips a DEFAULT binding whose field is not on the object (knownFields), with a warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const known = new Set(['status', 'signed_at']);
      // Default region binding targets `region`, which the object lacks → skipped.
      expect(buildWidgetScopedFilter({ id: 'w1' }, [regionDef], { region: 'EMEA' }, known)).toBeUndefined();
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).toContain('does not exist');
    } finally {
      warn.mockRestore();
    }
  });

  it('always honours an EXPLICIT filterBindings string, even when knownFields lacks it', () => {
    const known = new Set(['status']);
    const scoped = buildWidgetScopedFilter(
      { id: 'w1', filterBindings: { region: 'sales_region' } },
      [regionDef],
      { region: 'EMEA' },
      known,
    );
    // The author asked for that field — a typo surfaces as an empty widget,
    // never a silently-dropped filter.
    expect(scoped).toEqual({ sales_region: 'EMEA' });
  });

  it('applies no metadata check when knownFields is omitted (metadata unavailable)', () => {
    expect(buildWidgetScopedFilter({ id: 'w1' }, [regionDef], { region: 'EMEA' })).toEqual({
      region: 'EMEA',
    });
  });
});

describe('mergeFilters', () => {
  it('ANDs two non-empty filters, passes single ones through, drops empties', () => {
    expect(mergeFilters({ a: 1 }, { b: 2 })).toEqual({ $and: [{ a: 1 }, { b: 2 }] });
    expect(mergeFilters({ a: 1 }, undefined)).toEqual({ a: 1 });
    expect(mergeFilters(undefined, { b: 2 })).toEqual({ b: 2 });
    expect(mergeFilters({}, undefined)).toBeUndefined();
  });
});

/**
 * `DATE_RANGE_PRESETS` stopped being `Object.keys(PRESET_RANGES)` and became a
 * re-export of the spec's const in objectui#4167 (objectstack#4115).
 *
 * A COPY of a const passes every value comparison — that insight is why the
 * guard's own header says reference identity is the only check that separates a
 * re-export from a fork, and it is the one assertion a `toEqual` on the member
 * list cannot make. So the first test asks `toBe`, deliberately.
 *
 * The second is the other half of the burn-down and the one with teeth at
 * runtime: the spec owns which presets EXIST, this module owns what each one
 * RESOLVES TO, and nothing but the `satisfies` in `dashboard-filters.ts` ties
 * them together. That is a compile-time pin, so it is erased here — this test
 * is what makes the same claim visible in a suite run, and what would catch a
 * future edit that re-annotated the table as `Record<string, …>` (a string index
 * signature satisfies every literal key, so the `satisfies` would go vacuously
 * green while the bounds table quietly went missing entries).
 */
describe('DATE_RANGE_PRESETS is the spec\'s list, not a copy of it', () => {
  it('is the spec\'s own array by REFERENCE, not an equal one', async () => {
    const spec = await import('@objectstack/spec/ui');
    expect(DATE_RANGE_PRESETS).toBe(spec.DATE_RANGE_PRESETS);
  });

  it('every offered preset resolves to date-macro bounds', () => {
    // `buildFilterCondition` warns and drops a preset it has no bounds for, so a
    // preset in this list with no entry in the bounds table is a filter that
    // validates clean and then selects nothing — the exact failure the spec's
    // own comment on DATE_RANGE_PRESETS describes.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      for (const preset of DATE_RANGE_PRESETS) {
        const built = buildFilterCondition(
          { name: 'd', field: 'created_at', type: 'dateRange' },
          { preset },
        );
        expect(built, `preset "${preset}" produced no condition`).toBeDefined();
      }
      expect(
        warn.mock.calls.map((c) => String(c[0])).filter((m) => m.includes('unknown date range preset')),
      ).toEqual([]);
    } finally {
      warn.mockRestore();
    }
  });
});

// ---------------------------------------------------------------------------
// objectui#4165 — the ADR-0089 legacy-alias window for a date filter's
// declared `defaultValue`.
//
// Maintainer ruling (2026-08-11): the spec stays strict, the bare preset NAME
// is the single canonical spelling, and the stored `{ preset }` object form is
// a documented legacy alias — lifted on read, rewritten on next save.
//
// READ THE STRENGTHS OF THESE PINS HONESTLY — reverse verification (deleting
// the lift call in `resolveDashboardFilterDefs`, re-running, restoring) turned
// exactly ONE of them red: the warning. The convergence and rendering pins were
// green with the lift and green without it, and it is worth knowing why rather
// than mistaking them for proof.
//
// A legacy DECLARATION (`defaultValue: { preset }`) happens to be shaped like
// the runtime VALUE `normalizeDateDefault` produces for the canonical spelling,
// and `normalizeDateDefault` passes non-strings straight through. So a stored
// `{ preset }` dashboard already rendered correctly before this change and
// still would with the lift removed. That coincidence is the whole reason the
// object form looked harmless for so long — and it is how the divergence prose
// drifted into calling it "the on-disk form".
//
// So what each pin is for:
//  - the WARNING pin is the one that can detect the lift's absence, and it is
//    what makes the window closable at all (ADR-0078);
//  - the CONVERGENCE and BOUNDS pins are regression guards, not evidence: they
//    say the lift did not break the shape everything downstream reads. Kept
//    deliberately, labelled deliberately;
//  - the behavioural teeth of #4165 are elsewhere and DO go red — the schema's
//    refusal (`@object-ui/types` parity suite) and the rewrite-on-save
//    (`@object-ui/plugin-designer`'s DashboardDesignPage pin).
// ---------------------------------------------------------------------------
describe('[#4165] legacy `{ preset }` declaration — ADR-0089 alias lift', () => {
  const legacy = { field: 'created_at', type: 'date', label: 'Date Range', defaultValue: { preset: 'last_7_days' } };
  const canonical = { field: 'created_at', type: 'date', label: 'Date Range', defaultValue: 'last_7_days' };

  const resolveQuietly = (globalFilters: unknown[]) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      return {
        defs: resolveDashboardFilterDefs({ globalFilters } as any),
        warnings: warn.mock.calls.map((c) => String(c[0])),
      };
    } finally {
      warn.mockRestore();
    }
  };

  // Regression guard (see the block note): green with or without the lift.
  it('resolves to defs identical to the canonical spelling', () => {
    const { defs: fromLegacy } = resolveQuietly([legacy]);
    const { defs: fromCanonical } = resolveQuietly([canonical]);
    expect(fromLegacy).toEqual(fromCanonical);
    // …and specifically to the runtime VALUE shape the date consumers read.
    // Note this is `{ preset }` again — the round trip is not a no-op, it is
    // declaration → canonical name → value. See `normalizeDateDefault`'s note
    // on declaration space vs value space; conflating the two is what #4165
    // was filed about.
    expect(fromLegacy[0].defaultValue).toEqual({ preset: 'last_7_days' });
  });

  it('produces the same query bounds as the canonical spelling', () => {
    const { defs } = resolveQuietly([legacy]);
    expect(buildFilterCondition(defs[0], defs[0].defaultValue)).toEqual({
      $gte: '{7_days_ago}',
      $lte: '{today}',
    });
  });

  it('warns when it lifts, so a surviving legacy document is visible', () => {
    // ADR-0078 — a silent lift can never be retired: nothing would ever show
    // that the last legacy document is gone.
    const { warnings } = resolveQuietly([legacy]);
    const lift = warnings.filter((m) => m.includes('LEGACY'));
    expect(lift).toHaveLength(1);
    expect(lift[0]).toContain('created_at');
    expect(lift[0]).toContain('last_7_days');
    expect(lift[0]).toContain('#4165');
  });

  it('says nothing at all for a canonical declaration', () => {
    const { warnings } = resolveQuietly([canonical]);
    expect(warnings).toEqual([]);
  });

  it('does not lift a `{ preset, from, to }` value — it has no canonical spelling', () => {
    // Left exactly as declared; `buildFilterCondition` still reads the bounds
    // off it, so nothing breaks, but no data is silently dropped to fit the
    // bare-name form.
    const withBounds = { field: 'created_at', type: 'date', defaultValue: { preset: 'last_7_days', from: '2026-01-01' } };
    const { defs, warnings } = resolveQuietly([withBounds]);
    expect(defs[0].defaultValue).toEqual({ preset: 'last_7_days', from: '2026-01-01' });
    expect(warnings.filter((m) => m.includes('LEGACY'))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// #4356 — the bare-string `options` shorthand is RETIRED: dropped, not lifted.
//
// Maintainer ruling of 2026-08-12 on objectstack#7917, verbatim 「7917 ②」: the
// spec stays strict and the runtime lift retires. PR #4601 shipped the warn half
// (Phase 1); the window closed on the 2026-09-02 ruling, verbatim
// 「objectstack#7917 不考虑现有数据」, and this block pins the end state
// (Phase 2): a non-object member yields no option, a shorthand-only filter
// resolves with no `options`, and a mixed array keeps only its object members.
//
// What each pin here is for:
//  - the DROP pins are the discriminating ones: each went red against the
//    Phase 1 build (which lifted `'EMEA'` to `{ value: 'EMEA', label: 'EMEA' }`)
//    before the arm was removed — red-first, quoted in the landing PR;
//  - the WARNING pin keeps the skip audible (ADR-0078 §4 — where the runtime
//    skips an instance it emits a dev-mode diagnostic rather than swallowing
//    it): a stored dashboard is the one document no author-time gate re-reads,
//    and an empty select with no line in the console reads as "no data". The
//    warning names the filter, the dropped members and the rewrite, and it
//    promises NO lift — the Phase 1 sentence "Still lifted here" retired with
//    the arm, which the negative pin below guards;
//  - the ONCE pin protects the render path. `resolveDashboardFilterDefs` runs
//    on every dashboard render, so a warning without the memo floods the
//    console per frame — and a warning that floods is a warning that gets muted;
//  - the CANONICAL-SILENCE pin is a false-positive guard, honestly NOT a
//    discrimination proof: it passes vacuously against a build with no warning
//    at all. It goes red if the warn ever fires on healthy dashboards.
// ---------------------------------------------------------------------------
describe('[#4356] bare-string `options` shorthand — retired: dropped, not lifted', () => {
  /** Capture warnings without letting them reach the suite's console. */
  const resolveQuietly = (globalFilters: unknown[]) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      return {
        defs: resolveDashboardFilterDefs({ globalFilters } as any),
        warnings: warn.mock.calls.map((c) => String(c[0])),
      };
    } finally {
      warn.mockRestore();
    }
  };

  /** The one warning this block is about, picked by its card, not its prose. */
  const shorthandWarnings = (warnings: string[]) => warnings.filter((m) => m.includes('objectui#4356'));

  beforeEach(() => {
    resetDashboardFilterWarnings();
  });

  it('DROPS a bare string: a shorthand-only filter resolves with no `options`, and says so', () => {
    const { defs, warnings } = resolveQuietly([
      { name: 'region', field: 'region', type: 'select', options: ['EMEA', 'APAC'] },
    ]);

    // Nothing is lifted — the spec's reading of the document, no dialect beside it.
    expect(defs).toHaveLength(1);
    expect(defs[0].options).toBeUndefined();

    const w = shorthandWarnings(warnings);
    expect(w).toHaveLength(1);
    // Names the filter, the dropped members and the rewrite — a warning an
    // author cannot act on is noise.
    expect(w[0]).toContain('filter "region"');
    expect(w[0]).toContain('"EMEA"');
    expect(w[0]).toContain('"APAC"');
    expect(w[0]).toContain('{ value: "EMEA", label: "EMEA" }');
    // …and promises no lift. The Phase 1 text said "Still lifted here"; that
    // sentence is the one thing the ruling forbids this warning to carry.
    expect(w[0]).not.toContain('lifted here');
  });

  it('keeps ONLY the object members of a MIXED array, and names only the dropped ones', () => {
    // Partial migrations happen — the survey found one in this very repo. The
    // object member renders; re-reporting it would send the author back to an
    // option they had just fixed.
    const { defs, warnings } = resolveQuietly([
      { name: 'stage', field: 'stage', type: 'select', options: [{ value: 'won', label: 'Won' }, 'lost'] },
    ]);
    expect(defs[0].options).toEqual([{ value: 'won', label: 'Won' }]);
    const w = shorthandWarnings(warnings);
    expect(w).toHaveLength(1);
    expect(w[0]).toContain('"lost"');
    expect(w[0]).not.toContain('"won"');
  });

  it('drops EVERY non-object member — a number and a boolean, not only a string', () => {
    // Phase 1 lifted every non-nullish primitive through `String(o)`; the
    // retirement removes the whole arm, not the string case of it.
    const { defs, warnings } = resolveQuietly([
      { name: 'tier', field: 'tier', type: 'select', options: [42, true, { value: 'gold', label: 'Gold' }] },
    ]);
    expect(defs[0].options).toEqual([{ value: 'gold', label: 'Gold' }]);
    const w = shorthandWarnings(warnings);
    expect(w).toHaveLength(1);
    expect(w[0]).toContain('42');
    expect(w[0]).toContain('true');
  });

  it('warns ONCE per offending filter across repeated renders, and drops on every one of them', () => {
    // The render path calls this on every frame. Three resolves, one warning.
    const filters = [{ name: 'status', field: 'status', type: 'select', options: ['draft', 'paid'] }];
    const first = resolveQuietly(filters);
    const second = resolveQuietly(filters);
    const third = resolveQuietly(filters);

    expect(shorthandWarnings(first.warnings)).toHaveLength(1);
    expect(shorthandWarnings(second.warnings)).toHaveLength(0);
    expect(shorthandWarnings(third.warnings)).toHaveLength(0);

    // The memo mutes the WARNING, never the behaviour: the member is dropped on
    // every resolve, memo or not — a dedupe that also changed the output would
    // be a silent data change.
    expect(first.defs[0].options).toBeUndefined();
    expect(third.defs[0].options).toBeUndefined();
  });

  it('warns separately for a DIFFERENT filter — the memo is not a global mute', () => {
    // Keying the memo on the values alone would report the first filter and
    // send the author to fix one symptom while the rest stayed silent.
    const { warnings } = resolveQuietly([
      { name: 'region', field: 'region', type: 'select', options: ['EMEA'] },
      { name: 'status', field: 'status', type: 'select', options: ['draft'] },
    ]);
    const w = shorthandWarnings(warnings);
    expect(w).toHaveLength(2);
    expect(w[0]).toContain('filter "region"');
    expect(w[1]).toContain('filter "status"');
  });

  it('says NOTHING for canonical `{ value, label }` options, and keeps an I18nLabel map intact', () => {
    // False-positive guard: this would otherwise fire on every healthy
    // dashboard in the product.
    const { defs, warnings } = resolveQuietly([
      {
        name: 'region',
        field: 'region',
        type: 'select',
        options: [{ value: 'emea', label: 'EMEA' }, { value: 'apac', label: { en: 'APAC', 'zh-CN': '亚太' } }],
      },
    ]);
    expect(shorthandWarnings(warnings)).toEqual([]);
    // The I18nLabel map survives untouched (#4032 / #4163 must-not-change).
    expect(defs[0].options).toEqual([
      { value: 'emea', label: 'EMEA' },
      { value: 'apac', label: { en: 'APAC', 'zh-CN': '亚太' } },
    ]);
  });

  it('`resetDashboardFilterWarnings` re-arms the memo — the export keeps its job', () => {
    const filters = [{ name: 'region', field: 'region', type: 'select', options: ['EMEA'] }];
    expect(shorthandWarnings(resolveQuietly(filters).warnings)).toHaveLength(1);
    expect(shorthandWarnings(resolveQuietly(filters).warnings)).toHaveLength(0);
    resetDashboardFilterWarnings();
    expect(shorthandWarnings(resolveQuietly(filters).warnings)).toHaveLength(1);
  });
});
