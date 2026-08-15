// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#8197, maintainer ruling 2026-08-15] The TARGET-FIELD half of the withhold:
 * the five non-cross-field `INVALID_FILTER` refusals that named the refused
 * constraint's own column now consume the same #8220 provenance mark the
 * cross-field family does.
 *
 * ## Why the discrimination is the subject, not the withhold
 *
 * A suite that only checked "a policy predicate is redacted" would pass just as
 * well against a driver that redacted EVERY caller — which is the blanket cost
 * the ruling explicitly refused, and the shape #7929's triage rejected before
 * it. So every refusal below is run against all THREE populations in one table:
 *
 *  1. **policy-marked** ⇒ the target field is withheld;
 *  2. **author-marked** ⇒ the full diagnostic comes back, target field included;
 *  3. **unmarked** ⇒ withheld, byte-identically to policy.
 *
 * (3) is the fail direction and the case most easily lost: the mark is
 * permission to REVEAL, never a requirement to prove secrecy, so a missing mark
 * must never land on the disclosing branch. It is pinned as byte-equality with
 * (1) rather than as "does not contain the column", because a message that
 * merely happened to omit the name today would satisfy the weaker assertion.
 *
 * ## The measured population
 *
 * The five refusals are the ones the card measured on a real `SqlDriver`
 * (better-sqlite3, `:memory:`) through `driver.find`, each answering
 * `INVALID_FILTER` / 400 while naming the target column. Each is a predicate an
 * administrator's CEL rule can plausibly produce; the JSON-column gate leads
 * because a permission rule over a `multiple: true` field lowers to exactly that
 * membership test.
 *
 * The merged-`$and` spelling is included deliberately at the end: it is where an
 * implementation that resolved the WRONG subtree — the tree root, or the local
 * branch instead of the query's `where` root — still passes every single-arm
 * case above and fails the only one that matters in production, since a merge
 * boundary never hands the driver anything else.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SqlDriver } from './index.js';
import { markFilterSubtreeProvenance, type FilterCondition } from '@objectstack/spec/data';

interface WireBearingError extends Error {
  code?: string;
  status?: number;
}

/** The column an administrator's rule targets, and the one no tenant may learn. */
const POLICY_JSON_COL = 'secret_policy_col';
const POLICY_NUM_COL = 'secret_amount_col';

