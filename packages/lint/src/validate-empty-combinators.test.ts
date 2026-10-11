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
  validateEmptyCombinators as validateEmptyCombinatorsUnrecorded,
  FILTER_EMPTY_COMBINATOR,
  FILTER_EMPTY_NODE,
} from './validate-empty-combinators.js';
import { FILTER_KEYS } from './filter-walk.js';
import { explainRule } from './rule-explanations.js';

// [#22161] Each finding of the two ids is one verdict sentence; the reasoning
// it used to carry is the id's `os explain` entry. Every direct call below
// records what it fired, and the last cases in this file hold each recorded
// verdict to one line of at most 200 characters — every firing variant this
// suite exercises, not a chosen few. Run the whole file: those cases read what
// the cases above fired.
const fired: Array<{ rule: string; message: string; hint: string }> = [];
const validateEmptyCombinators: typeof validateEmptyCombinatorsUnrecorded = (...args) => {
  const findings = validateEmptyCombinatorsUnrecorded(...args);
  fired.push(...findings);
  return findings;
};

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
    // [#22161] One remedy line; why the absent key is the spelling is the
    // explanation's.
    expect(findings[0].hint).toContain('delete the key');
    expect(explainRule(FILTER_EMPTY_COMBINATOR)!.paragraphs.join('\n')).toContain('DELETE the key');
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
    // [#22161] The verdict says it is the opposite; the one-line `fix:` says
    // what emptying the array does instead of relaxing it.
    expect(findings[0].hint).toContain('closes the filter instead of relaxing it');
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
    // The `pages` row authors the RETIRED record form on purpose: since
    // #15442 / #15449 (ui#6206-B, one filter orthography) the `object-*`
    // `filter` doors carry `z.array(ViewFilterRuleSchema)`, so the spec now
    // refuses `{ $or: [] }` there. That is exactly what this row measures.
    // This rule never parses a fixture against the spec schema — the walk is
    // key-name based (`walkAuthoredFilters` visits any `FILTER_KEYS` key it
    // reaches, whatever its shape) — so the off-spec author is still judged
    // here, and gets this located error beside the schema refusal rather than
    // nothing. It is also the only measurement of the page walk that `pages`
    // in `EMPTY_COMBINATOR_SURFACES` declares: drop it and that surface is
    // declared and unmeasured.
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
  const identityCases = FILTER_LOGIC_CASES.filter((c) => (c.note ?? '').includes('every face reduces an empty combinator to its boolean identity'));

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

