// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  DashboardSchema,
  DashboardWidgetSchema,
  DashboardHeaderSchema,
  DashboardHeaderActionSchema,
  Dashboard,
  WidgetColorVariantSchema,
  WidgetActionTypeSchema,
  GlobalFilterSchema,
  GlobalFilterOptionsFromSchema,
  DATE_RANGE_PRESETS,
  DATE_RANGE_DEFAULT_RANGES,
} from './dashboard.zod';

/**
 * ADR-0021 single-form: every dashboard widget binds a `dataset` and selects
 * `dimensions`/`values` BY NAME. The legacy inline `object` + `categoryField` +
 * `valueField` + `aggregate` query was removed in the cutover, so these tests
 * cover the dataset shape and the surviving presentation sub-schemas.
 */
describe('DashboardWidgetSchema (dataset-bound)', () => {
  it('accepts a KPI/metric widget (dataset + values, no dimensions)', () => {
    const w = DashboardWidgetSchema.parse({
      id: 'total_pipeline', type: 'metric', dataset: 'sales', values: ['revenue'],
      layout: { x: 0, y: 0, w: 3, h: 2 },
    });
    expect(w.dataset).toBe('sales');
    expect(w.values).toEqual(['revenue']);
  });

  // Regression (Studio dashboard designer): the designer adds widgets WITHOUT a
  // `layout`; the renderer auto-flows them. `layout` must be OPTIONAL — when it
  // was required, every designer-authored dashboard failed validation (422 on
  // draft save) and Publish stayed disabled even though the widget rendered.
  it('accepts a widget with NO layout (auto-flowed; Studio designer omits it)', () => {
    const w = DashboardWidgetSchema.parse({
      id: 'widget_1', type: 'metric', dataset: 'showcase_task_metrics', values: ['task_count'],
    });
    expect(w.layout).toBeUndefined();
    expect(w.values).toEqual(['task_count']);
  });

  it('accepts a chart widget with dimensions', () => {
    const w = DashboardWidgetSchema.parse({
      id: 'by_stage', type: 'bar', dataset: 'sales', dimensions: ['stage'], values: ['revenue'],
      layout: { x: 0, y: 0, w: 6, h: 4 },
    });
    expect(w.dimensions).toEqual(['stage']);
  });

  it('keeps the presentation-scope filter (runtimeFilter) and compareTo', () => {
    const w = DashboardWidgetSchema.parse({
      id: 'won', type: 'metric', dataset: 'sales', values: ['revenue'],
      // #5011: `compareTo` is the executor's `{ kind, dimension? }` contract.
      // The bare string this used to assert is retired — see
      // `dashboard-compareto.test.ts` for the prescription it now raises.
      filter: { stage: 'closed_won' }, compareTo: { kind: 'previousPeriod' },
      layout: { x: 0, y: 0, w: 3, h: 2 },
    });
    expect(w.filter).toEqual({ stage: 'closed_won' });
    expect(w.compareTo).toEqual({ kind: 'previousPeriod' });
  });

  it('rejects a widget with no dataset', () => {
    expect(() => DashboardWidgetSchema.parse({ id: 'x', type: 'metric', values: ['revenue'], layout: { x: 0, y: 0, w: 3, h: 2 } })).toThrow();
  });

  it('rejects a widget with no values', () => {
    expect(() => DashboardWidgetSchema.parse({ id: 'x', type: 'metric', dataset: 'sales', values: [], layout: { x: 0, y: 0, w: 3, h: 2 } })).toThrow();
  });

  it('a widget supplying only the removed inline fields is invalid (missing dataset AND unknown keys)', () => {
    // Fails twice over now: no `dataset`/`values`, and under `.strict()` the
    // legacy `object`/`aggregate` keys are unrecognized.
    expect(() => DashboardWidgetSchema.parse({ id: 'x', type: 'metric', object: 'opportunity', aggregate: 'count', layout: { x: 0, y: 0, w: 3, h: 2 } } as any)).toThrow();
  });

  // ── .strict() endpoint (framework#3251, protocol 16 step16) ──────────────
  it('rejects an otherwise-valid widget carrying a legacy analytics key, and points at the dataset shape', () => {
    const legacy = { id: 'w_legacy', type: 'bar', dataset: 'sales', values: ['revenue'], categoryField: 'stage' } as any;
    const res = DashboardWidgetSchema.safeParse(legacy);
    expect(res.success).toBe(false);
    if (!res.success) {
      const unknown = res.error.issues.find((i) => i.code === 'unrecognized_keys');
      expect(unknown).toBeDefined();
      const msg = unknown!.message;
      expect(msg).toContain('categoryField');
      expect(msg).toContain('dataset');
    }
  });

  it('rejects the objectui-internal `component` / inline `data` keys', () => {
    expect(() => DashboardWidgetSchema.parse({ id: 'w_comp', type: 'metric', dataset: 'sales', values: ['revenue'], component: {} } as any)).toThrow();
    const res = DashboardWidgetSchema.safeParse({ id: 'w_data', type: 'metric', dataset: 'sales', values: ['revenue'], data: [] } as any);
    expect(res.success).toBe(false);
    if (!res.success) {
      const unknown = res.error.issues.find((i) => i.code === 'unrecognized_keys');
      expect(unknown!.message).toContain('objectui-internal');
    }
  });

  it('rejects an unknown/typo top-level key and names it in the error', () => {
    const res = DashboardWidgetSchema.safeParse({ id: 'w_typo', type: 'metric', dataset: 'sales', values: ['revenue'], colourVariant: 'blue' } as any);
    expect(res.success).toBe(false);
    if (!res.success) expect(JSON.stringify(res.error.issues)).toContain('colourVariant');
  });

  it('keeps `options` as the free-form renderer-extras escape hatch', () => {
    const w = DashboardWidgetSchema.parse({
      id: 'w_opts', type: 'bar', dataset: 'sales', values: ['revenue'],
      options: { stacked: true, palette: ['#111', '#222'], drillDown: { enabled: true } },
    });
    expect((w.options as any).stacked).toBe(true);
  });

  it('keeps the runtime capability gates', () => {
    const w = DashboardWidgetSchema.parse({
      id: 'gated', type: 'metric', dataset: 'sys', values: ['cnt'],
      requiresObject: 'sys_package_installation', requiresService: 'analytics',
      layout: { x: 0, y: 0, w: 3, h: 2 },
    });
    expect(w.requiresObject).toBe('sys_package_installation');
    expect(w.requiresService).toBe('analytics');
  });
});

