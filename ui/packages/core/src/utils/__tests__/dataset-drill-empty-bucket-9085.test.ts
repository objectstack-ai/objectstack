/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The empty-bucket drill returns the empty bucket's ROWS — objectui#9085.
 *
 * ## What was wrong
 *
 * `buildDatasetDrillFilter` wrote a bare `null` for a bucket whose dimension
 * value is empty. `convertFiltersToAST` SKIPS a key whose value is `null` /
 * `undefined` — its oldest pinned behaviour, pinned by name as "should skip
 * null and undefined values" — so the constraint never reached the wire and the
 * drill answered with a SUPERSET: every row, silently, nothing thrown and
 * nothing logged.
 *
 * The repair is at the PRODUCER. ⛔ The converter is NOT touched: other
 * producers rely on that skip, and objectui#9020 ruled it stays.
 *
 * ## Why these assertions are ROW SETS and not composed-object shapes
 *
 * The defect is invisible in the composed object — `{ owner: null }` looks like
 * a filter. It only becomes wrong one layer down, where the key is dropped. A
 * shape assertion therefore cannot fail for the reason this card exists, so
 * every case below lowers the composed filter through the real sink
 * (`toFilterNode`) and asks a real matcher (`ValueDataSource`) which rows come
 * back.
 *
 * ## The fixture answers the semantic question the spelling had to settle
 *
 * `MISSING` has no `owner` KEY AT ALL; `EXPLICIT_NULL` has `owner: null`. The
 * two are told apart by exactly one thing — which spelling the producer emits:
 *
 *   - `['owner','is_null',true]`  selects BOTH  (what `{ $null: true }` lowers to)
 *   - equality against `null`      selects only EXPLICIT_NULL
 *
 * The aggregate counted both into the one empty bucket, so the drill has to
 * return both, and the third case below is that choice pinned as a row set
 * rather than asserted as a preference.
 */

import { describe, it, expect } from 'vitest';
import { buildDatasetDrillFilter } from '../dataset-format';
import { toFilterNode } from '../filter-converter';
import { ValueDataSource } from '../../adapters/ValueDataSource';

/**
 * Deals across two stages and three authorings of "no owner". `MISSING` is a
 * row object with NO `owner` key — written as a separate literal rather than
 * `owner: undefined`, because the source goes through a `JSON` round trip that
 * would erase the key either way and the distinction has to be the fixture's,
 * not the clone's.
 */
const WON_ALICE = { id: 'won-alice', stage: 'won', owner: 'alice' };
const WON_EXPLICIT_NULL = { id: 'won-null', stage: 'won', owner: null };
const WON_MISSING = { id: 'won-missing', stage: 'won' };
const LOST_EXPLICIT_NULL = { id: 'lost-null', stage: 'lost', owner: null };
const LOST_BOB = { id: 'lost-bob', stage: 'lost', owner: 'bob' };

const ROWS = [WON_ALICE, WON_EXPLICIT_NULL, WON_MISSING, LOST_EXPLICIT_NULL, LOST_BOB];
const ALL_IDS = ROWS.map((r) => r.id);

/** Dimension NAME -> object FIELD, as the server sends it beside the rows. */
const DIMENSION_FIELDS = { stage: 'stage', owner: 'owner' };

/** Lower a composed drill filter through the real sink and select real rows. */
async function drilledIds(composed: Record<string, unknown>): Promise<string[]> {
  const node = toFilterNode(composed);
  const ds = new ValueDataSource({ items: ROWS as never });
  const result = await ds.find('deal', (node === undefined ? {} : { $filter: node }) as never);
  return (result.data as Array<{ id: string }>).map((r) => String(r.id));
}

