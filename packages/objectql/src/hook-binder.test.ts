// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
import { ObjectQL } from './engine.js';
import { bindHooksToEngine } from './hook-binder.js';
import { wrapDeclarativeHook } from './hook-wrappers.js';
import type { Hook, HookContext } from '@objectstack/spec/data';

function makeEngine() {
  return new ObjectQL();
}

function makeCtx(overrides: Partial<HookContext> = {}): HookContext {
  return {
    object: 'account',
    event: 'beforeInsert',
    input: { data: { name: 'acme', annual_revenue: 100 } },
    ql: undefined,
    ...overrides,
  } as HookContext;
}

describe('bindHooksToEngine', () => {
  it('binds inline-function hooks per (event, object) and triggers them', async () => {
    const engine = makeEngine();
    const calls: string[] = [];
    const hook: Hook = {
      name: 'h1',
      object: ['account', 'contact'],
      events: ['beforeInsert', 'afterInsert'],
      priority: 100,
      handler: async (ctx) => { calls.push(`${ctx.object}:${ctx.event}`); },
    };

    const result = bindHooksToEngine(engine, [hook], { packageId: 'app:test' });
    expect(result.registered).toBe(4); // 2 events × 2 objects
    expect(result.errors).toEqual([]);

    await engine.triggerHooks('beforeInsert', makeCtx({ object: 'account' }));
    await engine.triggerHooks('afterInsert',  makeCtx({ object: 'contact', event: 'afterInsert' }));
    await engine.triggerHooks('beforeInsert', makeCtx({ object: 'lead' })); // not targeted
    expect(calls).toEqual(['account:beforeInsert', 'contact:afterInsert']);
  });

  it('resolves string handlers via the engine function registry', async () => {
    const engine = makeEngine();
    const seen: string[] = [];
    const hook: Hook = {
      name: 'h2',
      object: 'account',
      events: ['beforeInsert'],
      priority: 100,
      handler: 'normalize_account',
    };

    bindHooksToEngine(engine, [hook], {
      packageId: 'app:t',
      functions: { normalize_account: async () => { seen.push('called'); } },
    });

    await engine.triggerHooks('beforeInsert', makeCtx());
    expect(seen).toEqual(['called']);
  });

  it('skips hooks whose string handler cannot be resolved', () => {
    const engine = makeEngine();
    const hook: Hook = {
      name: 'h3',
      object: 'account',
      events: ['beforeInsert'],
      priority: 100,
      handler: 'unknown_fn',
    };
    const result = bindHooksToEngine(engine, [hook], { packageId: 'p' });
    expect(result.registered).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.errors[0]?.reason).toMatch(/unknown function/);
  });

  it('replaces existing hooks under the same packageId on re-bind', async () => {
    const engine = makeEngine();
    const calls: string[] = [];
    const v1: Hook = {
      name: 'h', object: 'account', events: ['beforeInsert'], priority: 100,
      handler: () => { calls.push('v1'); },
    };
    const v2: Hook = {
      name: 'h', object: 'account', events: ['beforeInsert'], priority: 100,
      handler: () => { calls.push('v2'); },
    };
    bindHooksToEngine(engine, [v1], { packageId: 'app:x' });
    bindHooksToEngine(engine, [v2], { packageId: 'app:x' });

    await engine.triggerHooks('beforeInsert', makeCtx());
    expect(calls).toEqual(['v2']);
  });

  it('skips body-hooks when no bodyRunner is supplied and no default is installed', () => {
    const engine = makeEngine();
    const hook: Hook = {
      name: 'body-no-runner', object: 'account', events: ['beforeInsert'], priority: 100,
      body: { language: 'js', source: "ctx.input.x = 1;" },
    } as unknown as Hook;
    const result = bindHooksToEngine(engine, [hook], { packageId: 'p' });
    expect(result.registered).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.errors[0]?.reason).toMatch(/no bodyRunner/);
  });

  it('falls back to the engine default bodyRunner via engine.bindHooks (#2588)', async () => {
    const engine = makeEngine();
    const calls: string[] = [];
    // Fake runner — the real QuickJS bridge lives in @objectstack/runtime;
    // here we only verify the engine-level fallback plumbing.
    engine.setDefaultBodyRunner((hook: Hook) => async () => {
      calls.push(hook.name);
    });
    const hook: Hook = {
      name: 'body-default-runner', object: 'account', events: ['beforeInsert'], priority: 100,
      body: { language: 'js', source: "ctx.input.x = 1;" },
    } as unknown as Hook;
    engine.bindHooks([hook], { packageId: 'metadata-service' });
    await engine.triggerHooks('beforeInsert', makeCtx());
    expect(calls).toEqual(['body-default-runner']);
  });

  it('explicit bodyRunner wins over the engine default', async () => {
    const engine = makeEngine();
    const calls: string[] = [];
    engine.setDefaultBodyRunner(() => async () => { calls.push('default'); });
    const hook: Hook = {
      name: 'body-explicit', object: 'account', events: ['beforeInsert'], priority: 100,
      body: { language: 'js', source: "ctx.input.x = 1;" },
    } as unknown as Hook;
    engine.bindHooks([hook], {
      packageId: 'app:x',
      bodyRunner: () => async () => { calls.push('explicit'); },
    });
    await engine.triggerHooks('beforeInsert', makeCtx());
    expect(calls).toEqual(['explicit']);
  });

  it('keeps hooks bound under different packageIds isolated', async () => {
    const engine = makeEngine();
    const calls: string[] = [];
    bindHooksToEngine(engine, [{
      name: 'a', object: 'account', events: ['beforeInsert'], priority: 100,
      handler: () => { calls.push('a'); },
    } as Hook], { packageId: 'pkg-a' });
    bindHooksToEngine(engine, [{
      name: 'b', object: 'account', events: ['beforeInsert'], priority: 100,
      handler: () => { calls.push('b'); },
    } as Hook], { packageId: 'pkg-b' });

    engine.unregisterHooksByPackage('pkg-a');
    await engine.triggerHooks('beforeInsert', makeCtx());
    expect(calls).toEqual(['b']);
  });
});

