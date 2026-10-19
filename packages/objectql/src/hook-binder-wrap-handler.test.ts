// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #24289 — `bindHooksToEngine`'s `wrapHandler` option: one wrap for every
 * handler a hook runs in-process, applied after a string `handler` resolves.
 *
 *  - an inline function, a name from the bind's `functions` and a name the
 *    same package registered on the engine all take the wrap;
 *  - a `body`'s handler (built by `bodyRunner`) never does;
 *  - control: a bind with no `wrapHandler` calls the resolved function with
 *    the engine's own context object, exactly as before.
 */

import { describe, it, expect } from 'vitest';
import { ObjectQL } from './engine.js';
import { bindHooksToEngine } from './hook-binder.js';
import type { Hook, HookContext } from '@objectstack/spec/data';

const ctx = (): HookContext =>
  ({ object: 'account', event: 'beforeInsert', input: { data: {} } }) as HookContext;

/** Marks each context the wrapped handler is called with, and records which hook it wrapped. */
function marking(wrappedFor: string[]) {
  return (handler: (context: HookContext) => unknown, hook: Hook) => {
    wrappedFor.push(hook.name);
    return (context: HookContext) => handler({ ...context, wrapped: hook.name } as HookContext);
  };
}

const hook = (name: string, handler: Hook['handler']): Hook => ({
  name,
  object: 'account',
  events: ['beforeInsert'],
  handler,
});

describe('#24289: bindHooksToEngine wrapHandler', () => {
  it('wraps an inline handler and both kinds of named handler, once each, at bind', async () => {
    const engine = new ObjectQL();
    engine.registerFunction('registered_fn', async (c: any) => { seen.push(`registered:${c.wrapped}`); }, {
      packageId: 'app:wrap',
    });
    const seen: string[] = [];
    const wrappedFor: string[] = [];

    const result = bindHooksToEngine(
      engine,
      [
        hook('inline', async (c: any) => { seen.push(`inline:${c.wrapped}`); }),
        hook('from_bind', 'bound_fn'),
        hook('from_registry', 'registered_fn'),
      ],
      {
        packageId: 'app:wrap',
        functions: { bound_fn: async (c: any) => { seen.push(`bound:${c.wrapped}`); } },
        wrapHandler: marking(wrappedFor),
      },
    );
    expect(result.errors).toEqual([]);
    expect(wrappedFor).toEqual(['inline', 'from_bind', 'from_registry']);

    await engine.triggerHooks('beforeInsert', ctx());
    await engine.triggerHooks('beforeInsert', ctx());
    expect(seen.sort()).toEqual([
      'bound:from_bind', 'bound:from_bind',
      'inline:inline', 'inline:inline',
      'registered:from_registry', 'registered:from_registry',
    ]);
    expect(wrappedFor, 'the wrap is applied at bind, never per event').toHaveLength(3);
  });

  it("never wraps the handler a body's runner builds", async () => {
    const engine = new ObjectQL();
    const seen: unknown[] = [];
    const wrappedFor: string[] = [];
    bindHooksToEngine(
      engine,
      [{ ...hook('with_body', undefined), body: { language: 'js', source: 'return;' } } as Hook],
      {
        bodyRunner: () => async (c: any) => { seen.push(c.wrapped); },
        wrapHandler: marking(wrappedFor),
      },
    );

    await engine.triggerHooks('beforeInsert', ctx());
    expect(wrappedFor).toEqual([]);
    expect(seen).toEqual([undefined]);
  });

  it("control: without wrapHandler, a named handler is called with the engine's own context", async () => {
    const engine = new ObjectQL();
    const received: unknown[] = [];
    const fn = async (c: unknown) => { received.push(c); };
    bindHooksToEngine(engine, [hook('plain_named', 'plain_fn'), hook('plain_inline', fn)], {
      packageId: 'app:plain',
      functions: { plain_fn: fn },
    });

    const context = ctx();
    await engine.triggerHooks('beforeInsert', context);
    expect(received).toEqual([context, context]);
    expect(received.every((c) => c === context)).toBe(true);
  });
});
