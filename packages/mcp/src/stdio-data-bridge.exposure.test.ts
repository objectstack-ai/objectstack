// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #8083 — transport parity for the ADR-0049 object exposure gate.
 *
 * The defect: both MCP transports register the SAME tools from the same
 * `McpDataBridge` (#8034 made that structural), but the two hosts implement
 * that bridge over different seams — HTTP through `callData`, which gates on
 * the object's declared `apiEnabled` / `apiMethods`, and stdio straight onto
 * the engine, which did not. One declaration, two transports, two answers.
 *
 * **What was leaking is the author's DECLARATION, not the data guard.** The
 * gate is a surface-area control by `api-exposure.ts`'s own ADR note, and every
 * stdio call passed the engine's CRUD/FLS/RLS before this change and after it.
 * These tests are graded accordingly: they assert an exposure verdict, never a
 * data-authorization one.
 *
 * ## How the parity claim is pinned from inside `packages/mcp`
 *
 * The HTTP verdict function is `checkApiExposure`
 * (`packages/runtime/src/api-exposure.ts`), and `packages/mcp` neither depends
 * on `@objectstack/runtime` nor may read its sources (that would be exactly the
 * cross-package test input `check:cross-package-test-inputs` exists to catch).
 * So the parity is pinned the way it is actually reviewable: the declaration →
 * verdict table below is the SAME table `packages/runtime/src/api-exposure.test.ts`
 * pins the HTTP side against, case for case — `apiEnabled: false` → 404,
 * a whitelist miss → 405, `[]` → deny-all, `find`/`query` → `list`,
 * `aggregate` as a list-class read, an unmapped action ungated, and the nested
 * `enable` block winning over the flat shape. If either surface moves off the
 * shared derivation, the two tables stop agreeing.
 *
 * The half that is NOT a hand-copied table is {@link GATED_ACTIONS}: it is
 * asserted structurally against the spec's own action map, so a typo in an
 * action word cannot silently degrade a verb to the ungated pass-through.
 */

import { describe, it, expect, vi } from 'vitest';
import { DATA_ACTION_TO_API_OPERATION } from '@objectstack/spec/data';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import type { IDataEngine, IMetadataService } from '@objectstack/spec/contracts';
import { createStdioDataBridge, GATED_ACTIONS, type McpExposureError } from './stdio-data-bridge.js';

// ---------------------------------------------------------------------------
// Doubles
// ---------------------------------------------------------------------------

/**
 * The engine double. `insert` / `update` / `delete` are bare `vi.fn()` — the
 * idiom `__tests__/plugin.test.ts` already uses here — because every write
 * assertion below is that they were **never reached**: the gate refuses before
 * dispatch, so a double that modelled the engine's write semantics would be
 * modelling a call that must not happen.
 */
function makeEngine(rows: Array<Record<string, unknown>> = [{ id: 'r1', title: 'row' }]) {
  return {
    find: vi.fn(async () => rows),
    findOne: vi.fn(async () => rows[0] ?? null),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    count: vi.fn(async () => rows.length),
    aggregate: vi.fn(async () => [{ n: rows.length }]),
  };
}

/** A metadata service serving ONE object definition (or a thrown read). */
function makeMetadata(def: unknown, opts?: { throws?: boolean }) {
  return {
    listObjects: vi.fn(async () => [{ name: 'task', label: 'Task', fields: {} }]),
    getObject: vi.fn(async () => {
      if (opts?.throws) throw new Error('metadata service is down');
      return def;
    }),
    get: vi.fn(async () => null),
    list: vi.fn(async () => []),
    exists: vi.fn(async () => true),
    getRegisteredTypes: vi.fn(async () => ['object']),
    register: vi.fn(),
    unregister: vi.fn(),
  };
}

const PRINCIPAL = { userId: 'u1', isSystem: false } as unknown as ExecutionContext;
const SYSTEM = { userId: 'u1', isSystem: true } as unknown as ExecutionContext;

function makeBridge(
  def: unknown,
  opts?: { throws?: boolean; context?: ExecutionContext; rows?: Array<Record<string, unknown>> },
) {
  const engine = makeEngine(opts?.rows);
  const metadataService = makeMetadata(def, { throws: opts?.throws });
  const bridge = createStdioDataBridge({
    engine: engine as unknown as IDataEngine,
    metadataService: metadataService as unknown as IMetadataService,
    resolvePrincipal: async () => opts?.context ?? PRINCIPAL,
  });
  return { bridge, engine, metadataService };
}

/** Run a bridge verb by name with arguments that satisfy every signature. */
function invoke(bridge: ReturnType<typeof makeBridge>['bridge'], method: string): Promise<unknown> {
  switch (method) {
    case 'query':
      return bridge.query('task', { limit: 5 }) as Promise<unknown>;
    case 'get':
      return bridge.get('task', 'r1') as Promise<unknown>;
    case 'create':
      return bridge.create('task', { title: 'x' }) as Promise<unknown>;
    case 'update':
      return bridge.update('task', 'r1', { title: 'x' }) as Promise<unknown>;
    case 'remove':
      return bridge.remove('task', 'r1') as Promise<unknown>;
    case 'aggregate':
      return bridge.aggregate!('task', {
        aggregations: [{ function: 'count', field: 'id', alias: 'n' }],
      }) as Promise<unknown>;
    default:
      throw new Error(`no such bridge verb: ${method}`);
  }
}

/**
 * Assert an exposure refusal by its ENVELOPE (ADR-0112), not by the fact that
 * something threw: a bridge that threw a bare `Error` for an unrelated reason
 * would satisfy `.toThrow()` while the gate stayed missing.
 */
async function expectRefusal(
  run: () => Promise<unknown>,
  expected: { code: string; status: number },
): Promise<McpExposureError> {
  const err = (await run().then(
    () => null,
    (e: unknown) => e,
  )) as McpExposureError | null;
  expect(err, 'the call resolved — no exposure refusal was raised').toBeTruthy();
  expect(err!.code).toBe(expected.code);
  expect(err!.status).toBe(expected.status);
  return err!;
}

const ALL_GATED = Object.keys(GATED_ACTIONS) as Array<keyof typeof GATED_ACTIONS>;

// ---------------------------------------------------------------------------
// The structural half — no hand-copied table
// ---------------------------------------------------------------------------

describe('#8083 the gated verb set is the HTTP one', () => {
  it('gates exactly the six methods `buildMcpBridge` routes through callData', () => {
    // `listObjects` / `describeObject` are absent BY DESIGN: the HTTP bridge
    // answers both straight off the metadata service, so gating them here
    // would be a fresh divergence in the opposite direction.
    expect(ALL_GATED.sort()).toEqual(
      ['aggregate', 'create', 'get', 'query', 'remove', 'update'].sort(),
    );
  });

  it('spells every action in a way the spec map actually recognises', () => {
    // The failure this catches is silent: `DATA_ACTION_TO_API_OPERATION[action]
    // ?? action` passes an unrecognised word straight through as an ungated
    // custom action. A typo here would not throw — it would just stop gating
    // that verb, which is the bug this card exists to close.
    for (const [method, action] of Object.entries(GATED_ACTIONS)) {
      expect(
        DATA_ACTION_TO_API_OPERATION[action],
        `bridge.${method} gates on "${action}", which the spec's action map does not define`,
      ).toBeTruthy();
    }
  });

  it('maps `remove` onto the `delete` action word, as callData receives it', () => {
    // The one entry whose bridge name and action word differ.
    expect(GATED_ACTIONS.remove).toBe('delete');
    expect(DATA_ACTION_TO_API_OPERATION.delete).toBe('delete');
  });
});

// ---------------------------------------------------------------------------
// The declaration → verdict table (mirrors runtime/src/api-exposure.test.ts)
// ---------------------------------------------------------------------------

describe('#8083 apiEnabled: false hides the object on stdio (404)', () => {
  it.each(ALL_GATED)('refuses %s', async (method) => {
    const { bridge, engine } = makeBridge({ name: 'task', enable: { apiEnabled: false } });

    const err = await expectRefusal(() => invoke(bridge, method), {
      code: 'OBJECT_API_DISABLED',
      status: 404,
    });
    expect(err.message).toContain('task');

    // Refused BEFORE dispatch — the engine was never asked anything.
    expect(engine.find).not.toHaveBeenCalled();
    expect(engine.insert).not.toHaveBeenCalled();
    expect(engine.update).not.toHaveBeenCalled();
    expect(engine.delete).not.toHaveBeenCalled();
    expect(engine.aggregate).not.toHaveBeenCalled();
  });

  it('still serves the schema reads the HTTP bridge serves ungated', async () => {
    // The other direction of parity: `describe_object` / `list_objects` answer
    // off the metadata service on HTTP with no gate, so a hidden object's
    // SCHEMA stays readable on stdio too. Divergence in either direction is
    // the same defect.
    const { bridge } = makeBridge({ name: 'task', label: 'Task', enable: { apiEnabled: false } });

    await expect(bridge.describeObject('task')).resolves.toMatchObject({ name: 'task' });
    await expect(bridge.listObjects()).resolves.toHaveLength(1);
  });
});

describe('#8083 apiMethods whitelist on stdio', () => {
  const readOnly = { name: 'task', enable: { apiMethods: ['list', 'get'] } };

  it('allows the whitelisted reads (query → list, get → get)', async () => {
    const { bridge, engine } = makeBridge(readOnly);

    await expect(bridge.query('task', { limit: 5 })).resolves.toMatchObject({ object: 'task' });
    await expect(bridge.get('task', 'r1')).resolves.toMatchObject({ id: 'r1' });
    expect(engine.find).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['create', 'create'],
    ['update', 'update'],
    ['remove', 'delete'],
  ] as const)('refuses %s (405) and names the effective set', async (method, operation) => {
    const { bridge, engine } = makeBridge(readOnly);

    const err = await expectRefusal(() => invoke(bridge, method), {
      code: 'OBJECT_API_METHOD_NOT_ALLOWED',
      status: 405,
    });
    expect(err.message).toContain(operation);
    // The EFFECTIVE operation set, as REST's 405 body carries it — the
    // whitelist plus its derived reads, never the raw declaration.
    expect(err.allowedOperations).toContain('get');
    expect(err.allowedOperations).toContain('list');
    expect(err.allowedOperations).not.toContain(operation);

    expect(engine.insert).not.toHaveBeenCalled();
    expect(engine.update).not.toHaveBeenCalled();
    expect(engine.delete).not.toHaveBeenCalled();
  });

  it('gates aggregate as a list-class read', async () => {
    // An object whose whitelist excludes `list` must not leak row statistics
    // through GROUP BY either — the derivation, not a special case here.
    const listed = makeBridge({ name: 'task', enable: { apiMethods: ['list'] } });
    await expect(
      listed.bridge.aggregate!('task', {
        aggregations: [{ function: 'count', field: 'id', alias: 'n' }],
      }),
    ).resolves.toBeDefined();

    const getOnly = makeBridge({ name: 'task', enable: { apiMethods: ['get'] } });
    await expectRefusal(() => invoke(getOnly.bridge, 'aggregate'), {
      code: 'OBJECT_API_METHOD_NOT_ALLOWED',
      status: 405,
    });
    expect(getOnly.engine.aggregate).not.toHaveBeenCalled();
  });

  it('an empty whitelist is deny-all', async () => {
    const { bridge } = makeBridge({ name: 'task', enable: { apiMethods: [] } });

    for (const method of ALL_GATED) {
      await expectRefusal(() => invoke(bridge, method), {
        code: 'OBJECT_API_METHOD_NOT_ALLOWED',
        status: 405,
      });
    }
  });

  it('an absent whitelist is unrestricted', async () => {
    const { bridge, engine } = makeBridge({ name: 'task', enable: { apiEnabled: true } });

    await expect(bridge.create('task', { title: 'x' })).resolves.toMatchObject({ object: 'task' });
    expect(engine.insert).toHaveBeenCalledTimes(1);
  });
});

describe('#8083 shapes the HTTP gate reads that stdio must read too', () => {
  it('reads the flat legacy shape when there is no nested enable block', async () => {
    // `checkApiExposure` falls back to the flat top level for legacy/test
    // doubles. Reading only the nested shape here would re-open this very
    // divergence one shape down: gated on HTTP, ungated on stdio.
    const { bridge } = makeBridge({ name: 'task', apiEnabled: false });

    await expectRefusal(() => invoke(bridge, 'get'), {
      code: 'OBJECT_API_DISABLED',
      status: 404,
    });
  });

  it('lets the nested enable block win over the flat shape', async () => {
    const { bridge, engine } = makeBridge({ name: 'task', apiEnabled: false, enable: {} });

    await expect(bridge.get('task', 'r1')).resolves.toMatchObject({ id: 'r1' });
    expect(engine.find).toHaveBeenCalledTimes(1);
  });
});

describe('#8083 the fail-open and bypass behaviours match the HTTP path', () => {
  it('falls open when the metadata read throws', async () => {
    // `callData` wraps its metadata read in `catch { def = undefined }` and
    // `checkApiExposure(undefined, …)` allows. Failing CLOSED here would be a
    // divergence in the other direction — #3545's reasoning holds because the
    // engine's CRUD/FLS/RLS still runs on the call.
    const { bridge, engine } = makeBridge(null, { throws: true });

    await expect(bridge.query('task', { limit: 5 })).resolves.toMatchObject({ object: 'task' });
    expect(engine.find).toHaveBeenCalledTimes(1);
  });

  it('falls open when the object does not resolve', async () => {
    const { bridge, engine } = makeBridge(null);

    await expect(bridge.create('task', { title: 'x' })).resolves.toMatchObject({ object: 'task' });
    expect(engine.insert).toHaveBeenCalledTimes(1);
  });

  it('bypasses for a system context, as callData does', async () => {
    // These flags govern API *exposure*, not internal engine self-writes.
    const { bridge, engine, metadataService } = makeBridge(
      { name: 'task', enable: { apiEnabled: false } },
      { context: SYSTEM },
    );

    await expect(bridge.create('task', { title: 'x' })).resolves.toMatchObject({ object: 'task' });
    expect(engine.insert).toHaveBeenCalledTimes(1);
    // Bypassed outright — not "read the metadata then allow".
    expect(metadataService.getObject).not.toHaveBeenCalled();
  });
});

describe('#8083 the gate runs before the existence probe', () => {
  it.each(['update', 'remove'] as const)(
    '%s refuses a hidden object without telling the caller whether the row exists',
    async (method) => {
      // Both verbs probe with `findById` and answer `recordNotFound` on a miss.
      // Gating AFTER that probe would answer "no such record" for one id and
      // succeed for another — an existence oracle on an object the author
      // declared unexposed.
      const { bridge, engine } = makeBridge({ name: 'task', enable: { apiEnabled: false } }, {
        rows: [],
      });

      const err = await expectRefusal(() => invoke(bridge, method), {
        code: 'OBJECT_API_DISABLED',
        status: 404,
      });
      expect(err.message).not.toMatch(/not found/i);
      expect(engine.find).not.toHaveBeenCalled();
    },
  );
});
