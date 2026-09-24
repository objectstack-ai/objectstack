// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20020] Four filter-refusal doors of this driver read the #8220
 * filter-subtree provenance mark, like the cross-field (#7929) and target-field
 * (#8197) families already did.
 *
 * ## What was measured before this file existed
 *
 * A read scope — an RLS / sharing / tenant predicate a merge boundary ANDs into
 * the caller's `where` and marks `'policy'` (`markFilterSubtreeProvenance`,
 * `@objectstack/spec/data`) — that one of these four doors refused came back as
 * an `INVALID_FILTER` / 400 whose message named the policy's field, and for
 * three of them its comparand too. Measured end to end on both merge faces
 * (the analytics `POST /api/v1/analytics/query` route, and an ObjectQL `find`
 * under a plugin-security-shaped merge): the column a policy names when the
 * table has none, a retired or unknown operator, a combinator whose operand is
 * not a list, and a non-boolean `$null` / `$exists`.
 *
 * ## The contract these pins hold
 *
 * `filter-subtree-provenance.ts`, the `'policy'` literal: "A refusal raised
 * from inside it keeps the #7929 redaction: identity (`INVALID_FILTER` / 400)
 * and capability statement on the wire, operands in the server log." And the
 * fail direction: "Unmarked or ambiguous ⇒ withheld." So, per door:
 *
 *  - policy-marked ⇒ the same code and status, a message that names neither the
 *    field nor the comparand, and the full diagnostic in the server log;
 *  - author-marked ⇒ the full diagnostic, which is exactly the text the door
 *    answered every caller with before (asserted as equal to the logged
 *    diagnostic of the withheld population, which is that text);
 *  - unmarked ⇒ byte-identical to policy;
 *  - inside a merged `$and`, the REFUSING arm's mark decides, never the root's
 *    or a sibling's.
 *
 * Both merge boundaries hand this driver the same shape — the caller's arm and
 * the scope arm under one unmarked `$and`, each arm marked on its own object —
 * so the merged cases below are what each face produces at this layer.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SqlDriver } from './index.js';
import { markFilterSubtreeProvenance, type FilterCondition } from '@objectstack/spec/data';

interface WireBearingError extends Error {
  code?: string;
  status?: number;
}

/** A column the policy names, and a literal no caller may learn. */
const POLICY_COL = 'secret_policy_col';
/** A column the policy names that the TABLE lacks (schema drift). */
const MISSING_COL = 'secret_missing_col';
const SECRET = 'PSECRET_LITERAL';

