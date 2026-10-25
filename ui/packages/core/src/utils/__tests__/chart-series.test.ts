/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect } from 'vitest';
import {
  buildOptionColorMap,
  buildDimensionLabelMap,
  relabelDimensions,
  buildChartSeries,
  resolveRelationshipTarget,
  resolveDimensionFieldOptions,
} from '../chart-series';

describe('buildOptionColorMap', () => {
  const health = [
    { label: 'Green', value: 'green', color: '#10B981', default: true },
    { label: 'Yellow', value: 'yellow', color: '#F59E0B' },
    { label: 'Red', value: 'red', color: '#EF4444' },
  ];

  it('keys each option color by BOTH its value and its label', () => {
    // A dataset row's category may carry the raw value (legacy aggregate path)
    // or the resolved label (server-resolved dataset dimensions), so both work.
    expect(buildOptionColorMap(health)).toEqual({
      green: '#10B981', Green: '#10B981',
      yellow: '#F59E0B', Yellow: '#F59E0B',
      red: '#EF4444', Red: '#EF4444',
    });
  });

  it('returns null when the field has no options', () => {
    expect(buildOptionColorMap(undefined)).toBeNull();
    expect(buildOptionColorMap(null)).toBeNull();
    expect(buildOptionColorMap([])).toBeNull();
  });

  it('returns null when no option carries a color', () => {
    expect(buildOptionColorMap([{ label: 'A', value: 'a' }, { label: 'B', value: 'b' }])).toBeNull();
  });

  it('keeps only the options that carry a color', () => {
    expect(buildOptionColorMap([{ value: 'a', color: '#111' }, { value: 'b' }])).toEqual({ a: '#111' });
  });

  it('ignores non-string colors and malformed entries', () => {
    expect(
      buildOptionColorMap([
        { value: 'a', color: 123 },
        { value: 'b', color: '' },
        null,
        'not-an-object',
        { value: 'c', color: '#0f0' },
      ]),
    ).toEqual({ c: '#0f0' });
  });
});

describe('buildDimensionLabelMap', () => {
  // The AI-build default: English stored `value` + localized display `label`.
  const status = [
    { value: 'active', label: '合作中' },
    { value: 'lost', label: '已流失' },
    { value: 'potential', label: '潜在' },
  ];

  it('maps each option value to its display label', () => {
    expect(buildDimensionLabelMap(status)).toEqual({
      active: '合作中',
      lost: '已流失',
      potential: '潜在',
    });
  });

  it('drops no-op entries where the label equals the value (and bare strings)', () => {
    // A select whose value IS its label needs no relabeling, so it must not
    // appear in the map — that is what makes relabelDimensions idempotent.
    expect(buildDimensionLabelMap([{ value: 'open', label: 'open' }, 'closed'])).toBeNull();
  });

  it('returns null for empty / missing / malformed options', () => {
    expect(buildDimensionLabelMap(undefined)).toBeNull();
    expect(buildDimensionLabelMap(null)).toBeNull();
    expect(buildDimensionLabelMap([])).toBeNull();
    expect(buildDimensionLabelMap([{ value: 'a' }, { label: 'b' }, null])).toBeNull();
  });
});

describe('relabelDimensions', () => {
  const maps = { status: { active: '合作中', lost: '已流失', potential: '潜在' } };

  it('replaces a select dimension value with its label, keeping the measure attached', () => {
    const rows = [
      { status: 'active', count: 6 },
      { status: 'lost', count: 2 },
      { status: 'potential', count: 4 },
    ];
    expect(relabelDimensions(rows, maps)).toEqual([
      { status: '合作中', count: 6 },
      { status: '已流失', count: 2 },
      { status: '潜在', count: 4 },
    ]);
  });

  it('does not mutate the input rows (raw values survive for drill-through)', () => {
    const rows = [{ status: 'active', count: 6 }];
    relabelDimensions(rows, maps);
    expect(rows[0].status).toBe('active');
  });

  it('passes through values with no mapping (already a label, lookup id, free text)', () => {
    // Idempotent: running it again on already-resolved labels is a no-op.
    const rows = [{ status: '合作中', count: 6 }, { status: 'archived', count: 1 }];
    expect(relabelDimensions(rows, maps)).toEqual(rows);
  });

  it('is a no-op when there is no label map', () => {
    const rows = [{ status: 'active', count: 6 }];
    expect(relabelDimensions(rows, null)).toBe(rows);
    expect(relabelDimensions(rows, {})).toBe(rows);
  });

  it('tolerates null/undefined rows', () => {
    expect(relabelDimensions(null, maps)).toEqual([]);
    expect(relabelDimensions(undefined, maps)).toEqual([]);
  });
});

