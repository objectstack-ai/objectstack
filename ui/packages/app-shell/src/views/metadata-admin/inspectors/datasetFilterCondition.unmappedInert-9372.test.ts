// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * An operator this bridge cannot express must be INERT, never destructive
 * (objectui#9372).
 *
 * ## The defect, and the split that carries it
 *
 * objectui#9363 repaired `isNull` / `isNotNull` one operator at a time. This
 * card is the same destruction four more times — `between`, `endsWith`,
 * `notContains`, `startsWith`, every one of them an ordinary entry in this
 * inspector's menu — and it separates two questions the card's own option list
 * ran together:
 *
 *   (i)  WHICH operators map to the dialect — a per-operator conformance
 *        question, answered below for three of the four.
 *   (ii) What happens when one does NOT map — not an open question. Erasing
 *        the author's stored filter is wrong whatever (i) answers.
 *
 * (ii) is what this file exists for, and it is fixed unconditionally: the
 * mechanism is that `undefined` out of {@link groupToCondition} means BOTH
 * "the author cleared the filter" AND "nothing survived serialization", and the
 * caller treated both as clear. That conflation is what makes an unmapped
 * operator destructive rather than inert.
 *
 * ## The second route, which needs no operator at all
 *
 * The conflation is reachable by blanking the VALUE of the only row — an
 * incomplete row is dropped by the same `continue`, the last part disappears,
 * and the function answers `undefined`. Pinned below beside the operator
 * route, because it is the same defect and a repair aimed only at operators
 * would leave it standing.
 *
 * ## What "leave it alone" is, and what it is deliberately not
 *
 * {@link isClearedGroup} answers the one question the caller could not ask
 * before: was `undefined` the author's CLEAR gesture? Only then is `undefined`
 * committed. Otherwise the caller patches nothing and the stored filter is
 * untouched.
 *
 * ⚠️ NOT "emit something". Emitting a filter in a spelling that means something
 * else is worse than dropping — that is the whole reason the unmapped arm
 * exists, and it survives this repair intact.
 *
 * ## `between`, flipped (objectui#10062)
 *
 * This file used to pin `between` as the one offered operator still unmapped,
 * because nothing told a half-typed pair from a finished one. The builder's
 * own `isFilterValueComplete` does (objectui#5025), the bridge now asks it, and
 * the last block below is the flipped pin: both bounds ⇒ `$between`, a missing
 * bound ⇒ not emitted, and the conformance reading every other mapped operator
 * got. The (ii) gestures above keep their meaning with `between` as the
 * UNFINISHED-row route rather than the unmapped-operator one.
 *
 * ## Red-first
 *
 * Predicted before running, on the unmodified tree: the (ii) block fails at
 * `isClearedGroup` not being a function, and the three (i) mappings fail with
 * `undefined`, while the `equals` control in the SAME run passes — a table of
 * all-`undefined` answers and a dead function look identical otherwise.
 */
import { describe, it, expect } from 'vitest';
import {
  FILTER_OPERATORS,
  FieldOperatorsSchema,
  FILTER_TEXT_CASES,
  TEMPORAL_CASES,
  TEMPORAL_TIME_CASES,
  TEXT_OPERATOR_DOOR_CASES,
} from '@objectstack/spec/data';
import {
  filterValueArity,
  isFilterValueComplete,
  operatorsForFieldType,
  reshapeFilterValue,
} from '@object-ui/components';
import { groupToCondition, conditionToGroup, isClearedGroup } from './datasetFilterCondition';
import type { BuilderGroup } from './datasetFilterCondition';

/** One condition row, as the builder emits it. */
const row = (operator: string, value: unknown = ''): BuilderGroup => ({
  id: 'g',
  logic: 'and',
  conditions: [{ id: 'c1', field: 'name', operator, value }],
});

/** The author's stored filter, before they touch anything. */
const STORED = { name: { $eq: 'acme' } };

/**
 * The commit decision, spelled exactly as `DatasetFilterField` spells it.
 *
 * Returned rather than asserted inline so each gesture below reads as "what
 * would this commit", and so the HOLD case is a value rather than the absence
 * of a call.
 */
function commitFor(group: BuilderGroup): { hold: true } | { hold: false; filter: unknown } {
  const next = groupToCondition(group);
  if (next === undefined && !isClearedGroup(group)) return { hold: true };
  return { hold: false, filter: next };
}

/**
 * Every `$`-operator a canonical case table's filters carry — the driver
 * conformance reading an operator has to appear in before this bridge maps it.
 */
function tokensOf(cases: ReadonlyArray<{ filter: unknown }>): Set<string> {
  const out = new Set<string>();
  for (const c of cases) {
    for (const ops of Object.values(c.filter as Record<string, unknown>)) {
      if (ops && typeof ops === 'object') for (const k of Object.keys(ops)) out.add(k);
    }
  }
  return out;
}

describe('(ii) an operator this bridge cannot express is inert, not destructive (objectui#9372)', () => {
  it('CONTROL: a mapped operator still serializes, so an empty answer below is about that operator', () => {
    expect(groupToCondition(row('equals', 'acme'))).toEqual({ name: { $eq: 'acme' } });
  });

  it('tells the author\'s CLEAR gesture apart from a serialization that produced nothing', () => {
    // No rows at all is the clear gesture — "Clear all", or removing the last
    // row. `undefined` is the right commit for it and stays that way.
    expect(isClearedGroup({ id: 'g', logic: 'and', conditions: [] })).toBe(true);
    expect(isClearedGroup(undefined)).toBe(true);
    // A row with no field picked is not yet a row — `groupToCondition` filters
    // it out before anything else, so the two must agree here.
    expect(isClearedGroup(row('equals', 'acme'))).toBe(false);
    expect(isClearedGroup({ id: 'g', logic: 'and', conditions: [{ id: 'c1', field: '', operator: 'equals', value: 'x' }] })).toBe(true);
  });

  it('THE GESTURE, operator route: switching the only row to `between` commits NOTHING until both bounds are typed', () => {
    // The exact author gesture the card describes: a dataset that already has
    // a filter, opened in the inspector, one operator change. Before this
    // repair the commit was `undefined`, which the host spreads over the draft
    // as `{ filter: undefined }` — the same patch shape `objectChangePatch`
    // uses deliberately to CLEAR the filter.
    //
    // objectui#10062: `between` is mapped now, so the switch no longer drops
    // an UNMAPPED operator — it drops an UNFINISHED row. The builder re-shapes
    // the scalar it had into a pair with the second bound blank, and that
    // value is taken from the builder's own re-shaper rather than restated.
    const { group, representable } = conditionToGroup(STORED);
    expect(representable).toBe(true);
    const switched = reshapeFilterValue(group.conditions[0].value as string, 'between');
    expect(switched, 'the switch must hand the bridge a HALF pair, or this is not the gesture').toEqual(['acme', '']);
    const edited: BuilderGroup = {
      ...group,
      conditions: [{ ...group.conditions[0], operator: 'between', value: switched }],
    };
    expect(groupToCondition(edited)).toBeUndefined();
    expect(
      commitFor(edited),
      'this gesture used to commit `undefined`, which ERASES the stored filter',
    ).toEqual({ hold: true });
  });

  it('an operator this bridge does not map at all is still inert, not destructive', () => {
    // The unmapped arm outlives objectui#10062 for operators this inspector
    // does not offer — `exists` is an opt-in the builder draws only when a
    // caller grants it, and this caller grants none. (The fixture was
    // `containsCaseInsensitive` until objectui#9306 made the case-insensitive
    // contains an ordinary, mapped operator.)
    expect(operatorsForFieldType('text', []).map((o) => o.value)).not.toContain('exists');
    expect(groupToCondition(row('exists'))).toBeUndefined();
    expect(commitFor(row('exists'))).toEqual({ hold: true });
  });

  it('THE GESTURE, blank-value route: blanking the only row\'s value commits NOTHING — no operator needed', () => {
    // The same defect reached without touching the operator menu at all: an
    // incomplete row is dropped by the same `continue`, the last part goes,
    // and the answer is `undefined`.
    const { group } = conditionToGroup(STORED);
    const blanked: BuilderGroup = {
      ...group,
      conditions: [{ ...group.conditions[0], value: '' }],
    };
    expect(groupToCondition(blanked)).toBeUndefined();
    expect(
      commitFor(blanked),
      'blanking the only row used to erase the stored filter, with no operator involved',
    ).toEqual({ hold: true });
  });

  it('a partly-edited group still commits the rows that DID survive', () => {
    // Holding is only for "nothing survived". One good row and one unfinished
    // one — a `between` with its upper bound not typed yet — must still commit
    // the good row, exactly as before.
    const mixed: BuilderGroup = {
      id: 'g',
      logic: 'and',
      conditions: [
        { id: 'c1', field: 'stage', operator: 'equals', value: 'won' },
        { id: 'c2', field: 'closed_at', operator: 'between', value: ['2026-01-01', ''] },
      ],
    };
    expect(commitFor(mixed)).toEqual({ hold: false, filter: { stage: { $eq: 'won' } } });
  });

  it('the author CLEARING the filter still clears it — the repair does not strand a stale filter', () => {
    // The other half of the equality, and the reason this is a disambiguation
    // rather than a blanket "never commit undefined": with no rows left there
    // is no edit to preserve, and `undefined` is the author's own gesture.
    expect(commitFor({ id: 'g', logic: 'and', conditions: [] })).toEqual({ hold: false, filter: undefined });
  });
});

describe('(i) the text operators this bridge now expresses (objectui#9372, objectui#9306)', () => {
  // `icontains` joined in objectui#9306, when it stopped being opt-in: every
  // leg below — the token, the round trip, both conformance tables, both
  // doors and the text-only offering — holds for it exactly as for the three
  // objectui#9372 bridged.
  const MAPPED: ReadonlyArray<readonly [string, string]> = [
    ['icontains', '$icontains'],
    ['not_contains', '$notContains'],
    ['starts_with', '$startsWith'],
    ['ends_with', '$endsWith'],
  ];

  it('serializes each one to the spec\'s own token', () => {
    for (const [operator, token] of MAPPED) {
      expect(groupToCondition(row(operator, 'ac')), `${operator} serialized to nothing`)
        .toEqual({ name: { [token]: 'ac' } });
    }
  });

  it('reads each one back as the operator the author picked', () => {
    for (const [operator, token] of MAPPED) {
      const { group, representable } = conditionToGroup({ name: { [token]: 'ac' } });
      expect(representable, `${token} fell back to the Source tab`).toBe(true);
      expect(group.conditions[0].operator).toBe(operator);
      expect(groupToCondition(group)).toEqual({ name: { [token]: 'ac' } });
    }
  });

  it('PREMISE, re-measured: the dialect CAN express all four — the file\'s comment was stale', () => {
    // The `unmapped (e.g. notContains/between)` comment read as "operators this
    // dialect genuinely cannot express". Measured against the pinned spec, all
    // four are members of its filter vocabulary, so the premise is false for
    // every one of them: they were not inexpressible, they were unmapped.
    for (const token of ['$notContains', '$startsWith', '$endsWith', '$between']) {
      expect(FILTER_OPERATORS).toContain(token);
    }
    // Negative control: membership is a real reading, not a list that contains
    // everything. A plausible spelling this bridge could have invented is not
    // in it.
    expect(FILTER_OPERATORS).not.toContain('$beginsWith');
  });

  it('CONFORMANCE: each one carries canonical driver cases — and `$between` does too, in the temporal tables', () => {
    // The reading `$null` has and these were said to lack. `FILTER_TEXT_CASES`
    // is the Filter Protocol's text-operator standard — the table every filter
    // backend is checked against — and it carries rows for all three.
    const textCovered = tokensOf(FILTER_TEXT_CASES);
    for (const [, token] of MAPPED) expect(textCovered, `${token} has no text-conformance rows`).toContain(token);
    // objectui#10062 — the leg that read `expect(covered).not.toContain('$between')`,
    // inverted. `$between` is a range operator, so its canonical driver cases
    // are not in the text table; they are in the temporal ones, which state
    // what every backend answers for a range over a date-time and a time
    // column (inclusive at both ends, the max widened like `$lte`).
    const temporalCovered = tokensOf([...TEMPORAL_CASES, ...TEMPORAL_TIME_CASES]);
    const covered = new Set([...textCovered, ...temporalCovered]);
    expect(covered, '`$between` has no driver-conformance rows').toContain('$between');
    // Attribution, so the union is not a set that says yes to everything:
    // `$between` comes from the temporal tables, and the text table still does
    // not carry it.
    expect(temporalCovered).toContain('$between');
    expect(textCovered).not.toContain('$between');
    // Negative control: a plausible spelling no table carries is not covered.
    expect(covered).not.toContain('$beginsWith');
  });

  it('CONFORMANCE: the spec\'s declared-type door passes all three over text and refuses them over number', () => {
    // The authoring half. This bridge only ever emits these three from the
    // builder's TEXT bucket (asserted below), which is the side the door
    // passes; the refusals are what make the pass a reading rather than a
    // table that says yes to everything.
    for (const [, token] of MAPPED) {
      const forText = TEXT_OPERATOR_DOOR_CASES.filter((c) => c.operator === token && c.declaredType === 'text');
      expect(forText.length, `${token} has no door case over text`).toBeGreaterThan(0);
      for (const c of forText) expect(c.verdict, `${token} over text`).toBe('passes');
      const forNumber = TEXT_OPERATOR_DOOR_CASES.filter((c) => c.operator === token && c.declaredType === 'number');
      expect(forNumber.length, `${token} has no door case over number`).toBeGreaterThan(0);
      for (const c of forNumber) expect(c.verdict, `${token} over number`).toBe('door-refusal');
    }
  });

  it('CONFORMANCE: the comparand door accepts the string this builder types and refuses a number', () => {
    for (const [, token] of MAPPED) {
      expect(FieldOperatorsSchema.safeParse({ [token]: 'ac' }).success, `${token} refused a string`).toBe(true);
      // Negative control: this door judges the VALUE, so without this leg the
      // assertion above would pass for a schema that accepts anything.
      expect(FieldOperatorsSchema.safeParse({ [token]: 5 }).success, `${token} accepted a number`).toBe(false);
    }
  });

  it('the builder only OFFERS these three on text-like fields, which is the side the door passes', () => {
    // The two halves have to meet: the door refuses these operators over
    // `number` / `date` / `boolean`, so mapping them is only safe while the
    // dropdown never offers them there. Read from the builder's own bucket
    // function rather than restated.
    const offered = (type: string | undefined) => operatorsForFieldType(type, []).map((o) => o.value);
    for (const [operator] of MAPPED) {
      expect(offered('text'), `${operator} is not offered on text`).toContain(operator);
      for (const type of ['number', 'currency', 'percent', 'rating', 'date', 'datetime', 'time', 'boolean']) {
        expect(offered(type), `${operator} is offered on ${type}, where the spec's door refuses it`)
          .not.toContain(operator);
      }
    }
  });
});

describe('`between` maps, with BOTH bounds required (objectui#10062 — flips the objectui#9381 pin)', () => {
  /**
   * One `between` row on a date column, as the builder emits it.
   *
   * The builder offers `between` on its date bucket only (asserted below), so
   * the bounds are the day strings a date input writes.
   */
  const range = (value: unknown): BuilderGroup => ({
    id: 'g',
    logic: 'and',
    conditions: [{ id: 'c1', field: 'closed_at', operator: 'between', value }],
  });
  const LO = '2026-01-01';
  const HI = '2026-03-31';

  /**
   * Every pair-row value this block probes, complete and not.
   *
   * The incomplete ones are the shapes the builder can actually hand over: a
   * pair padded with `''` on either side (`reshapeFilterValue`), the untouched
   * `[]` a fresh row starts from, and a scalar or one-bound list reaching the
   * row from outside the dropdown. `null` is the unset spelling an external
   * group may carry.
   */
  const HALF_FILLED: ReadonlyArray<unknown> = [
    [LO, ''], ['', HI], ['', ''], [], [LO], LO, '', null, undefined, [LO, null], [null, HI],
  ];
  const COMPLETE: ReadonlyArray<unknown> = [[LO, HI], [0, 10], [LO, LO]];

  it('both bounds ⇒ the spec\'s own `$between`, carrying `[lo, hi]` in order', () => {
    expect(groupToCondition(range([LO, HI]))).toEqual({ closed_at: { $between: [LO, HI] } });
  });

  it('a `0` bound is a bound, not a blank', () => {
    // `isFilterValueComplete` reads presence through `isValueUnset`, never
    // truthiness (objectui#4873) — a local `!bound` would drop this range.
    expect(groupToCondition(range([0, 10]))).toEqual({ closed_at: { $between: [0, 10] } });
  });

  it('a missing lo or hi ⇒ NOT emitted: the row drops as incomplete', () => {
    for (const value of HALF_FILLED) {
      expect(groupToCondition(range(value)), `${JSON.stringify(value)} was emitted`).toBeUndefined();
    }
  });

  it('what a half pair emits INSTEAD: nothing — the only row holds the stored filter, beside a complete row only that row commits', () => {
    // As the ONLY row: nothing survived, rows are still on screen, so the
    // caller patches nothing and the stored filter stays (objectui#9372).
    expect(commitFor(range([LO, '']))).toEqual({ hold: true });
    // Beside a complete row: the complete row is the whole commit. Not an
    // `$and` with a half range in it, and not a range with an invented bound.
    expect(commitFor({
      id: 'g',
      logic: 'and',
      conditions: [
        { id: 'c1', field: 'stage', operator: 'equals', value: 'won' },
        { id: 'c2', field: 'closed_at', operator: 'between', value: ['', HI] },
      ],
    })).toEqual({ hold: false, filter: { stage: { $eq: 'won' } } });
  });

  it('the completeness answer IS `isFilterValueComplete` — emitted exactly when the builder calls the pair finished', () => {
    // Not a second rule: over every probe, "emitted" and the builder's own
    // arity-aware answer agree. A local predicate that drifted from it — the
    // length check this bridge used to spell inline passes `[LO, '']` — goes
    // red here on the first disagreeing probe.
    for (const value of [...COMPLETE, ...HALF_FILLED]) {
      const emitted = groupToCondition(range(value)) !== undefined;
      expect(emitted, `bridge and isFilterValueComplete disagree on ${JSON.stringify(value)}`)
        .toBe(isFilterValueComplete('between', value as Parameters<typeof isFilterValueComplete>[1]));
    }
    // Controls, so the agreement above cannot be two constant answers.
    expect(isFilterValueComplete('between', [LO, HI])).toBe(true);
    expect(isFilterValueComplete('between', [LO, ''])).toBe(false);
  });

  it('why a local rule was ever needed: the builder really does hand over a half pair', () => {
    // `between` takes a PAIR, and switching a row to it re-shapes whatever
    // scalar it held into `[scalar, '']` — two entries long, so a length-only
    // completeness check would have let it through.
    expect(filterValueArity('between')).toBe('pair');
    expect(reshapeFilterValue(LO, 'between')).toEqual([LO, '']);
    expect(reshapeFilterValue('', 'between')).toEqual([]);
  });

  it('round-trips: a stored `$between` reads back as `between` with the same bounds and writes back byte-identical', () => {
    const stored = { closed_at: { $between: [LO, HI] } };
    const { group, representable } = conditionToGroup(stored);
    expect(representable, '`$between` fell back to the Source tab').toBe(true);
    expect(group.conditions).toEqual([{ id: 'c0', field: 'closed_at', operator: 'between', value: [LO, HI] }]);
    expect(groupToCondition(group)).toEqual(stored);
    // Inside a flat `$and`, beside another row, too.
    const both = { $and: [{ stage: { $eq: 'won' } }, stored] };
    expect(groupToCondition(conditionToGroup(both).group)).toEqual(both);
  });

  it('a stored `$between` that is not a complete pair — a blank, missing or extra bound, or a scalar — reads as non-representable: the Source tab, not a silent drop', () => {
    // Read back as a row, an incomplete pair would be dropped by the next
    // commit of ANY row in the group, removing a stored condition the author
    // never touched. So it goes where it went while `$between` was unmapped.
    //
    // ⚠️ This measures the pair's COMPLETENESS only, and reads with no field
    // list. The other refusal — a complete pair on a column whose bucket does
    // not offer `between` — needs the field list and is pinned in
    // `datasetFilterCondition.dateRoundTrip-9382`.
    for (const value of [[LO, ''], ['', HI], [LO], LO, [LO, HI, LO]]) {
      expect(
        conditionToGroup({ $and: [{ stage: { $eq: 'won' } }, { closed_at: { $between: value } }] }).representable,
        `${JSON.stringify(value)} became an editable row the next commit would drop`,
      ).toBe(false);
    }
  });

  describe('CONFORMANCE — the reading every other mapped operator received', () => {
    it('`$between` is a member of the spec\'s filter vocabulary', () => {
      expect(FILTER_OPERATORS).toContain('$between');
    });

    it('the spec\'s comparand door accepts the pair this bridge emits and refuses every non-pair shape', () => {
      const emitted = groupToCondition(range([LO, HI])) as { closed_at: Record<string, unknown> };
      expect(FieldOperatorsSchema.safeParse(emitted.closed_at).success).toBe(true);
      expect(FieldOperatorsSchema.safeParse({ $between: [0, 10] }).success).toBe(true);
      // Negative controls: this door judges the VALUE's shape, so without
      // these legs the acceptance above would pass for a schema that takes
      // anything. The bridge never emits any of them.
      for (const bad of [LO, [LO], [LO, HI, LO], [null, HI]]) {
        expect(FieldOperatorsSchema.safeParse({ $between: bad }).success, `door accepted ${JSON.stringify(bad)}`)
          .toBe(false);
      }
    });

    it('the builder only OFFERS `between` on date-like fields, which is what the temporal driver rows speak to', () => {
      // Read from the builder's own bucket function rather than restated.
      const offered = (type: string | undefined) => operatorsForFieldType(type, []).map((o) => o.value);
      for (const type of ['date', 'datetime', 'time']) {
        expect(offered(type), `between is not offered on ${type}`).toContain('between');
      }
      for (const type of [undefined, 'text', 'number', 'currency', 'percent', 'rating', 'boolean', 'select', 'status', 'lookup', 'user']) {
        expect(offered(type), `between is offered on ${String(type)}`).not.toContain('between');
      }
    });
  });
});
