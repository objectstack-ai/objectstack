// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#5637] The hook layer writes its diagnostics through the `Logger` CONTRACT.
 *
 * `packages/spec/src/contracts/logger.ts` declares
 * `error(message, error?: Error, meta?)` — the `Error` slot is SECOND and the
 * meta bag is THIRD. Both hook modules used to declare their own logger shape
 * with `error(msg, meta?)`, and their call sites passed the diagnostic in the
 * second slot accordingly.
 *
 * Nothing caught it: the contract type satisfies that local shape structurally,
 * so `tsc` stayed silent, and the implementation the platform happens to inject
 * (`ObjectLogger`) dispatches its second argument BY SHAPE, so the meta landed
 * anyway. The contract's other implementations (`ConsoleLogger` / `JsonLogger`
 * in `@objectstack/observability`) follow the contract literally — the meta bag
 * lands in the `error` slot, `error.message`/`error.stack` read `undefined`,
 * `meta` IS `undefined`, and the whole diagnostic evaporates.
 *
 * So these tests judge the call sites with a logger that is FAITHFUL to the
 * contract — one that keeps its three parameters apart and records them
 * separately. Under the old dialect every one of them fails with
 * `meta === undefined` and the diagnostic sitting in `error`.
 *
 * The last block guards the other direction: `ObjectLogger`'s shape dispatch
 * must keep working with `undefined` in the `Error` slot (it is the
 * implementation every host gets today, and #5575 is what made its third
 * parameter honest).
 */

import { describe, it, expect } from 'vitest';
import { ObjectLogger } from '@objectstack/core';
import type { Hook, HookContext } from '@objectstack/spec/data';
import { ObjectQL } from './engine.js';
import { bindHooksToEngine } from './hook-binder.js';
import { wrapDeclarativeHook, type HookDiagnosticsLogger } from './hook-wrappers.js';

/** One `error(...)` call, with its three contract parameters kept apart. */
interface ErrorCall {
  message: string;
  error: Error | undefined;
  meta: Record<string, any> | undefined;
}

/**
 * A logger that implements the contract EXACTLY as declared — the behaviour
 * `ConsoleLogger`/`JsonLogger` have and `ObjectLogger` generalises. It performs
 * no shape dispatch on purpose: that tolerance is what hid the defect, so a
 * test that reproduced it could not see anything.
 */
function makeContractLogger() {
  const errors: ErrorCall[] = [];
  const logger: HookDiagnosticsLogger = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: (message: string, error?: Error, meta?: Record<string, any>) => {
      errors.push({ message, error, meta });
    },
  };
  return { logger, errors };
}

const silentLogger: HookDiagnosticsLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

function makeCtx(overrides: Partial<HookContext> = {}): HookContext {
  return {
    object: 'account',
    event: 'beforeInsert',
    input: { data: { name: 'acme' } },
    ql: undefined,
    ...overrides,
  } as HookContext;
}

/** Every recorded call kept its meta in the meta slot and left `error` empty. */
function expectContractShape(call: ErrorCall) {
  expect(call.error).toBeUndefined();
  expect(call.meta).toBeTypeOf('object');
  expect(call.meta).not.toBeNull();
}

