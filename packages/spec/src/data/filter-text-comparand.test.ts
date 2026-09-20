// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#18113] The text-comparand door, driven against the table it answers.
 *
 * `filter-text-conformance.test.ts` proves `FILTER_TEXT_CASES` is internally
 * honest. This file proves the PREDICATE and the REASON published beside it
 * answer that same table — the two halves are only worth publishing together
 * if they cannot drift apart, and a predicate written from the rows by hand is
 * exactly how they drift.
 *
 * Both pins are driven from the table rather than from a transcribed list, so a
 * row added to `FILTER_TEXT_CASES` arrives here automatically.
 */

import { describe, it, expect } from 'vitest';
import {
  FILTER_TEXT_CASES,
  FILTER_TEXT_ROWS,
  type FilterTextCase,
  type FilterTextRejectionCase,
} from './filter-text-conformance';
import { isRefusedTextComparand, textComparandRefusalReason } from './filter-text-comparand';
// Entry reachability, the ruling's actual unblock criterion: the objectui half
// is gated on the INSTALLED `@objectstack/spec` exporting these two names, so
// the barrel hop is pinned here and `check:api-surface` covers the built face.
import * as dataEntry from './index';

/** The operator this door is scoped to, in the two spellings that can ARRIVE. */
const ARRIVING_SPELLINGS = ['$icontains', 'icontains'] as const;

const isRejection = (c: FilterTextCase): c is FilterTextRejectionCase =>
  'expectRejection' in c && c.expectRejection === true;

/** Every (field, operator, comparand) triple a case's filter carries. */
function comparands(c: FilterTextCase): Array<{ field: string; operator: string; target: unknown }> {
  const out: Array<{ field: string; operator: string; target: unknown }> = [];
  for (const [field, ops] of Object.entries(c.filter as Record<string, Record<string, unknown>>)) {
    for (const [operator, target] of Object.entries(ops)) out.push({ field, operator, target });
  }
  return out;
}

/** The case-insensitive contains operator, in whichever dialect the row is written. */
const isTheOperator = (operator: string) => operator === '$icontains' || operator === 'icontains';

// ---------------------------------------------------------------------------
// 1. The predicate answers EXACTLY the two declared REJECTION rows
// ---------------------------------------------------------------------------

describe('#18113 — isRefusedTextComparand, driven through every FILTER_TEXT_CASES case', () => {
  it('the table still carries both verdicts, so this suite is not vacuous', () => {
    expect(FILTER_TEXT_CASES.filter(isRejection).length).toBeGreaterThan(0);
    expect(FILTER_TEXT_CASES.filter((c) => !isRejection(c)).length).toBeGreaterThan(0);
  });

  for (const c of FILTER_TEXT_CASES) {
    const rejection = isRejection(c);
    it(`${rejection ? 'REJECTION' : 'rows'}: ${c.name}`, () => {
      for (const { operator, target } of comparands(c)) {
        // The door is scoped to ONE operator (the module's Scope section). A
        // comparand on any other operator is not its question, and answering
        // one would be the widening-by-analogy the table reserves to itself.
        const expected = rejection && isTheOperator(operator);
        expect(
          isRefusedTextComparand(target),
          `${c.name} — comparand ${JSON.stringify(target) ?? String(target)} on '${operator}'`,
        ).toBe(expected);
      }
    });
  }

  it('answers TRUE for exactly the two rows the table declares refused for this operator', () => {
    // The whole-table reading, stated as a set rather than per case: whatever
    // rows arrive later, the predicate's TRUE set must stay equal to the
    // REJECTION rows written in this operator's dialect.
    const trueFor = FILTER_TEXT_CASES
      .filter((c) => comparands(c).some(({ target }) => isRefusedTextComparand(target)))
      .map((c) => c.name);
    const declared = FILTER_TEXT_CASES
      .filter((c) => isRejection(c) && comparands(c).some(({ operator }) => isTheOperator(operator)))
      .map((c) => c.name);
    expect(trueFor).toEqual(declared);
    expect(trueFor).toHaveLength(2);
  });

  it('answers FALSE for the RETIRED-operator rejections — they are a different door', () => {
    // Measured, and the reason the set above is not simply "every REJECTION
    // case": `$regex` / `$options` rows are refused because the OPERATOR is
    // retired (`RETIRED_FILTER_OPERATORS` carries their prescription), and
    // their comparands are perfectly ordinary non-empty strings. A predicate
    // that answered TRUE for them would be reporting the wrong repair.
    const retired = FILTER_TEXT_CASES.filter(
      (c) => isRejection(c) && !comparands(c).some(({ operator }) => isTheOperator(operator)),
    );
    expect(retired.length, 'the table still carries retired-operator rejections').toBeGreaterThan(0);
    for (const c of retired) {
      for (const { target } of comparands(c)) expect(isRefusedTextComparand(target), c.name).toBe(false);
    }
  });

  it('answers FALSE for every stored NAME in the fixture', () => {
    // The card's other half: nothing the fixture stores is a refused comparand,
    // so a face cannot pass this door by refusing its own test data. (`score` is
    // deliberately not asked — it is a STORED value, never a comparand; the
    // rows that aim a text operator at it are `expected: []`, not rejections.)
    for (const row of FILTER_TEXT_ROWS) expect(isRefusedTextComparand(row.name), row.name).toBe(false);
  });

  it('answers TRUE for `undefined` — the carve-out a caller owns, not a third row', () => {
    // Pinned because a vocabulary with an "absent" (a view rule whose operator
    // takes no comparand) must test absence BEFORE this door, and the module's
    // docblock promises exactly this answer to callers that do.
    expect(isRefusedTextComparand(undefined)).toBe(true);
    expect(FILTER_TEXT_CASES.filter(isRejection)).toHaveLength(5);
  });
});