describe('[#20020] four refusal doors × filter-subtree provenance', () => {
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
          [POLICY_COL]: { type: 'text', name: POLICY_COL },
        },
      } as any,
    ]);
    await driver.create('deal', { id: '1', stage: 'won', [POLICY_COL]: 'a' });
    logged = [];
    (driver as unknown as { logger: unknown }).logger = {
      warn: (m: string) => { logged.push(String(m)); },
      error: () => {},
      info: () => {},
      debug: () => {},
    };
  });

  const refusalOf = async (
    where: unknown,
    verb: 'find' | 'count' = 'find',
  ): Promise<WireBearingError> => {
    try {
      if (verb === 'count') await driver.count('deal', { where: where as FilterCondition });
      else await driver.find('deal', { fields: ['id'], where: where as FilterCondition });
    } catch (e) {
      return e as WireBearingError;
    }
    throw new Error('expected the driver to refuse this filter, but it resolved');
  };

  /**
   * One row per door, each `where` a THUNK: `markFilterSubtreeProvenance`
   * writes a non-writable, first-mark-wins mark, so every population needs its
   * own object graph.
   *
   * `secrets` are what the author gets back and nobody else may read;
   * `klass` is a fragment of the class statement, which survives redaction.
   * `logsAuthorText` is false for the one door whose server-log line is the
   * DIALECT's message (it names the column too) rather than the composed text.
   */
  const DOORS: ReadonlyArray<{
    readonly name: string;
    readonly where: () => Record<string, unknown>;
    readonly secrets: readonly string[];
    readonly klass: string;
    readonly logsAuthorText?: false;
  }> = [
    {
      name: 'a column the table lacks (the #8790 refusal)',
      where: () => ({ [MISSING_COL]: SECRET }),
      secrets: [MISSING_COL],
      klass: 'names a column the database could not resolve',
      logsAuthorText: false,
    },
    {
      name: 'a RETIRED operator',
      where: () => ({ [POLICY_COL]: { $regex: `^${SECRET}` } }),
      secrets: [POLICY_COL, '$regex'],
      klass: 'is RETIRED',
    },
    {
      name: 'an operator outside the vocabulary',
      where: () => ({ [POLICY_COL]: { $sounds_like: SECRET } }),
      secrets: [POLICY_COL, '$sounds_like'],
      klass: 'not one this driver evaluates',
    },
    {
      name: 'a combinator whose operand is an OBJECT',
      where: () => ({ $or: { [POLICY_COL]: SECRET } }),
      secrets: [POLICY_COL, SECRET],
      klass: 'requires an array of filter conditions',
    },
    {
      name: 'a combinator whose operand is a PRIMITIVE',
      where: () => ({ $and: SECRET }),
      secrets: [SECRET],
      klass: 'requires an array of filter conditions',
    },
    {
      name: 'a non-boolean $null',
      where: () => ({ [POLICY_COL]: { $null: SECRET } }),
      secrets: [POLICY_COL, SECRET],
      klass: 'Operator "$null" in this filter requires a boolean comparand',
    },
    {
      name: 'a non-boolean $exists',
      where: () => ({ [POLICY_COL]: { $exists: SECRET } }),
      secrets: [POLICY_COL, SECRET],
      klass: 'Operator "$exists" in this filter requires a boolean comparand',
    },
  ];

  const expectWithheld = (err: WireBearingError, secrets: readonly string[], klass: string) => {
    expect(err.code).toBe('INVALID_FILTER');
    expect(err.status).toBe(400);
    for (const secret of secrets) expect(err.message, `names "${secret}"`).not.toContain(secret);
    expect(err.message).toContain(klass);
    expect(err.message).not.toContain('[sql-driver]');
    // Relocated, not deleted: every secret is in the server log.
    for (const secret of secrets) expect(logged.join('\n'), `log lost "${secret}"`).toContain(secret);
  };

  for (const door of DOORS) {
    describe(door.name, () => {
      it('policy-marked ⇒ same code and status, operands WITHHELD, and in the server log', async () => {
        const err = await refusalOf(markFilterSubtreeProvenance(door.where(), 'policy'));
        expectWithheld(err, door.secrets, door.klass);
      });

      it('author-marked ⇒ the full diagnostic, the text the withheld case logged', async () => {
        const policy = await refusalOf(markFilterSubtreeProvenance(door.where(), 'policy'));
        const log = logged.join('\n');
        logged = [];
        const author = await refusalOf(markFilterSubtreeProvenance(door.where(), 'author'));
        expect(author.code).toBe('INVALID_FILTER');
        expect(author.status).toBe(400);
        for (const secret of door.secrets) expect(author.message).toContain(secret);
        expect(author.message).not.toBe(policy.message);
        // The author's text is the diagnostic the policy population only logged.
        if (door.logsAuthorText !== false) expect(log).toContain(author.message);
      });

      it('UNMARKED ⇒ withheld, byte-identical to policy — the fail direction', async () => {
        const unmarked = await refusalOf(door.where());
        expectWithheld(unmarked, door.secrets, door.klass);
        const policy = await refusalOf(markFilterSubtreeProvenance(door.where(), 'policy'));
        expect(unmarked.message).toBe(policy.message);
      });

      it("merged $and: the refusing arm's mark decides — author arm discloses, policy arm does not", async () => {
        const disclosed = await refusalOf({
          $and: [
            markFilterSubtreeProvenance({ stage: 'won' }, 'policy'),
            markFilterSubtreeProvenance(door.where(), 'author'),
          ],
        });
        for (const secret of door.secrets) expect(disclosed.message).toContain(secret);

        logged = [];
        const withheld = await refusalOf({
          $and: [
            markFilterSubtreeProvenance({ stage: 'won' }, 'author'),
            markFilterSubtreeProvenance(door.where(), 'policy'),
          ],
        });
        expectWithheld(withheld, door.secrets, door.klass);
      });
    });
  }

  describe('the column-name door locates its node by NAME, and fails closed', () => {
    it('count() answers the same verdicts as find()', async () => {
      const policy = await refusalOf(markFilterSubtreeProvenance({ [MISSING_COL]: SECRET }, 'policy'), 'count');
      expectWithheld(policy, [MISSING_COL], 'names a column the database could not resolve');
      const author = await refusalOf(markFilterSubtreeProvenance({ [MISSING_COL]: SECRET }, 'author'), 'count');
      expect(author.message).toContain(MISSING_COL);
    });

    it('named by BOTH an author arm and a policy arm ⇒ withheld', async () => {
      const err = await refusalOf({
        $and: [
          markFilterSubtreeProvenance({ [MISSING_COL]: 'mine' }, 'author'),
          markFilterSubtreeProvenance({ [MISSING_COL]: SECRET }, 'policy'),
        ],
      });
      expectWithheld(err, [MISSING_COL], 'names a column the database could not resolve');
    });

    it('an author arm naming a DIFFERENT column does not vouch for the one refused', async () => {
      const err = await refusalOf({
        $and: [
          markFilterSubtreeProvenance({ stage: 'won' }, 'author'),
          markFilterSubtreeProvenance({ [MISSING_COL]: SECRET }, 'policy'),
        ],
      });
      expectWithheld(err, [MISSING_COL], 'names a column the database could not resolve');
    });
  });

  describe('the combinator door finds the node that carries the key', () => {
    it('a primitive operand nested in an author arm is the author arm', async () => {
      const err = await refusalOf({
        $or: [
          markFilterSubtreeProvenance({ stage: 'won' }, 'policy'),
          markFilterSubtreeProvenance({ $and: [{ $or: SECRET }] }, 'author'),
        ],
      });
      expect(err.message).toContain(SECRET);
      expect(err.message).toContain('filter.$or[1].$and[0].$or');
    });

    it('the same primitive operand nested in a policy arm is withheld', async () => {
      const err = await refusalOf({
        $or: [
          markFilterSubtreeProvenance({ stage: 'won' }, 'author'),
          markFilterSubtreeProvenance({ $and: [{ $or: SECRET }] }, 'policy'),
        ],
      });
      expectWithheld(err, [SECRET, 'filter.$or[1]'], 'requires an array of filter conditions');
    });

    it('under $not the operand node is found too', async () => {
      const err = await refusalOf(markFilterSubtreeProvenance({ $not: { $and: SECRET } }, 'author'));
      expect(err.message).toContain('filter.$not.$and');
    });
  });
});
