// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21080] `NativeSQLStrategy` declines an object that carries an object-keyed
 * ENGINE middleware, and fails closed when the engine cannot say.
 *
 * The native strategy compiles the statement itself and runs it through the
 * driver's raw-SQL seam, so no engine operation runs and no engine middleware
 * does. The read gates that live in the engine as per-object middlewares (the
 * comment, activity and attachment gates, the approval snapshot redaction) did
 * not apply on it. The engine now answers, read-only, which objects carry such a
 * middleware (`IObjectQLEngine.hasObjectMiddleware`); the context carries that
 * answer (`DatasetScopedStrategyContext.hasObjectMiddleware`), and the strategy
 * declines, so the ObjectQL strategy hands the query to the engine with the
 * caller's context and the gates run.
 *
 * What each block pins:
 *
 * - **The decline, per object the statement reads.** The base object, a
 *   declared join, and an object the door scoped through a relationship path.
 * - **Fail closed.** A context hook that cannot answer (`undefined`) declines.
 *   So does the plugin, when the data engine does not carry the member: it
 *   says so once and every native query routes to the engine path.
 * - **Controls.** An object no middleware names is still served natively, and
 *   a context built with no hook keeps the behaviour it had.
 * - **End to end.** Through `AnalyticsService` and through
 *   `AnalyticsServicePlugin`: the engine path serves the gated object with the
 *   caller's context, and the raw-SQL seam is never called for it.
 */

import { describe, it, expect, vi } from 'vitest';
import type { Cube } from '@objectstack/spec/data';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { NativeSQLStrategy } from '../strategies/native-sql-strategy.js';
import type { DatasetScopedStrategyContext, StrategyContext } from '../strategies/types.js';
import { AnalyticsService } from '../analytics-service.js';
import { AnalyticsServicePlugin } from '../plugin.js';

const GATED = 'mw_gated_note';
const PLAIN = 'mw_plain_note';
const JOINED = 'mw_joined_owner';

const caps = () => ({ nativeSql: true, objectqlAggregate: true, inMemory: false });

function cubeOn(object: string, joins?: Record<string, { name: string }>): Cube {
  return {
    name: `c_${object}`,
    sql: object,
    ...(joins ? { joins } : {}),
    measures: { n: { sql: '*', type: 'count', title: 'n' } },
    dimensions: { kind: { sql: 'kind', type: 'string', title: 'kind' } },
    public: true,
  } as unknown as Cube;
}

function ctxFor(
  cube: Cube,
  extra: Partial<DatasetScopedStrategyContext> = {},
): StrategyContext {
  return {
    getCube: () => cube,
    queryCapabilities: caps,
    executeRawSql: async () => [],
    ...extra,
  } as unknown as StrategyContext;
}

const queryOf = (cube: Cube) => ({ cube: cube.name, measures: ['n'], dimensions: ['kind'] }) as any;
const gatedOnly = (object: string) => object === GATED;

describe('NativeSQLStrategy.canHandle — an object with an engine middleware is declined', () => {
  const strategy = new NativeSQLStrategy();

  it('declines when the base object carries one', () => {
    const cube = cubeOn(GATED);
    expect(strategy.canHandle(queryOf(cube), ctxFor(cube, { hasObjectMiddleware: gatedOnly }))).toBe(false);
  });

  it('declines when a declared join reads one', () => {
    const cube = cubeOn(PLAIN, { owner: { name: GATED } });
    expect(strategy.canHandle(queryOf(cube), ctxFor(cube, { hasObjectMiddleware: gatedOnly }))).toBe(false);
  });

  it('declines when an object the door scoped through a relationship path carries one', () => {
    const cube = cubeOn(PLAIN);
    const ctx = ctxFor(cube, {
      hasObjectMiddleware: gatedOnly,
      getReadScope: () => null,
      readScopedObjects: [PLAIN, GATED],
    });
    expect(strategy.canHandle(queryOf(cube), ctx)).toBe(false);
  });

  it('fails closed: declines when the hook cannot answer', () => {
    const cube = cubeOn(PLAIN);
    expect(strategy.canHandle(queryOf(cube), ctxFor(cube, { hasObjectMiddleware: () => undefined }))).toBe(false);
  });

  it('control: serves natively when no object the statement reads carries one', () => {
    const cube = cubeOn(PLAIN, { owner: { name: JOINED } });
    expect(strategy.canHandle(queryOf(cube), ctxFor(cube, { hasObjectMiddleware: gatedOnly }))).toBe(true);
  });

  it('control: a context built with no hook keeps the behaviour it had', () => {
    const cube = cubeOn(GATED);
    expect(strategy.canHandle(queryOf(cube), ctxFor(cube))).toBe(true);
  });
});

