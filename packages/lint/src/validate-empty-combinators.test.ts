// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #5330 — the authoring-time refusal of LITERAL empty combinators.
//
// Two things are being proven here, and they are different claims:
//
//  1. **The rule fires on the five literal shapes, with the RIGHT prescription
//     for each.** A generic "empty combinator, fix it" would pass a test that
//     only counted findings, and would teach the wrong fix half the time —
//     `{$and: []}` / `{}` are match-ALL and `{$or: []}` / `{$not: {}}` are
//     match-NONE. So every rejection case asserts the id AND the severity AND
//     the prescription's load-bearing sentence, never just "something was
//     reported".
//  2. **The rule's vocabulary is the RUNTIME's.** `identity vocabulary agrees
//     with FILTER_LOGIC_CASES` drives the four #5322 identity cases from the
//     conformance table itself and asserts that the row-set language in the
//     message matches the rows the table says the filter selects. That is the
//     pin that would have caught #5388's defect (`{$or: []}` labelled
//     "match-all") if it had existed one package over, and it goes red the day
//     the messages stop being derived from `reduceFilterVerdict`.

import { describe, it, expect } from 'vitest';
import { FILTER_LOGIC_CASES, reduceFilterVerdict } from '@objectstack/spec/data';

import {
  validateEmptyCombinators,
  FILTER_EMPTY_COMBINATOR,
  FILTER_EMPTY_NODE,
} from './validate-empty-combinators.js';

type AnyRec = Record<string, unknown>;

/** A dashboard widget carrying one authored filter — the #3574 surface shape. */
const widgetStack = (filter: unknown): AnyRec => ({
  dashboards: [{ name: 'ops', widgets: [{ id: 'open_cases', type: 'metric', filter }] }],
});

const WIDGET_PATH = 'dashboards[0].widgets[0].filter';
const WIDGET_WHERE = 'dashboard "ops" · widget "open_cases"';

describe('validateEmptyCombinators — the literal shapes are refused', () => {
  it('returns nothing for an absent / empty stack', () => {
    expect(validateEmptyCombinators(undefined)).toEqual([]);
    expect(validateEmptyCombinators(null)).toEqual([]);
    expect(validateEmptyCombinators({})).toEqual([]);
  });

  it('refuses `$and: []` and prescribes deleting the key, not emptying it', () => {
    const findings = validateEmptyCombinators(widgetStack({ $and: [] }));

    expect(findings).toHaveLength(1);
    // The rejection envelope this package gates on: id + severity + location.
    expect(findings[0].rule).toBe(FILTER_EMPTY_COMBINATOR);
    expect(findings[0].severity).toBe('error');
    expect(findings[0].where).toBe(WIDGET_WHERE);
    expect(findings[0].path).toBe(`${WIDGET_PATH}.$and`);
    // Per-shape: the AND identity matches everything.
    expect(findings[0].message).toContain('matches EVERY row');
    expect(findings[0].hint).toContain('DELETE the key');
  });

  it('refuses `$or: []` and says it is the OPPOSITE of "no filter"', () => {
    const findings = validateEmptyCombinators(widgetStack({ $or: [] }));

    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe(FILTER_EMPTY_COMBINATOR);
    expect(findings[0].severity).toBe('error');
    expect(findings[0].path).toBe(`${WIDGET_PATH}.$or`);
    // The half a generic message gets wrong: OR identity is match-NONE.
    expect(findings[0].message).toContain('matches NO row');
    expect(findings[0].message).not.toContain('matches EVERY row');
    expect(findings[0].hint).toContain('OPPOSITE');
  });

  it('refuses `$not: {}` and prescribes putting the negated condition inside', () => {
    const findings = validateEmptyCombinators(widgetStack({ $not: {} }));

    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe(FILTER_EMPTY_COMBINATOR);
    expect(findings[0].severity).toBe('error');
    expect(findings[0].path).toBe(`${WIDGET_PATH}.$not`);
    expect(findings[0].message).toContain('matches NO row');
    expect(findings[0].hint).toContain('inside `$not`');
  });

  it('refuses a whole-filter `{}` and prescribes omitting the key', () => {
    const findings = validateEmptyCombinators(widgetStack({}));

    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe(FILTER_EMPTY_NODE);
    expect(findings[0].severity).toBe('error');
    expect(findings[0].path).toBe(WIDGET_PATH);
    expect(findings[0].message).toContain('matches EVERY row');
    expect(findings[0].hint).toContain('DELETE the key');
  });

  it('refuses a `{}` branch of `$or` by naming the branches it kills', () => {
    const findings = validateEmptyCombinators(
      widgetStack({ $or: [{ status: 'open' }, {}] }),
    );

    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe(FILTER_EMPTY_NODE);
    expect(findings[0].severity).toBe('error');
    expect(findings[0].path).toBe(`${WIDGET_PATH}.$or[1]`);
    // Absorption, not narrowing — the distinction #5297 was filed about.
    expect(findings[0].message).toContain('ABSORBS');
    expect(findings[0].message).toContain('matches EVERY row');
    expect(findings[0].hint).toContain('NARROW');
  });

  it('refuses a `{}` branch of `$and` with the AND identity wording', () => {
    const findings = validateEmptyCombinators(
      widgetStack({ $and: [{ status: 'open' }, {}] }),
    );

    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe(FILTER_EMPTY_NODE);
    expect(findings[0].severity).toBe('error');
    expect(findings[0].path).toBe(`${WIDGET_PATH}.$and[1]`);
    expect(findings[0].message).toContain('AND identity');
    // A dead conjunct is not an absorbed disjunct; the two must not share prose.
    expect(findings[0].message).not.toContain('ABSORBS');
  });

  it('reaches an empty combinator nested inside a live one', () => {
    const findings = validateEmptyCombinators(
      widgetStack({ $or: [{ status: 'open' }, { $and: [] }, { $not: { $or: [] } }] }),
    );

    expect(findings.map((f) => f.path).sort()).toEqual([
      `${WIDGET_PATH}.$or[1].$and`,
      `${WIDGET_PATH}.$or[2].$not.$or`,
    ]);
    for (const f of findings) expect(f.severity).toBe('error');
  });
});

