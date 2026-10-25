/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `drillDown` is validated by name wherever a mirror declares it
 * (objectui#7352).
 *
 * `DrillDownConfig` (`../data-display.ts`) is the drill configuration five
 * widgets share, and two mirrored declarations carry `drillDown?: DrillDownConfig`
 * — `ChartSchema` and `ObjectDataTableSchema` (objectui#6576). Neither mirror
 * knew the key: there was no `DrillDownConfigSchema`, so under `BaseSchema`'s
 * `.passthrough()` a `drillDown: { enabled: 'yes' }` parsed GREEN and rode
 * through to a widget that reads `enabled` as truthy. Both pairs were ledgered
 * in `zod-mirror-parity.test.ts` (`UnmirroredDeclared`) as the measured debt.
 *
 * This file is the behaviour pin for the repair: the mirror exists, is
 * exported from `@object-ui/types/zod`, is wired into both declarations, and
 * REFUSES the malformed value by name where nothing refused it before. The
 * ledger side (both `UnmirroredDeclared` rows gone, the new pair registered)
 * is pinned by the parity file's own ratchet.
 *
 * ⚠️ `PivotTableSchema.drillDown` is NOT covered here. The pivot pair gained a
 * zod mirror in objectui#10859 (batch 2), which judged that key by the mirror
 * minted here, and objectui#10932 then retired it on the `pivot` node, which
 * nothing drills: `pivot-drilldown-retired-10932.test.ts` pins the refusal.
 *
 * ⚠️ Not the spec's `ChartDrillDownSchema`, deliberately: `@objectstack/spec/ui`
 * models the CHART-ONLY subset (`enabled` / `filter` / `title` / `target` /
 * `columns` / `maxRows`) as a strict object that refuses `mode` and `report` by
 * name, and both of those are real keys on the table / pivot / metric widgets
 * that share `DrillDownConfig`. Referencing it would make the published
 * validator refuse what the published TypeScript declares — the class this
 * card closes, in the other direction.
 */
import { describe, it, expect } from 'vitest';
import type { z } from 'zod';
import {
  safeValidateSchema,
  DrillDownConfigSchema,
  ChartSchema,
  ObjectDataTableSchema,
} from '../zod/index.zod.js';
import type { DrillDownConfig } from '../data-display.js';

/* ── Runtime helpers ───────────────────────────────────────────────────────── */

/** Every issue path in the tree, per-arm `errors` included (see the objectui#7363 pin). */
function issuePaths(result: { success: true } | { success: false; error: { issues: readonly z.core.$ZodIssue[] } }): string[] {
  if (result.success) return [];
  const out: string[] = [];
  const walk = (issues: readonly z.core.$ZodIssue[]) => {
    for (const issue of issues) {
      out.push(issue.path.map(String).join('.'));
      const nested = (issue as { errors?: readonly (readonly z.core.$ZodIssue[])[] }).errors;
      if (nested) for (const arm of nested) walk(arm);
    }
  };
  walk(result.error.issues);
  return out;
}

/** A chart document that validates on its own, so a red run is about `drillDown`. */
const chart = (drillDown: unknown) => ({
  type: 'chart',
  chartType: 'bar',
  series: [{ name: 'revenue' }],
  drillDown,
});
const table = (drillDown: unknown) => ({ type: 'object-data-table', objectName: 'contact', drillDown });

/* ── The values hosts actually synthesise ──────────────────────────────────── */

/**
 * Read from the renderers, not invented: `DashboardRenderer.tsx` writes
 * `{ enabled: true }` for drillable charts and `{ enabled: true, mode: 'record' }`
 * for object-backed tables; `ObjectMetricWidget.tsx` writes
 * `{ enabled: true, mode: 'record', target: 'dialog' }`; the drill tests author
 * `{ enabled: false }` and `{ enabled: true, mode: 'filter' }`. `report` takes the
 * one form `DrillDownConfig` declares, a dataset-bound report; the `{ name }`
 * reference it declared beside that is retired (objectui#11517) and sits in the
 * refusal table below.
 */
const ACCEPTED: Array<[string, DrillDownConfig]> = [
  ['the empty block', {}],
  ['enabled', { enabled: true }],
  ['disabled', { enabled: false }],
  ['record mode', { enabled: true, mode: 'record' }],
  ['filter mode', { enabled: true, mode: 'filter' }],
  ['record mode in a dialog', { enabled: true, mode: 'record', target: 'dialog' }],
  ['navigate target', { target: 'navigate' }],
  ['the full drill-through shape', {
    enabled: true,
    title: '${event.rowLabel}',
    filter: { status: '${event.rowKey}', owner: 42 },
    columns: ['name', 'amount'],
    maxRows: 50,
  }],
  // objectui#11506 — the inline arm is the spec's dataset-bound `ReportSchema`; the
  // pre-9.0 `objectName` form it used to take is retired, and its refusal is pinned in
  // `drill-down-report-dataset-bound-11506.test.ts`.
  ['an inline report', { report: { name: 'pipeline', label: 'Pipeline', type: 'summary', dataset: 'opportunity_ds', rows: ['stage'], values: ['amount_sum'] } }],
  ['an inline report carrying more report keys', {
    report: { name: 'pipeline', label: 'Pipeline', type: 'matrix', dataset: 'opportunity_ds', rows: ['stage'], columns: ['owner'], values: ['amount_sum'], runtimeFilter: { region: 'emea' } },
  }],
];

/**
 * objectui#10685 — the `object-data-table` mirror takes that block's OWN drill
 * shape: the shared mirror with `filter`, `maxRows` and `report` refused by name
 * and `target` narrowed to `'drawer'` / `'dialog'`
 * (`drill-down-per-block-10685.test.ts` pins those refusals on both doors). So
 * the table leg below runs over the ACCEPTED entries that carry none of them;
 * the rest are that pin's refusals, not this ledger's acceptances.
 */
const TABLE_REFUSED_KEYS = ['filter', 'maxRows', 'report'] as const;
const TABLE_ACCEPTED = ACCEPTED.filter(
  ([, value]) => !TABLE_REFUSED_KEYS.some((key) => key in value) && value.target !== 'navigate',
);

/** Each is a DECLARED key with a value outside its declared type. */
const REFUSED: Array<[string, unknown, string]> = [
  ['enabled as a string', { enabled: 'yes' }, 'enabled'],
  ['an unknown mode', { mode: 'jump' }, 'mode'],
  ['an unknown target', { target: 'popup' }, 'target'],
  ['title as a number', { title: 42 }, 'title'],
  ['filter as a string', { filter: 'status eq open' }, 'filter'],
  ['columns as a string', { columns: 'name' }, 'columns'],
  ['maxRows as a string', { maxRows: '50' }, 'maxRows'],
  ['report as a bare string', { report: 'pipeline' }, 'report'],
  // objectui#11517 — the `{ name }` reference arm is retired, so the two values below
  // left the acceptance table. Each used to reach that arm: the inline arm wanted
  // `label` and a `dataset`, and a string `name` satisfied the reference, which
  // STRIPPED the parsed copy to `{ name }`. Now nothing catches them: the spec report
  // refuses both, and a bare `{ name }` is refused by name too
  // (`drill-down-report-name-retired-11517.test.ts` pins the messages and the faces).
  ['a named report reference, retired (objectui#11517)', { report: { name: 'pipeline' } }, 'report'],
  ['a `name` and an empty `columns`, which the retired reference arm read as `{ name }`', { report: { name: 'pipeline', columns: [] } }, 'report'],
  ['a `{ name }` value with a non-string name', { report: { name: 42 } }, 'report'],
];

describe('objectui#7352 — DrillDownConfigSchema is the zod mirror of DrillDownConfig', () => {
  it('is exported from the /zod barrel and declares every key the TS interface declares', () => {
    expect(DrillDownConfigSchema).toBeDefined();
    expect(Object.keys(DrillDownConfigSchema.shape).sort()).toEqual(
      ['columns', 'enabled', 'filter', 'maxRows', 'mode', 'report', 'target', 'title'],
    );
  });

  it.each(ACCEPTED)('accepts %s', (_label, value) => {
    const r = DrillDownConfigSchema.safeParse(value);
    expect(r.success, r.success ? '' : JSON.stringify(r.error.issues, null, 2)).toBe(true);
  });

  it('keeps an inline report\'s keys — the inline arm is the spec\'s `ReportSchema` (objectui#11506)', () => {
    const r = DrillDownConfigSchema.safeParse({
      report: { name: 'pipeline', label: 'Pipeline', dataset: 'opportunity_ds', rows: ['stage'], values: ['amount_sum'], runtimeFilter: { region: 'emea' } },
    });
    expect(r.success).toBe(true);
    expect(r.success && (r.data.report as Record<string, unknown>).runtimeFilter).toEqual({ region: 'emea' });
  });

  it.each(REFUSED)('refuses %s, naming the key', (_label, value, key) => {
    const r = DrillDownConfigSchema.safeParse(value);
    expect(r.success).toBe(false);
    expect(issuePaths(r).some((p) => p === key || p.startsWith(`${key}.`))).toBe(true);
  });
});

describe('objectui#7352 — both declaring mirrors read the key', () => {
  it('ChartSchema and ObjectDataTableSchema declare drillDown through the shared mirror', () => {
    // The table's through its per-block extension of it (objectui#10685).
    expect(ChartSchema.shape.drillDown).toBeDefined();
    expect(ObjectDataTableSchema.shape.drillDown).toBeDefined();
  });

  it('the table leg still covers every value hosts synthesise for a table (objectui#10685)', () => {
    // Non-vacuity for the filtered leg below: the blocks `DashboardRenderer`,
    // `DrillDownDrawer` and `ObjectChart` write onto an `object-data-table`, and
    // the drill tests' disabled and filter-mode blocks, all stay in it.
    expect(TABLE_ACCEPTED.map(([label]) => label)).toEqual(expect.arrayContaining([
      'the empty block', 'enabled', 'disabled', 'record mode', 'filter mode', 'record mode in a dialog',
    ]));
  });

  it.each(ACCEPTED)('a chart carrying %s validates', (_label, value) => {
    const r = safeValidateSchema(chart(value));
    expect(r.success, r.success ? '' : JSON.stringify(r.error.issues, null, 2)).toBe(true);
  });

  it.each(TABLE_ACCEPTED)('an object-data-table carrying %s validates', (_label, value) => {
    const r = safeValidateSchema(table(value));
    expect(r.success, r.success ? '' : JSON.stringify(r.error.issues, null, 2)).toBe(true);
  });

  it('the card\'s own repro is refused where it used to parse green: chart', () => {
    // Under `.passthrough()` this parsed green and the widget read `'yes'` as
    // truthy. `.success === false` is the whole leg here — it was TRUE before.
    const r = safeValidateSchema(chart({ enabled: 'yes' }));
    expect(r.success).toBe(false);
    expect(issuePaths(r)).toContain('drillDown.enabled');
  });

  it('the card\'s own repro is refused BY NAME on object-data-table', () => {
    // This node was refused before too — for having NO arm at all (objectui#7363).
    // The by-name path is what did not exist.
    const r = safeValidateSchema(table({ enabled: 'yes' }));
    expect(r.success).toBe(false);
    expect(issuePaths(r)).toContain('drillDown.enabled');
  });

  it.each(REFUSED)('a chart carrying %s is refused under drillDown', (_label, value, key) => {
    const r = safeValidateSchema(chart(value));
    expect(r.success).toBe(false);
    expect(issuePaths(r).some((p) => p === `drillDown.${key}` || p.startsWith(`drillDown.${key}.`))).toBe(true);
  });

  it('the mirror does not reach beyond the two declaring pairs: a plain data-table has no drillDown arm', () => {
    // `DataTableSchema` does not declare `drillDown` on either face; a value there
    // still rides through on `.passthrough()`, unchanged by this card.
    const r = safeValidateSchema({ type: 'data-table', columns: [], data: [], drillDown: { enabled: 'yes' } });
    expect(r.success).toBe(true);
  });
});