// ---------------------------------------------------------------------------
// 2. The reason names each row's `mustMention` tokens, per ARRIVING spelling
// ---------------------------------------------------------------------------

describe('#18113 — textComparandRefusalReason names what the row requires', () => {
  const rows = FILTER_TEXT_CASES.filter(
    (c): c is FilterTextRejectionCase =>
      isRejection(c) && comparands(c).some(({ operator }) => isTheOperator(operator)),
  );

  for (const c of rows) {
    const { field, target } = comparands(c).find(({ operator }) => isTheOperator(operator))!;

    it(`${c.name} — the $-dialect spelling carries every mustMention token`, () => {
      const reason = textComparandRefusalReason(field, '$icontains', target);
      for (const token of c.mustMention) expect(reason, `${c.name} / ${token}`).toContain(token);
    });

    it(`${c.name} — the INFIX spelling names what arrived; the $ twin is the envelope's job`, () => {
      // ⚠️ Measured, and deliberate. `mustMention` is spelled in the `$` dialect
      // because the published rows' filters are. A view rule spells the same
      // operator `icontains`, and this function names the spelling that
      // ARRIVED — so the `$` token is NOT in the contract half for that
      // dialect. The face serving that vocabulary names the `$` twin in its own
      // tail (objectui#9152 does exactly this); prescribing it here would send
      // a view author looking for a key their metadata cannot contain.
      const reason = textComparandRefusalReason(field, 'icontains', target);
      for (const token of c.mustMention) {
        expect(reason, `${c.name} / ${token} without its dialect sigil`).toContain(token.replace(/^\$/, ''));
        expect(reason, `${c.name} / the $ twin is NOT substituted for what arrived`).not.toContain(token);
      }
    });

    for (const operator of ARRIVING_SPELLINGS) {
      it(`${c.name} — '${operator}' arrives verbatim, never a canonical substitute`, () => {
        const reason = textComparandRefusalReason(field, operator, target);
        expect(reason).toContain(`on operator '${operator}'`);
        expect(reason).toContain(`the declared comparand for '${operator}'`);
        expect(reason).toContain(`field '${field}'`);
      });

      it(`${c.name} — '${operator}' is seatable: no leading capital, no trailing period`, () => {
        // The shape contract each face depends on to seat this in its own
        // sentence. Both shipped faces read it mid-sentence.
        const reason = textComparandRefusalReason(field, operator, target);
        expect(reason[0]).toBe(reason[0]!.toLowerCase());
        expect(reason.endsWith('.')).toBe(false);
        expect(reason).toContain('INVALID_FILTER');
      });
    }
  }

  it('the two rows get DIFFERENT reasons — the empty string is not "not a string"', () => {
    const empty = textComparandRefusalReason('name', '$icontains', '');
    const nonString = textComparandRefusalReason('name', '$icontains', 42);
    expect(empty).not.toEqual(nonString);
    expect(empty).toContain('EMPTY STRING');
    expect(nonString).toContain('not a string');
  });

  it('the BYTES, transcribed — a reword is a different failure to honour the same row', () => {
    // `mustMention` cannot catch a reword: it only requires `$icontains`. These
    // are the bytes two objectui faces have shipped since objectui#8748 /
    // objectui#9001, which is what makes them the contract rather than prose.
    // ⛔ Change them only by changing the rows they answer.
    expect(textComparandRefusalReason('name', '$icontains', '')).toBe(
      "filter comparand for field 'name' on operator '$icontains' is the EMPTY STRING. "
      + 'Every value contains the empty substring, so evaluating it is a predicate that '
      + "constrains nothing. @objectstack/spec's FILTER_TEXT_CASES declares this shape "
      + "refused (INVALID_FILTER); the declared comparand for '$icontains' is a NON-EMPTY "
      + 'STRING. Drop the condition instead of sending an empty comparand',
    );
    expect(textComparandRefusalReason('name', '$icontains', 42)).toBe(
      "filter comparand for field 'name' on operator '$icontains' is number (42), not a "
      + "string. Coercing it would answer a query nobody wrote. @objectstack/spec's "
      + 'FILTER_TEXT_CASES declares this shape refused (INVALID_FILTER); the declared '
      + "comparand for '$icontains' is a NON-EMPTY STRING. Write the comparand as a string",
    );
  });

  it('describes a comparand JSON.stringify would THROW on, instead of throwing', () => {
    // The guard that travels with the text: on a throwing face a `TypeError`
    // raised while BUILDING the message escapes in the refusal's place.
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => textComparandRefusalReason('name', '$icontains', cyclic)).not.toThrow();
    expect(() => textComparandRefusalReason('name', '$icontains', 10n)).not.toThrow();
    expect(textComparandRefusalReason('name', '$icontains', 10n)).toContain('bigint');
    // `null` is reported as `null`, not as `object` — the typeof trap.
    expect(textComparandRefusalReason('name', '$icontains', null)).toContain('is null (null)');
    // `undefined` and symbols stay readable, which `JSON.stringify` alone does not.
    expect(textComparandRefusalReason('name', '$icontains', undefined)).toContain('undefined');
  });
});

// ---------------------------------------------------------------------------
// 3. Reachability — the ruling's unblock criterion is an EXPORT, not a merge
// ---------------------------------------------------------------------------

describe('#18113 — both names reach the data entry', () => {
  it('are re-exported from the barrel a consumer imports', () => {
    // objectui#9048 is `pm:blocked` until the INSTALLED `@objectstack/spec`
    // exports these. A module nothing re-exports satisfies the card's letter
    // and none of its purpose, so the hop is pinned rather than assumed.
    expect(typeof (dataEntry as Record<string, unknown>).isRefusedTextComparand).toBe('function');
    expect(typeof (dataEntry as Record<string, unknown>).textComparandRefusalReason).toBe('function');
  });

  it('and `describeComparand` deliberately does NOT — two new symbols, not three', () => {
    // ⚠️ Not a ban. #18113 declared TWO new exported symbols (Clause-② carrier),
    // so the helper stays internal. If a face needs to describe a comparand in
    // its OWN envelope text, export it in the PR that needs it and say so, so
    // the addition is a decision rather than a side effect of `export *`.
    expect(Object.prototype.hasOwnProperty.call(dataEntry, 'describeComparand')).toBe(false);
  });
});
