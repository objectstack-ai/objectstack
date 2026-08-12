// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ObjectQL } from './engine';
import { SchemaRegistry } from './registry';

/**
 * #2737 — count() and aggregate() must honor middleware-injected read filters.
 *
 * The security/sharing middlewares inject RLS / OWD-scope filters into
 * `opCtx.ast.where`. find() carried its AST on the opCtx, so records were
 * scoped — but count() and aggregate() built a LOCAL ast inside the executor
 * from the caller's raw `where`, discarding every injected filter. Result:
 * `GET /data/:object` returned scoped `records` with an UNSCOPED `total`
 * (a row-count oracle over invisible records, and broken pagination).
 *
 * These tests assert on what the DRIVER receives: the middleware's filter
 * must be present in the ast that reaches driver.count / driver.aggregate.
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

const NOTE_SCHEMA = {
  name: 'note',
  fields: {
    title: { type: 'text' },
    owner: { type: 'text' },
  },
};

function makeDriver() {
  const seen: { countAst?: any; aggregateAst?: any; findAst?: any } = {};
  const driver: any = {
    name: 'memory',
    supports: {},
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    find: vi.fn(async (_o: string, ast: any) => {
      seen.findAst = ast;
      return [];
    }),
    count: vi.fn(async (_o: string, ast: any) => {
      seen.countAst = ast;
      return 0;
    }),
    aggregate: vi.fn(async (_o: string, ast: any) => {
      seen.aggregateAst = ast;
      return [];
    }),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  };
  return { driver, seen };
}

/** A read-filter middleware shaped like the security/sharing ones. */
function injectOwnerFilter(ql: ObjectQL) {
  ql.registerMiddleware(async (ctx: any, next: () => Promise<void>) => {
    if (['find', 'findOne', 'count', 'aggregate'].includes(ctx.operation)) {
      const scoped = { owner: 'me' };
      const ast: any = ctx.ast ?? { object: ctx.object };
      ast.where = ast.where ? { $and: [ast.where, scoped] } : scoped;
      ctx.ast = ast;
    }
    await next();
  });
}

async function makeEngine(driver: any) {
  vi.mocked((SchemaRegistry as any).getObject).mockImplementation((name: string) =>
    name === 'note' ? NOTE_SCHEMA : undefined,
  );
  const ql = new ObjectQL();
  ql.registerDriver(driver, true);
  await ql.init();
  return ql;
}

describe('engine read scoping — count/aggregate honor injected filters (#2737)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('count(): the middleware filter reaches driver.count', async () => {
    const { driver, seen } = makeDriver();
    const ql = await makeEngine(driver);
    injectOwnerFilter(ql);

    await ql.count('note', { where: { title: 'x' } });

    expect(seen.countAst?.where).toEqual({ $and: [{ title: 'x' }, { owner: 'me' }] });
  });

  it('count() with no caller where: filter still applies', async () => {
    const { driver, seen } = makeDriver();
    const ql = await makeEngine(driver);
    injectOwnerFilter(ql);

    await ql.count('note');

    expect(seen.countAst?.where).toEqual({ owner: 'me' });
  });

  it('aggregate(): the middleware filter reaches driver.aggregate', async () => {
    const { driver, seen } = makeDriver();
    const ql = await makeEngine(driver);
    injectOwnerFilter(ql);

    await ql.aggregate('note', {
      where: { title: 'x' },
      groupBy: ['owner'],
      aggregations: [{ function: 'count', field: 'id', alias: 'n' }],
    });

    expect(seen.aggregateAst?.where).toEqual({ $and: [{ title: 'x' }, { owner: 'me' }] });
    // groupBy/aggregations survive on the same ast.
    expect(seen.aggregateAst?.groupBy).toEqual(['owner']);
    expect(seen.aggregateAst?.aggregations).toEqual([
      { function: 'count', field: 'id', alias: 'n' },
    ]);
  });

  it('count() and find() see the SAME scoped where (total matches records)', async () => {
    const { driver, seen } = makeDriver();
    const ql = await makeEngine(driver);
    injectOwnerFilter(ql);

    await ql.find('note', { where: { title: 'x' } });
    await ql.count('note', { where: { title: 'x' } });

    expect(seen.countAst?.where).toEqual(seen.findAst?.where);
  });
});