describe('[#5637] wrapDeclarativeHook writes diagnostics in the Logger contract shape', () => {
  it("onError: 'log' — the suppressed failure keeps its hook/object/event/error meta", async () => {
    const { logger, errors } = makeContractLogger();
    const meta: Hook = {
      name: 'audit_task',
      object: 'account',
      events: ['beforeInsert'],
      onError: 'log',
      handler: async () => { throw new Error('handler exploded'); },
    } as Hook;

    const wrapped = wrapDeclarativeHook(meta, (async () => { throw new Error('handler exploded'); }) as any, { logger });
    // `onError: 'log'` suppresses — the call must not reject.
    await wrapped(makeCtx());

    expect(errors).toHaveLength(1);
    const call = errors[0]!;
    expect(call.message).toContain('onError=log');
    expectContractShape(call);
    expect(call.meta).toMatchObject({
      hook: 'audit_task',
      object: 'account',
      event: 'beforeInsert',
      error: 'handler exploded',
    });
  });

  it('fire-and-forget — the async after-hook failure keeps its meta', async () => {
    const { logger, errors } = makeContractLogger();
    const meta: Hook = {
      name: 'async_audit',
      object: 'account',
      events: ['afterInsert'],
      async: true,
      onError: 'abort',
      handler: async () => { throw new Error('async exploded'); },
    } as Hook;

    const wrapped = wrapDeclarativeHook(meta, (async () => { throw new Error('async exploded'); }) as any, { logger });
    await wrapped(makeCtx({ event: 'afterInsert' }));
    // Fire-and-forget: the rejection is reported on a later turn.
    await new Promise((r) => setTimeout(r, 10));

    expect(errors).toHaveLength(1);
    const call = errors[0]!;
    expect(call.message).toContain('fire-and-forget');
    expectContractShape(call);
    expect(call.meta).toMatchObject({ hook: 'async_audit', error: 'async exploded' });
  });

  it('an uncompilable condition keeps the condition source in its meta', () => {
    const { logger, errors } = makeContractLogger();
    const meta: Hook = {
      name: 'broken_condition',
      object: 'account',
      events: ['beforeInsert'],
      condition: 'record.done == = true',
      handler: async () => {},
    } as Hook;

    // The diagnostic is emitted at WRAP time (the compile failure is known
    // then); the rejection itself happens per invocation.
    wrapDeclarativeHook(meta, (async () => {}) as any, { logger });

    expect(errors).toHaveLength(1);
    const call = errors[0]!;
    expect(call.message).toContain('failed to compile');
    expectContractShape(call);
    expect(call.meta).toMatchObject({
      hook: 'broken_condition',
      condition: 'record.done == = true',
    });
    expect(String(call.meta?.error)).not.toBe('undefined');
  });
});

describe('[#5637] bindHooksToEngine writes its bind failure in the Logger contract shape', () => {
  it('a throwing registerHook is reported with the hook name and cause in meta', () => {
    const engine = new ObjectQL({ logger: silentLogger } as any);
    (engine as any).registerHook = () => { throw new Error('registry refused'); };

    const { logger, errors } = makeContractLogger();
    const hook: Hook = {
      name: 'h_bind_fail',
      object: 'account',
      events: ['beforeInsert'],
      handler: async () => {},
    } as Hook;

    const result = bindHooksToEngine(engine, [hook], { packageId: 'app:test', logger });

    expect(result.registered).toBe(0);
    expect(result.errors).toEqual([{ hook: 'h_bind_fail', reason: 'registry refused' }]);
    expect(errors).toHaveLength(1);
    const call = errors[0]!;
    expect(call.message).toContain('failed to bind hook');
    expectContractShape(call);
    expect(call.meta).toMatchObject({ hook: 'h_bind_fail', error: 'registry refused' });
  });
});

describe('[#5637] ObjectLogger keeps rendering the meta with an empty Error slot', () => {
  /**
   * The compatibility half. `ObjectLogger` is what every host injects today
   * (`ctx.logger` / `engine.logger`), and since #5575 its `error` honours all
   * three shapes — `(msg, Error)`, `(msg, meta)` and `(msg, undefined, meta)`.
   * This pins the third one, which is what the hook layer now emits: a bare
   * message with the fields gone would be the regression.
   */
  it('emits the hook diagnostic fields on a contract-shaped call', async () => {
    const written: string[] = [];
    const realErrWrite = process.stderr.write.bind(process.stderr);
    (process.stderr as { write: unknown }).write = (chunk: string) => {
      written.push(String(chunk));
      return true;
    };

    try {
      const logger = new ObjectLogger({ level: 'error', format: 'json' });
      const meta: Hook = {
        name: 'audit_task',
        object: 'account',
        events: ['beforeInsert'],
        onError: 'log',
        handler: async () => { throw new Error('handler exploded'); },
      } as Hook;
      const wrapped = wrapDeclarativeHook(meta, (async () => { throw new Error('handler exploded'); }) as any, { logger });
      await wrapped(makeCtx());
    } finally {
      (process.stderr as { write: unknown }).write = realErrWrite;
    }

    const line = written.find((l) => l.includes('onError=log'));
    expect(line, 'the suppressed-failure diagnostic reached stderr').toBeTruthy();
    const record = JSON.parse(line!.trim());
    expect(record.level).toBe('error');
    expect(record.hook).toBe('audit_task');
    expect(record.object).toBe('account');
    expect(record.event).toBe('beforeInsert');
    expect(record.error).toBe('handler exploded');
  });
});
