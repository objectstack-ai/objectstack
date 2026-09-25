// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20039] EVERY refusal on this driver's filter-compile path goes through the
 * #8220 withheld seam — and a builder added later that does not goes red here.
 *
 * ## What was measured before this file existed
 *
 * Eight more compile refusals than #20020 converted built their error with
 * `unsupportedFilterError` directly, so a read scope — an RLS / sharing /
 * tenant predicate a merge boundary ANDs into the caller's `where` and marks
 * `'policy'` — that one of them refused came back as an `INVALID_FILTER` / 400
 * naming the policy's field or literal. Measured through a real `ObjectQL` over
 * a real `SqlDriver` with a `plugin-security`-shaped merge (the scope in the
 * `'policy'` arm): an empty or non-string `$icontains`, a non-string `$like`, a
 * `$like` pattern with a trailing escape, an object `$contains` comparand, an
 * object `$in` member, an `undefined` comparand, a non-node element of `$or`,
 * an undeclared node combinator. A ninth, the array-root refusal, relays the
 * WHOLE array — every field and literal in it.
 *
 * ## The contract
 *
 * `filter-subtree-provenance.ts`, the `'policy'` literal: "A refusal raised
 * from inside it keeps the #7929 redaction: identity (`INVALID_FILTER` / 400)
 * and capability statement on the wire, operands in the server log." And the
 * fail direction: "Unmarked or ambiguous ⇒ withheld."
 *
 * ## Two halves, and why both
 *
 * 1. **The enumeration** reads `sql-driver.ts` and lists every function that
 *    builds an `INVALID_FILTER` error. Only three may call
 *    `unsupportedFilterError` directly (the seam itself, the `'author'`
 *    re-issue, and the column refusal raised from a dialect error AFTER the
 *    statement ran), and every caller of `withheldFilterError` must have a row
 *    in the table below. So a new compile refusal that bypasses the seam goes
 *    red on the first set, and one that uses the seam without a row goes red on
 *    the second — no door can disclose by omission.
 * 2. **The table** drives each of those builders under every mark: policy and
 *    unmarked withhold (same code and status, no secret on the wire, every
 *    secret in the log), author gets the full text, and inside a merged `$and`
 *    the refusing arm's mark decides in both arm orders. Each row proves it
 *    reached its builder by the error's own stack, so a row cannot silently
 *    drift onto a sibling door.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { SqlDriver } from './index.js';
import { markFilterSubtreeProvenance, type FilterCondition } from '@objectstack/spec/data';

interface WireBearingError extends Error {
  code?: string;
  status?: number;
}

/** A column a policy names, a column it references, and a literal no caller may learn. */
const POLICY_COL = 'secret_policy_col';
const REF_COL = 'secret_ref_col';
const JSON_COL = 'secret_tags';
const SECRET = 'PSECRET_LITERAL';
/** A literal for the doors whose comparand must NOT be a string. */
const SECRET_NUM = 7770123;
const UNDECLARED_KEY = '$psecret_combinator';

type Door = {
  /** The builder in `sql-driver.ts` this row drives — asserted by the error's stack. */
  readonly builder: string;
  readonly where: () => Record<string, unknown> | unknown[];
  readonly secrets: readonly string[];
  /** A fragment of the class statement, which survives redaction. */
  readonly klass: string;
  /** The author text adds a prescription the log line does not carry. */
  readonly authorExtendsLog?: true;
  /** The refusal fires only when the array IS the `where` root — no merged arm. */
  readonly rootOnly?: true;
};