/**
 * Message ORDER on the widget unknown-key rejection (#6416, applying #5955's
 * ruling; #6619 folded the map into the shared template).
 *
 * Written against `strictWidgetAnalyticsError`, the hand-written `$ZodErrorMap`
 * that neither #5955 nor #5593 could reach; #6416 direction 1 reordered it in
 * place with these pins as the acceptance criteria, and #6619 folded the three
 * prescription branches into `strictObject` `guidanceSets`
 * ({@link WIDGET_GUIDANCE_SETS} in `dashboard.zod.ts`). The pins migrated with
 * the code: the ORDER contract (front matter → fix channels → history last)
 * is now the template's own. Two byte-level changes rode the fold, each pinned
 * below where it lands:
 *
 * - prescriptions render as the template's `\n  • ` bullets instead of joined
 *   inline with a space;
 * - keys with no family and no prescription now get the template's
 *   edit-distance rename (`titel` → `title`), which the hand-written map had
 *   no channel for.
 *
 * ORDER pins, not presence checks: the fold deletes nothing, so every
 * `toContain` in the block above stays green either way. An edit that folds the
 * sentence back into the middle passes all of them and fails here.
 */
describe('widget unknown-key message order — fix before history (#6416 / #6619)', () => {
  const HISTORY =
    'Undeclared top-level keys were dropped silently before strict validation, ' +
    'shipping inert metadata; a stale or mis-layered key is now a loud parse error.';

  const base = { id: 'w1', type: 'metric', dataset: 'sales', values: ['revenue'] };
  const messageFor = (extra: Record<string, unknown>) => {
    const res = DashboardWidgetSchema.safeParse({ ...base, ...extra } as any);
    expect(res.success).toBe(false);
    const unknown = res.error!.issues.find((i) => i.code === 'unrecognized_keys');
    expect(unknown).toBeDefined();
    return unknown!.message;
  };

  const orderPin = (label: string, extra: Record<string, unknown>, key: string, fix: string) => {
    it(label, () => {
      const m = messageFor(extra);
      // 1. which key is wrong — and nothing before it
      expect(m.startsWith(`Unrecognized key(s) on this dashboard widget: \`${key}\`.`)).toBe(true);
      // 2. the fix, ahead of the history
      expect(m).toContain(fix);
      expect(m.indexOf(fix)).toBeLessThan(m.indexOf(HISTORY));
      // 3. the history sentence, verbatim, last — moved, never dropped
      expect(m.endsWith(` ${HISTORY}`)).toBe(true);
    });
  };

  orderPin(
    'legacy inline-analytics branch: the ADR-0021 dataset prescription comes first',
    { categoryField: 'stage' },
    'categoryField',
    'The pre-ADR-0021 inline analytics shape',
  );

  orderPin(
    'quarantine branch: the objectui-internal verdict comes first',
    { component: {} },
    'component',
    '`component` and inline `data` are objectui-internal renderer capabilities',
  );

  orderPin(
    'drill branch (#5022): the "AUTOMATIC" answer comes first',
    { drillDown: { enabled: true } },
    'drillDown',
    'Drill-through on a dashboard is AUTOMATIC and not configurable per widget',
  );

  it('keeps the whole drill answer ahead of the history, not just its opening', () => {
    // The #5022 branch is the longest of the three; its two "where the real
    // drills live" pointers are the actionable part and must not slip behind.
    const m = messageFor({ drillDown: { enabled: true } });
    expect(m.indexOf('`ChartDrillDownSchema`')).toBeLessThan(m.indexOf(HISTORY));
    expect(m.indexOf('`ReportSchema.drilldown` (ADR-0021 D2, on by default).'))
      .toBeLessThan(m.indexOf(HISTORY));
  });

  it('is unchanged in SHAPE when no fix matches — full-message pin', () => {
    // A key with no family, no guidance and no near-declared-key: the history
    // follows the key statement directly. Any stray separator fails here.
    expect(messageFor({ zzWrongKey: 'blue' }))
      .toBe(`Unrecognized key(s) on this dashboard widget: \`zzWrongKey\`. ${HISTORY}`);
  });

  it('a near-miss of a DECLARED key now gets the rename the bespoke map never offered (#6619)', () => {
    // `colourVariant` was this block's no-fix fixture while the map was
    // hand-written: it answered with nothing but the history, leaving the
    // author to find `colorVariant` alone. Folding onto the shared template
    // brought the edit-distance channel with it — a deliberate byte change,
    // in the fix-before-history order the block pins.
    const m = messageFor({ colourVariant: 'blue' });
    expect(m).toBe(
      'Unrecognized key(s) on this dashboard widget: `colourVariant`. '
      + `Did you mean \`colourVariant\` → \`colorVariant\`? ${HISTORY}`,
    );
  });

  it('emits the history exactly once, whatever the key count', () => {
    const m = messageFor({ categoryField: 'stage', alsoWrong: 1, andThis: 2 });
    expect(m.split(HISTORY)).toHaveLength(2);
    expect(m.endsWith(` ${HISTORY}`)).toBe(true);
  });

  it('keys from TWO families now surface BOTH prescriptions, in declaration order (#6619)', () => {
    // The one deliberate behaviour change in the fold. The hand-written map
    // was an if/else chain: a widget carrying `categoryField` AND `component`
    // got only the legacy-analytics answer, and the quarantine verdict was
    // silently dropped. Sets answer independently — one bullet each, ordered
    // as declared — and each family speaks exactly once however many of its
    // members were written.
    const m = messageFor({ categoryField: 'stage', component: {} });
    const legacy = 'The pre-ADR-0021 inline analytics shape';
    const quarantine = '`component` and inline `data` are objectui-internal renderer capabilities';
    expect(m).toContain(legacy);
    expect(m).toContain(quarantine);
    expect(m.indexOf(legacy)).toBeLessThan(m.indexOf(quarantine));
    expect(m.endsWith(` ${HISTORY}`)).toBe(true);
    // Once per family, not once per member.
    expect(m.split(legacy)).toHaveLength(2);
  });

  it('a set answers once however many of its members are written (#6619)', () => {
    const m = messageFor({ categoryField: 'stage', valueField: 'amount', aggregate: 'sum' });
    expect(m.split('The pre-ADR-0021 inline analytics shape')).toHaveLength(2);
    expect(m.endsWith(` ${HISTORY}`)).toBe(true);
  });
});