describe('empty-bucket drill (objectui#9085)', () => {
  /**
   * The three shapes the card names, each re-measured as the rows a user would
   * see in the drill drawer. Before the producer fix these answered
   * `[WON_ALICE, WON_EXPLICIT_NULL, WON_MISSING]`, the same two ways, and
   * `ALL_IDS` the third way — supersets in every case.
   */
  it('two drill dimensions, one of them empty, selects only the empty bucket', async () => {
    const composed = buildDatasetDrillFilter(
      { stage: 'won', owner: '' },
      ['stage', 'owner'],
      DIMENSION_FIELDS,
    );
    expect(await drilledIds(composed)).toEqual([WON_EXPLICIT_NULL.id, WON_MISSING.id]);
  });

  it('one drill dimension plus a runtime filter keeps BOTH constraints', async () => {
    const composed = buildDatasetDrillFilter(
      { owner: '' },
      ['owner'],
      DIMENSION_FIELDS,
      { stage: 'won' },
    );
    // Both halves are load-bearing: the empty-bucket condition survives (the
    // `lost` rows are gone) AND the runtime filter still scopes the list (the
    // owned `won` row is gone).
    expect(await drilledIds(composed)).toEqual([WON_EXPLICIT_NULL.id, WON_MISSING.id]);
  });

  it('one drill dimension with no runtime filter still constrains', async () => {
    const composed = buildDatasetDrillFilter({ owner: '' }, ['owner'], DIMENSION_FIELDS);
    expect(await drilledIds(composed)).toEqual([
      WON_EXPLICIT_NULL.id,
      WON_MISSING.id,
      LOST_EXPLICIT_NULL.id,
    ]);
    // ⚠️ The control that makes the assertion above mean something. This shape
    // is the one that degraded to EVERY ROW, so a fixture where the answer
    // happened to be every row would pass either way.
    expect(await drilledIds(composed)).not.toEqual(ALL_IDS);
  });

  /**
   * The row the spelling decision is about. `MISSING` carries no `owner` key,
   * and it is in the answer above — which is what an equality test against
   * `null` would NOT have produced.
   */
  it('the empty bucket includes the row whose dimension key is absent, not only an explicit null', async () => {
    const composed = buildDatasetDrillFilter({ owner: '' }, ['owner'], DIMENSION_FIELDS);
    expect(await drilledIds(composed)).toContain(WON_MISSING.id);
    // The rejected spelling, run side by side so the difference is visible here
    // rather than asserted in prose: equality against `null` drops the
    // missing-key row. This is the fork objectui#9085 had to settle.
    const ds = new ValueDataSource({ items: ROWS as never });
    const equality = await ds.find('deal', { $filter: ['owner', '=', null] } as never);
    expect((equality.data as Array<{ id: string }>).map((r) => r.id)).toEqual([
      WON_EXPLICIT_NULL.id,
      LOST_EXPLICIT_NULL.id,
    ]);
  });

  /**
   * All three empty authorings reach ONE spelling. `null` is in this set because
   * JSON cannot carry `undefined`: a SQL NULL grouped value arrives over the
   * wire AS `null`, so it is the empty bucket's most common shape and a fix
   * that skipped it would leave the common case broken.
   */
  it.each([
    ['empty string', { owner: '' }],
    ['explicit null', { owner: null }],
    ['absent key', {}],
    ['absent raw row', undefined],
  ])('%s all become one is-empty spelling', async (_name, rawRow) => {
    const composed = buildDatasetDrillFilter(
      rawRow as Record<string, unknown> | undefined,
      ['owner'],
      DIMENSION_FIELDS,
    );
    expect(composed).toEqual({ owner: { $null: true } });
    expect(toFilterNode(composed)).toEqual(['owner', 'is_null', true]);
  });

  // ── LIVE CONTROLS — pre-existing behaviour this change must not move ──────
  //
  // Same KIND as the subject (a drill composed by the same producer and lowered
  // through the same sink), pre-existing, and untouched by the change: neither
  // reaches the empty-value branch at all.

  it('CONTROL: a non-empty bucket drill is unchanged', async () => {
    const composed = buildDatasetDrillFilter({ owner: 'alice' }, ['owner'], DIMENSION_FIELDS);
    expect(composed).toEqual({ owner: 'alice' });
    expect(await drilledIds(composed)).toEqual([WON_ALICE.id]);
  });

  it('CONTROL: a non-empty bucket drill still carries its runtime filter', async () => {
    const composed = buildDatasetDrillFilter(
      { owner: 'bob' },
      ['owner'],
      DIMENSION_FIELDS,
      { stage: 'lost' },
    );
    // objectui#9137 re-spelled the COMPOSITION (the widget filter is conjoined
    // through `composeDrillFilter` instead of spread into the drill filter), so
    // the shape moved while the row set below — this test's actual claim — did
    // not. Only the composing leg moved: the no-runtime-filter control below is
    // byte-identical to what objectui#9085 pinned.
    expect(composed).toEqual({ $and: [{ stage: 'lost' }, { owner: 'bob' }] });
    expect(await drilledIds(composed)).toEqual([LOST_BOB.id]);
    // …and the runtime filter is a real constraint here, not decoration: drop
    // it and a second row would qualify on the drill condition alone.
    const withoutRuntime = buildDatasetDrillFilter({ stage: 'lost' }, ['stage'], DIMENSION_FIELDS);
    expect(await drilledIds(withoutRuntime)).toEqual([LOST_EXPLICIT_NULL.id, LOST_BOB.id]);
  });

  it('CONTROL: a date-bucket RANGE drill is unchanged', async () => {
    const composed = buildDatasetDrillFilter({}, [], {}, undefined, {
      closed: { field: 'closed_at', gte: '2026-01-01', lt: '2026-04-01' },
    });
    expect(composed).toEqual({ closed_at: { $gte: '2026-01-01', $lt: '2026-04-01' } });
  });
});