const DOORS: readonly Door[] = [
  // ── #20039: the class this file closes ────────────────────────────────────
  {
    builder: 'icontainsComparandError',
    where: () => ({ [POLICY_COL]: { $icontains: SECRET_NUM } }),
    secrets: [POLICY_COL, String(SECRET_NUM)],
    klass: 'Operator "$icontains" in this filter requires a NON-EMPTY string comparand',
  },
  {
    builder: 'likePatternComparandError',
    where: () => ({ [POLICY_COL]: { $like: SECRET_NUM } }),
    // Both pattern operators are NAMED by the class statement ("$like" /
    // "$ilike"), so which one fired is not asserted absent; the field and the
    // comparand are.
    secrets: [POLICY_COL, String(SECRET_NUM)],
    klass: 'requires a string comparand',
  },
  {
    builder: 'danglingLikeEscapeError',
    where: () => ({ [POLICY_COL]: { $ilike: `${SECRET}\\` } }),
    secrets: [POLICY_COL, SECRET],
    klass: 'ending in a lone unpaired backslash',
  },
  {
    builder: 'unrenderableTextComparandError',
    where: () => ({ [POLICY_COL]: { $startsWith: { k: SECRET } } }),
    secrets: [POLICY_COL, SECRET, '$startsWith'],
    klass: 'matches against the TEXT of a pattern',
  },
  {
    builder: 'unbindableListMemberError',
    where: () => ({ [POLICY_COL]: { $nin: ['a', { k: SECRET }] } }),
    secrets: [POLICY_COL, SECRET, 'index 1'],
    klass: 'has a member that cannot be bound as a SQL parameter',
  },
  {
    builder: 'undefinedComparandError',
    where: () => ({ [POLICY_COL]: { $eq: undefined } }),
    secrets: [POLICY_COL],
    klass: 'A comparand in this filter is undefined',
  },
  {
    builder: 'assertFilterNode',
    where: () => ({ $or: [SECRET] }),
    secrets: [SECRET, '$or[0]'],
    klass: 'is not a filter condition object',
  },
  {
    builder: 'unknownLogicalOperatorError',
    where: () => ({ [UNDECLARED_KEY]: 'x' }),
    secrets: [UNDECLARED_KEY],
    klass: 'not a declared combinator',
  },
  {
    builder: 'filterArrayReachedDriverError',
    where: () => [{ [POLICY_COL]: SECRET }],
    secrets: [POLICY_COL, SECRET],
    klass: 'A filter ARRAY reached the driver',
    rootOnly: true,
  },
  // ── the doors #7929 / #8197 / #20020 already converted, enumerated here so
  //    the table IS the set the seam carries ──────────────────────────────────
  {
    builder: 'crossFieldComparisonError',
    where: () => ({ [POLICY_COL]: { $contains: { $field: REF_COL } } }),
    secrets: [POLICY_COL, REF_COL],
    klass: 'A cross-field comparison',
    authorExtendsLog: true,
  },
  {
    builder: 'bareFieldReferenceError',
    where: () => ({ [POLICY_COL]: { $field: REF_COL } }),
    secrets: [POLICY_COL, REF_COL],
    klass: 'bare field reference',
    authorExtendsLog: true,
  },
  {
    builder: 'uncompilableFieldReferenceError',
    where: () => ({ [POLICY_COL]: { $gt: { $field: 'secret_undeclared_ref' } } }),
    secrets: [POLICY_COL, 'secret_undeclared_ref'],
    klass: 'cannot be compiled here',
  },
  {
    builder: 'jsonColumnOperatorError',
    where: () => ({ [JSON_COL]: { $in: [SECRET] } }),
    secrets: [JSON_COL],
    klass: 'WAS NOT APPLIED',
  },
  {
    builder: 'emptyFieldConstraintError',
    where: () => ({ [POLICY_COL]: {}, stage: { $eq: 'won' } }),
    secrets: [POLICY_COL],
    klass: 'carries zero operators',
  },
  {
    builder: 'unbindableComparandError',
    where: () => ({ [POLICY_COL]: { $eq: { k: SECRET } } }),
    secrets: [POLICY_COL, SECRET],
    klass: 'cannot be bound as a SQL parameter',
  },
  {
    builder: 'betweenArityError',
    where: () => ({ [POLICY_COL]: { $between: [SECRET] } }),
    secrets: [POLICY_COL],
    klass: 'requires a [min, max] value array',
  },
  {
    builder: 'retiredFilterOperatorError',
    where: () => ({ [POLICY_COL]: { $regex: `^${SECRET}` } }),
    secrets: [POLICY_COL, '$regex'],
    klass: 'is RETIRED',
  },
  {
    builder: 'unsupportedFilterOperatorError',
    where: () => ({ [POLICY_COL]: { $sounds_like: SECRET } }),
    secrets: [POLICY_COL, '$sounds_like'],
    klass: 'not one this driver evaluates',
  },
  {
    builder: 'assertFilterNodeList',
    where: () => ({ $or: { [POLICY_COL]: SECRET } }),
    secrets: [POLICY_COL, SECRET],
    klass: 'requires an array of filter conditions',
  },
  {
    builder: 'nonBooleanNullComparandError',
    where: () => ({ [POLICY_COL]: { $null: SECRET } }),
    secrets: [POLICY_COL, SECRET],
    klass: 'Operator "$null" in this filter requires a boolean comparand',
  },
  {
    builder: 'nonBooleanExistsComparandError',
    where: () => ({ [POLICY_COL]: { $exists: SECRET } }),
    secrets: [POLICY_COL, SECRET],
    klass: 'Operator "$exists" in this filter requires a boolean comparand',
  },
];