describe('validateEmptyCombinators — what it leaves alone', () => {
  it('says nothing about an absent filter key — the canonical "no filter"', () => {
    expect(
      validateEmptyCombinators({
        dashboards: [{ name: 'ops', widgets: [{ id: 'w', type: 'metric' }] }],
      }),
    ).toEqual([]);
  });

  it('says nothing about a filter that carries a real predicate', () => {
    expect(
      validateEmptyCombinators(
        widgetStack({
          $and: [{ status: 'open' }, { $or: [{ owner: 'u1' }, { owner: 'u2' }] }],
          $not: { archived: true },
        }),
      ),
    ).toEqual([]);
  });

  it('says nothing about `{ field: {} }` — that is #5240\'s shape, not this one', () => {
    // A field constrained by zero operators is a different defect with a
    // different fix, ruled and gated elsewhere. Descending into a comparand
    // here would double-report it in a second vocabulary.
    expect(validateEmptyCombinators(widgetStack({ status: {} }))).toEqual([]);
  });

  it('says nothing about the declared match-none spelling it prescribes', () => {
    // The hint tells authors to write `{ $in: [] }` when they really do want
    // zero rows. A rule that then rejected its own prescription would be worse
    // than no rule at all.
    expect(validateEmptyCombinators(widgetStack({ stage: { $in: [] } }))).toEqual([]);
  });

  it('says nothing about a non-array `$and` or a non-object `$not` operand', () => {
    // Refused BY NAME at the schema and at every driver (`assertNodeList` /
    // `assertNode`); a second complaint here would describe a run that never
    // happens.
    expect(validateEmptyCombinators(widgetStack({ $and: 'nope' }))).toEqual([]);
    expect(validateEmptyCombinators(widgetStack({ $not: 'nope' }))).toEqual([]);
  });

  it('does not read a non-plain object as an empty node', () => {
    // A `Date` / `Map` enumerates to zero own keys. Reporting one would name a
    // shape the author never wrote — the mirror of the `isFilterNode` guard the
    // shared reduction carries for the opposite reason.
    expect(validateEmptyCombinators(widgetStack(new Date()))).toEqual([]);
    expect(validateEmptyCombinators(widgetStack({ $or: [{ a: 'x' }, new Date()] }))).toEqual([]);
  });

  it('leaves the array authoring shape alone, empty or not', () => {
    // `FilterArray` is lowered by `parseFilterAST` and is not one of the four
    // shapes #5322 ruled on — out of scope rather than guessed at.
    expect(validateEmptyCombinators(widgetStack([]))).toEqual([]);
    expect(
      validateEmptyCombinators(widgetStack([{ field: 'owner', operator: 'equals', value: 'u1' }])),
    ).toEqual([]);
  });

  it('survives a cyclic metadata graph', () => {
    const dash: AnyRec = { name: 'd', widgets: [] };
    dash.self = dash;
    expect(() => validateEmptyCombinators({ dashboards: [dash] })).not.toThrow();
  });
});

