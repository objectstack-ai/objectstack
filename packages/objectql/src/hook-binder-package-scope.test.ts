// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A hook's `handler` name resolves inside the hook's OWN package only.
 *
 * The engine's function registry is keyed by bare name, and the binder used to
 * fall back to it unscoped: a hook naming `shared_stamp` bound to whichever
 * package had registered a function of that name, so that package's code ran on
 * this package's events. Now a name resolves against the functions handed to
 * the hook's own bind, then against the entries the SAME package registered; a
 * name the package does not hold is refused at registration with the ADR-0112
 * envelope (`INVALID_REFERENCE`, 400) and the hook is not bound.
 *
 * Every refusal here asserts the code, the status and that the hook did not
 * bind (the other package's function never runs on the event). The controls
 * are the two shapes a package's own functions take: the functions handed to
 * the same bind, and a function the same package registered in an earlier bind.
 */

import { describe, it, expect, vi } from 'vitest';
import { ObjectQL } from './engine.js';
import {
  bindHooksToEngine,
  HOOK_HANDLER_NOT_IN_PACKAGE_CODE,
  HOOK_HANDLER_NOT_IN_PACKAGE_STATUS,
} from './hook-binder.js';
import type { Hook, HookContext } from '@objectstack/spec/data';

function captureLogger() {
  const logger: any = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
  };
  logger.child = () => logger;
  return logger;
}

function makeEngine(logger = captureLogger()) {
  return { engine: new ObjectQL({ logger }), logger };
}

function ctxFor(object = 'account'): HookContext {
  return { object, event: 'beforeInsert', input: { data: {} }, ql: undefined } as unknown as HookContext;
}

const hookNaming = (name: string, handler: string): Hook => ({
  name,
  object: 'account',
  events: ['beforeInsert'],
  priority: 100,
  handler,
});

/** Package A registers `shared_stamp` the way a code package does: through its own bind's `functions`. */
function registerPackageA(engine: ObjectQL, ran: string[]) {
  bindHooksToEngine(engine, [], {
    packageId: 'app:com.example.a',
    functions: { shared_stamp: async () => { ran.push('a:shared_stamp'); } },
  });
}

describe('a hook handler name resolves inside its own package only', () => {
  it('the envelope constants are the standard catalog member and its status', () => {
    expect(HOOK_HANDLER_NOT_IN_PACKAGE_CODE).toBe('INVALID_REFERENCE');
    expect(HOOK_HANDLER_NOT_IN_PACKAGE_STATUS).toBe(400);
  });

  it('refuses a hook naming a function ANOTHER package registered, and that function never runs', async () => {
    const { engine } = makeEngine();
    const ran: string[] = [];
    registerPackageA(engine, ran);

    const result = bindHooksToEngine(engine, [hookNaming('b_cross', 'shared_stamp')], {
      packageId: 'app:com.example.b',
    });

    expect(result.registered).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({ hook: 'b_cross', code: 'INVALID_REFERENCE', status: 400 });
    expect(result.errors[0]!.reason).toContain("'shared_stamp'");
    expect(result.errors[0]!.reason).toContain("'app:com.example.b'");

    await engine.triggerHooks('beforeInsert', ctxFor());
    expect(ran, "package A's function ran on package B's event").toEqual([]);
  });

  it('under strict, the refusal is thrown with its code and status, and nothing binds', async () => {
    const { engine } = makeEngine();
    const ran: string[] = [];
    registerPackageA(engine, ran);

    let thrown: any;
    try {
      bindHooksToEngine(engine, [hookNaming('b_cross_strict', 'shared_stamp')], {
        packageId: 'app:com.example.b',
        strict: true,
      });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect(thrown).toMatchObject({
      code: 'INVALID_REFERENCE',
      status: 400,
      hook: 'b_cross_strict',
      handler: 'shared_stamp',
      packageId: 'app:com.example.b',
    });

    await engine.triggerHooks('beforeInsert', ctxFor());
    expect(ran).toEqual([]);
  });

  it('refuses a name no package holds with the same envelope', async () => {
    const { engine } = makeEngine();
    const result = bindHooksToEngine(engine, [hookNaming('typo_hook', 'shard_stamp')], {
      packageId: 'app:com.example.b',
    });
    expect(result.registered).toBe(0);
    expect(result.errors[0]).toMatchObject({ hook: 'typo_hook', code: 'INVALID_REFERENCE', status: 400 });
  });

  it('the metadata door (owner `metadata-service`) cannot reach a code package\'s function; the refusal is logged at error with its envelope', async () => {
    const { engine, logger } = makeEngine();
    const ran: string[] = [];
    registerPackageA(engine, ran);

    // The door the runtime-authored hooks are bound through.
    engine.bindHooks([hookNaming('authored_cross', 'shared_stamp')], { packageId: 'metadata-service' });

    await engine.triggerHooks('beforeInsert', ctxFor());
    expect(ran, 'a runtime-authored hook ran a code package\'s function').toEqual([]);

    const refusals = logger.error.mock.calls.filter(
      (call: any[]) => call[2]?.hook === 'authored_cross',
    );
    expect(refusals).toHaveLength(1);
    expect(refusals[0][1]).toBeInstanceOf(Error);
    expect(refusals[0][2]).toMatchObject({
      code: 'INVALID_REFERENCE',
      status: 400,
      handler: 'shared_stamp',
      packageId: 'metadata-service',
    });
  });

  it('a bind that names no owning package resolves only what it was handed — never an unowned engine entry', async () => {
    const { engine } = makeEngine();
    const ran: string[] = [];
    engine.registerFunction('loose_fn', async () => { ran.push('loose_fn'); });

    const result = bindHooksToEngine(engine, [hookNaming('unowned_hook', 'loose_fn')], {});
    expect(result.registered).toBe(0);
    expect(result.errors[0]).toMatchObject({ hook: 'unowned_hook', code: 'INVALID_REFERENCE', status: 400 });

    await engine.triggerHooks('beforeInsert', ctxFor());
    expect(ran).toEqual([]);
  });

  it('control: a hook naming a function handed to its own bind binds and runs', async () => {
    const { engine } = makeEngine();
    const ran: string[] = [];
    registerPackageA(engine, ran);

    const result = bindHooksToEngine(engine, [hookNaming('b_own', 'b_stamp')], {
      packageId: 'app:com.example.b',
      functions: { b_stamp: async () => { ran.push('b:b_stamp'); } },
    });
    expect(result.registered).toBe(1);
    expect(result.errors).toEqual([]);

    await engine.triggerHooks('beforeInsert', ctxFor());
    expect(ran).toEqual(['b:b_stamp']);
  });

  it('control: a hook naming a function its OWN package registered in an earlier bind binds and runs', async () => {
    const { engine } = makeEngine();
    const ran: string[] = [];
    registerPackageA(engine, ran);

    const result = bindHooksToEngine(engine, [hookNaming('a_own_later', 'shared_stamp')], {
      packageId: 'app:com.example.a',
    });
    expect(result.registered).toBe(1);
    expect(result.errors).toEqual([]);

    await engine.triggerHooks('beforeInsert', ctxFor());
    expect(ran).toEqual(['a:shared_stamp']);
  });
});
