// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ObjectQL } from './engine';
import { SchemaRegistry } from './registry';

/**
 * framework#3582 — filter placeholders are expanded on the SERVER read path.
 *
 * Filters travel as JSON, so a time- or user-scoped slice authored in a view,
 * a related list or a REST query writes `'{current_year_start}'` /
 * `'{current_user_id}'`. Nothing on the server used to substitute them: the
 * placeholder reached the driver as a literal string, compared as text, and
 * matched nothing — an empty grid with no error anywhere, which apps worked
 * around by freezing dates into their build artifact.
 *
 * These tests assert on what the DRIVER receives: no `{token}` may survive to
 * the driver AST, and an unresolvable one must throw rather than pass through.
 */
vi.mock('./registry', () => {
  const instance: any = {
    getObject: vi.fn(),
    resolveObject: vi.fn((n: string) => instance.getObject(n)),
    // [#9154] This double used to OMIT `getAllObjects`, and every test here
    // passed anyway: the engine's roll-up summary index read it as
    // `getAllObjects?.() ?? []`, so a double that does not model the method
    // was indistinguishable from a registry with nothing in it — the write
    // path silently skipped the insert-time roll-up seed (#5749) and the
    // post-write recompute. With the optional call gone the omission is a
    // hard `TypeError`, which is the point: the double now has to model the
    // method the engine actually calls. Empty is the truthful body for THIS
    // suite — it declares no `summary` field, so the roll-up index over it is
    // empty either way, and now it says so instead of the engine inventing it.
    getAllObjects: vi.fn(() => []),
    registerObject: vi.fn(),
    getObjectOwner: vi.fn(),
    registerNamespace: vi.fn(),
    registerKind: vi.fn(),
    registerItem: vi.fn(),
    registerApp: vi.fn(),
    installPackage: vi.fn(),
    reset: vi.fn(),
    metadata: { get: vi.fn(() => new Map()) },
  };
  function SchemaRegistry() {
    return instance;
  }
  Object.assign(SchemaRegistry, instance);
  return {
    SchemaRegistry,
    computeFQN: (_ns: string | undefined, name: string) => name,
    parseFQN: (fqn: string) => ({ namespace: undefined, shortName: fqn }),
    RESERVED_NAMESPACES: new Set(['base', 'system']),
  };
});

const DEAL_SCHEMA = {
  name: 'deal',
  fields: {
    title: { type: 'text' },
    owner: { type: 'text' },
    close_date: { type: 'date' },
  },
};

function makeDriver() {
  const seen: {
    findAst?: any; findOneAst?: any; countAst?: any; aggregateAst?: any;
    updateManyAst?: any; deleteManyAst?: any; updateId?: any; deleteId?: any;
  } = {};
  const driver: any = {
    name: 'memory',
    supports: {},
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    find: vi.fn(async (_o: string, ast: any) => { seen.findAst = ast; return []; }),
    // [#7867] Echoes back the id it was asked for, so a by-id write reaches the
    // driver instead of dying at the not-found gate. `return null` here would
    // make this double looser than the producer on exactly the write path the
    // by-id case below measures; `seen.findOneAst`, which the read cases assert
    // on, is captured exactly as before.
    findOne: vi.fn(async (_o: string, ast: any) => {
      seen.findOneAst = ast;
      const id = ast?.where?.id;
      return id === undefined || id === null ? null : { id, title: 'stored' };
    }),
    count: vi.fn(async (_o: string, ast: any) => { seen.countAst = ast; return 0; }),
    aggregate: vi.fn(async (_o: string, ast: any) => { seen.aggregateAst = ast; return []; }),
    create: vi.fn(async (_o: string, d: any) => d),
    update: vi.fn(async (_o: string, id: any, d: any) => { seen.updateId = id; return { id, ...d }; }),
    updateMany: vi.fn(async (_o: string, ast: any) => { seen.updateManyAst = ast; return { modified: 0 }; }),
    delete: vi.fn(async (_o: string, id: any) => { seen.deleteId = id; return true; }),
    deleteMany: vi.fn(async (_o: string, ast: any) => { seen.deleteManyAst = ast; return { deleted: 0 }; }),
  };
  return { driver, seen };
}