describe('validateEmptyCombinators — the surfaces it walks', () => {
  it('covers a flow CRUD node config, where the blast radius is largest', () => {
    const findings = validateEmptyCombinators({
      flows: [
        {
          name: 'purge_stale',
          nodes: [
            { id: 'start', type: 'start' },
            {
              id: 'purge',
              type: 'delete_record',
              config: { objectName: 'lead', multi: true, filter: { $or: [] } },
            },
          ],
        },
      ],
    });

    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe(FILTER_EMPTY_COMBINATOR);
    expect(findings[0].severity).toBe('error');
    expect(findings[0].where).toBe('flow "purge_stale"');
    expect(findings[0].path).toBe('flows[0].nodes[1].config.filter.$or');
    expect(findings[0].message).toContain('matches NO row');
  });

  it('covers objects, views, reports, datasets, pages and apps', () => {
    const findings = validateEmptyCombinators({
      objects: [{ name: 'lead', listViews: { mine: { filter: { $or: [] } } } }],
      views: [{ name: 'all', list: { filter: { $and: [] } } }],
      reports: [{ name: 'weekly', runtimeFilter: { $not: {} } }],
      datasets: [{ name: 'cases', filter: {} }],
      pages: [
        {
          name: 'home',
          regions: [{ components: [{ type: 'object-grid', properties: { filter: { $or: [] } } }] }],
        },
      ],
      apps: [{ name: 'crm', navigation: [{ id: 'n', type: 'object', filters: { $and: [] } }] }],
    });

    expect(findings.map((f) => f.where).sort()).toEqual([
      'app "crm"',
      'dataset "cases"',
      'object "lead"',
      'page "home"',
      'report "weekly"',
      'view "all"',
    ]);
    for (const f of findings) expect(f.severity).toBe('error');
  });
});

describe('validateEmptyCombinators — the vocabulary is the runtime\'s (#5322/#5659)', () => {
  /**
   * The four identity cases, taken from the conformance table rather than
   * retyped: `filter-logic-conformance.ts` is what every backend is measured
   * against, so a message derived from anything else would be a second opinion.
   */
  const identityCases = FILTER_LOGIC_CASES.filter((c) => (c.note ?? '').includes('#5322'));

  it('the identity cases are still findable in the conformance table', () => {
    // Guarded body: if the selection ever returns nothing, the loop below would
    // pass by vacuity and this file would report coverage it does not have.
    expect(identityCases.map((c) => c.name).sort()).toEqual([
      '$not of {} is FALSE — NOT TRUE',
      'a {} branch is a TRUE disjunct and absorbs its $or',
      'empty $and is TRUE — the AND identity',
      'empty $or is FALSE — the OR identity',
    ]);
  });

  it('identity vocabulary agrees with FILTER_LOGIC_CASES', () => {
    expect(identityCases.length).toBe(4);

    for (const c of identityCases) {
      const findings = validateEmptyCombinators(widgetStack(c.filter));
      expect(findings, `${c.name}: exactly one literal shape is reported`).toHaveLength(1);

      // The table says which rows the filter selects; the message must say the
      // same thing in words. `expected: []` is match-none, a full row set is
      // match-all — there is no third answer among these four.
      const selectsEveryRow = c.expected.length === 4;
      const selectsNoRow = c.expected.length === 0;
      expect(selectsEveryRow || selectsNoRow, `${c.name}: an identity selects all rows or none`).toBe(true);

      expect(findings[0].message, `${c.name}: prescription must match the conformance row set`).toContain(
        selectsEveryRow ? 'matches EVERY row' : 'matches NO row',
      );
      expect(findings[0].message).not.toContain(selectsEveryRow ? 'matches NO row' : 'matches EVERY row');
    }
  });

  it('the row-set language is DERIVED from the shared reduction, not retyped', () => {
    // The same claim from the other side: ask `reduceFilterVerdict` directly.
    // If a future edit hand-writes a fourth reduction inside this rule, these
    // two views stop agreeing and this case is where it shows.
    const probes: ReadonlyArray<[AnyRec, string]> = [
      [{ $and: [] }, 'matches EVERY row'],
      [{ $or: [] }, 'matches NO row'],
      [{ $not: {} }, 'matches NO row'],
      [{}, 'matches EVERY row'],
      [{ $or: [{ status: 'open' }, {}] }, 'matches EVERY row'],
    ];

    for (const [filter, prose] of probes) {
      const verdict = reduceFilterVerdict(filter);
      expect(verdict, `${JSON.stringify(filter)} must reduce to a boolean identity`).not.toBe('clause');
      const expected = verdict === 'true' ? 'matches EVERY row' : 'matches NO row';
      expect(expected, `${JSON.stringify(filter)}`).toBe(prose);

      const findings = validateEmptyCombinators(widgetStack(filter));
      expect(findings, `${JSON.stringify(filter)} is a literal shape this rule reports`).toHaveLength(1);
      expect(findings[0].message).toContain(prose);
    }
  });
});