describe('relabelDimensions + buildChartSeries (the value≠label chart bug, cloud#667)', () => {
  // A select field whose stored value is English and whose option label is
  // Chinese — the default product of the AI build agent. The dataset groups by
  // the stored VALUE (active/lost/potential), counts correct. Before the fix
  // the chart axis read those raw values; the requirement is that the chart
  // displays the LABEL while every count still lands on the right category.
  const options = [
    { value: 'active', label: '合作中' },
    { value: 'lost', label: '已流失' },
    { value: 'potential', label: '潜在' },
  ];
  const labelMaps = { status: buildDimensionLabelMap(options)! };

  it('single dimension: counts land on label-keyed categories (no bar reads 0)', () => {
    const valueKeyedRows = [
      { status: 'active', count: 6 },
      { status: 'lost', count: 2 },
      { status: 'potential', count: 4 },
    ];
    const { data, xAxisKey, series } = buildChartSeries(
      relabelDimensions(valueKeyedRows, labelMaps),
      ['status'],
      ['count'],
    );
    expect(xAxisKey).toBe('status');
    expect(series).toEqual([{ dataKey: 'count', label: 'count' }]);
    // Each category displays the label AND keeps its count (the chart reads
    // data[i][xAxisKey] for the bar label and data[i][series.dataKey] for the
    // height) — the exact mismatch that previously zeroed every bar.
    expect(data).toEqual([
      { status: '合作中', count: 6 },
      { status: '已流失', count: 2 },
      { status: '潜在', count: 4 },
    ]);
    const byCategory = Object.fromEntries(data.map((r) => [r.status, r.count]));
    expect(byCategory).toEqual({ 合作中: 6, 已流失: 2, 潜在: 4 });
  });

  it('two dimensions: the pivoted grouped series read labels with counts intact', () => {
    // month × status grouped count — status is the second (pivoted) dimension.
    const rows = [
      { month: '2025-01', status: 'active', count: 5 },
      { month: '2025-01', status: 'lost', count: 1 },
      { month: '2025-02', status: 'active', count: 7 },
    ];
    const { data, xAxisKey, series } = buildChartSeries(
      relabelDimensions(rows, labelMaps),
      ['month', 'status'],
      ['count'],
    );
    expect(xAxisKey).toBe('month');
    // Series (the second dimension) are keyed AND labeled by the display label,
    // so the legend reads 合作中/已流失 and the pivoted column lookup matches.
    expect(series).toEqual([
      { dataKey: '合作中', label: '合作中' },
      { dataKey: '已流失', label: '已流失' },
    ]);
    expect(data).toEqual([
      { month: '2025-01', 合作中: 5, 已流失: 1 },
      { month: '2025-02', 合作中: 7 },
    ]);
  });
});

