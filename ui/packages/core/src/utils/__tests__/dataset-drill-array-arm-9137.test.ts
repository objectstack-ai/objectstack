/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `buildDatasetDrillFilter` and the ARRAY arm of the widget filter —
 * objectui#9137, the THIRD site of the mis-composition objectui#8944 removed
 * from `ObjectChart` and objectui#9024 removed from `ObjectPivotTable`.
 *
 * ## Why this site is the one that mattered most
 *
 * On the chart the array arm was what the corpus happened to author; on the
 * pivot nothing declared `filter` at all. Here the declaration exists, it is
 * reached, and it names the array arm as the one objectui sends —
 * `DashboardWidgetSchema.filter`, verbatim: "objectui passes an ObjectQL
 * FilterNode array here, not the spec's `FilterCondition` envelope". And
 * `DatasetWidget`'s guard admits it: an array passes all three of
 * `rawFilter &&`, `typeof rawFilter === 'object'` and
 * `Object.keys(rawFilter).length > 0`.
 *
 * ## ⚠️ The failure direction, MEASURED — it is NOT the silent superset
 *
 * The card and its triage both graded this fail-OPEN, reasoning that the index
 * key a spread array produces (`{ '0': ['region','=','emea'] }`) is "a key
 * nothing reads as a condition", so the widget's own narrowing is dropped and
 * the list widens to the clicked bucket. That premise does not hold on this
 * tree, and §"the wire refuses it" below is the measurement: a bare array is
 * not a legal equality comparand anywhere in this dialect (objectui#8530 /
 * objectui#8514), so the index key is neither honoured nor dropped — it is
 * REFUSED. `convertFiltersToAST` throws `FilterOperatorError`; the in-memory
 * matcher selects nothing; `driver-sql` answers `400 INVALID_FILTER`.
 *
 * ⇒ the drilled list was not a superset, it was DEAD. Recorded here rather
 * than argued, because it is the kind of claim a later reader will want the
 * row counts for. The repair is the same either way, and it is the ruled one:
 * conjoin through `composeDrillFilter`, the repo's single filter confluence.
 */

import { describe, it, expect } from 'vitest';
import { buildDatasetDrillFilter } from '../dataset-format';
import { convertFiltersToAST, toFilterNode } from '../filter-converter';
import { ValueDataSource } from '../../adapters/ValueDataSource';

const EMEA_WON = { id: 'emea-won', region: 'emea', stage: 'won', closed_at: '2026-05-02' };
const EMEA_LOST = { id: 'emea-lost', region: 'emea', stage: 'lost', closed_at: '2026-05-03' };
const APAC_WON = { id: 'apac-won', region: 'apac', stage: 'won', closed_at: '2026-05-04' };
const EMEA_WON_LATE = { id: 'emea-won-late', region: 'emea', stage: 'won', closed_at: '2026-08-02' };

const ROWS = [EMEA_WON, EMEA_LOST, APAC_WON, EMEA_WON_LATE];
const DIMENSION_FIELDS = { stage: 'stage' };

/**
 * The ARRAY arm, spelled exactly as `DashboardWidgetSchema.filter`'s docblock
 * says objectui sends it: an ObjectQL FilterNode array, not the spec's
 * `FilterCondition` object envelope.
 */
const WIDGET_FILTER_ARRAY = [['region', '=', 'emea']];

/** Lower a composed drill filter through the real sink and select real rows. */
async function drilledIds(composed: Record<string, unknown> | undefined): Promise<string[]> {
  const node = toFilterNode(composed);
  const ds = new ValueDataSource({ items: ROWS as never });
  const result = await ds.find('deal', (node === undefined ? {} : { $filter: node }) as never);
  return (result.data as Array<{ id: string }>).map((r) => String(r.id));
}

describe('dataset drill vs the widget filter ARRAY arm (objectui#9137)', () => {
  it('conjoins the array arm instead of spreading it into index keys', async () => {
    const composed = buildDatasetDrillFilter(
      { stage: 'won' },
      ['stage'],
      DIMENSION_FIELDS,
      WIDGET_FILTER_ARRAY,
    );
    expect(composed).toEqual({ $and: [{ region: 'emea' }, { stage: 'won' }] });
    // The row set is the claim; the shape above is only how it is reached.
    expect(await drilledIds(composed)).toEqual([EMEA_WON.id, EMEA_WON_LATE.id]);
  });

  it('the widget filter is a REAL constraint here, not decoration', async () => {
    // The control that makes the assertion above mean something: drop the
    // widget filter and an apac row qualifies on the drill condition alone, so
    // a fixture whose answer happened to be the same either way cannot pass.
    const bucketOnly = buildDatasetDrillFilter({ stage: 'won' }, ['stage'], DIMENSION_FIELDS);
    expect(await drilledIds(bucketOnly)).toEqual([EMEA_WON.id, APAC_WON.id, EMEA_WON_LATE.id]);
  });

  it('pins the defect ABSENT: no index key from a spread array', () => {
    const composed = buildDatasetDrillFilter(
      { stage: 'won' },
      ['stage'],
      DIMENSION_FIELDS,
      WIDGET_FILTER_ARRAY,
    );
    expect(Object.keys(composed)).not.toContain('0');
  });

  /**
   * The measurement behind the docblock's "not a superset" correction, kept as
   * an assertion so the claim cannot rot into prose. The shape the spread
   * produced is built here directly — nothing in the tree produces it any more.
   */
  it('the wire REFUSES the spread product, so the old drill was dead rather than wide', async () => {
    const spreadProduct = { ...WIDGET_FILTER_ARRAY, stage: 'won' } as Record<string, unknown>;
    expect(Object.keys(spreadProduct)).toContain('0');
    // Leg 1 — the lowering every `$filter` consumer goes through.
    expect(() => convertFiltersToAST(spreadProduct)).toThrow(/bare ARRAY as its equality comparand/);
    // Leg 2 — the in-memory matcher, which selects NOTHING rather than widening.
    const ds = new ValueDataSource({ items: ROWS as never });
    const result = await ds.find('deal', { $filter: spreadProduct } as never);
    expect((result.data as unknown[]).length).toBe(0);
  });

  /**
   * Precondition 2 of the card: a time-bucketed dimension contributes ObjectQL
   * range operator objects, and the composition has to PRESERVE them.
   */
  it('preserves a half-open date range through the composition', async () => {
    const composed = buildDatasetDrillFilter({}, [], {}, WIDGET_FILTER_ARRAY, {
      closed: { field: 'closed_at', gte: '2026-04-01', lt: '2026-07-01' },
    });
    // Re-spelled as two `$and` children on one field — `convertFiltersToAST`
    // emits one node per bound and `parseFilterAST` cannot fold two nodes back
    // onto a single key. Both bounds survive, which is what the rows show.
    expect(composed).toEqual({
      $and: [
        { region: 'emea' },
        { $and: [{ closed_at: { $gte: '2026-04-01' } }, { closed_at: { $lt: '2026-07-01' } }] },
      ],
    });
    // Scoped by BOTH bounds and by the widget: the late emea row and the apac
    // row are each excluded, by a different half of the conjunction.
    expect(await drilledIds(composed)).toEqual([EMEA_WON.id, EMEA_LOST.id]);
  });

  /**
   * Precondition 1 of the card: the return type is a NON-optional
   * `Record<string, unknown>` and callers do not expect `undefined`, while
   * `composeDrillFilter` answers `undefined` when both sources are empty.
   */
  it('answers an empty OBJECT, never undefined, when both sources are empty', () => {
    expect(buildDatasetDrillFilter(undefined, [], {}, {})).toEqual({});
    expect(buildDatasetDrillFilter(undefined, [], {}, undefined)).toEqual({});
  });

  /**
   * Precondition 3 of the card: two consumers hand this parameter different
   * types — `any` from `DatasetWidget`, `Record<string, unknown>` from
   * `DatasetReportRenderer`. The parameter is declared `unknown` so both arms
   * are admitted without a cast; ⛔ neither consumer's own type was changed.
   */
  it('admits the OBJECT arm the report renderer sends, unchanged', async () => {
    const composed = buildDatasetDrillFilter(
      { stage: 'won' },
      ['stage'],
      DIMENSION_FIELDS,
      { region: 'emea' },
    );
    expect(await drilledIds(composed)).toEqual([EMEA_WON.id, EMEA_WON_LATE.id]);
  });
});