// ── Half 1: the enumeration ───────────────────────────────────────────────────

/**
 * Every function in `sql-driver.ts` that builds an `INVALID_FILTER` error, by
 * the route it takes. Read with the TypeScript parser, not a regex, so a call
 * split across lines, an inline `throw`, or a builder written as a method or an
 * arrow cannot slip past the count.
 */
function enumerateRefusalBuilders(): {
  directCallers: Set<string>;
  seamCallers: Set<string>;
  codeWriters: Set<string>;
} {
  const source = readFileSync(new URL('./sql-driver.ts', import.meta.url), 'utf8');
  const sf = ts.createSourceFile('sql-driver.ts', source, ts.ScriptTarget.Latest, true);
  const directCallers = new Set<string>();
  const seamCallers = new Set<string>();
  const codeWriters = new Set<string>();

  const enclosingName = (node: ts.Node): string => {
    for (let at: ts.Node | undefined = node.parent; at; at = at.parent) {
      if (ts.isFunctionDeclaration(at) && at.name) return at.name.text;
      if (ts.isMethodDeclaration(at) && ts.isIdentifier(at.name)) {
        const owner = at.parent;
        const cls = ts.isClassDeclaration(owner) && owner.name ? owner.name.text : '?';
        return `${cls}.${at.name.text}`;
      }
      if ((ts.isArrowFunction(at) || ts.isFunctionExpression(at)) && ts.isVariableDeclaration(at.parent)) {
        const decl = at.parent;
        if (ts.isIdentifier(decl.name)) return decl.name.text;
      }
    }
    return '(module scope)';
  };
  const calleeName = (call: ts.CallExpression): string | null => {
    const callee = call.expression;
    if (ts.isIdentifier(callee)) return callee.text;
    if (ts.isPropertyAccessExpression(callee)) return callee.name.text;
    return null;
  };
  const isInvalidFilterCode = (expr: ts.Expression): boolean =>
    (ts.isStringLiteralLike(expr) && expr.text === 'INVALID_FILTER') ||
    (ts.isPropertyAccessExpression(expr) && expr.name.text === 'INVALID_FILTER');

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const name = calleeName(node);
      if (name === 'unsupportedFilterError') directCallers.add(enclosingName(node));
      if (name === 'withheldFilterError') seamCallers.add(enclosingName(node));
    }
    // `err.code = …INVALID_FILTER` or `{ code: 'INVALID_FILTER' }` — a builder
    // that hand-rolls the envelope instead of calling either constructor.
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isPropertyAccessExpression(node.left) &&
      node.left.name.text === 'code' &&
      isInvalidFilterCode(node.right)
    ) {
      codeWriters.add(enclosingName(node));
    }
    if (
      ts.isPropertyAssignment(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'code' &&
      isInvalidFilterCode(node.initializer)
    ) {
      codeWriters.add(enclosingName(node));
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return { directCallers, seamCallers, codeWriters };
}

describe('[#20039] the filter-compile refusal class is closed — enumeration', () => {
  const found = enumerateRefusalBuilders();

  it('positive control: the scan sees the doors #20020 converted, and the column door it left', () => {
    // If the parser stopped seeing builders, every assertion below would pass
    // over empty sets. These are known members of both sets.
    for (const builder of [
      'retiredFilterOperatorError',
      'unsupportedFilterOperatorError',
      'assertFilterNodeList',
      'nonBooleanNullComparandError',
      'nonBooleanExistsComparandError',
    ]) {
      expect(found.seamCallers, builder).toContain(builder);
    }
    expect(found.directCallers).toContain('unresolvableFilterColumnError');
  });

  it('only three functions build the envelope WITHOUT the seam, none of them on the compile path', () => {
    // - `withheldFilterError`: the seam itself;
    // - `SqlDriver.resolveWithheldFilterRefusal`: the `'author'` re-issue, after
    //   the verdict;
    // - `unresolvableFilterColumnError`: raised from a dialect error AFTER the
    //   statement ran, with its own by-name provenance
    //   (`unresolvableColumnProvenance`, #20020).
    // A NEW name here is a compile refusal that decides by omission what the
    // wire may name. Route it through `withheldFilterError` with the node it
    // was raised from, and give it a row in DOORS.
    expect([...found.directCallers].sort()).toEqual(
      ['SqlDriver.resolveWithheldFilterRefusal', 'unresolvableFilterColumnError', 'withheldFilterError'].sort(),
    );
    // And nothing hand-rolls the envelope beside the one constructor.
    expect([...found.codeWriters]).toEqual(['unsupportedFilterError']);
  });

  it('every builder that goes through the seam is driven by a row below, and every row is one', () => {
    expect([...found.seamCallers].sort()).toEqual(DOORS.map((d) => d.builder).sort());
  });
});

// ── Half 2: every builder under every mark ────────────────────────────────────

describe('[#20039] every filter-compile refusal × filter-subtree provenance', () => {
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
          [REF_COL]: { type: 'text', name: REF_COL },
          [JSON_COL]: { type: 'lookup', name: JSON_COL, multiple: true },
        },
      } as any,
    ]);
    await driver.create('deal', { id: '1', stage: 'won', [POLICY_COL]: 'a', [REF_COL]: 'b' });
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

  const expectWithheld = (err: WireBearingError, door: Door) => {
    expect(err.code).toBe('INVALID_FILTER');
    expect(err.status).toBe(400);
    // The error's own keys are the envelope and nothing else.
    expect(Object.keys(err).sort()).toEqual(['code', 'status']);
    for (const secret of door.secrets) expect(err.message, `names "${secret}"`).not.toContain(secret);
    expect(err.message).toContain(door.klass);
    expect(err.message).not.toContain('[sql-driver]');
    // Relocated, not deleted: every secret is in the server log.
    for (const secret of door.secrets) expect(logged.join('\n'), `log lost "${secret}"`).toContain(secret);
    // The row reached the builder it names — not a sibling door.
    expect(err.stack ?? '').toMatch(new RegExp(`\\bat ${door.builder}\\b`));
  };

  for (const door of DOORS) {
    describe(door.builder, () => {
      it('policy-marked ⇒ same code and status, operands WITHHELD, and in the server log', async () => {
        expectWithheld(await refusalOf(markFilterSubtreeProvenance(door.where(), 'policy')), door);
      });

      it('author-marked ⇒ the full diagnostic', async () => {
        const policy = await refusalOf(markFilterSubtreeProvenance(door.where(), 'policy'));
        const log = logged.join('\n');
        logged = [];
        const author = await refusalOf(markFilterSubtreeProvenance(door.where(), 'author'));
        expect(author.code).toBe('INVALID_FILTER');
        expect(author.status).toBe(400);
        for (const secret of door.secrets) expect(author.message).toContain(secret);
        expect(author.message).not.toBe(policy.message);
        // The author's text is the diagnostic the policy population only logged.
        if (!door.authorExtendsLog) expect(log).toContain(author.message);
        // The seam re-issues it and logs nothing: it was the caller's to read.
        expect(logged).toEqual([]);
      });

      it('UNMARKED ⇒ withheld, byte-identical to policy — the fail direction', async () => {
        const unmarked = await refusalOf(door.where());
        expectWithheld(unmarked, door);
        const policy = await refusalOf(markFilterSubtreeProvenance(door.where(), 'policy'));
        expect(unmarked.message).toBe(policy.message);
      });

      if (!door.rootOnly) {
        it("merged $and: the refusing arm's mark decides, in both arm orders", async () => {
          for (const order of ['author-first', 'policy-first'] as const) {
            const other = { stage: 'won' };
            const disclosedArms = [
              markFilterSubtreeProvenance(door.where(), 'author'),
              markFilterSubtreeProvenance({ ...other }, 'policy'),
            ];
            const disclosed = await refusalOf({
              $and: order === 'author-first' ? disclosedArms : [...disclosedArms].reverse(),
            });
            for (const secret of door.secrets) expect(disclosed.message, order).toContain(secret);

            logged = [];
            const withheldArms = [
              markFilterSubtreeProvenance({ ...other }, 'author'),
              markFilterSubtreeProvenance(door.where(), 'policy'),
            ];
            const withheld = await refusalOf({
              $and: order === 'author-first' ? withheldArms : [...withheldArms].reverse(),
            });
            expectWithheld(withheld, door);
          }
        });
      }
    });
  }
});

