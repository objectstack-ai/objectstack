/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The drill "escape hatch" and the empty bucket — the THIRD consumer of
 * `buildDatasetDrillFilter`, measured for objectui#9085 and REPAIRED by
 * objectui#9159.
 *
 * `buildDatasetDrillFilter`'s output has three consumers. Two of them
 * (`ObjectDataTable`, and the report drill's `SchemaRenderer` path, which wraps
 * the filter in an `$and`) lower it through `convertFiltersToAST`, where
 * objectui#9085's `{ $null: true }` becomes `['field','is_null',true]` and the
 * empty bucket selects its own rows. This is the third: the host's
 * `openRecordList`, which does NOT go through that converter — it serializes
 * the same object into `filter[...]` URL params for the bare data surface.
 *
 * ## What objectui#9085 measured here, and why it left it open
 *
 * ⚠️ At that time this dialect had NO spelling for is-null. Its whole operator
 * vocabulary was equality plus four range bounds, so there was no param shape
 * carrying "this dimension is empty" and no suffix `parseUrlFilterTriples` would
 * read back as one. `{ $null: true }` and the bare `null` it replaced therefore
 * serialized BYTE-IDENTICALLY, an empty-bucket drill escalated to the list page
 * had always landed on a superset, and objectui#9085 neither improved nor
 * regressed that — which is exactly what this file was written to hold.
 *
 * ## What objectui#9159 changed, and why these assertions moved rather than went
 *
 * That card added the missing operator on BOTH sides of the dialect
 * (`NULL_FILTER` — `filter[<field>][null]=true`), so the claim above has stopped
 * being true, at the assertions the card said it would: the two spellings are no
 * longer byte-identical, and an empty-bucket-only drill no longer serializes to
 * nothing. The claim is UPDATED to the new byte-identity rather than deleted,
 * because what this file is for is recording what the escape hatch does with an
 * empty bucket — first that it dropped it, now that it carries it.
 *
 * ⇒ the surviving record: the bare `null` spelling is STILL not a condition (a
 * producer writes it when it has nothing to say about the field), the RANGE
 * vocabulary is still exactly the four bounds it always was, and the divergence
 * between the two spellings is the repair. The end-to-end obligations of the new
 * operator — the real `openRecordList`, the destination scope and the chip —
 * live in `drillEmptyBucketEscapeHatch-9159.test.tsx`.
 *
 * ⚠️ The answer for `[null]=false` moved AGAIN in objectui#9508, which gave the
 * dialect the is-not-null half of the pair; it is pinned in
 * `drillNotNullDialect-9508.test.tsx`. The RANGE vocabulary asserted below is
 * still exactly the four bounds it always was — that card added no range
 * operator either.
 */

import { describe, it, expect } from 'vitest';
import { buildDatasetDrillFilter } from '@object-ui/core';
import {
  serializeDrillFilterParams,
  parseUrlFilterTriples,
  URL_FILTER_OPS,
  RANGE_OP_PARAM,
  NULL_FILTER,
} from './drillUrlFilters';

const DIMENSION_FIELDS = { stage: 'stage', owner: 'owner' };

/** What the producer wrote BEFORE objectui#9085 — the shape being replaced. */
const PREVIOUS_EMPTY_SPELLING = null;

describe('drill escape hatch vs the empty bucket (objectui#9085, repaired by objectui#9159)', () => {
  it('the is-null operator is its own flag and did NOT widen the range vocabulary', () => {
    // Stated as the exported constants rather than as prose, so the day any of
    // the three moves, this assertion is where the claim above stops being true.
    // The two range maps are unchanged by objectui#9159 on purpose: `is_null` is
    // already a canonical `ViewFilterRule` word, and `ObjectDataPage` inverts
    // `URL_FILTER_OPS` to bridge triples to the spec's ALIAS spelling — an entry
    // here would send it through that bridge and lose the condition from a saved
    // view.
    expect(Object.keys(URL_FILTER_OPS)).toEqual(['gte', 'lte', 'gt', 'lt']);
    expect(Object.keys(RANGE_OP_PARAM)).toEqual(['$gte', '$lte', '$gt', '$lt']);
    // ⚠️ objectui#9508 added this record's inverse half (`notFlag` / `notOp` /
    // `existsKey` / `notLabelKey`), so the assertion names the members whose
    // MOVEMENT would falsify the claim above rather than the record's whole
    // shape — an exhaustive `toEqual` here would redden on every future
    // spelling this dialect gains without any of these five having moved.
    expect(NULL_FILTER.param).toBe('null');
    expect(NULL_FILTER.flag).toBe('true');
    expect(NULL_FILTER.op).toBe('is_null');
    expect(NULL_FILTER.key).toBe('$null');
    expect(NULL_FILTER.labelKey).toBe('filterBuilder.operators.is_null');
  });

  it('the new spelling NO LONGER serializes identically to the bare null it replaced', () => {
    const now = buildDatasetDrillFilter({ stage: 'won', owner: '' }, ['stage', 'owner'], DIMENSION_FIELDS);
    const before = { stage: 'won', owner: PREVIOUS_EMPTY_SPELLING };

    expect(now).toEqual({ stage: 'won', owner: { $null: true } });
    // objectui#9159: this pair used to be byte-identical, which is what made the
    // escalated list a superset. The divergence IS the repair, so it is asserted
    // as the two exact strings rather than as an inequality — the latter would
    // also pass on a serializer that had merely started emitting garbage.
    expect(serializeDrillFilterParams(now).toString())
      .toBe('filter%5Bstage%5D=won&filter%5Bowner%5D%5Bnull%5D=true');
    expect(serializeDrillFilterParams(before).toString()).toBe('filter%5Bstage%5D=won');
    // And BOTH conditions now reach the destination — the empty-bucket one being
    // the one the user actually clicked.
    expect(parseUrlFilterTriples(new URLSearchParams(serializeDrillFilterParams(now).toString())))
      .toEqual([
        ['stage', '=', 'won'],
        ['owner', 'is_null', true],
      ]);
  });

  it('an empty-bucket-only drill now serializes to the flag, while a bare null still serializes to nothing', () => {
    const now = buildDatasetDrillFilter({ owner: '' }, ['owner'], DIMENSION_FIELDS);
    expect(serializeDrillFilterParams(now).toString()).toBe('filter%5Bowner%5D%5Bnull%5D=true');
    // Unchanged by objectui#9159, and deliberately: a JS `null` value means the
    // producer has nothing to say about the field, not that the field is empty.
    expect(serializeDrillFilterParams({ owner: PREVIOUS_EMPTY_SPELLING }).toString()).toBe('');
  });

  it('CONTROL: a NON-empty drill still reaches the URL, so an empty result set above is the boundary and not a broken serializer', () => {
    const composed = buildDatasetDrillFilter({ owner: 'alice' }, ['owner'], DIMENSION_FIELDS);
    expect(serializeDrillFilterParams(composed).toString()).toBe('filter%5Bowner%5D=alice');
  });

  it('CONTROL: a date-bucket RANGE drill still reaches the URL', () => {
    const composed = buildDatasetDrillFilter({}, [], {}, undefined, {
      closed: { field: 'closed_at', gte: '2026-01-01', lt: '2026-04-01' },
    });
    expect(parseUrlFilterTriples(new URLSearchParams(serializeDrillFilterParams(composed).toString())))
      .toEqual([
        ['closed_at', '>=', '2026-01-01'],
        ['closed_at', '<', '2026-04-01'],
      ]);
  });
});
