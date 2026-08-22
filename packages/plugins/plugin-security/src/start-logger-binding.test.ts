// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#10706] `start()` binds `this.logger` ABOVE its two bail-outs.
//
// The mechanic this pins: `private logger … = {}` is an empty object from
// construction, and `this.logger = ctx.logger` is its ONLY assignment. It used
// to sit in the "capture handles" block, BELOW the two `return`s that fire when
// `objectql`/`metadata` are missing or when the engine carries no
// `registerMiddleware`. On either bail-out the field therefore stayed `{}` for
// the LIFETIME of the instance — and because every report site is written
// `this.logger.warn?.(…)`, an unbound sink is indistinguishable from a
// configured one at every call site: it silently reports nothing.
//
// ⛔ This suite is deliberately INDEPENDENT of #10556's open design call on what
// the `= {}` default should be. It asserts only WHERE the real sink is bound,
// which is correct under every option on that question. Nothing here reads or
// asserts the default value itself.
//
// Four directions are pinned, and the middle two are the load-bearing ones:
//
//   1. after either bail-out, `this.logger` IS `ctx.logger` — and RECEIVES a
//      report. Identity alone is not enough, and "non-empty" would be no
//      assertion at all: `{}` and a real logger both satisfy
//      `typeof x === 'object'`.
//   2. STILL BAILS. Both early returns still return, and the middleware is
//      still NOT registered. An implementation that "fixed" this by deleting a
//      bail-out would pass a logger-only suite while changing boot behaviour.
//   3. the bail-out itself stays LOUD through `ctx.logger` — it already was,
//      and that must not regress.
//   4. the normal boot path is unchanged — same sink, registration still
//      happens.

import { describe, it, expect, vi } from 'vitest';
// Relative specifier: resolves to THIS package's `src/security-plugin.ts`, never
// to `dist/`. The only aliases in `vitest.config.ts` are anchored regexes for
// `@objectstack/driver-sql` and `@objectstack/objectql`; neither can match a
// relative path, so the subject here is the source in the checkout.
import { SecurityPlugin } from './security-plugin.js';

type Ctx = {
  logger: { info: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };
  registerService: ReturnType<typeof vi.fn>;
  getService: ReturnType<typeof vi.fn>;
  registerMiddleware: ReturnType<typeof vi.fn>;
};

/**
 * A boot context in one of three postures:
 *
 *  - `'throws'`   — `getService('objectql')` throws → the `:878` bail-out.
 *  - `'no-mw'`    — objectql resolves but carries no `registerMiddleware`
 *                   → the `:883` bail-out.
 *  - `'healthy'`  — a normal boot that reaches registration.
 */
function makeCtx(posture: 'throws' | 'no-mw' | 'healthy'): Ctx {
  const registerMiddleware = vi.fn();
  const manifestService = { register: vi.fn() };
  const ctx: any = {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    registerService: vi.fn(),
    registerMiddleware,
    getService: vi.fn().mockImplementation((name: string) => {
      if (name === 'manifest') return manifestService;
      if (posture === 'throws') throw new Error('service not available');
      if (name === 'objectql') return posture === 'no-mw' ? {} : { registerMiddleware };
      if (name === 'metadata') return { list: vi.fn().mockResolvedValue([]) };
      return undefined;
    }),
  };
  return ctx as Ctx;
}

/** The private field, read exactly as the mechanic describes it. */
const sinkOf = (plugin: SecurityPlugin) => (plugin as any).logger;

/**
 * Drive a REAL report through `this.logger` and return whether it landed.
 *
 * `getReadFilter` is a public instance method whose on-behalf-of refusal
 * (`this.logger.error?.(…)`, the ADR-0095/#2852 fail-closed branch) depends on
 * NONE of the handles captured below the bail-outs — no `this.ql`, no
 * `this.metadata`. That makes it the one report site that is genuinely
 * reachable on a bailed-out instance, which is what makes it the right probe
 * for "the sink RECEIVES something".
 *
 * Pre-fix this call is silent: `{}.error` is `undefined` and `?.()` no-ops.
 */
async function probeSinkReceives(plugin: SecurityPlugin, ctx: Ctx): Promise<boolean> {
  ctx.logger.error.mockClear();
  const verdict = await plugin.getReadFilter('crm_opportunity', {
    userId: 'u_agent',
    onBehalfOf: { userId: 'u_delegator' },
  });
  // The refusal itself must still be fail-closed, independent of the sink.
  expect(verdict).toBeTruthy();
  return ctx.logger.error.mock.calls.length > 0;
}

describe('[#10706] start() binds the report sink above both bail-outs', () => {
  describe.each([
    ['getService throws — the ObjectQL/metadata bail-out', 'throws' as const],
    ['engine without registerMiddleware — the no-middleware bail-out', 'no-mw' as const],
  ])('%s', (_label, posture) => {
    it('binds `this.logger` to the real sink, and that sink RECEIVES a report', async () => {
      const plugin = new SecurityPlugin();
      const ctx = makeCtx(posture);

      // Before `start()` the field is still the construction default — this is
      // the state the fix makes unreachable AFTER a start, and asserting it
      // here is what makes the post-start assertion a change and not a tautology.
      expect(sinkOf(plugin)).not.toBe(ctx.logger);

      await plugin.init(ctx as any);
      await plugin.start(ctx as any);

      // Direction 1a — identity: the field IS the context's logger.
      expect(sinkOf(plugin)).toBe(ctx.logger);

      // Direction 1b — the sink RECEIVES. `typeof sink === 'object'` would be
      // satisfied by `{}` too, so the only honest assertion is a delivered call.
      await expect(probeSinkReceives(plugin, ctx)).resolves.toBe(true);
    });

    it('STILL BAILS — no middleware and no `security` service are registered', async () => {
      const plugin = new SecurityPlugin();
      const ctx = makeCtx(posture);

      await plugin.init(ctx as any);
      await plugin.start(ctx as any);

      // The bail-out is the POINT of these paths. A "fix" that moved the sink
      // by deleting a return would satisfy the logger assertions above and
      // silently change boot behaviour; these two assertions are what refuse it.
      expect(ctx.registerMiddleware).not.toHaveBeenCalled();
      const registeredNames = ctx.registerService.mock.calls.map((c) => c[0]);
      expect(registeredNames).not.toContain('security');
    });

    it('the bail-out stays LOUD — it still reports through `ctx.logger`', async () => {
      const plugin = new SecurityPlugin();
      const ctx = makeCtx(posture);

      await plugin.init(ctx as any);
      await plugin.start(ctx as any);

      expect(ctx.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('security middleware not registered'),
      );
    });
  });

  it('normal boot is unchanged — same sink, and registration still happens', async () => {
    const plugin = new SecurityPlugin();
    const ctx = makeCtx('healthy');

    await plugin.init(ctx as any);
    await plugin.start(ctx as any);

    expect(sinkOf(plugin)).toBe(ctx.logger);
    expect(ctx.registerMiddleware).toHaveBeenCalledWith(expect.any(Function));
    const registeredNames = ctx.registerService.mock.calls.map((c) => c[0]);
    expect(registeredNames).toContain('security');
    // The healthy path must NOT take either bail-out.
    expect(ctx.logger.warn).not.toHaveBeenCalledWith(
      expect.stringContaining('security middleware not registered'),
    );
  });
});