async function makeEngine(driver: any) {
  vi.mocked((SchemaRegistry as any).getObject).mockImplementation((name: string) =>
    name === 'deal' ? DEAL_SCHEMA : undefined,
  );
  const ql = new ObjectQL();
  ql.registerDriver(driver, true);
  await ql.init();
  return ql;
}

const CTX = { userId: 'usr_1', tenantId: 'org_9', timezone: 'UTC' } as any;
const THIS_YEAR_START = `${new Date().getUTCFullYear()}-01-01`;

describe('engine filter placeholders (framework#3582)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('find(): a date macro reaches the driver as a concrete date', async () => {
    const { driver, seen } = makeDriver();
    const ql = await makeEngine(driver);

    await ql.find('deal', {
      where: { close_date: { $gte: '{current_year_start}' } },
      context: CTX,
    });

    expect(seen.findAst?.where).toEqual({ close_date: { $gte: THIS_YEAR_START } });
  });

  it('find(): a context token reaches the driver as the signed-in user id', async () => {
    const { driver, seen } = makeDriver();
    const ql = await makeEngine(driver);

    await ql.find('deal', { where: { owner: '{current_user_id}' }, context: CTX });

    expect(seen.findAst?.where).toEqual({ owner: 'usr_1' });
  });

  it('find(): expands inside logical branches and the `filter` alias', async () => {
    const { driver, seen } = makeDriver();
    const ql = await makeEngine(driver);

    await ql.find('deal', {
      filter: { $and: [{ owner: '{current_user_id}' }, { close_date: { $lt: '{today}' } }] },
      context: CTX,
    } as any);

    const branches = seen.findAst?.where?.$and;
    expect(branches?.[0]).toEqual({ owner: 'usr_1' });
    expect(branches?.[1].close_date.$lt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('findOne(): placeholders are expanded too', async () => {
    const { driver, seen } = makeDriver();
    const ql = await makeEngine(driver);

    await ql.findOne('deal', { where: { owner: '{current_user_id}' }, context: CTX });

    expect(seen.findOneAst?.where).toEqual({ owner: 'usr_1' });
  });

  it('count(): the driver counts the resolved filter, not the literal', async () => {
    const { driver, seen } = makeDriver();
    const ql = await makeEngine(driver);

    await ql.count('deal', { where: { owner: '{current_user_id}' }, context: CTX });

    expect(seen.countAst?.where).toEqual({ owner: 'usr_1' });
  });

  it('aggregate(): placeholders are expanded before grouping', async () => {
    const { driver, seen } = makeDriver();
    const ql = await makeEngine(driver);

    await ql.aggregate('deal', {
      where: { close_date: { $gte: '{current_year_start}' } },
      groupBy: ['owner'],
      aggregations: [{ function: 'count', field: 'id', alias: 'n' }],
      context: CTX,
    });

    expect(seen.aggregateAst?.where).toEqual({ close_date: { $gte: THIS_YEAR_START } });
    expect(seen.aggregateAst?.groupBy).toEqual(['owner']);
    expect(seen.aggregateAst?.aggregations).toEqual([
      { function: 'count', field: 'id', alias: 'n' },
    ]);
  });

  it('throws on an unknown placeholder instead of matching nothing', async () => {
    const { driver } = makeDriver();
    const ql = await makeEngine(driver);

    // `{current_user}` is the near-miss the issue was filed on: it is the RLS
    // expression root, so authors reach for it in filters too.
    await expect(
      ql.find('deal', { where: { owner: '{current_user}' }, context: CTX }),
    ).rejects.toThrow(/current_user_id/);
    expect(driver.find).not.toHaveBeenCalled();
  });

  it('leaves placeholder-free filters untouched', async () => {
    const { driver, seen } = makeDriver();
    const ql = await makeEngine(driver);

    await ql.find('deal', { where: { title: 'acme {x} deal', owner: 'usr_2' }, context: CTX });

    expect(seen.findAst?.where).toEqual({ title: 'acme {x} deal', owner: 'usr_2' });
  });

  /**
   * #5586 — the read path is where the bypass was measured, so it is pinned
   * here and not only at the resolver.
   *
   * A placeholder carrying a non-word character was not recognised as a token,
   * so it rode the AST all the way to the driver and was compared as a literal
   * string. On the issue's four-row fixture `due_date < '{TODAY()}'` returned
   * 4 rows where `due_date < '{today}'` returned the 2 genuinely overdue ones
   * — wrong rows, no error, indistinguishable from a correct answer.
   */
  describe('non-word placeholder shapes refuse before the driver (#5586)', () => {
    it.each([
      ['{TODAY()}', 'TODAY()'],
      ['{current-user-id}', 'current-user-id'],
      ['{30 days ago}', '30 days ago'],
      ['{user.id}', 'user.id'],
      ['${TODAY()}', 'TODAY()'],
    ])('find(): %s throws and the driver is never reached', async (value, token) => {
      const { driver } = makeDriver();
      const ql = await makeEngine(driver);

      let err: any;
      try {
        await ql.find('deal', { where: { close_date: { $lt: value } }, context: CTX });
      } catch (e) {
        err = e;
      }

      // The specific identity, not the bare fact of a rejection: the point of
      // the fix is WHICH error the caller gets, and a `rejects.toThrow()` here
      // would stay green on a driver-level blow-up.
      expect(err?.name).toBe('UnknownFilterTokenError');
      expect(err?.code).toBe('FILTER_TOKEN_UNKNOWN');
      expect(err?.status).toBe(400);
      expect(err?.token).toBe(token);
      expect(err?.message).toContain(`{${token}}`);
      expect(driver.find).not.toHaveBeenCalled();
    });

    it('find(): the word-character near miss `{TODAY}` still throws', async () => {
      // Control for the widening: the shape that already refused must keep
      // refusing with the same identity.
      const { driver } = makeDriver();
      const ql = await makeEngine(driver);

      let err: any;
      try {
        await ql.find('deal', { where: { close_date: { $lt: '{TODAY}' } }, context: CTX });
      } catch (e) {
        err = e;
      }
      expect(err?.name).toBe('UnknownFilterTokenError');
      expect(err?.token).toBe('TODAY');
      expect(driver.find).not.toHaveBeenCalled();
    });

    it('find(): `{today}` still resolves to a concrete date', async () => {
      const { driver, seen } = makeDriver();
      const ql = await makeEngine(driver);

      await ql.find('deal', { where: { close_date: { $lt: '{today}' } }, context: CTX });

      expect(seen.findAst?.where?.close_date?.$lt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it.each(['{a}{b}', '{{x}}', '{}', 'a{b}c'])(
      'find(): %s is not ONE wrapped token and reaches the driver as a literal',
      async (value) => {
        // Pinned deliberately: recognition is one brace pair around the whole
        // value. These shapes are ordinary text and must not start throwing.
        const { driver, seen } = makeDriver();
        const ql = await makeEngine(driver);

        await ql.find('deal', { where: { title: value }, context: CTX });

        expect(seen.findAst?.where).toEqual({ title: value });
      },
    );

    it('delete(multi): the write path refuses the same shape before deleting', async () => {
      // The verb-parity property #3810 established: one filter, one row set.
      // A widened `delete` is the most expensive place for a silent literal.
      const { driver } = makeDriver();
      const ql = await makeEngine(driver);

      let err: any;
      try {
        await ql.delete('deal', {
          where: { close_date: { $lt: '{TODAY()}' } }, multi: true, context: CTX,
        } as any);
      } catch (e) {
        err = e;
      }
      expect(err?.name).toBe('UnknownFilterTokenError');
      expect(err?.code).toBe('FILTER_TOKEN_UNKNOWN');
      expect(err?.token).toBe('TODAY()');
      expect(driver.deleteMany).not.toHaveBeenCalled();
      expect(driver.delete).not.toHaveBeenCalled();
    });
  });

  // ── Write path (framework#3810) ────────────────────────────────────────
  // The evaluator originally reached only find/findOne/count/aggregate, so the
  // SAME filter selected different rows depending on the verb: `find` matched
  // the signed-in user's rows while `update`/`delete` compared the literal
  // token text and matched none. #3106 one layer down — the switch was right,
  // the call sites were incomplete.
  describe('write path', () => {
    it('updateMany: the driver receives the resolved filter, not the token', async () => {
      const { driver, seen } = makeDriver();
      const ql = await makeEngine(driver);

      await ql.update('deal', { title: 'x' }, {
        where: { owner: '{current_user_id}' }, multi: true, context: CTX,
      } as any);

      expect(seen.updateManyAst?.where).toEqual({ owner: 'usr_1' });
    });

    it('deleteMany: the driver receives the resolved filter, not the token', async () => {
      const { driver, seen } = makeDriver();
      const ql = await makeEngine(driver);

      await ql.delete('deal', {
        where: { close_date: { $lt: '{current_year_start}' } }, multi: true, context: CTX,
      } as any);

      expect(seen.deleteManyAst?.where).toEqual({ close_date: { $lt: THIS_YEAR_START } });
    });

    it('resolves BEFORE the by-id fast path claims a scalar where.id', async () => {
      // Ordering regression: the token would otherwise be bound as the primary
      // key itself (`WHERE id = '{current_user_id}'`).
      const { driver, seen } = makeDriver();
      const ql = await makeEngine(driver);

      await ql.update('deal', { title: 'x' }, { where: { id: '{current_user_id}' }, context: CTX } as any);

      expect(seen.updateId).toBe('usr_1');
    });

    it('read and write agree on the same filter', async () => {
      const { driver, seen } = makeDriver();
      const ql = await makeEngine(driver);
      const filter = { owner: '{current_user_id}' };

      await ql.find('deal', { where: filter, context: CTX });
      await ql.update('deal', { title: 'x' }, { where: filter, multi: true, context: CTX } as any);

      expect(seen.updateManyAst?.where).toEqual(seen.findAst?.where);
    });

    it('an unknown placeholder throws before anything is written', async () => {
      const { driver } = makeDriver();
      const ql = await makeEngine(driver);

      await expect(
        ql.delete('deal', { where: { owner: '{current_user}' }, multi: true, context: CTX } as any),
      ).rejects.toThrow(/current_user_id/);
      expect(driver.deleteMany).not.toHaveBeenCalled();
      expect(driver.delete).not.toHaveBeenCalled();
    });

    it('does not mutate the caller options — flow node config is reused', async () => {
      const { driver } = makeDriver();
      const ql = await makeEngine(driver);
      const options: any = { where: { owner: '{current_user_id}' }, multi: true, context: CTX };

      await ql.update('deal', { title: 'x' }, options);

      expect(options.where).toEqual({ owner: '{current_user_id}' });
    });
  });

  it('does not mutate the caller filter — view metadata is shared across requests', async () => {
    const { driver } = makeDriver();
    const ql = await makeEngine(driver);
    const viewFilter = { owner: '{current_user_id}' };

    await ql.find('deal', { where: viewFilter, context: CTX });
    await ql.find('deal', { where: viewFilter, context: { ...CTX, userId: 'usr_2' } as any });

    expect(viewFilter).toEqual({ owner: '{current_user_id}' });
    expect(driver.find.mock.calls[1][1].where).toEqual({ owner: 'usr_2' });
  });
});
