/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * A non-Date EXOTIC object in comparand position — objectui#8567.
 *
 * ## The defect
 *
 * The operator-object arm opens on `typeof value === 'object' &&
 * !Array.isArray(value)` and then iterates `Object.entries(value)`. Every
 * entry-less object therefore ran the loop body zero times and pushed NO
 * condition for its field. objectui#8555 closed exactly one door of that hole —
 * `Date`, which the spec rules IN as a literal comparand. Every other entry-less
 * object was still dropped:
 *
 *     { status: 'a', created: /abc/ }        ->  ['status', '=', 'a']
 *     { status: 'a', tags: new Set(['x']) }  ->  ['status', '=', 'a']
 *     { status: 'a', m: new Map() }          ->  ['status', '=', 'a']
 *
 * Nothing threw, nothing warned, and the result set got WIDER than the author
 * asked for — the one failure direction this file exists to avoid. As with the
 * Date half, the field's fate depended on its SIBLINGS: with the exotic value
 * alone, `conditions` ended empty and the ORIGINAL OBJECT came back untouched,
 * so the defect was invisible until a second field appeared. Section 2 pins that
 * asymmetry closed.
 *
 * ## The ruling — REFUSE, and the spec is what decides that
 *
 * The opposite answer to objectui#8555 on the same arm, for the opposite reason:
 * there the spec rules the shape IN, here it rules it OUT. Measured against
 * `@objectstack/spec` 17.3.0 (declared floor `^17.2.0`), and pinned in section 3:
 * `isAcceptedFilterComparand(/x/)` is `false`, and
 * `normalizeFilterComparandTypes({ created: /x/ })` refuses with
 * `INVALID_FILTER` / 400 — *"Filter comparand at where.created is a RegExp
 * instance ({}), which no driver can compare."* Lowering it would only move that
 * refusal downstream; dropping it is the defect itself. So the refusal lands
 * HERE, where the field name and the offending value are both still in hand.
 *
 * ## Which refusal CLASS this is — read, not inherited
 *
 * `filter-converter.ts` carries seven `FilterOperatorError` throws, and they are
 * not one class (each was read, not counted):
 *
 *   - `$regex` and the unknown-operator arm — operator VOCABULARY: the spelling
 *     is absent from the spec's `FILTER_OPERATORS`, so there is nothing to
 *     translate it into;
 *   - `$not` — AST EXPRESSIVENESS: the spec DECLARES it, but the array dialect
 *     this file emits has no negation keyword;
 *   - the two `lowerLogicalGroup` throws — combinator ARGUMENT shape, against
 *     the spec's declared `'$and?: FilterCondition[]'`;
 *   - the bare-array arm and the stored-rule arity arm — comparand SHAPE, argued
 *     from downstream behaviour precisely because the spec DECLINES to rule
 *     (`assertListComparandShapes` rules only on `$in` / `$nin` / `$between`).
 *
 * This one is none of those: it is a comparand TYPE the spec itself rejects. So
 * the `$regex` / `$not` message idiom ("this layer has no target for your
 * operator") is deliberately NOT copied — it would answer a question nobody
 * asked. What IS shared is the error TYPE, and on a measurement rather than on
 * the name: four of the seven existing throws are already non-operator refusals,
 * because what `FilterOperatorError` actually transports is the `INVALID_FILTER`
 * / 400 envelope `classifyLoadError` reads. Section 4 pins both halves.
 *
 * ## The one shape that must NOT be swept up
 *
 * An empty operator object `{}` is the TRUE identity, constrains nothing, and is
 * deliberate (objectui#5322, pinned in `filter-date-comparand-8555.test.ts`
 * section 4). It has no own entries either — which is exactly why the gate is
 * the PROTOTYPE and not `Object.keys(value).length === 0`: that count cannot
 * tell `{}` from `/x/`, and the two need opposite answers. Section 5 is the
 * control, and it must stay green in every ablation leg.
 *
 * ⚠️ UPDATED by objectui#10788: an empty operator map is now refused alone or
 * beside a key that lowers; the bare `{}` filter above is the only shape still
 * read as the TRUE identity.
 *
 * ## What carries the weight — two legs, RUN against the committed tree
 *
 * Each was applied to the COMMITTED implementation, proved on disk before it was
 * run (`git hash-object` moved off the `HEAD` blob, and the anchored marker count
 * went 1 -> 0 for the removal and 0 -> 1 for the injection), and restored BY
 * STATE afterwards (`git diff HEAD` empty and the blob back at `5ba58fb`). No
 * rebuild is involved and none is needed: `vitest.config.mts` aliases
 * `@object-ui/core` to `packages/core/src`, so these files execute the SOURCE and
 * there is no `dist/` hop a stale build could make silently green.
 *
 * 1. **Ablation** — the refusal branch removed (16 lines). 10 of 34 red, across
 *    BOTH files. MODE: the refusal is MISSING and it fails as the defect itself —
 *    `convertFiltersToAST({ created: /abc/ })` hands back `{ created: /abc/ }`,
 *    the original object, because `conditions` ended empty. Every control stayed
 *    GREEN, both `{}` identity pins included.
 * 2. **`Object.keys(value).length === 0` as the gate** — the caricature this arm
 *    has to be distinguishable from, and the one a reader reaches for first. 4 of
 *    34 red. MODE: over-refusal — `{}` is swept up and the TRUE identity becomes
 *    a throw, so BOTH `{}` controls redden (this file's and
 *    filter-date-comparand-8555.test.ts's), together with the `Money`
 *    counter-case and the message pin. That is the leg that proves the control is
 *    a control: it moves when the change is WRONG, and does not move when the
 *    subject is merely absent.
 */

import { describe, it, expect } from 'vitest';
import { runInNewContext } from 'node:vm';
import {
  isAcceptedFilterComparand,
  normalizeFilterComparandTypes,
  ACCEPTED_FILTER_COMPARAND_TYPES_SENTENCE,
} from '@objectstack/spec/data';
import {
  convertFiltersToAST,
  toFilterNode,
  mergeFilterNodes,
  FilterOperatorError,
} from '../filter-converter';

const D = new Date('2026-01-01T00:00:00.000Z');

/** The envelope every refusal in this file must carry — never a bare `Error`. */
const INVALID_FILTER = { code: 'INVALID_FILTER', httpStatus: 400 };

/** Run `call` and hand back what it threw, or `undefined` if it returned. */
function refusalOf(call: () => unknown): { thrown: unknown; returned: unknown } {
  try {
    return { thrown: undefined, returned: call() };
  } catch (error) {
    return { thrown: error, returned: undefined };
  }
}

/**
 * The exotic comparands this arm has to answer for, each with the text its
 * refusal must name it by. `Object.entries` of every one of them is `[]` —
 * asserted below rather than asserted about, because that emptiness IS the
 * mechanism of the defect.
 */
class Money {
  readonly amount = 1;
}

const EXOTIC: ReadonlyArray<readonly [label: string, value: object, named: RegExp]> = [
  ['a RegExp', /abc/, /RegExp instance \(\/abc\/\)/],
  ['a Set', new Set(['x']), /Set instance/],
  ['a Map', new Map([['k', 'v']]), /Map instance/],
  ['a URL', new URL('https://example.dev/x'), /URL instance/],
  ['a class instance', new Money(), /Money instance/],
];

// ---------------------------------------------------------------------------
// 1. The refusal — loud, at this layer, naming the field and the value
// ---------------------------------------------------------------------------

describe('objectui#8567 — an exotic comparand is refused, not dropped', () => {
  it('refuses each exotic shape with the INVALID_FILTER / 400 envelope', () => {
    for (const [label, value] of EXOTIC) {
      const { thrown, returned } = refusalOf(() => convertFiltersToAST({ status: 'a', created: value }));
      expect(thrown, `${label} lowered to ${JSON.stringify(returned)} instead of being refused`)
        .toMatchObject(INVALID_FILTER);
      expect((thrown as Error).name).toBe('FilterOperatorError');
    }
  });

  it('names the field and describes the value the author actually wrote', () => {
    // `JSON.stringify` renders every one of these as `{}` — the spec's own
    // refusal prints `({})` for a RegExp for that reason — so the message is
    // held to naming the TYPE, and the pattern text where there is one.
    for (const [label, value, named] of EXOTIC) {
      const { thrown } = refusalOf(() => convertFiltersToAST({ created: value }));
      const message = (thrown as Error).message;
      expect(message, `${label}: the refusal does not name the offending value`).toMatch(named);
      expect(message, `${label}: the refusal does not name the field`).toMatch(/'created'/);
    }
  });

  it('refuses the LONE exotic field too — the sibling asymmetry is closed', () => {
    // Pre-fix, this was the invisible half: `conditions` ended empty, so the
    // `if (conditions.length === 0)` fallback returned the INPUT OBJECT and the
    // shape survived by accident.
    const { thrown, returned } = refusalOf(() => convertFiltersToAST({ created: /abc/ }));
    expect(returned).toBeUndefined();
    expect(thrown).toMatchObject(INVALID_FILTER);
  });

  it('refuses it wherever it sits — inside $and / $or, and through both public sinks', () => {
    expect(() => convertFiltersToAST({ $or: [{ created: /abc/ }, { status: 'open' }] }))
      .toThrow(/RegExp instance/);
    expect(() => convertFiltersToAST({ $and: [{ status: 'open' }, { created: /abc/ }] }))
      .toThrow(/RegExp instance/);
    expect(() => toFilterNode({ status: 'a', created: /abc/ })).toThrow(/RegExp instance/);
    expect(() => mergeFilterNodes({ created: /abc/ }, ['stage', '=', 'won'])).toThrow(/RegExp instance/);
  });

  it('is the emptiness of Object.entries that used to hide it — and the gate is not that emptiness', () => {
    // The mechanism, asserted rather than described: the built-in shapes have
    // zero own enumerable entries, which is why the operator loop ran zero times
    // and pushed nothing at all.
    expect(Object.entries(/abc/)).toEqual([]);
    expect(Object.entries(new Set(['x']))).toEqual([]);
    expect(Object.entries(new Map([['k', 'v']]))).toEqual([]);
    expect(Object.entries(new URL('https://example.dev/x'))).toEqual([]);

    // `Money` is the counter-case, and it is in the list on purpose: it HAS an
    // own entry, so the emptiness is not what the gate reads. Pre-fix it reached
    // the operator loop and was refused as an unknown operator named `amount` —
    // a refusal about the wrong thing. It is now refused as what it is.
    expect(Object.entries(new Money())).toEqual([['amount', 1]]);
    const message = (refusalOf(() => convertFiltersToAST({ price: new Money() })).thrown as Error).message;
    expect(message).toMatch(/Money instance/);
    expect(message).not.toMatch(/Unknown filter operator/);
  });
});

// ---------------------------------------------------------------------------
// 2. Why REFUSE and not lower — the spec's own ruling, pinned
// ---------------------------------------------------------------------------

describe('objectui#8567 — the spec rules these OUT, which is why this is a refusal', () => {
  it('rejects every one of them as a comparand', () => {
    for (const [label, value] of EXOTIC) {
      expect(isAcceptedFilterComparand(value), `${label} is not an accepted comparand`).toBe(false);
    }
    // The positive control: the one object-typed member the list does have.
    expect(isAcceptedFilterComparand(D)).toBe(true);
  });

  it('answers INVALID_FILTER / 400 for the same value one layer down', () => {
    // The refusal this layer now gives is the answer the wire would have given
    // two layers later — which is the whole argument for giving it here.
    const { thrown } = refusalOf(() => normalizeFilterComparandTypes({ created: /abc/ }));
    expect(thrown).toMatchObject({ code: 'INVALID_FILTER' });
    expect((thrown as Error).message).toMatch(/no driver can compare/);
  });

  it('states the accepted types in the spec\'s own words, not a second list', () => {
    const { thrown } = refusalOf(() => convertFiltersToAST({ created: /abc/ }));
    expect((thrown as Error).message).toContain(ACCEPTED_FILTER_COMPARAND_TYPES_SENTENCE);
  });
});

// ---------------------------------------------------------------------------
// 3. The prescription — the message sends the author somewhere that works
// ---------------------------------------------------------------------------

describe('objectui#8567 — the refusal prescribes spellings that lower', () => {
  it('prescribes $contains / $in, and both of them really lower', () => {
    const { thrown } = refusalOf(() => convertFiltersToAST({ name: /abc/ }));
    const message = (thrown as Error).message;
    expect(message).toMatch(/\$contains/);
    expect(message).toMatch(/\$in/);
    // A prescription nothing checks is how a message goes stale: run them.
    expect(convertFiltersToAST({ name: { $contains: 'abc' } })).toEqual(['name', 'contains', 'abc']);
    expect(convertFiltersToAST({ name: { $in: ['a', 'b'] } })).toEqual(['name', 'in', ['a', 'b']]);
  });
});

// ---------------------------------------------------------------------------
// 4. The refusal CLASS — the shared envelope, and the message that is NOT
//    borrowed from the operator refusals
// ---------------------------------------------------------------------------

describe('objectui#8567 — the envelope is shared, the idiom is not', () => {
  it('carries the code and status classifyLoadError reads, like every other refusal here', () => {
    // A bare `Error` classifies as a NETWORK fault, which is the one thing this
    // is definitely not — see the FilterOperatorError declaration.
    for (const call of [
      () => convertFiltersToAST({ created: /abc/ }),
      () => convertFiltersToAST({ name: { $regex: 'a.c' } }),
      () => convertFiltersToAST({ tags: ['a'] }),
    ]) {
      expect(refusalOf(call).thrown).toMatchObject(INVALID_FILTER);
    }
  });

  it('answers the comparand-TYPE question, not the operator question', () => {
    // The discriminator against copying the `$regex` / `$not` idiom: those two
    // say an OPERATOR is unsupported. A reader who wrote `{ name: /abc/ }` used
    // no operator at all, so that sentence would answer nothing they asked.
    const message = (refusalOf(() => convertFiltersToAST({ name: /abc/ })).thrown as Error).message;
    expect(message).not.toMatch(/Unknown filter operator/);
    expect(message).not.toMatch(/is not supported/);
    expect(message).toMatch(/comparand/);
    // And it says what actually used to happen, because a silent widening is
    // the part an author cannot have observed.
    expect(message).toMatch(/WIDENING|dropped/);
  });
});

// ---------------------------------------------------------------------------
// 5. THE CONTROL — everything this refusal must not touch
// ---------------------------------------------------------------------------

describe('objectui#8567 — the identity and the operator path are untouched', () => {
  it('an EMPTY operator object is never read as an exotic comparand', () => {
    // The control for every ablation leg: `{}` is entry-less exactly like `/x/`,
    // and a fix gated on the key COUNT would sweep it up into THIS arm. That
    // fence stands: whatever `{}` answers, it is not this file's refusal.
    //
    // ⚠️ FLIPPED ON PURPOSE by objectui#10788. Beside a key that lowers this
    // row used to pin `['status', '=', 'a']` — the `created` key dropped and
    // the result WIDENED, the silent drop this file refuses for `/x/`.
    // `@objectstack/spec` records `{ field: {} }` as REJECTED by
    // objectstack#5240 in every position, so it is now refused as an EMPTY
    // OPERATOR MAP naming the field — never as an exotic comparand (envelope
    // pinned in filter-empty-operator-map-beside-key-10788.test.ts).
    const beside = refusalOf(() => convertFiltersToAST({ status: 'a', created: {} }));
    expect(beside.returned).toBeUndefined();
    expect(beside.thrown).toMatchObject({ ...INVALID_FILTER, field: 'created', operator: undefined });
    expect((beside.thrown as Error).message).not.toMatch(/comparand position/);
    // ⚠️ UPDATED. Alone it used to come back as the original object; since
    // objectui#9164 it is refused as an EMPTY OPERATOR MAP — the operator-map
    // arm's refusal, not this file's (envelope pinned in
    // filter-empty-operator-map-9164.test.ts).
    expect(() => convertFiltersToAST({ created: {} })).toThrow(FilterOperatorError);
  });

  it('a null-prototype bag is still an operator map, not an exotic value', () => {
    const bag = Object.create(null) as Record<string, unknown>;
    bag.$gte = 18;
    expect(convertFiltersToAST({ age: bag })).toEqual(['age', '>=', 18]);
  });

  it('a CROSS-REALM plain object is still an operator map', () => {
    // Its prototype is another realm's `Object.prototype`, so an identity test
    // against this realm's would refuse a perfectly plain object. The gate takes
    // the second hop instead: a plain object's prototype has a null prototype.
    const foreign = runInNewContext('({ $gte: 18 })') as Record<string, unknown>;
    expect(Object.getPrototypeOf(foreign)).not.toBe(Object.prototype);
    expect(convertFiltersToAST({ age: foreign })).toEqual(['age', '>=', 18]);
  });

  it('a Date comparand still LOWERS — the other half of this arm (objectui#8555)', () => {
    expect(convertFiltersToAST({ created: D })).toEqual(['created', '=', D]);
    expect(convertFiltersToAST({ status: 'a', created: D }))
      .toEqual(['and', ['status', '=', 'a'], ['created', '=', D]]);
  });

  it('operator objects, including ones CARRYING an exotic member, are unchanged', () => {
    // The refusal is about the field's VALUE. `{ created: { $gte: d } }` is a
    // plain object whose MEMBER is exotic; the loop owns that, and a Date member
    // lowers as it always did.
    expect(convertFiltersToAST({ age: { $gte: 18, $lte: 65 } }))
      .toEqual(['and', ['age', '>=', 18], ['age', '<=', 65]]);
    expect(convertFiltersToAST({ created: { $gte: D } })).toEqual(['created', '>=', D]);
    expect(convertFiltersToAST({ status: { $in: ['a', 'b'] } })).toEqual(['status', 'in', ['a', 'b']]);
    expect(convertFiltersToAST({ deleted: { $null: true } })).toEqual(['deleted', 'is_null', true]);
  });

  it('the other refusals still answer with their OWN messages', () => {
    expect(() => convertFiltersToAST({ name: { $regex: 'a.c' } })).toThrow(/\$regex/);
    expect(() => convertFiltersToAST({ tags: ['a'] })).toThrow(/bare ARRAY/);
    expect(() => convertFiltersToAST({ $not: { status: 'open' } })).toThrow(/\$not/);
  });

  it('scalars, null and undefined are exactly what they were', () => {
    expect(convertFiltersToAST({ status: 'active' })).toEqual(['status', '=', 'active']);
    expect(convertFiltersToAST({ count: 0, ok: false }))
      .toEqual(['and', ['count', '=', 0], ['ok', '=', false]]);
    // UPDATED by objectui#9020 — an all-skipped filter answers "no constraint"
    // rather than handing back the caller's object. The skip itself, which is
    // what this control guards, is unchanged: the sibling case below is the
    // half that would redden if this card had made null keys meaningful.
    expect(convertFiltersToAST({ a: null, b: undefined })).toBeUndefined();
    expect(convertFiltersToAST({ a: null, status: 'active' })).toEqual(['status', '=', 'active']);
  });
});
