/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Retirement pin — `UnifiedViewConfig.chart` is RETIRED (objectui#12063,
 * ADR-0049 enforce-or-remove).
 *
 * ## What retired, and why
 *
 * The member declared the list-view chart's pre-ADR-0021 inline query:
 * `chartType` beside `xAxisField`, `yAxisFields`, `aggregation`, `series`,
 * `config` and `filter`. objectui#6152 round 15 retired every route that read
 * those axes, every list-view door refuses them by name, and nothing read or
 * wrote the member. The triage ruling on objectui#12063: with zero consumers it
 * retires with a tombstone that names the spec's list chart block (`dataset`,
 * `values`, `dimensions`, `chartType`) as the remedy. The census is recorded on
 * the card's pull request as a one-time reading; this file keeps the contract.
 *
 * ## Why a tombstone and not a deletion
 *
 * `UnifiedViewConfig` keeps a `[key: string]: any` index signature, so a
 * DELETED member would read `any` and admit every value, a fresh literal
 * included. Row (b) pins that consequence on an undeclared key, so the reason
 * is a reading and not prose. The interface has no zod mirror, so the
 * TypeScript face is the only face to retire.
 *
 * ## Two instruments, and which half each one reads
 *
 * The `Expect` / `Equal` aliases and the `@ts-expect-error` directives are
 * TYPE-level: `tsc -p tsconfig.test.json` (the third leg of this package's
 * `type-check` script) reads them, and a revived or re-widened member fails
 * there, on an unused directive or on a `false` row. vitest strips types and
 * reads none of it. The `ListChartConfigSchema` rows are RUNTIME and vitest
 * reads them: they keep the remedy the tombstone names a live, parsing block.
 * A green run of either one alone says nothing about the other.
 */

import { describe, expect, it } from 'vitest';
import { ListChartConfigSchema } from '@objectstack/spec/ui';
import type { ListChartConfig, ListView } from '@objectstack/spec/ui';
import type { UnifiedViewConfig } from '../designer';

/** Invariant equality — `extends` both ways would accept a narrowing. */
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Expect<T extends true> = T;

/* ── (a) the member reads as a tombstone ──────────────────────────────────── */

/**
 * `?: never` without `exactOptionalPropertyTypes` is `never | undefined`, which
 * collapses to `undefined`. `Equal` separates that from the object type the
 * member carried and from the `any` a deletion would leave (row b).
 */
export type assertionChartReadsAsTombstone = Expect<Equal<UnifiedViewConfig['chart'], undefined>>;
/** The helper can FAIL — a sibling block is still declared, so it is not `undefined`. */
export type assertionSiblingStillDeclared = Expect<Equal<Equal<UnifiedViewConfig['kanban'], undefined>, false>>;

/* ── (b) why a tombstone: an undeclared key reads `any` here ──────────────── */

/** What a deletion would have left: the index signature answers `any` for any key it does not declare. */
export type assertionUndeclaredKeyReadsAny = Expect<Equal<UnifiedViewConfig['chartt'], any>>;

/* ── (c) the remedy is the spec's list chart block ────────────────────────── */

/** The block the tombstone names IS the spec's list view `chart` member, not a local copy. */
export type assertionRemedyIsTheSpecListViewChart = Expect<Equal<NonNullable<ListView['chart']>, ListChartConfig>>;

const LEGACY_BLOCK = {
  chartType: 'bar',
  xAxisField: 'status',
  yAxisFields: ['estimate'],
  aggregation: 'sum',
  series: [{ name: 'estimate' }],
  config: { stacked: true },
  filter: [['status', '=', 'open']],
} as const;

const REMEDY: ListChartConfig = {
  chartType: 'bar',
  dataset: 'task_stats',
  dimensions: ['status'],
  values: ['total_estimate'],
};

describe('objectui#12063 — `UnifiedViewConfig.chart` is RETIRED', () => {
  it('(c) the TypeScript face refuses the member at every value — checked by `tsc -p tsconfig.test.json`', () => {
    // Not `as const` on the rows: a readonly literal would fail each line for
    // a reason of its own, and each `@ts-expect-error` would pass without
    // testing the tombstone.
    const refused: UnifiedViewConfig[] = [
      // @ts-expect-error — retired: the pre-ADR-0021 inline axes
      { id: 'legacy', type: 'chart', chart: { chartType: 'bar', xAxisField: 'status', yAxisFields: ['estimate'], aggregation: 'sum' } },
      // @ts-expect-error — retired whole: the spec's block belongs on the spec's list view, not here
      { id: 'dataset', type: 'chart', chart: { chartType: 'bar', dataset: 'task_stats', values: ['total_estimate'] } },
    ];
    // A WIDENED value is refused too: the member is declared, so it is checked
    // on every assignment, where a deletion would have handed it to the index
    // signature at `any`. Mutable on purpose (not `LEGACY_BLOCK`): its type is
    // assignable to the retired declaration, so this row fails on the
    // tombstone and on nothing else.
    const widened = {
      id: 'widened',
      chart: { chartType: 'bar', xAxisField: 'status', yAxisFields: ['estimate'], aggregation: 'sum' },
    };
    // @ts-expect-error — retired: a value that reached the annotation through a wider variable
    const viaVariable: UnifiedViewConfig = widened;
    expect([...refused, viaVariable]).toHaveLength(3);
  });

  it('CONTROL — the sibling members compile and read as before', () => {
    const view: UnifiedViewConfig = {
      id: 'board',
      type: 'kanban',
      kanban: { groupByField: 'status', titleField: 'name' },
      gantt: { startDateField: 'start', endDateField: 'end' },
    };
    expect(view.kanban?.groupByField).toBe('status');
    expect(view.chart).toBeUndefined();
  });

  it('(d) the remedy parses: the spec\'s list chart block, bound to a dataset by name', () => {
    const r = ListChartConfigSchema.safeParse(REMEDY);
    expect(r.error?.issues ?? []).toEqual([]);
    expect(r.success).toBe(true);
  });

  it('(d) the retired block\'s axes are refused BY NAME at that same spec block', () => {
    const r = ListChartConfigSchema.safeParse(LEGACY_BLOCK);
    expect(r.success).toBe(false);
    const issues = (r.error?.issues ?? []) as Array<{ code: string; path: PropertyKey[]; keys?: string[] }>;
    const unrecognized = issues.filter((i) => i.code === 'unrecognized_keys');
    expect(unrecognized.map(({ code, path }) => ({ code, path }))).toEqual([{ code: 'unrecognized_keys', path: [] }]);
    expect([...(unrecognized[0]!.keys ?? [])].sort()).toEqual(
      ['aggregation', 'config', 'filter', 'series', 'xAxisField', 'yAxisFields'],
    );
  });
});