describe('DashboardSchema', () => {
  it('parses a dataset-bound dashboard', () => {
    const d = DashboardSchema.parse({
      name: 'sales_overview', label: 'Sales Overview',
      widgets: [
        { id: 'kpi', type: 'metric', dataset: 'sales', values: ['revenue'], layout: { x: 0, y: 0, w: 3, h: 2 } },
        { id: 'chart', type: 'bar', dataset: 'sales', dimensions: ['stage'], values: ['revenue'], layout: { x: 3, y: 0, w: 6, h: 4 } },
      ],
    });
    expect(d.widgets).toHaveLength(2);
  });

  it('parses a designer-authored dashboard whose widgets omit layout', () => {
    const d = DashboardSchema.parse({
      name: 'delivery_exec_overview', label: 'Delivery Executive Overview',
      widgets: [
        { id: 'widget_1', type: 'metric', dataset: 'showcase_task_metrics', values: ['task_count'] },
        { id: 'widget_2', type: 'donut', dataset: 'showcase_task_metrics', dimensions: ['status'], values: ['task_count'] },
      ],
    });
    expect(d.widgets.every((w) => w.layout === undefined)).toBe(true);
  });

  it('Dashboard.create factory parses + returns a typed dashboard', () => {
    const d = Dashboard.create({
      name: 'dash_x', label: 'D',
      widgets: [{ id: 'wid_x', type: 'metric', dataset: 'sales', values: ['revenue'], layout: { x: 0, y: 0, w: 3, h: 2 } }],
    });
    expect(d.name).toBe('dash_x');
  });

  it('supports columns/gap/refresh/dateRange/globalFilters', () => {
    const d = DashboardSchema.parse({
      name: 'dash_x', label: 'D', columns: 12, gap: 4, refreshInterval: 60,
      dateRange: { field: 'close_date', defaultRange: 'this_quarter' },
      globalFilters: [{ field: 'owner', type: 'lookup' }],
      widgets: [{ id: 'wid_x', type: 'metric', dataset: 'sales', values: ['revenue'], layout: { x: 0, y: 0, w: 3, h: 2 } }],
    });
    expect(d.columns).toBe(12);
    expect(d.globalFilters).toHaveLength(1);
  });
});