describe('[#22161] one-line verdicts — filter-empty-combinator, filter-empty-node', () => {
  const CONVERTED = [FILTER_EMPTY_COMBINATOR, FILTER_EMPTY_NODE];

  it('every verdict the cases above fired is one line of at most 200 characters', () => {
    const converted = fired.filter((f) => CONVERTED.includes(f.rule));
    // The coverage control first: both ids fired, the combinator id on all
    // three shapes and the node id at all three positions.
    expect([...new Set(converted.map((f) => f.rule))].sort()).toEqual([...CONVERTED].sort());
    const combinator = converted.filter((f) => f.rule === FILTER_EMPTY_COMBINATOR);
    for (const shape of ['`$and: []`', '`$or: []`', '`$not: {}`']) {
      expect(combinator.some((f) => f.message.startsWith(shape)), shape).toBe(true);
    }
    const node = converted.filter((f) => f.rule === FILTER_EMPTY_NODE);
    for (const opening of ['An EMPTY filter node', 'An EMPTY branch (`{}`) of a `$or`', 'An EMPTY branch (`{}`) of a `$and`']) {
      expect(node.some((f) => f.message.startsWith(opening)), opening).toBe(true);
    }
    for (const f of converted) {
      expect(f.message, f.rule).not.toContain('\n');
      expect(f.message.length, `${f.rule}: ${f.message}`).toBeLessThanOrEqual(200);
    }
  });

  it('reads as one sentence per shape and position', () => {
    const verdict = (filter: unknown) => validateEmptyCombinators(widgetStack(filter))[0]!.message;
    expect(verdict({ $and: [] })).toBe(
      '`$and: []` is a conjunction of ZERO conditions, which every backend reduces to its identity, so it ' +
        'matches EVERY row: this surface reads as filtered and is not',
    );
    expect(verdict({ $or: [] })).toBe(
      '`$or: []` is a disjunction of ZERO branches, which every backend reduces to its identity, so it ' +
        'matches NO row: this surface renders permanently empty',
    );
    expect(verdict({ $not: {} })).toBe(
      '`$not: {}` negates an EMPTY node, which is TRUE, so it matches NO row: the opposite of the ' +
        '"no filter" an empty operand looks like',
    );
    expect(verdict({})).toBe(
      'An EMPTY filter node (`{}`) is TRUE, so it matches EVERY row exactly as if the key were absent: a ' +
        'filter is declared and enforces nothing',
    );
    expect(verdict({ $or: [{ status: 'open' }, {}] })).toBe(
      'An EMPTY branch (`{}`) of a `$or` is TRUE, and one TRUE disjunct ABSORBS the disjunction (it ' +
        'matches EVERY row), so every branch written beside it is dead',
    );
    expect(verdict({ $and: [{ status: 'open' }, {}] })).toBe(
      'An EMPTY branch (`{}`) of a `$and` is TRUE, the AND identity, so it contributes no condition and ' +
        'the conjunction means whatever its other branches mean',
    );
  });

  it('`os explain` carries what the verdicts no longer say', () => {
    const facts: Record<string, string[]> = {
      [FILTER_EMPTY_COMBINATOR]: [
        'on a read scope, hides every row',
        'fail-closed by design',
        'not an authoring surface',
      ],
      [FILTER_EMPTY_NODE]: [
        'silently narrow the scope',
        'lost in an edit',
      ],
    };
    for (const [rule, list] of Object.entries(facts)) {
      const entry = explainRule(rule);
      expect(entry, `no \`os explain ${rule}\` entry`).toBeDefined();
      const text = entry!.paragraphs.join('\n');
      for (const fact of list) expect(text, `${rule} explanation names ${fact}`).toContain(fact);
    }
    // The identity table and the scope are one text each under both ids.
    const [combinator, node] = CONVERTED.map((rule) => explainRule(rule)!.paragraphs);
    expect(combinator![0]).toBe(node![0]);
    expect(combinator!.at(-1)).toBe(node!.at(-1));
  });

  it('the explanation\'s identity table is the shared reduction\'s', () => {
    // The explanation module imports nothing, so the row sets it writes out
    // are held to `reduceFilterVerdict` here, the same function the verdicts
    // derive their words from.
    const identities = explainRule(FILTER_EMPTY_COMBINATOR)!.paragraphs[0]!;
    expect(reduceFilterVerdict({ $and: [] })).toBe('true');
    expect(reduceFilterVerdict({})).toBe('true');
    expect(identities).toContain('`{ $and: [] }` and `{}` reduce to TRUE and match EVERY row');
    expect(reduceFilterVerdict({ $or: [] })).toBe('false');
    expect(reduceFilterVerdict({ $not: {} })).toBe('false');
    expect(identities).toContain('`{ $or: [] }` and `{ $not: {} }` reduce to FALSE and match NO row');
  });

  it('the explanation names every filter key the walk visits', () => {
    const scope = explainRule(FILTER_EMPTY_COMBINATOR)!.paragraphs.at(-1)!;
    for (const key of FILTER_KEYS) expect(scope, key).toContain(`\`${key}\``);
  });
});

// [#22161] Slice 11: the `fix:` line. `filter-empty-combinator` names its
// remedy in one line per shape; the declared match-none spelling and the
// programmatic-producer note are its explanation's. (`filter-empty-node` keeps
// its longer root-arm hint: a later slice's.)
describe('[#22161] one-line fixes — filter-empty-combinator', () => {
  it('every `fix:` line of the id the cases above fired is one line of at most 200 characters', () => {
    const converted = fired.filter((f) => f.rule === FILTER_EMPTY_COMBINATOR);
    // Coverage control: all three shapes fired.
    for (const shape of ['$and', '$or', '$not']) {
      expect(converted.some((f) => f.message.startsWith(`\`${shape}`)), shape).toBe(true);
    }
    for (const f of converted) {
      expect(f.hint, f.rule).not.toContain('\n');
      expect(f.hint.length, `${f.rule}: ${f.hint}`).toBeLessThanOrEqual(200);
    }
  });

  it('`os explain` carries what the `fix:` lines no longer say', () => {
    const text = explainRule(FILTER_EMPTY_COMBINATOR)!.paragraphs.join('\n');
    expect(text).toContain('`{ <field>: { $in: [] } }` is the declared spelling');
    expect(text).toContain('A PROGRAMMATIC producer that loops to zero operands keeps the runtime identity unchanged');
  });
});