describe('resolveRelationshipTarget (objectui#4053)', () => {
  it('reads the target off the spec spelling `reference`', () => {
    // The positive control: the one carrier `ObjectSchema.safeParse` ACCEPTS,
    // and the one every zero below is measured against.
    expect(resolveRelationshipTarget({ type: 'lookup', reference: 'crm_account' })).toBe('crm_account');
  });

  /**
   * objectui#6648 — the mirror of the dataset designer's CARRIER refusal pin,
   * kept in lockstep for the same reason the spelling pins are (see below): the
   * two canonicalizations are one doctrine in two files, and a divergence
   * recreates the defect one file over.
   *
   * These two used to assert `.toBe('crm_account')` — the tolerance written
   * down. The census that removed them walked STRUCTURE, not text, across both
   * trees and found ZERO producers of either carrier at the field-def key
   * position, against 587 bare-string carriers there. `ObjectSchema.safeParse`
   * (spec 17.2.0) REFUSES both as `invalid_type`, and the array branch also
   * discarded every element after the first.
   */
  it.each([
    { carrier: 'array', reference: ['crm_account'] as unknown },
    { carrier: 'multi-element array (the discarded-rest case)', reference: ['crm_account', 'crm_lead'] as unknown },
    { carrier: '`{ object }`', reference: { object: 'crm_account' } as unknown },
  ])('refuses the $carrier carrier on `reference` — a producer emitting it is the bug', ({ reference }) => {
    expect(resolveRelationshipTarget({ type: 'lookup', reference })).toBeUndefined();
  });

  /**
   * objectui#6528 — the mirror of the dataset designer's refusal pin, kept in
   * lockstep so the two canonicalizations cannot drift (the divergence would
   * recreate the defect one file over).
   *
   * The census that removed these three: `ObjectSchema.safeParse` (spec 17.2.0)
   * REFUSES `reference_to` / `referenceTo` / `reference_to_object` BY NAME and
   * ACCEPTS `reference` (asserted above as the positive control); no producer
   * emits any of the three onto an object metadata document.
   *
   * This path matters MORE than the designer's: it reads
   * `GET /meta/object/:name` directly, with no `readFields` door stripping
   * retired keys. An unresolved target is best-effort by construction — the
   * walk yields no entry and the caller keeps the raw value — so a producer
   * emitting a legacy spelling degrades visibly instead of being silently
   * absorbed here (AGENTS.md #0.1).
   */
  it.each(['reference_to', 'referenceTo', 'reference_to_object'])(
    'refuses the legacy spelling `%s` — a producer emitting it is the bug',
    (spelling) => {
      expect(resolveRelationshipTarget({ type: 'lookup', [spelling]: 'crm_account' })).toBeUndefined();
    },
  );

  it('prefers `reference` on a partially-migrated def carrying both', () => {
    expect(
      resolveRelationshipTarget({ type: 'lookup', reference: 'crm_account', referenceTo: 'stale_legacy' }),
    ).toBe('crm_account');
  });

  it('accepts every master-detail spelling, case-insensitively', () => {
    for (const type of ['master_detail', 'masterDetail', 'master-detail', 'LOOKUP']) {
      expect(resolveRelationshipTarget({ type, reference: 'crm_account' })).toBe('crm_account');
    }
  });

  it('refuses a NON-relationship field even when it carries a reference-shaped key', () => {
    // The type gate is what stops a plain field's segment from being turned
    // into an object name and fetched speculatively.
    expect(resolveRelationshipTarget({ type: 'select', reference: 'crm_account' })).toBeUndefined();
    expect(resolveRelationshipTarget({ type: 'lookup' })).toBeUndefined();
    expect(resolveRelationshipTarget(null)).toBeUndefined();
    expect(resolveRelationshipTarget('crm_account')).toBeUndefined();
  });
});