describe('[#8197] target-field refusals × filter-subtree provenance', () => {
  let driver: SqlDriver;
  let logged: string[];

  beforeEach(async () => {
    driver = new SqlDriver({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    await driver.initObjects([
      {
        name: 'deal',
        fields: {
          id: { type: 'text', name: 'id' },
          stage: { type: 'text', name: 'stage' },
          // `multiple: true` ⇒ stored as a JSON TEXT column, which is what makes
          // the #7398 gate — the most reachable member of this family — fire.
          [POLICY_JSON_COL]: { type: 'text', name: POLICY_JSON_COL, multiple: true },
          [POLICY_NUM_COL]: { type: 'number', name: POLICY_NUM_COL },
        },
      } as any,
    ]);
    await driver.create('deal', { id: '1', stage: 'won', [POLICY_NUM_COL]: 10 });
    logged = [];
    (driver as unknown as { logger: unknown }).logger = {
      warn: (m: string) => { logged.push(String(m)); },
      error: () => {},
      info: () => {},
      debug: () => {},
    };
  });

  const refusalOf = async (where: unknown): Promise<WireBearingError> => {
    try {
      await driver.find('deal', { fields: ['id'], where: where as FilterCondition });
    } catch (e) {
      return e as WireBearingError;
    }
    throw new Error('expected the driver to refuse this filter, but it resolved');
  };

  /**
   * The five refusals, each as a THUNK: every population needs its own fresh
   * object graph, because `markFilterSubtreeProvenance` writes a non-writable
   * mark and "first mark wins" — a shared literal reused across cases would
   * carry the first population's verdict into the rest, and the suite would
   * agree with itself about nothing.
   *
   * `target` is the column name the message must name for an author and must
   * never name for anyone else.
   */
  const CASES: ReadonlyArray<{
    readonly name: string;
    readonly where: () => Record<string, unknown>;
    readonly target: string;
    /** A fragment of the CLASS statement, which survives redaction. */
    readonly klass: string;
  }> = [
    {
      name: 'JSON column + $in (#7398)',
      where: () => ({ [POLICY_JSON_COL]: { $in: ['usr_1111'] } }),
      target: POLICY_JSON_COL,
      klass: 'JSON TEXT column',
    },
    {
      name: 'JSON column, bare equality spelling (#7398)',
      where: () => ({ [POLICY_JSON_COL]: 'usr_1111' }),
      target: POLICY_JSON_COL,
      klass: 'JSON TEXT column',
    },
    {
      name: 'empty field constraint (#5240)',
      where: () => ({ [POLICY_JSON_COL]: {} }),
      target: POLICY_JSON_COL,
      klass: 'zero operators',
    },
    {
      name: 'unbindable comparand (#5041)',
      where: () => ({ [POLICY_NUM_COL]: { $gt: { a: 1 } } }),
      target: POLICY_NUM_COL,
      klass: 'cannot be bound as a SQL parameter',
    },
    {
      // A `{ $field }` whose referent is not a string is NOT a
      // `FieldReferenceSchema`, so the cross-field arm never recognises it and
      // it falls to the bind gate above — carrying the target column AND the
      // malformed reference's JSON into the message.
      name: 'malformed $field residual (#5041 catches what #5222 does not)',
      where: () => ({ [POLICY_NUM_COL]: { $gt: { $field: 42 } } }),
      target: POLICY_NUM_COL,
      klass: 'cannot be bound as a SQL parameter',
    },
    {
      name: '$between arity',
      where: () => ({ [POLICY_NUM_COL]: { $between: [1] } }),
      target: POLICY_NUM_COL,
      klass: 'requires a [min, max] value array',
    },
  ];

  for (const testCase of CASES) {
    describe(testCase.name, () => {
      it('policy-marked ⇒ the target field is WITHHELD, and reaches the log instead', async () => {
        const err = await refusalOf(markFilterSubtreeProvenance(testCase.where(), 'policy'));
        expect(err.code).toBe('INVALID_FILTER');
        expect(err.status).toBe(400);
        expect(err.message).not.toContain(testCase.target);
        // The refusal still says WHICH rule refused it — identity and class are
        // not derived from the predicate, so they are never withheld.
        expect(err.message).toContain(testCase.klass);
        expect(logged.join('\n')).toContain(testCase.target);
      });

      it('author-marked ⇒ the full diagnostic is retained, target field included', async () => {
        const err = await refusalOf(markFilterSubtreeProvenance(testCase.where(), 'author'));
        expect(err.code).toBe('INVALID_FILTER');
        expect(err.status).toBe(400);
        expect(err.message).toContain(testCase.target);
        expect(err.message).toContain(testCase.klass);
        // Restored on the wire ⇒ nothing left to relocate to the log.
        expect(logged.join('\n')).toBe('');
      });

      it('UNMARKED ⇒ withheld, byte-identically to policy — the fail direction', async () => {
        const unmarked = await refusalOf(testCase.where());
        logged = [];
        const policy = await refusalOf(markFilterSubtreeProvenance(testCase.where(), 'policy'));
        expect(unmarked.message).toBe(policy.message);
        expect(unmarked.code).toBe('INVALID_FILTER');
        expect(unmarked.status).toBe(400);
        expect(unmarked.message).not.toContain(testCase.target);
      });

      it("the author's arm inside a merged $and discloses; the policy arm beside it does not", async () => {
        // The only shape a merge boundary actually produces, and the one that
        // separates "resolved the refusing subtree" from "resolved the root".
        const authorArm = markFilterSubtreeProvenance(testCase.where(), 'author');
        const policyScope = markFilterSubtreeProvenance({ stage: 'won' }, 'policy');
        const disclosed = await refusalOf({ $and: [policyScope, authorArm] });
        expect(disclosed.message).toContain(testCase.target);

        // Mirrored: the REFUSING arm is the policy one, the author's arm is
        // benign. Same tree shape, opposite verdict — an implementation that
        // resolved the root, or the first marked arm it found, gets this wrong.
        logged = [];
        const policyArm = markFilterSubtreeProvenance(testCase.where(), 'policy');
        const authorBenign = markFilterSubtreeProvenance({ stage: 'won' }, 'author');
        const withheld = await refusalOf({ $and: [authorBenign, policyArm] });
        expect(withheld.message).not.toContain(testCase.target);
        expect(logged.join('\n')).toContain(testCase.target);
      });
    });
  }

  describe('the degradations, which all land on the withholding branch', () => {
    it('a serialization round-trip DROPS an author mark — the copy withholds', async () => {
      const marked = markFilterSubtreeProvenance(
        { [POLICY_JSON_COL]: { $in: ['usr_1111'] } },
        'author',
      );
      const err = await refusalOf(JSON.parse(JSON.stringify(marked)));
      expect(err.message).not.toContain(POLICY_JSON_COL);
      expect(logged.join('\n')).toContain(POLICY_JSON_COL);
    });

    it("the innermost mark wins: 'policy' nested under an 'author' root stays redacted", async () => {
      const scope = markFilterSubtreeProvenance({ [POLICY_JSON_COL]: {} }, 'policy');
      const where = markFilterSubtreeProvenance({ $and: [{ stage: 'won' }, scope] }, 'author');
      const err = await refusalOf(where);
      expect(err.message).not.toContain(POLICY_JSON_COL);
      expect(logged.join('\n')).toContain(POLICY_JSON_COL);
    });

    it('a subtree aliased under CONFLICTING marks is ambiguous and withholds', async () => {
      const shared = { [POLICY_NUM_COL]: { $between: [1] } };
      const where = {
        $or: [
          markFilterSubtreeProvenance({ $and: [shared] }, 'author'),
          markFilterSubtreeProvenance({ $and: [shared] }, 'policy'),
        ],
      };
      const err = await refusalOf(where);
      expect(err.message).not.toContain(POLICY_NUM_COL);
    });
  });

  describe('what redaction takes, and what it must leave', () => {
    it('the comparand and the operator go with the field name — half a redaction is none', async () => {
      // #7929 withheld BOTH operands of a cross-field comparison because
      // echoing one would leave half the disclosure live. A comparand preview
      // is the administrator's literal just as surely as a column name is.
      const err = await refusalOf({ [POLICY_NUM_COL]: { $gt: { policy_literal: 'nato' } } });
      expect(err.message).not.toContain(POLICY_NUM_COL);
      expect(err.message).not.toContain('policy_literal');
      expect(err.message).not.toContain('nato');
      expect(err.message).not.toContain('$gt');
      expect(logged.join('\n')).toContain('policy_literal');
    });

    it('the malformed reference is withheld together with its target', async () => {
      const err = await refusalOf({ [POLICY_NUM_COL]: { $gt: { $field: 42 } } });
      expect(err.message).not.toContain(POLICY_NUM_COL);
      expect(err.message).not.toContain('$field');
      expect(logged.join('\n')).toContain('$field');
    });

    it('the prescription survives redaction with PLACEHOLDER names — the shape IS the repair', async () => {
      const err = await refusalOf({ [POLICY_JSON_COL]: { $in: ['usr_1111'] } });
      expect(err.message).toContain('$contains');
      expect(err.message).toContain('{ "FIELD": { "$contains": "a" } }');
    });

    it('the ADR-0112 envelope is unchanged for every population', async () => {
      for (const mark of ['author', 'policy', null] as const) {
        const where = mark === null
          ? { [POLICY_JSON_COL]: {} }
          : markFilterSubtreeProvenance({ [POLICY_JSON_COL]: {} }, mark);
        const err = await refusalOf(where);
        expect(err.code, String(mark)).toBe('INVALID_FILTER');
        expect(err.status, String(mark)).toBe(400);
        // Driver-internal wording never reaches a client, whatever the mark.
        expect(err.message, String(mark)).not.toContain('[sql-driver]');
      }
    });
  });

  describe('the refusals outside this family are untouched', () => {
    it('an UNDECLARED operator still names its operator and field — it was never in the family', async () => {
      // The card's boundary: this refusal names the target too, and closing it
      // was NOT ruled here. Pinned so a later widening is a deliberate act with
      // a failing test in front of it, rather than a silent drift.
      const err = await refusalOf({ stage: { $overlaps: ['x'] } });
      expect(err.code).toBe('INVALID_FILTER');
      expect(err.message).toContain('$overlaps');
      expect(err.message).toContain('stage');
    });

    it('a filter that compiles is still compiled — the gate adds no refusal', async () => {
      const rows = await driver.find('deal', {
        fields: ['id'],
        where: { stage: 'won' } as FilterCondition,
      });
      expect(rows.map((r: any) => r.id)).toEqual(['1']);
    });
  });
});