describe('Dashboard presentation sub-schemas', () => {
  it('DashboardHeaderSchema + action', () => {
    const h = DashboardHeaderSchema.parse({ showTitle: true, actions: [{ label: 'New', actionUrl: '/new', actionType: 'modal' }] });
    expect(h.actions).toHaveLength(1);
    expect(DashboardHeaderActionSchema.parse({ label: 'X', actionUrl: '/x' }).label).toBe('X');
  });

  it('WidgetColorVariantSchema + WidgetActionTypeSchema enums', () => {
    expect(WidgetColorVariantSchema.parse('blue')).toBe('blue');
    expect(WidgetActionTypeSchema.parse('flow')).toBe('flow');
    expect(() => WidgetColorVariantSchema.parse('chartreuse')).toThrow();
  });

  it('GlobalFilterSchema + GlobalFilterOptionsFromSchema', () => {
    const f = GlobalFilterSchema.parse({ field: 'owner', type: 'lookup', optionsFrom: { object: 'user', valueField: 'id', labelField: 'name' }, scope: 'dashboard' });
    expect(f.scope).toBe('dashboard');
    expect(GlobalFilterOptionsFromSchema.parse({ object: 'user', valueField: 'id', labelField: 'name' }).object).toBe('user');
  });

  it('GlobalFilterSchema.name — optional stable variable key (framework#2501)', () => {
    const named = GlobalFilterSchema.parse({ name: 'region', field: 'sales_region', type: 'select' });
    expect(named.name).toBe('region');
    // name stays optional — runtime defaults it to `field`.
    expect(GlobalFilterSchema.parse({ field: 'region' }).name).toBeUndefined();
  });

  describe('GlobalFilterSchema.object — i18n label-resolution key (#7804)', () => {
    it('accepts a string object name and threads it through unchanged', () => {
      const f = GlobalFilterSchema.parse({ field: 'sales_channel', type: 'select', object: 'opportunity' });
      expect(f.object).toBe('opportunity');
    });

    it('is optional — absent stays absent, no default materializes', () => {
      const f = GlobalFilterSchema.parse({ field: 'sales_channel', type: 'select' }) as Record<string, unknown>;
      expect(f.object).toBeUndefined();
      expect('object' in f).toBe(false);
    });

    it('rejects a non-string value', () => {
      expect(() => GlobalFilterSchema.parse({ field: 'x', object: 123 } as any)).toThrow();
      expect(() => GlobalFilterSchema.parse({ field: 'x', object: true } as any)).toThrow();
      expect(() => GlobalFilterSchema.parse({ field: 'x', object: null } as any)).toThrow();
    });

    it('is independent of optionsFrom.object — the two may name different objects', () => {
      // A filter targeting `opportunity.owner` with its dropdown options
      // sourced from `user` — the label-resolution object and the
      // options-source object are deliberately allowed to differ.
      const f = GlobalFilterSchema.parse({
        field: 'owner',
        type: 'lookup',
        object: 'opportunity',
        optionsFrom: { object: 'user', valueField: 'id', labelField: 'name' },
      });
      expect(f.object).toBe('opportunity');
      expect(f.optionsFrom?.object).toBe('user');
    });

    it('does not disturb GlobalFilterSchema unknown-key strictness', () => {
      const res = GlobalFilterSchema.safeParse({ field: 'x', object: 'opportunity', bogusKey: true } as any);
      expect(res.success).toBe(false);
      if (!res.success) {
        const unknown = res.error.issues.find((i) => i.code === 'unrecognized_keys');
        expect(unknown).toBeDefined();
        expect(unknown!.message).toContain('bogusKey');
      }
    });

    it('declares a string JSON-Schema slot, not required', () => {
      const js = z.toJSONSchema(GlobalFilterSchema as unknown as z.ZodType, {
        unrepresentable: 'any',
        io: 'input',
      }) as any;
      const prop = js.properties?.object;
      expect(prop).toBeDefined();
      expect(prop.type).toBe('string');
      expect(js.required ?? []).not.toContain('object');
    });
  });

  it('DashboardWidgetSchema.filterBindings — field override / opt-out (framework#2501)', () => {
    const w = DashboardWidgetSchema.parse({
      id: 'accounts_signed', type: 'line', dataset: 'accounts', values: ['count'],
      filterBindings: { dateRange: 'signed_at', region: 'sales_region', status: false },
    });
    expect(w.filterBindings).toEqual({ dateRange: 'signed_at', region: 'sales_region', status: false });
    // Only string (field name) or literal false are valid binding values.
    expect(() => DashboardWidgetSchema.parse({
      id: 'w_bad', type: 'metric', dataset: 'sales', values: ['revenue'],
      filterBindings: { region: true },
    })).toThrow();
  });
});

