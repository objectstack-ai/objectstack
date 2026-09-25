// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20039] EVERY refusal `RemoteTransport.buildWhereSQL` can raise goes through
 * the #8220 withheld seam — the remote twin of `driver-sql`'s
 * `sql-driver-compile-refusal-seam.test.ts`.
 *
 * `TursoDriver` picks this compiler or the inherited `SqlDriver` one by `url`,
 * so a door that withholds on one face and discloses on the other would make
 * the disclosure a property of the connection string. Measured on this
 * transport before this file (a `'policy'`-marked `where` handed to it
 * directly): an empty or non-string `$icontains`, a non-string `$like`, a
 * dangling `$like` escape, an `undefined` comparand, a non-node `$or` element or
 * `$not` operand, an undeclared node combinator, a non-node top-level `where`,
 * an empty operator map and an un-lowered `$between` each named the policy's
 * field or literal. (An object `$contains` comparand and an object `$in` member
 * already withheld: here both are the comparand gate's refusal.)
 *
 * Three halves:
 *
 * 1. **The enumeration** reads `remote-transport.ts`: only the seam and the
 *    `'author'` re-issue may call `invalidFilterError` directly, and every
 *    method that goes through the seam has a row below.
 * 2. **The table** drives each of those methods under every mark, and proves
 *    by the error's stack that the row reached the method it names.
 * 3. **One driver, two faces**: the withheld sentence of each class this card
 *    converted is `driver-sql`'s, behind this file's prefix — and in REMOTE
 *    mode `TursoDriver.toRemoteFilter` rebuilds every node, so no mark reaches
 *    this transport and even an author-marked `where` is withheld there: the
 *    contract's declared fail-closed direction, pinned so it is a decision and
 *    not an accident.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import type { DriverQuery } from '@objectstack/spec/contracts';
import { markFilterSubtreeProvenance } from '@objectstack/spec/data';
import { RemoteTransport } from './remote-transport.js';
import { TursoDriver } from './turso-driver.js';
import { asLibsqlClient, makeLibsqlSqliteStub, type LibsqlSqliteStub } from './libsql-sqlite-stub.testkit.js';

interface WireBearingError extends Error {
  code?: string;
  status?: number;
}

const POLICY_COL = 'secret_policy_col';
const SECRET = 'PSECRET_LITERAL';
const SECRET_NUM = 7770123;
const UNDECLARED_KEY = '$psecret_combinator';

type Door = {
  /** The `RemoteTransport` method this row drives — asserted by the error's stack. */
  readonly builder: string;
  readonly where: () => Record<string, unknown> | unknown[];
  readonly secrets: readonly string[];
  readonly klass: string;
  readonly rootOnly?: true;
  /** Names the row where `JSON.stringify` would drop its `undefined`. */
  readonly label?: string;
};

const DOORS: readonly Door[] = [
  // ── #20039 ─────────────────────────────────────────────────────────────────
  {
    builder: 'icontainsComparand',
    where: () => ({ [POLICY_COL]: { $icontains: SECRET_NUM } }),
    secrets: [POLICY_COL, String(SECRET_NUM)],
    klass: 'Operator "$icontains" in this filter requires a NON-EMPTY string comparand',
  },
  {
    builder: 'likePatternComparand',
    where: () => ({ [POLICY_COL]: { $like: SECRET_NUM } }),
    secrets: [POLICY_COL, String(SECRET_NUM)],
    klass: 'requires a string comparand',
  },
  {
    builder: 'danglingLikeEscape',
    where: () => ({ [POLICY_COL]: { $ilike: `${SECRET}\\` } }),
    secrets: [POLICY_COL, SECRET],
    klass: 'ending in a lone unpaired backslash',
  },
  {
    builder: 'undefinedComparand',
    where: () => ({ [POLICY_COL]: { $eq: undefined } }),
    secrets: [POLICY_COL],
    klass: 'A comparand in this filter is undefined',
    label: '{ secret_policy_col: { $eq: undefined } }',
  },
  {
    builder: 'uncompilableSubFilter',
    where: () => ({ $or: [{ stage: 'won' }, SECRET] }),
    secrets: [SECRET, '$or[1]'],
    klass: 'is not a filter condition object',
  },
  {
    builder: 'undeclaredCombinator',
    where: () => ({ [UNDECLARED_KEY]: 'x' }),
    secrets: [UNDECLARED_KEY],
    klass: 'not a declared combinator',
  },
  {
    builder: 'uncompilableWhere',
    where: () => [{ [POLICY_COL]: SECRET }],
    secrets: [POLICY_COL, SECRET],
    klass: 'The where of this query is not a filter condition',
    rootOnly: true,
  },
  {
    builder: 'emptyFieldFilter',
    where: () => ({ [POLICY_COL]: {} }),
    secrets: [POLICY_COL],
    klass: 'compiles to NO predicate',
  },
  // ── converted before (#7929 / #8197 / #20020), enumerated so the table IS
  //    the set the seam carries ───────────────────────────────────────────────
  {
    builder: 'unsupportedOperator',
    where: () => ({ [POLICY_COL]: { $sounds_like: SECRET } }),
    secrets: [POLICY_COL, '$sounds_like'],
    klass: 'not compiled in remote mode',
  },
  {
    builder: 'nonListCombinator',
    where: () => ({ $or: { [POLICY_COL]: SECRET } }),
    secrets: [POLICY_COL, SECRET],
    klass: 'requires an array of filter conditions',
  },
  {
    builder: 'nonBooleanNullComparand',
    where: () => ({ [POLICY_COL]: { $null: SECRET } }),
    secrets: [POLICY_COL, SECRET],
    klass: 'Operator "$null" in this filter requires a boolean comparand',
  },
  {
    builder: 'nonBooleanExistsComparand',
    where: () => ({ [POLICY_COL]: { $exists: SECRET } }),
    secrets: [POLICY_COL, SECRET],
    klass: 'Operator "$exists" in this filter requires a boolean comparand',
  },
  {
    builder: 'uncompilableComparand',
    where: () => ({ [POLICY_COL]: { $contains: { k: SECRET } } }),
    secrets: [POLICY_COL, SECRET],
    klass: 'a value this transport cannot bind',
  },
];

/**
 * Rows that share a method with a row above, one per arm the method answers:
 * the enumeration counts METHODS, so an arm is pinned here rather than there.
 */
const ARMS: readonly Door[] = [
  {
    builder: 'unsupportedOperator',
    where: () => ({ [POLICY_COL]: { $regex: `^${SECRET}` } }),
    secrets: [POLICY_COL, '$regex'],
    klass: 'is RETIRED',
  },
  {
    builder: 'unsupportedOperator',
    where: () => ({ [POLICY_COL]: { secret_relation_key: SECRET } }),
    secrets: [POLICY_COL, 'secret_relation_key'],
    klass: 'a key that is not an operator',
  },
  {
    // Unreachable through `TursoDriver` (it lowers `$between` first) — withheld
    // all the same, so the class has no exception.
    builder: 'unsupportedOperator',
    where: () => ({ [POLICY_COL]: { $between: [1, 2] } }),
    secrets: [POLICY_COL],
    klass: 'must be lowered to $gte/$lte',
  },
  {
    // The misplaced-field-operator tail: which tail applied says whether the
    // key is a field operator, so both tails share ONE withheld sentence.
    builder: 'undeclaredCombinator',
    where: () => ({ $eq: SECRET }),
    // The key (this refusal never printed the value).
    secrets: ['"$eq"'],
    klass: 'not a declared combinator',
  },
  {
    builder: 'uncompilableSubFilter',
    where: () => ({ $not: SECRET }),
    secrets: [SECRET],
    klass: 'is not a filter condition object',
  },
  {
    builder: 'undefinedComparand',
    where: () => ({ [POLICY_COL]: undefined, stage: 'won' }),
    secrets: [POLICY_COL],
    klass: 'A comparand in this filter is undefined',
    label: "{ secret_policy_col: undefined, stage: 'won' }",
  },
  {
    builder: 'undefinedComparand',
    where: () => ({ [POLICY_COL]: { $in: ['a', undefined] } }),
    secrets: [POLICY_COL, '$in[1]'],
    klass: 'A comparand in this filter is undefined',
    label: "{ secret_policy_col: { $in: ['a', undefined] } }",
  },
];

// ── Half 1: the enumeration ───────────────────────────────────────────────────

function enumerateRefusalMethods(): {
  directCallers: Set<string>;
  seamCallers: Set<string>;
  codeWriters: Set<string>;
} {
  const source = readFileSync(new URL('./remote-transport.ts', import.meta.url), 'utf8');
  const sf = ts.createSourceFile('remote-transport.ts', source, ts.ScriptTarget.Latest, true);
  const directCallers = new Set<string>();
  const seamCallers = new Set<string>();
  const codeWriters = new Set<string>();

  const enclosingName = (node: ts.Node): string => {
    for (let at: ts.Node | undefined = node.parent; at; at = at.parent) {
      if (ts.isFunctionDeclaration(at) && at.name) return at.name.text;
      if (ts.isMethodDeclaration(at) && ts.isIdentifier(at.name)) return at.name.text;
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
      if (name === 'invalidFilterError') directCallers.add(enclosingName(node));
      if (name === 'withheldRefusal' || name === 'withheldInvalidFilterError') {
        seamCallers.add(enclosingName(node));
      }
    }
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
  // The seam's own helper is its plumbing, not a refusal.
  seamCallers.delete('withheldRefusal');
  return { directCallers, seamCallers, codeWriters };
}

describe('[#20039] RemoteTransport: the filter-compile refusal class is closed — enumeration', () => {
  const found = enumerateRefusalMethods();

  it('positive control: the scan sees the methods #20020 converted', () => {
    for (const method of ['unsupportedOperator', 'nonListCombinator', 'nonBooleanNullComparand', 'nonBooleanExistsComparand']) {
      expect(found.seamCallers, method).toContain(method);
    }
  });

  it('only the seam and the author re-issue build the envelope WITHOUT the seam', () => {
    // A NEW name here is a compile refusal that decides by omission what the
    // wire may name. Route it through `withheldRefusal` with the node it was
    // raised from, and give it a row in DOORS.
    expect([...found.directCallers].sort()).toEqual(['resolveWithheldFilterRefusal', 'withheldInvalidFilterError']);
    expect([...found.codeWriters]).toEqual(['invalidFilterError']);
  });

  it('every method that goes through the seam is driven by a row below, and every row is one', () => {
    expect([...found.seamCallers].sort()).toEqual([...new Set(DOORS.map((d) => d.builder))].sort());
    for (const arm of ARMS) expect(found.seamCallers, arm.builder).toContain(arm.builder);
  });
});

// ── Half 2: every method under every mark ─────────────────────────────────────

function transport() {
  const client = {
    execute: vi.fn(async () => ({ rows: [], columns: [] })),
    close: vi.fn(),
  };
  const sink: string[] = [];
  const t = new RemoteTransport();
  t.setClient(client as any);
  t.setDiagnosticSink((m) => sink.push(m));
  return { t, sink, client };
}

const refusalOf = async (where: unknown) => {
  const { t, sink, client } = transport();
  try {
    await t.find('deal', { where } as never);
  } catch (e) {
    expect(client.execute, 'a refused filter must not execute a statement').not.toHaveBeenCalled();
    return { err: e as WireBearingError, sink: sink.join('\n') };
  }
  throw new Error('expected the transport to refuse this filter, but it resolved');
};

const expectWithheld = ({ err, sink }: { err: WireBearingError; sink: string }, door: Door) => {
  expect(err.code).toBe('INVALID_FILTER');
  expect(err.status).toBe(400);
  expect(Object.keys(err).sort()).toEqual(['code', 'status']);
  for (const secret of door.secrets) expect(err.message, `names "${secret}"`).not.toContain(secret);
  expect(err.message).toContain(door.klass);
  for (const secret of door.secrets) expect(sink, `sink lost "${secret}"`).toContain(secret);
  expect(err.stack ?? '').toMatch(new RegExp(`\\bat RemoteTransport\\.${door.builder}\\b`));
};

describe('[#20039] RemoteTransport: every filter-compile refusal × filter-subtree provenance', () => {
  for (const door of [...DOORS, ...ARMS]) {
    describe(`${door.builder}: ${door.label ?? JSON.stringify(door.where())}`, () => {
      it('policy-marked ⇒ same code and status, operands WITHHELD, and in the sink', async () => {
        expectWithheld(await refusalOf(markFilterSubtreeProvenance(door.where(), 'policy')), door);
      });

      it('author-marked ⇒ the full diagnostic, the text the withheld case sank', async () => {
        const policy = await refusalOf(markFilterSubtreeProvenance(door.where(), 'policy'));
        const author = await refusalOf(markFilterSubtreeProvenance(door.where(), 'author'));
        expect(author.err.code).toBe('INVALID_FILTER');
        expect(author.err.status).toBe(400);
        for (const secret of door.secrets) expect(author.err.message).toContain(secret);
        expect(policy.sink).toContain(author.err.message);
      });

      it('UNMARKED ⇒ withheld, byte-identical to policy', async () => {
        const unmarked = await refusalOf(door.where());
        expectWithheld(unmarked, door);
        const policy = await refusalOf(markFilterSubtreeProvenance(door.where(), 'policy'));
        expect(unmarked.err.message).toBe(policy.err.message);
      });

      if (!door.rootOnly) {
        it("merged $and: the refusing arm's mark decides, in both arm orders", async () => {
          for (const order of ['author-first', 'policy-first'] as const) {
            const disclosedArms = [
              markFilterSubtreeProvenance(door.where(), 'author'),
              markFilterSubtreeProvenance({ stage: 'won' }, 'policy'),
            ];
            const disclosed = await refusalOf({
              $and: order === 'author-first' ? disclosedArms : [...disclosedArms].reverse(),
            });
            for (const secret of door.secrets) expect(disclosed.err.message, order).toContain(secret);

            const withheldArms = [
              markFilterSubtreeProvenance({ stage: 'won' }, 'author'),
              markFilterSubtreeProvenance(door.where(), 'policy'),
            ];
            expectWithheld(
              await refusalOf({ $and: order === 'author-first' ? withheldArms : [...withheldArms].reverse() }),
              door,
            );
          }
        });
      }
    });
  }

  it('an undeclared key is decided by the node CARRYING it, never by its own value', async () => {
    const { err } = await refusalOf({
      $and: [
        markFilterSubtreeProvenance({ stage: 'won' }, 'author'),
        markFilterSubtreeProvenance({ [UNDECLARED_KEY]: markFilterSubtreeProvenance({ a: 1 }, 'author') }, 'policy'),
      ],
    });
    expect(err.message).not.toContain(UNDECLARED_KEY);
  });

  it('a primitive $not operand inherits from the node carrying $not', async () => {
    expect((await refusalOf(markFilterSubtreeProvenance({ $not: SECRET }, 'author'))).err.message).toContain(SECRET);
    expect((await refusalOf(markFilterSubtreeProvenance({ $not: SECRET }, 'policy'))).err.message).not.toContain(
      SECRET,
    );
  });
});

// ── Half 3: one driver, two faces ─────────────────────────────────────────────

describe('[#20039] TursoDriver LOCAL and REMOTE withhold these classes alike', () => {
  const OBJECT = {
    name: 'deal',
    fields: { stage: { type: 'string' }, [POLICY_COL]: { type: 'string' } },
  };
  let local: TursoDriver;
  let remote: TursoDriver;
  let stub: LibsqlSqliteStub;

  beforeAll(async () => {
    local = new TursoDriver({ url: ':memory:' });
    expect(local.transportMode).toBe('local');
    await local.initObjects([OBJECT]);
    stub = makeLibsqlSqliteStub();
    remote = new TursoDriver({ url: 'libsql://refusal-seam.turso.io', client: asLibsqlClient(stub) });
    await remote.connect();
    expect(remote.transportMode).toBe('remote');
    await remote.syncSchema(OBJECT.name, OBJECT);
  });

  afterAll(async () => {
    await local.disconnect();
    await remote.disconnect();
    stub.close();
  });

  const messageOf = async (driver: TursoDriver, where: unknown): Promise<string> => {
    const err = await driver
      .find(OBJECT.name, { where } as DriverQuery)
      .then(() => null, (e: unknown) => e as WireBearingError);
    expect(err, 'expected a refusal').not.toBeNull();
    expect(err!.code).toBe('INVALID_FILTER');
    expect(err!.status).toBe(400);
    return err!.message;
  };

  // The classes whose withheld sentence this card wrote on both compilers.
  const SHARED: ReadonlyArray<[string, () => Record<string, unknown>, string]> = [
    ['$icontains comparand', () => ({ [POLICY_COL]: { $icontains: SECRET_NUM } }), POLICY_COL],
    ['$like comparand', () => ({ [POLICY_COL]: { $like: SECRET_NUM } }), POLICY_COL],
    ['dangling escape', () => ({ [POLICY_COL]: { $like: `${SECRET}\\` } }), SECRET],
    ['undefined comparand', () => ({ [POLICY_COL]: { $eq: undefined } }), POLICY_COL],
    ['non-node $or element', () => ({ $or: [SECRET] }), SECRET],
    ['undeclared combinator', () => ({ [UNDECLARED_KEY]: 'x' }), UNDECLARED_KEY],
  ];

  for (const [label, where, secret] of SHARED) {
    it(`${label}: the remote withheld sentence is the local one behind the prefix`, async () => {
      const localWithheld = await messageOf(local, where());
      const remoteWithheld = await messageOf(remote, where());
      expect(localWithheld).not.toContain(secret);
      expect(remoteWithheld).toBe(`[RemoteTransport] ${localWithheld}`);
    });

    it(`${label}: REMOTE withholds even an author-marked where — no mark survives toRemoteFilter`, async () => {
      // LOCAL gives the author the full text back...
      expect(await messageOf(local, markFilterSubtreeProvenance(where(), 'author'))).toContain(secret);
      // ...REMOTE cannot: `TursoDriver.toRemoteFilter` rebuilds every node, the
      // rebuilt tree carries no mark, and unmarked is withheld. Fail-closed by
      // construction — a cost to the author on remote mode, never a disclosure.
      expect(await messageOf(remote, markFilterSubtreeProvenance(where(), 'author'))).not.toContain(secret);
    });
  }
});