// ── The node each refusal hands the seam ──────────────────────────────────────

describe('[#20039] the node a walk refusal resolves is the one it was raised from', () => {
  let driver: SqlDriver;

  beforeEach(async () => {
    driver = new SqlDriver({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    await driver.initObjects([
      {
        name: 'deal',
        fields: { id: { type: 'text', name: 'id' }, stage: { type: 'text', name: 'stage' } },
      } as any,
    ]);
    (driver as unknown as { logger: unknown }).logger = {
      warn: () => {}, error: () => {}, info: () => {}, debug: () => {},
    };
  });

  const messageOf = async (where: unknown): Promise<string> => {
    try {
      await driver.find('deal', { fields: ['id'], where: where as FilterCondition });
    } catch (e) {
      return (e as Error).message;
    }
    throw new Error('expected the driver to refuse this filter, but it resolved');
  };

  it('a primitive $or element nested in an AUTHOR arm is the author arm (found through its list)', async () => {
    const message = await messageOf({
      $or: [
        markFilterSubtreeProvenance({ stage: 'won' }, 'policy'),
        markFilterSubtreeProvenance({ $and: [{ $or: [SECRET] }] }, 'author'),
      ],
    });
    expect(message).toContain(SECRET);
    expect(message).toContain('filter.$or[1].$and[0].$or[0]');
  });

  it('the same element nested in a POLICY arm is withheld', async () => {
    const message = await messageOf({
      $or: [
        markFilterSubtreeProvenance({ stage: 'won' }, 'author'),
        markFilterSubtreeProvenance({ $and: [{ $or: [SECRET] }] }, 'policy'),
      ],
    });
    expect(message).not.toContain(SECRET);
    expect(message).toContain('is not a filter condition object');
  });

  it('a primitive $not operand inherits from the node carrying $not', async () => {
    expect(await messageOf(markFilterSubtreeProvenance({ $not: SECRET }, 'author'))).toContain(SECRET);
    expect(await messageOf(markFilterSubtreeProvenance({ $not: SECRET }, 'policy'))).not.toContain(SECRET);
  });

  it('a DIRECT undefined comparand is decided by the node carrying the field, at any depth', async () => {
    const author = await messageOf({
      $and: [
        markFilterSubtreeProvenance({ stage: 'won' }, 'policy'),
        markFilterSubtreeProvenance({ $or: [{ secret_field: undefined }] }, 'author'),
      ],
    });
    expect(author).toContain('secret_field');
    const policy = await messageOf({
      $and: [
        markFilterSubtreeProvenance({ stage: 'won' }, 'author'),
        markFilterSubtreeProvenance({ $or: [{ secret_field: undefined }] }, 'policy'),
      ],
    });
    expect(policy).not.toContain('secret_field');
  });

  it('an undeclared key is decided by the node CARRYING it, never by its own value', async () => {
    // The value is marked 'author' on its own, inside a policy node: the KEY is
    // the policy's, so the refusal stays withheld.
    const message = await messageOf({
      $and: [
        markFilterSubtreeProvenance({ stage: 'won' }, 'author'),
        markFilterSubtreeProvenance(
          { [UNDECLARED_KEY]: markFilterSubtreeProvenance({ a: 1 }, 'author') },
          'policy',
        ),
      ],
    });
    expect(message).not.toContain(UNDECLARED_KEY);
    expect(message).toContain('not a declared combinator');
  });
});
