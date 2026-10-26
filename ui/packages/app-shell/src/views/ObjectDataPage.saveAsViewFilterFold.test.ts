// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

// "Save as view" folds URL drill triples into spec ViewFilterRules
// (objectui#3419, tail of objectui#3375's viewEnvelope spec pin).
//
// `ObjectDataPage` renders from a runtime filter AST — `FilterTriple[]`, i.e.
// `[field, '=', value]`, the shape `parseUrlFilterTriples` produces and
// `ListView` sends as `$filter`. What "Save as view" PERSISTS is a ViewItem,
// and `ListViewSchema.filter` declares `z.array(ViewFilterRuleSchema)`:
// `{ field, operator, value }` over the canonical operator words. The two are
// different vocabularies for one key; writing the triples through verbatim
// produced an off-spec ViewItem that the record gate rejects with
// `config.filter.0 → "expected object, received array"`.
//
// This file pins the producer-side fold (AGENTS.md #0.1 — the consumer is NOT
// taught to accept triples). It asserts on `buildSaveAsViewSpec`, the whole
// spec-assembly step the callback delegates to, rather than on the fold helper
// alone: a test of the fold in isolation stays green if the call site goes back
// to `filter: urlFilters`, which is exactly the regression being pinned.
//
// Suite direction, decided before running: every case below is RED against the
// pre-#3419 producer (the raw-triple spec) and GREEN after — except
// `documents the pre-fix rejection`, which pins the SPEC's verdict on a raw
// triple and is green in both worlds by construction.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { ViewItemSchema } from '@objectstack/spec/ui';
import {
  URL_FILTER_OPS,
  NULL_FILTER,
  EMPTY_FILTER,
  parseUrlFilterTriples,
  type FilterTriple,
} from './drillUrlFilters';
import { viewEnvelope } from './runtime-metadata-persistence';
import { buildSaveAsViewSpec } from './ObjectDataPage';

/** The page's auto-derived column list (already field-security trimmed). */
const COLUMNS = ['name', 'stage', 'amount'];

/** What CreateViewDialog hands `handleSaveAsView`. */
const DIALOG_CONFIG = { type: 'grid', label: 'Open deals', name: 'open_deals' };

