// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21080] `ObjectQL.hasObjectMiddleware`, the engine's read-only answer to
 * "is a middleware registered FOR this object?" (`IObjectQLEngine.hasObjectMiddleware`).
 *
 * The analytics native-SQL strategy runs no engine operation, so no engine
 * middleware runs on it. It asks this accessor and declines an object that
 * carries one, so the engine path serves that object and its middlewares run.
 * What each case pins:
 *
 * - **Object-keyed.** A registration naming the object answers `true`; an
 *   object no registration names answers `false`.
 * - **Global is not object-keyed.** A registration with no `object`, or with
 *   `'*'`, matches every object at dispatch, but it is keyed to none, so it
 *   answers `false` for every object.
 * - **Read-only.** Asking runs no middleware and changes nothing the dispatch
 *   reads: on a later read the same middlewares run, once each.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ObjectQL } from './engine';
import { SchemaRegistry } from './registry';

vi.mock('./registry', async () => {
  // [#10551] The one shared factory — see `registry-module-mock.ts`.
  const { createRegistryModuleMock } = await import('./registry-module-mock.js');
  return createRegistryModuleMock();
});

const GATED = 'gated_note';
const PLAIN = 'plain_note';

const passThrough = () => vi.fn(async (_ctx: unknown, next: () => Promise<void>) => next());

async function makeEngine(): Promise<ObjectQL> {
  vi.mocked((SchemaRegistry as any).getObject).mockImplementation((name: string) =>
    name === GATED || name === PLAIN ? { name, fields: { title: { type: 'text' } } } : undefined,
  );
  const driver: any = {
    name: 'memory',
    supports: {},
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    find: vi.fn(async () => []),
    findOne: vi.fn(async () => null),
    count: vi.fn(async () => 0),
    aggregate: vi.fn(async () => []),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  };
  const ql = new ObjectQL();
  ql.registerDriver(driver, true);
  await ql.init();
  return ql;
}

describe('ObjectQL.hasObjectMiddleware — the engine answers which objects carry an object-keyed middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('answers true for an object a registration names, and false for one none names', async () => {
    const ql = await makeEngine();
    ql.registerMiddleware(passThrough(), { object: GATED });
    expect(ql.hasObjectMiddleware(GATED)).toBe(true);
    expect(ql.hasObjectMiddleware(PLAIN)).toBe(false);
  });

  it('answers false for every object when only global registrations exist', async () => {
    const ql = await makeEngine();
    ql.registerMiddleware(passThrough());
    ql.registerMiddleware(passThrough(), { object: '*' });
    expect(ql.hasObjectMiddleware(GATED)).toBe(false);
    expect(ql.hasObjectMiddleware('*')).toBe(false);
  });

  it('answers false on an engine with no registration at all', async () => {
    const ql = await makeEngine();
    expect(ql.hasObjectMiddleware(GATED)).toBe(false);
  });

  it('runs no middleware and leaves the dispatch set unchanged', async () => {
    const ql = await makeEngine();
    const keyed = passThrough();
    const global = passThrough();
    ql.registerMiddleware(keyed, { object: GATED });
    ql.registerMiddleware(global);
    expect(ql.hasObjectMiddleware(GATED)).toBe(true);
    expect(ql.hasObjectMiddleware(PLAIN)).toBe(false);
    expect(keyed).not.toHaveBeenCalled();
    expect(global).not.toHaveBeenCalled();
    // Positive control: a read through the chain reaches both, once each, and
    // a read of the other object reaches the global one alone.
    await ql.count(GATED, {});
    expect(keyed).toHaveBeenCalledTimes(1);
    expect(global).toHaveBeenCalledTimes(1);
    await ql.count(PLAIN, {});
    expect(keyed).toHaveBeenCalledTimes(1);
    expect(global).toHaveBeenCalledTimes(2);
  });
});