/**
 * #4614 — the date-range preset vocabulary, and the `defaultValue` check it
 * makes possible.
 *
 * Before this, `dateRange.defaultRange` was an enum (a typo there was already an
 * author-time error) while a `globalFilters` entry of `type: 'date'` accepted
 * any `string | number | boolean` unchecked. A misspelled preset therefore
 * failed silently and late — the renderer cannot lift it to a range, falls
 * through to "a bare string means equality on that day", and emits a condition
 * no row matches. The dashboard reads 0 everywhere and looks deliberately empty.
 */
describe('date-range preset vocabulary (#4614)', () => {
  const dateFilter = (defaultValue: unknown) =>
    GlobalFilterSchema.parse({ field: 'created_at', type: 'date', defaultValue });

  it('is a closed vocabulary — counts pinned so a silent add/drop is loud', () => {
    // ADR-0122 receipt convention: assert the count, not just membership, so a
    // name appearing or vanishing cannot ride in under a passing test.
    expect(DATE_RANGE_PRESETS).toHaveLength(13);
    expect(DATE_RANGE_DEFAULT_RANGES).toHaveLength(14);

    // `custom` names no window — it is a `defaultRange` sentinel only.
    expect(DATE_RANGE_PRESETS).not.toContain('custom');
    expect(DATE_RANGE_DEFAULT_RANGES).toContain('custom');
    expect(new Set(DATE_RANGE_PRESETS).size).toBe(DATE_RANGE_PRESETS.length);
  });

  it('`dateRange.defaultRange` accepts exactly what it accepted before the extraction', () => {
    // The vocabulary moved out of this enum into a shared constant; this is the
    // assertion that the move was value-preserving.
    for (const range of DATE_RANGE_DEFAULT_RANGES) {
      const d = DashboardSchema.parse({
        name: 'dash_x', label: 'D', dateRange: { field: 'created_at', defaultRange: range },
        widgets: [{ id: 'wid_x', type: 'metric', dataset: 'sales', values: ['revenue'] }],
      });
      expect(d.dateRange?.defaultRange).toBe(range);
    }
    expect(() => DashboardSchema.parse({
      name: 'dash_x', label: 'D', dateRange: { defaultRange: 'last_7_dayz' },
      widgets: [{ id: 'wid_x', type: 'metric', dataset: 'sales', values: ['revenue'] }],
    })).toThrow();
  });

  it('accepts every preset name as a date filter default', () => {
    for (const preset of DATE_RANGE_PRESETS) {
      expect(dateFilter(preset).defaultValue).toBe(preset);
    }
  });

  it('accepts an ISO date — day, or day with an instant', () => {
    expect(dateFilter('2026-01-15').defaultValue).toBe('2026-01-15');
    expect(dateFilter('2026-01-15T08:30:00Z').defaultValue).toBe('2026-01-15T08:30:00Z');
  });

  it('accepts a KNOWN date-macro token, wrapped either way', () => {
    expect(dateFilter('{today}').defaultValue).toBe('{today}');
    expect(dateFilter('${30_days_ago}').defaultValue).toBe('${30_days_ago}');
    // The macro vocabulary is asked, not restated — an unknown token is exactly
    // the typo this guard exists to catch.
    expect(() => dateFilter('{yesteryear}')).toThrow();
  });

  it('REJECTS a misspelled preset name', () => {
    // The regression this issue is about. `last_7_dayz` reaches a query as
    // `created_at = 'last_7_dayz'` and the backend answers 200 OK with a zero.
    expect(() => dateFilter('last_7_dayz')).toThrow();
    expect(() => dateFilter('last-7-days')).toThrow();
    expect(() => dateFilter('Last 7 Days')).toThrow();
    expect(() => dateFilter('lastweek')).toThrow();
  });

  it('REJECTS `custom` — a sentinel with no bounds of its own', () => {
    // Legal as `dateRange.defaultRange`, meaningless as a bare filter value:
    // there is no from/to for it to hand over.
    expect(() => dateFilter('custom')).toThrow();
  });

  it('REJECTS a non-string default on a date filter', () => {
    expect(() => dateFilter(0)).toThrow();
    expect(() => dateFilter(true)).toThrow();
  });

  it('names the offending value and all three legal spellings', () => {
    // House rule: a strict gate ships with text an author can act on. Without
    // the value quoted back, a dashboard with several date filters gives no clue
    // WHICH one is wrong.
    let message = '';
    try { dateFilter('last_7_dayz'); } catch (e) { message = String(e); }

    expect(message).toContain('last_7_dayz');
    expect(message).toContain('last_7_days');       // the preset list, i.e. the fix
    expect(message).toContain('2026-01-15');        // the ISO form
    expect(message).toContain('{30_days_ago}');     // the macro form
  });

  it('leaves every OTHER filter type untouched', () => {
    // A `select` filter's options are the author's own vocabulary — a value that
    // happens to look like a preset name is none of this check's business.
    expect(GlobalFilterSchema.parse({
      field: 'time_period', type: 'select', defaultValue: 'this_quarter',
    }).defaultValue).toBe('this_quarter');
    expect(GlobalFilterSchema.parse({
      field: 'period', type: 'select', defaultValue: 'last_7_dayz',
    }).defaultValue).toBe('last_7_dayz');
    expect(GlobalFilterSchema.parse({ field: 'q', type: 'text', defaultValue: 'today' }).defaultValue).toBe('today');
    expect(GlobalFilterSchema.parse({ field: 'n', type: 'number', defaultValue: 7 }).defaultValue).toBe(7);
    // A date filter with no default is still perfectly legal.
    expect(GlobalFilterSchema.parse({ field: 'created_at', type: 'date' }).defaultValue).toBeUndefined();
  });

  it('does not break the shipped System Overview dashboard', () => {
    // packages/platform-objects/.../system_overview.dashboard.ts — the only
    // date-filter default in the tree, and a legal one. Pinned here so the
    // strictness cannot regress a real, shipped declaration.
    expect(dateFilter('last_7_days').defaultValue).toBe('last_7_days');
  });
});