/** Build the envelope exactly as `handleSaveAsView` does, then gate it. */
function saveAsView(urlFilters: FilterTriple[]) {
  const spec = buildSaveAsViewSpec(DIALOG_CONFIG, COLUMNS, urlFilters);
  const env = viewEnvelope('crm_deal', spec, {
    name: DIALOG_CONFIG.name,
    label: DIALOG_CONFIG.label,
  });
  return { spec, env, gate: ViewItemSchema.safeParse(env) };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Save as view folds URL drill triples to spec rules (objectui#3419)', () => {
  it('documents the pre-fix rejection: a raw triple is not a ViewFilterRule', () => {
    // The exact verdict from the issue's repro, kept as executable evidence of
    // WHY the fold exists. This asserts the spec's behaviour, not ours, so it
    // is green before and after — the regression pin is the next test.
    const env = viewEnvelope(
      'crm_deal',
      { type: 'grid', columns: COLUMNS, filter: [['stage', '=', 'open']] },
      { name: 'raw', label: 'Raw' },
    );
    const res = ViewItemSchema.safeParse(env);
    expect(res.success).toBe(false);
    expect(res.error?.issues).toContainEqual(
      expect.objectContaining({
        code: 'invalid_type',
        expected: 'object',
        path: ['config', 'filter', 0],
      }),
    );
  });

  it('folds an equality drill and the envelope passes the ViewItem gate', () => {
    const { spec, gate } = saveAsView([['stage', '=', 'open']]);
    expect(spec.filter).toEqual([{ field: 'stage', operator: 'equals', value: 'open' }]);
    expect(
      gate.success,
      `ViewItem rejected by spec: ${JSON.stringify(gate.error?.issues)}`,
    ).toBe(true);
  });

  it('folds a date-bucket drill (two range triples on one field)', () => {
    // What a chart/date drill emits: `filter[close_date][gte]` + `[lt]`.
    const { spec, gate } = saveAsView([
      ['close_date', '>=', '2026-01-01'],
      ['close_date', '<', '2026-02-01'],
    ]);
    expect(spec.filter).toEqual([
      { field: 'close_date', operator: 'greater_than_or_equal', value: '2026-01-01' },
      { field: 'close_date', operator: 'less_than', value: '2026-02-01' },
    ]);
    expect(gate.success).toBe(true);
  });

  it('folds EVERY operator the URL contract can emit to a canonical spelling', () => {
    // Derived from `URL_FILTER_OPS` (plus `=`, which has no `[op]` suffix form,
    // and the emptiness PAIR, whose one param carries a direction rather than a
    // comparand and so is not in that range map) so an operator added to the URL
    // contract fails HERE rather than at publish time. `parseUrlFilterTriples`
    // emits nothing outside this set.
    //
    // ⚠️ `NULL_FILTER.notOp` joined the set in objectui#9508. Listing only
    // `op` would have left this pin GREEN while the contract grew an operator
    // it does not cover — the set is computed from the constants, so a missing
    // member is invisible here rather than red.
    //
    // ⚠️ objectui#11547 added the "is empty" pair (`EMPTY_FILTER`) for the same
    // reason and with the same obligation: both of its operators are listed.
    const emittable = [
      '=',
      ...Object.values(URL_FILTER_OPS),
      NULL_FILTER.op,
      NULL_FILTER.notOp,
      EMPTY_FILTER.op,
      EMPTY_FILTER.notOp,
    ];
    expect(emittable).toEqual([
      '=', '>=', '<=', '>', '<', 'is_null', 'is_not_null', 'is_empty', 'is_not_empty',
    ]);

    const { spec, gate } = saveAsView(
      emittable.map((op, i) => ['f' + i, op, String(i)] as FilterTriple),
    );
    expect(spec.filter.map((r: { operator: string }) => r.operator)).toEqual([
      'equals',
      'greater_than_or_equal',
      'less_than_or_equal',
      'greater_than',
      'less_than',
      // objectui#9159. `is_null` is ALREADY a canonical ViewFilterRule word, so
      // it must reach `normalizeFilterOperator` unbridged; the symbol-to-alias
      // table is keyed on the range symbols, which this operator is not one of.
      // Were the param added to `URL_FILTER_OPS` instead, the bridge would hand
      // over the alias `null`, the rule schema would refuse it, and saving the
      // view would silently drop the condition.
      'is_null',
      // objectui#9508 — the inverse direction, canonical for the same reason.
      'is_not_null',
      // objectui#11547 — the "is empty" pair, canonical words too, so it also
      // reaches `normalizeFilterOperator` unbridged.
      'is_empty',
      'is_not_empty',
    ]);
    expect(gate.success).toBe(true);
  });

  it('keeps the is-NOT-null direction intact through the fold too (objectui#9508)', () => {
    // A drill that can be WRITTEN into the URL must also be savable, or the
    // user reads a chip the saved view then silently does not carry.
    const { spec, gate } = saveAsView([['owner', NULL_FILTER.notOp, true]]);
    expect(spec.filter).toEqual([{ field: 'owner', operator: 'is_not_null', value: true }]);
    expect(
      gate.success,
      `ViewItem rejected by spec: ${JSON.stringify(gate.error?.issues)}`,
    ).toBe(true);
  });

  it.each([
    [EMPTY_FILTER.flag, EMPTY_FILTER.op],
    [EMPTY_FILTER.notFlag, EMPTY_FILTER.notOp],
  ])(
    'keeps `filter[owner][empty]=%s` through the fold as `%s` (objectui#11547)',
    (flag, op) => {
      // A drill that the URL can now carry must also be savable, or the user
      // reads a chip the saved view then silently does not carry. Read from the
      // URL itself, so the reader and the fold are judged together.
      const triples = parseUrlFilterTriples(
        new URLSearchParams(`filter[owner][${EMPTY_FILTER.param}]=${flag}`),
      );
      const { spec, gate } = saveAsView(triples);
      expect(spec.filter).toEqual([{ field: 'owner', operator: op, value: true }]);
      expect(
        gate.success,
        `ViewItem rejected by spec: ${JSON.stringify(gate.error?.issues)}`,
      ).toBe(true);
    },
  );

  it('keeps the is-null flag intact through the fold, value and all', () => {
    // The escape hatch's empty-bucket drill (objectui#9159) is savable as a
    // view: `[field,'is_null',true]` is a canonical rule, and the value rides
    // along exactly as `viewFilterFold` carries a value-less operator's value.
    const { spec, gate } = saveAsView([['owner', NULL_FILTER.op, true]]);
    expect(spec.filter).toEqual([{ field: 'owner', operator: 'is_null', value: true }]);
    expect(
      gate.success,
      `ViewItem rejected by spec: ${JSON.stringify(gate.error?.issues)}`,
    ).toBe(true);
  });

  it('carries field and value through untouched', () => {
    // Placeholder resolution has already run upstream; the fold must not
    // re-interpret what it produced (`''` included — the spec accepts it).
    const { spec } = saveAsView([
      ['owner_id', '=', 'usr_00042'],
      ['note', '=', ''],
    ]);
    expect(spec.filter).toEqual([
      { field: 'owner_id', operator: 'equals', value: 'usr_00042' },
      { field: 'note', operator: 'equals', value: '' },
    ]);
  });

  it('drops a triple with no canonical operator instead of persisting it off-spec', () => {
    // Defence in depth: `parseUrlFilterTriples` cannot emit `~=` today. If the
    // URL contract ever grows an operator the spec has no word for, the saved
    // view loses that one condition (with a warning) rather than becoming a
    // body the record gate rejects whole. objectui#4029 promoted this from
    // `console.debug` to `console.warn` — it is a real diagnostic (data
    // silently dropped), not debug noise, so it must survive the repo's
    // `no-console` allowlist.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { spec, gate } = saveAsView([
      ['stage', '=', 'open'],
      ['score', '~=', '10'],
    ]);
    expect(spec.filter).toEqual([{ field: 'stage', operator: 'equals', value: 'open' }]);
    expect(gate.success).toBe(true);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('score'));
  });

  it('omits `filter` entirely when every triple was dropped', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { spec, gate } = saveAsView([['score', '~=', '10']]);
    expect('filter' in spec).toBe(false);
    expect(gate.success).toBe(true);
  });
});

describe('Save as view without drill filters is unchanged (objectui#3419)', () => {
  it('writes no `filter` key and keeps the dialog payload byte-identical', () => {
    const { spec, gate } = saveAsView([]);
    expect(spec).toEqual({ ...DIALOG_CONFIG, columns: COLUMNS });
    expect(gate.success).toBe(true);
  });

  it('prefers the dialog columns over the page fallback, as before', () => {
    const spec = buildSaveAsViewSpec({ ...DIALOG_CONFIG, columns: ['name'] }, COLUMNS, []);
    expect(spec.columns).toEqual(['name']);
  });

  it('falls back to the page columns when the dialog carried an empty list', () => {
    const spec = buildSaveAsViewSpec({ ...DIALOG_CONFIG, columns: [] }, COLUMNS, []);
    expect(spec.columns).toEqual(COLUMNS);
  });
});