describe('resolveDimensionFieldOptions (objectui#4053)', () => {
  const INDUSTRY = [
    { value: 'education', label: 'Education' },
    { value: 'finance', label: 'Finance' },
  ];
  const OPPORTUNITY = {
    name: 'crm_opportunity',
    fields: {
      stage: { type: 'select', options: [{ value: 'won', label: 'Won' }] },
      crm_account: { type: 'lookup', reference: 'crm_account' },
    },
  };
  const ACCOUNT = {
    name: 'crm_account',
    fields: {
      industry: { type: 'select', options: INDUSTRY },
      tier: { type: 'select', options: [{ value: 'a', label: 'A' }] },
      owner: { type: 'lookup', reference: 'crm_user' },
      website: { type: 'text' },
    },
  };
  const USER = {
    name: 'crm_user',
    fields: { department: { type: 'select', options: [{ value: 'rnd', label: 'R&D' }] } },
  };
  const DOCS: Record<string, unknown> = {
    crm_opportunity: OPPORTUNITY,
    crm_account: ACCOUNT,
    crm_user: USER,
  };
  /** Records which objects the walk asked for, in order. */
  const makeLoader = () => {
    const asked: string[] = [];
    return {
      asked,
      load: async (name: string) => {
        asked.push(name);
        return DOCS[name] ?? null;
      },
    };
  };

  it('resolves a LOCAL field straight off the base schema, fetching nothing', async () => {
    const { asked, load } = makeLoader();
    const out = await resolveDimensionFieldOptions(OPPORTUNITY, ['stage'], load);
    expect(out).toEqual({ stage: [{ value: 'won', label: 'Won' }] });
    expect(asked).toEqual([]);
  });

  it('resolves a DOTTED path against the relationship target', async () => {
    const { asked, load } = makeLoader();
    const out = await resolveDimensionFieldOptions(OPPORTUNITY, ['crm_account.industry'], load);
    expect(out['crm_account.industry']).toEqual(INDUSTRY);
    expect(asked).toEqual(['crm_account']);
  });

  it('walks N hops', async () => {
    const { asked, load } = makeLoader();
    const out = await resolveDimensionFieldOptions(OPPORTUNITY, ['crm_account.owner.department'], load);
    expect(out['crm_account.owner.department']).toEqual([{ value: 'rnd', label: 'R&D' }]);
    expect(asked).toEqual(['crm_account', 'crm_user']);
  });

  it('fetches a shared prefix ONCE and never re-fetches the base object', async () => {
    const { asked, load } = makeLoader();
    const out = await resolveDimensionFieldOptions(
      OPPORTUNITY,
      ['stage', 'crm_account.industry', 'crm_account.tier', 'crm_account.owner.department'],
      load,
    );
    expect(Object.keys(out).sort()).toEqual(
      ['crm_account.industry', 'crm_account.owner.department', 'crm_account.tier', 'stage'],
    );
    // `crm_account` serves three paths on one read; the base is seeded, not read.
    expect(asked).toEqual(['crm_account', 'crm_user']);
  });

  it('yields NO entry for a terminal field with no options, a missing field, or a dead hop', async () => {
    const { asked, load } = makeLoader();
    const out = await resolveDimensionFieldOptions(
      OPPORTUNITY,
      ['crm_account.website', 'crm_account.no_such_field', 'stage.nested', 'crm_account.ghost.name'],
      load,
    );
    expect(out).toEqual({});
    // `stage` is not a relationship, so it was never fetched; `ghost` is not a
    // field at all. Only the one reachable object was read.
    expect(asked).toEqual(['crm_account']);
  });

  it('survives a loader that throws, costing only that path', async () => {
    const out = await resolveDimensionFieldOptions(
      OPPORTUNITY,
      ['stage', 'crm_account.industry'],
      async () => { throw new Error('offline'); },
    );
    expect(out).toEqual({ stage: [{ value: 'won', label: 'Won' }] });
  });

  it('is a no-op for an empty / undefined path list and a junk base schema', async () => {
    const { asked, load } = makeLoader();
    expect(await resolveDimensionFieldOptions(OPPORTUNITY, [], load)).toEqual({});
    expect(await resolveDimensionFieldOptions(OPPORTUNITY, [undefined, null, ''], load)).toEqual({});
    expect(await resolveDimensionFieldOptions(null, ['stage'], load)).toEqual({});
    // `fields` as an array (not the map shape this lookup reads) resolves to
    // nothing rather than throwing.
    expect(await resolveDimensionFieldOptions({ fields: [] }, ['stage'], load)).toEqual({});
    expect(asked).toEqual([]);
  });
});