describe('AnalyticsService — the engine path serves a gated object, with the caller\'s context', () => {
  const caller = { userId: 'u_member', tenantId: 'org_1' } as unknown as ExecutionContext;

  function serviceWith(hasObjectMiddleware?: (object: string) => boolean | undefined) {
    const rawSql = vi.fn(async () => [{ kind: 'raw', n: 1 }]);
    const aggregate = vi.fn(async () => [{ kind: 'engine', n: 2 }]);
    const service = new AnalyticsService({
      cubes: [cubeOn(GATED), cubeOn(PLAIN)],
      queryCapabilities: caps,
      executeRawSql: rawSql,
      executeAggregate: aggregate,
      ...(hasObjectMiddleware ? { hasObjectMiddleware } : {}),
    });
    return { service, rawSql, aggregate };
  }

  it('a gated object never reaches the raw-SQL seam, and the engine receives the caller', async () => {
    const { service, rawSql, aggregate } = serviceWith(gatedOnly);
    await service.query({ cube: `c_${GATED}`, measures: ['n'], dimensions: ['kind'] } as any, caller);
    expect(rawSql).not.toHaveBeenCalled();
    expect(aggregate).toHaveBeenCalledTimes(1);
    expect((aggregate.mock.calls[0] as any[])[0]).toBe(GATED);
    expect((aggregate.mock.calls[0] as any[])[1]?.context).toBe(caller);
  });

  it('control: an object no middleware names is still served by the raw-SQL seam', async () => {
    const { service, rawSql, aggregate } = serviceWith(gatedOnly);
    await service.query({ cube: `c_${PLAIN}`, measures: ['n'], dimensions: ['kind'] } as any, caller);
    expect(rawSql).toHaveBeenCalledTimes(1);
    expect(aggregate).not.toHaveBeenCalled();
  });
});

describe('AnalyticsServicePlugin — wired from the data engine, failing closed without its answer', () => {
  function fakePluginContext(services: Record<string, unknown>) {
    const registered: Record<string, unknown> = {};
    const warn = vi.fn();
    return {
      warn,
      registered,
      ctx: {
        getService: (name: string) => services[name] ?? registered[name],
        registerService: (name: string, svc: unknown) => { registered[name] = svc; },
        replaceService: (name: string, svc: unknown) => { registered[name] = svc; },
        logger: { info() {}, warn, error() {}, debug() {} },
      },
    };
  }

  function fakeEngine(hasObjectMiddleware?: (object: string) => boolean) {
    const execute = vi.fn(async () => ({ rows: [{ kind: 'raw', n: 1 }] }));
    const aggregate = vi.fn(async () => [{ kind: 'engine', n: 2 }]);
    const engine: Record<string, unknown> = {
      execute,
      aggregate,
      getObject: (name: string) => (name === GATED || name === PLAIN ? { name, fields: { kind: { type: 'text' } } } : undefined),
    };
    if (hasObjectMiddleware) engine.hasObjectMiddleware = hasObjectMiddleware;
    return { engine, execute, aggregate };
  }

  async function serviceVia(engine: unknown) {
    const { ctx, registered, warn } = fakePluginContext({ data: engine });
    await new AnalyticsServicePlugin({ cubes: [cubeOn(GATED), cubeOn(PLAIN)], queryCapabilities: caps }).init(ctx as never);
    return { service: registered.analytics as AnalyticsService, warn };
  }

  const ask = (service: AnalyticsService, object: string) =>
    service.query({ cube: `c_${object}`, measures: ['n'], dimensions: ['kind'] } as any, { userId: 'u_member' } as any);

  it('an engine that names the object: the engine path serves it, the raw-SQL seam is not called', async () => {
    const { engine, execute, aggregate } = fakeEngine(gatedOnly);
    const { service } = await serviceVia(engine);
    await ask(service, GATED);
    expect(execute).not.toHaveBeenCalled();
    expect(aggregate).toHaveBeenCalledTimes(1);
    await ask(service, PLAIN);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('fails closed: an engine without the member serves every object through the engine path, and says so once', async () => {
    const { engine, execute, aggregate } = fakeEngine();
    const { service, warn } = await serviceVia(engine);
    await ask(service, PLAIN);
    await ask(service, GATED);
    expect(execute).not.toHaveBeenCalled();
    expect(aggregate).toHaveBeenCalledTimes(2);
    const told = warn.mock.calls.filter((c) => String(c[0]).includes('hasObjectMiddleware'));
    expect(told).toHaveLength(1);
  });
});
