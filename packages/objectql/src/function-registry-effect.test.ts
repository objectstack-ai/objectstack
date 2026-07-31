// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The function registry carries what a function DECLARED about itself (#4396).
 *
 * One registry serves hooks, actions and flow `script` nodes, so the
 * declaration has to travel WITH the handler: the automation engine reads it
 * back through this registry to report whether a run's `acted` count covers
 * everything the run did.
 */

import { describe, it, expect, vi } from 'vitest';
import { ObjectQL } from './engine.js';
import { bindHooksToEngine } from './hook-binder.js';
import type { Hook, HookContext } from '@objectstack/spec/data';

describe('ObjectQL.registerFunction — declarations (#4396)', () => {
  it('keeps the packageId-string form working unchanged', () => {
    const engine = new ObjectQL();
    const fn = () => {};
    engine.registerFunction('scoreLead', fn, 'app:demo');
    expect(engine.resolveFunction('scoreLead')).toBe(fn);
    expect(engine.resolveFunctionEntry('scoreLead')).toEqual({ handler: fn, packageId: 'app:demo' });
  });

  it('records a declared effect and hands it back on the entry', () => {
    const engine = new ObjectQL();
    const fn = () => {};
    engine.registerFunction('syncBilling', fn, { packageId: 'app:demo', effect: 'writes' });
    expect(engine.resolveFunction('syncBilling')).toBe(fn);
    expect(engine.resolveFunctionEntry('syncBilling')).toEqual({
      handler: fn,
      packageId: 'app:demo',
      effect: 'writes',
    });
  });

  it('leaves the effect absent when nothing was declared — absent reads as pure', () => {
    const engine = new ObjectQL();
    engine.registerFunction('scoreLead', () => {}, { packageId: 'app:demo' });
    expect(engine.resolveFunctionEntry('scoreLead')?.effect).toBeUndefined();
  });

  it('still unregisters by package with the options form', () => {
    const engine = new ObjectQL();
    engine.registerFunction('syncBilling', () => {}, { packageId: 'app:demo', effect: 'writes' });
    expect(engine.unregisterFunctionsByPackage('app:demo')).toBe(1);
    expect(engine.resolveFunctionEntry('syncBilling')).toBeUndefined();
  });

  it('answers undefined for an unknown name', () => {
    expect(new ObjectQL().resolveFunctionEntry('nope')).toBeUndefined();
  });
});

describe('bindHooksToEngine — function entries (#4396)', () => {
  it('registers a declared entry with both its handler and its effect', () => {
    const engine = new ObjectQL();
    const syncBilling = () => {};
    bindHooksToEngine(engine, [], {
      packageId: 'app:demo',
      functions: { syncBilling: { handler: syncBilling, effect: 'writes' } },
    });
    expect(engine.resolveFunctionEntry('syncBilling')).toEqual({
      handler: syncBilling,
      packageId: 'app:demo',
      effect: 'writes',
    });
  });

  it('resolves a string-named hook handler through a declared entry', async () => {
    const engine = new ObjectQL();
    const calls: string[] = [];
    const hook: Hook = {
      name: 'h1',
      object: ['account'],
      events: ['beforeInsert'],
      handler: 'syncBilling',
    } as Hook;

    const result = bindHooksToEngine(engine, [hook], {
      packageId: 'app:demo',
      functions: { syncBilling: { handler: () => { calls.push('ran'); }, effect: 'writes' } },
    });

    expect(result.errors).toEqual([]);
    expect(result.registered).toBe(1);
    await engine.triggerHooks('beforeInsert', {
      object: 'account',
      event: 'beforeInsert',
      input: { data: {} },
    } as HookContext);
    expect(calls).toEqual(['ran']);
  });

  it('warns and keeps the run measurable when an effect spelling is unreadable', () => {
    const engine = new ObjectQL();
    const warn = vi.fn();
    bindHooksToEngine(engine, [], {
      packageId: 'app:demo',
      // 'write' is not a member — read as an uncountable write rather than as
      // the pure default, which would silently under-report the run.
      functions: { syncBilling: { handler: () => {}, effect: 'write' } as never },
      logger: { debug: vi.fn(), info: vi.fn(), warn, error: vi.fn() },
    });
    expect(engine.resolveFunctionEntry('syncBilling')?.effect).toBe('writes');
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('unrecognized function effect'),
      expect.objectContaining({ name: 'syncBilling', effect: 'write' }),
    );
  });
});

/**
 * `functions` is not a hook accessory (found while wiring #4396).
 *
 * The binder bailed out on an empty `hooks` array BEFORE registering the
 * bundle's functions, so a stack that declared functions and no hooks — the
 * shape a flow-only app has — registered none of them, and every `script` node
 * calling one failed with "no function named 'x' is registered".
 */
describe('bindHooksToEngine — functions without hooks', () => {
  it('registers the bundle functions even when the stack declares no hooks', () => {
    const engine = new ObjectQL();
    const scoreLead = () => {};
    bindHooksToEngine(engine, [], { packageId: 'app:demo', functions: { scoreLead } });
    expect(engine.resolveFunction('scoreLead')).toBe(scoreLead);
  });

  it('registers them for an undefined hooks list too', () => {
    const engine = new ObjectQL();
    const scoreLead = () => {};
    bindHooksToEngine(engine, undefined, { packageId: 'app:demo', functions: { scoreLead } });
    expect(engine.resolveFunction('scoreLead')).toBe(scoreLead);
  });
});