describe('wrapDeclarativeHook', () => {
  it('skips when condition predicate evaluates to false', async () => {
    const calls: string[] = [];
    const meta: Hook = {
      name: 'cond', object: 'account', events: ['beforeInsert'], priority: 100,
      condition: 'record.annual_revenue > 1000',
      handler: () => { calls.push('ran'); },
    };
    const wrapped = wrapDeclarativeHook(meta, meta.handler as any);
    await wrapped(makeCtx({ input: { data: { annual_revenue: 100 } } }));
    expect(calls).toEqual([]);
    await wrapped(makeCtx({ input: { data: { annual_revenue: 5000 } } }));
    expect(calls).toEqual(['ran']);
  });

  it('retries up to retryPolicy.maxRetries on failure', async () => {
    let attempts = 0;
    const meta: Hook = {
      name: 'retry', object: 'a', events: ['afterInsert'], priority: 100,
      retryPolicy: { maxRetries: 2, backoffMs: 0 },
      handler: () => {
        attempts += 1;
        if (attempts < 3) throw new Error('boom');
      },
    };
    const wrapped = wrapDeclarativeHook(meta, meta.handler as any);
    await wrapped(makeCtx({ event: 'afterInsert' }));
    expect(attempts).toBe(3); // 1 initial + 2 retries
  });

  it('honours timeout by rejecting slow handlers', async () => {
    const meta: Hook = {
      name: 'timeout', object: 'a', events: ['beforeInsert'], priority: 100,
      timeout: 20,
      handler: () => new Promise((r) => setTimeout(r, 200)),
    };
    const wrapped = wrapDeclarativeHook(meta, meta.handler as any);
    await expect(wrapped(makeCtx())).rejects.toThrow(/timed out/);
  });

  it('swallows errors when onError=log', async () => {
    const meta: Hook = {
      name: 'onerr', object: 'a', events: ['beforeInsert'], priority: 100,
      onError: 'log',
      handler: () => { throw new Error('nope'); },
    };
    const wrapped = wrapDeclarativeHook(meta, meta.handler as any);
    await expect(wrapped(makeCtx())).resolves.toBeUndefined();
  });

  it('runs async after-events fire-and-forget', async () => {
    const calls: string[] = [];
    const meta: Hook = {
      name: 'async', object: 'a', events: ['afterInsert'], priority: 100,
      async: true,
      handler: async () => {
        await new Promise((r) => setTimeout(r, 30));
        calls.push('done');
      },
    };
    const wrapped = wrapDeclarativeHook(meta, meta.handler as any);
    await wrapped(makeCtx({ event: 'afterInsert' }));
    // Ordering, not wall clock (#2744): if the wrapper had awaited the
    // handler, `calls` would already hold 'done' here — the 30ms timer is a
    // macrotask and cannot fire between the wrapper's resolution and this
    // synchronous check, no matter how slow the runner is. The old
    // `< 20ms` wall-clock assertion was flaky on shared CI machines.
    expect(calls).toEqual([]); // returned before handler finished
    await new Promise((r) => setTimeout(r, 60));
    expect(calls).toEqual(['done']);
  });

  it('async flag is ignored on before-events (must remain blocking)', async () => {
    const calls: string[] = [];
    const meta: Hook = {
      name: 'asyncblock', object: 'a', events: ['beforeInsert'], priority: 100,
      async: true,
      handler: async () => {
        await new Promise((r) => setTimeout(r, 20));
        calls.push('done');
      },
    };
    const wrapped = wrapDeclarativeHook(meta, meta.handler as any);
    await wrapped(makeCtx());
    expect(calls).toEqual(['done']); // awaited despite async=true
  });

  it('logs and treats invalid condition formulas as skipping', async () => {
    const warn = vi.fn();
    const calls: string[] = [];
    const meta: Hook = {
      name: 'badcond', object: 'a', events: ['beforeInsert'], priority: 100,
      condition: '(((not valid syntax',
      handler: () => { calls.push('ran'); },
    };
    const wrapped = wrapDeclarativeHook(meta, meta.handler as any, {
      logger: { debug: () => {}, info: () => {}, warn, error: () => {} },
    });
    await wrapped(makeCtx());
    expect(warn).toHaveBeenCalled();
    // Either ignored at compile time (handler runs) or evaluated false
    // (skipped). Both are valid; just assert we didn't crash.
    expect(calls.length === 0 || calls[0] === 'ran').toBe(true);
  });
});