// ============================================================================
// [#4876] `widgets[].responsive` is RETIRED — mirrors #3896's `view.responsive`
// ============================================================================
//
// RUNTIME assertions, deliberately. #4642 established that a compile-time pin in
// `packages/spec` was a no-op until #5286: `tsconfig.json` excluded `**/*.test.ts` and
// `vitest.config.ts` never enables `typecheck`, so an `Assert< Equal< … > >`
// here was dead text until #5286. The tombstone's `tsc` channel is proved by the build
// of the packages that author dashboards, not by this file.
//
// The pair below is the whole contract of this retirement: the widget embed
// REJECTS with the prescription, and the shared shape it used to reference is
// untouched everywhere else. Splitting one shared schema's two embeds is
// exactly the change that silently over-reaches, so the control is not optional.
describe('[#4876] DashboardWidgetSchema — retired `responsive`', () => {
  const widget = { id: 'orders_kpi', type: 'metric', dataset: 'orders', values: ['total'] };

  it('REJECTS an authored `responsive` with the prescription (not "unrecognized key")', () => {
    let message = '';
    try {
      DashboardWidgetSchema.parse({
        ...widget,
        responsive: { columns: { xs: 12, lg: 4 }, hiddenOn: ['xs'] },
      });
    } catch (e) { message = String((e as Error).message); }

    // The prescription itself, in the four parts an upgrading author needs:
    // the fully-qualified key, the version, the issue, and the fix.
    expect(message).toMatch(/dashboard\.widgets\[\]\.responsive/);
    expect(message).toMatch(/removed in @objectstack\/spec 17\.0\.0/);
    expect(message).toMatch(/#4876/);
    expect(message).toMatch(/Delete the key/);
    // It must point at the surviving home for the capability, or an author who
    // really wants breakpoints reads this as "responsive layout is gone".
    expect(message).toMatch(/page\.components\[\]\.responsive/);
    // `.strict()` on this schema would answer a DELETED key with a generic
    // unrecognized-key error. The tombstone is what makes it a prescription —
    // if this ever regresses to the strict path, this assertion is the tripwire.
    expect(message).not.toMatch(/Unrecognized key/);
  });

  it('still accepts a widget with no `responsive` (the retirement strips nothing else)', () => {
    const w = DashboardWidgetSchema.parse(widget);
    expect(w).not.toHaveProperty('responsive');
    expect(w.dataset).toBe('orders');
  });

  // ── CONTROL: the shared shape is NOT retired, only this embed ──────────────
  it('CONTROL: `ResponsiveConfigSchema` is still exported and still parses', async () => {
    const ui = await import('./index');
    expect(ui.ResponsiveConfigSchema).toBeTruthy();
    const cfg = ui.ResponsiveConfigSchema.parse({
      columns: { xs: 12, lg: 4 }, order: { xs: 2, lg: 1 }, hiddenOn: ['xs'],
    });
    expect(cfg.columns).toEqual({ xs: 12, lg: 4 });
    expect(cfg.hiddenOn).toEqual(['xs']);
  });

  it('CONTROL: `page.components[].responsive` parses exactly as before', async () => {
    const { PageComponentSchema } = await import('./page.zod');
    const c = PageComponentSchema.parse({
      type: 'page:sidebar', properties: {},
      responsive: { columns: { xs: 12, lg: 4 }, order: { xs: 2, lg: 1 }, hiddenOn: ['xs'] },
    });
    // Round-trips untouched — the page embed is a live consumer path
    // (objectui `useResponsiveConfig`), not a second casualty of this removal.
    expect(c.responsive).toEqual({ columns: { xs: 12, lg: 4 }, order: { xs: 2, lg: 1 }, hiddenOn: ['xs'] });
  });
});

// ============================================================================
// [#5010] the widget action trio + `aria` are RETIRED
// ============================================================================
//
// RUNTIME assertions for the same reason the #4876 block above gives: a
// compile-time pin in `packages/spec` was dead text until #5286 (#4642). The tombstone's
// `tsc` channel is proved by the build of the packages that author dashboards.
//
// Two affordances, one block, because they were retired as one change:
//   - `actionUrl`/`actionType`/`actionIcon` — a per-widget action BUTTON that no
//     renderer has ever drawn (every dispatched action comes from
//     `header.actions[]`);
//   - `aria` — ARIA attributes that never reached the DOM, the dashboard-level
//     `aria` retired by #3896 one level down.
describe('[#5010] DashboardWidgetSchema — retired action trio + `aria`', () => {
  const widget = { id: 'orders_kpi', type: 'metric', dataset: 'orders', values: ['total'] };

  const parseWith = (extra: Record<string, unknown>): string => {
    try {
      DashboardWidgetSchema.parse({ ...widget, ...extra });
    } catch (e) { return String((e as Error).message); }
    return '';
  };

  it.each([
    ['actionUrl', 'export_dashboard_pdf'],
    ['actionType', 'script'],
    ['actionIcon', 'download'],
  ] as const)('REJECTS an authored `%s` with the prescription', (key, value) => {
    const message = parseWith({ [key]: value });

    // The prescription, in the parts an upgrading author needs: the
    // fully-qualified key, the version, the issue, and the fix.
    expect(message).toMatch(new RegExp(`dashboard\\.widgets\\[\\]\\.${key}`));
    expect(message).toMatch(/removed in @objectstack\/spec 17\.0\.0/);
    expect(message).toMatch(/#5010/);
    // The three went together — an author who deletes only the one key they
    // were told about would hit this same error twice more.
    expect(message).toMatch(/delete all three/i);
    // It must name the surviving home, or this reads as "dashboards cannot have
    // buttons" rather than "the button belongs on the header".
    expect(message).toMatch(/header\.actions\[\]/);
    // The tombstone is what makes it a prescription; a plain `.strict()`
    // rejection of a DELETED key would be a generic unrecognized-key error.
    expect(message).not.toMatch(/Unrecognized key/);
  });

  it('REJECTS an authored `aria` with the prescription, naming its surviving homes', () => {
    const message = parseWith({ aria: { ariaLabel: 'Total orders' } });

    expect(message).toMatch(/dashboard\.widgets\[\]\.aria/);
    expect(message).toMatch(/removed in @objectstack\/spec 17\.0\.0/);
    expect(message).toMatch(/#5010/);
    expect(message).toMatch(/Delete the key/);
    // The shared shape survives elsewhere. Without this, the message reads as
    // "AriaProps is gone", which would send an author deleting live metadata.
    //
    // ⚠️ This assertion used to require `/app\.aria/` — and `App.aria` is a
    // `retiredKey()` tombstone removed in this same 17.0.0, so the pin was
    // holding the prescription ON a dead surface (#6756). Re-aimed at the
    // surfaces that really do still declare `aria: AriaPropsSchema` and are
    // graded `live` in the liveness ledger. The full both-directions
    // enumeration pin lives in `aria-carrier-tombstones.test.ts`.
    expect(message).toMatch(/page\.aria/);
    expect(message).toMatch(/page\.components\[\]\.aria/);
    expect(message).not.toMatch(/app\.aria/i);
    expect(message).not.toMatch(/Unrecognized key/);
  });

  it('still accepts a widget carrying none of the four (nothing else was stripped)', () => {
    const w = DashboardWidgetSchema.parse(widget);
    for (const k of ['actionUrl', 'actionType', 'actionIcon', 'aria']) {
      expect(w).not.toHaveProperty(k);
    }
    expect(w.dataset).toBe('orders');
    expect(w.values).toEqual(['total']);
  });

  // ── CONTROLS: only the WIDGET embeds go ────────────────────────────────────
  it('CONTROL: `header.actions[]` still takes the whole action vocabulary', () => {
    const d = DashboardSchema.parse({
      name: 'ops', label: 'Ops',
      header: {
        actions: [{ label: 'Export', actionUrl: 'export_dashboard_pdf', actionType: 'script', icon: 'download' }],
      },
      widgets: [widget],
    });
    // The header action is the live dispatch path (DashboardRenderer builds an
    // ActionDef from exactly these keys) — it must round-trip untouched.
    expect(d.header?.actions?.[0]).toMatchObject({
      label: 'Export', actionUrl: 'export_dashboard_pdf', actionType: 'script', icon: 'download',
    });
  });

  it('CONTROL: `AriaPropsSchema` is still exported and still parses', async () => {
    const ui = await import('./index');
    expect(ui.AriaPropsSchema).toBeTruthy();
    expect(ui.AriaPropsSchema.parse({ ariaLabel: 'Total orders' }).ariaLabel).toBe('Total orders');
  });

  it('CONTROL: `page.components[].aria` parses exactly as before', async () => {
    const { PageComponentSchema } = await import('./page.zod');
    const c = PageComponentSchema.parse({
      type: 'page:sidebar', properties: {}, aria: { ariaLabel: 'Sidebar' },
    });
    expect(c.aria).toEqual({ ariaLabel: 'Sidebar' });
  });
});
