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
  const seen: { findAst?: any; findOneAst?: any; countAst?: any; aggregateAst?: any } = {};
  const driver: any = {
    name: 'memory',
    supports: {},
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    find: vi.fn(async (_o: string, ast: any) => { seen.findAst = ast; return []; }),
    findOne: vi.fn(async (_o: string, ast: any) => { seen.findOneAst = ast; return null; }),
    count: vi.fn(async (_o: string, ast: any) => { seen.countAst = ast; return 0; }),
    aggregate: vi.fn(async (_o: string, ast: any) => { seen.aggregateAst = ast; return []; }),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
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
      aggregations: [{ func: 'count', field: 'id', alias: 'n' }],
      context: CTX,
    } as any);

    expect(seen.aggregateAst?.where).toEqual({ close_date: { $gte: THIS_YEAR_START } });
    expect(seen.aggregateAst?.groupBy).toEqual(['owner']);
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
