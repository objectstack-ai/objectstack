// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #22837 — a hook handler whose parameter is not the identifier `ctx`.
 *
 * The runtime runs a lowered hook body as `(async (ctx) => { SOURCE })`, so
 * `ctx` is the only name it binds, and the lowering used to drop the handler's
 * parameter list. `async (hookCtx) => { hookCtx.input.note = … }` lowered at
 * exit 0 and threw `ReferenceError: 'hookCtx' is not defined` on every run —
 * `500` over REST where the in-process handler answered `201`.
 *
 * The hook face now re-emits the one parameter as `var <param> = ctx;` ahead of
 * the body, and refuses (naming the parameter) what it cannot re-emit
 * faithfully. These pin the build-time half: the emitted source, that it RUNS
 * the way the handler runs, the residue's refusals, and the capability tokens
 * the rebound names still earn. The artifact door is
 * `packages/qa/dogfood/test/lowered-body-door.dogfood.test.ts`.
 */

import { describe, expect, it } from 'vitest';
import { extractHookBody, extractLoweredBody, HookBodyExtractionError } from '../src/utils/extract-hook-body.js';
import { lowerCallables } from '../src/utils/lower-callables.js';

type Fn = (...a: any[]) => unknown;

const lower = (fn: Fn, label = "hook 'h'") => extractHookBody(fn as (...a: unknown[]) => unknown, label);

const refusal = (fn: Fn, label = "hook 'h'"): HookBodyExtractionError => {
  try {
    lower(fn, label);
  } catch (err) {
    if (err instanceof HookBodyExtractionError) return err;
    throw err;
  }
  throw new Error(`expected ${label} to be refused, but it lowered`);
};

/**
 * Run a lowered source the way the runtime's L2 wrapper does —
 * `(async (ctx) => { SOURCE })(ctx)` — in plain JS. The QuickJS sandbox is
 * the dogfood door's subject; this is the local check that the emitted source
 * means what the handler means.
 */
const runLowered = async (source: string, ctx: unknown): Promise<unknown> =>
  // eslint-disable-next-line @typescript-eslint/no-implied-eval -- the emitted SOURCE is the subject under test
  (new Function(`return (async (ctx) => { ${source} });`)() as (c: unknown) => Promise<unknown>)(ctx);

const hookCtx = () => ({ input: { name: 'alpha' } as Record<string, unknown>, previous: undefined as unknown });

describe('the hook face rebinds the handler parameter to the sandbox `ctx`', () => {
  it('re-emits an identifier parameter ahead of the body, and the body runs as the handler does', async () => {
    const handler = async (hookCtx: any) => {
      hookCtx.input.note = 'named:' + String(hookCtx.input.name);
    };
    const ext = lower(handler);
    expect(ext.source.startsWith('var hookCtx = ctx;')).toBe(true);
    expect(ext.source).toContain('hookCtx.input.note');

    const inProcess = hookCtx();
    await handler(inProcess);
    const lowered = hookCtx();
    await runLowered(ext.source, lowered);
    expect(lowered.input).toEqual(inProcess.input);
    expect(lowered.input.note).toBe('named:alpha');
  });

  it('re-emits a destructuring parameter as the same pattern', async () => {
    const handler = async ({ input, previous }: any) => {
      input.note = previous ? 'update' : 'create';
    };
    const ext = lower(handler);
    expect(ext.source.startsWith('var { input, previous } = ctx;')).toBe(true);
    const ctx = hookCtx();
    await runLowered(ext.source, ctx);
    expect(ctx.input.note).toBe('create');
  });

  it('keeps a nested pattern, a renamed key and a pattern default verbatim', async () => {
    const handler = async ({ input: row, previous: { status = 'new' } = {} as any }: any) => {
      row.note = status;
    };
    // A DEFAULT inside the pattern is the pattern's own, and survives as written;
    // only a default on the PARAMETER (`(ctx = …)`) is refused below.
    expect(() => lower(handler)).not.toThrow();
    const ext = lower(handler);
    expect(ext.source).toMatch(/^var \{ input: row, previous: \{ status = "new" \} = \{\} \} = ctx;/);
    const ctx = hookCtx();
    await runLowered(ext.source, ctx);
    expect(ctx.input.note).toBe('new');
  });

  it('rebinds an implicit-return arrow, a function expression and a method shorthand', async () => {
    const arrow = (c: any) => c.input.name;
    expect(lower(arrow).source).toBe('var c = ctx; return (c.input.name);');
    expect(lower(arrow).isExpression).toBe(true);
    expect(await runLowered(lower(arrow).source, hookCtx())).toBe('alpha');

    const fnExpr = async function (h: any) {
      h.input.note = 'fn';
    };
    expect(lower(fnExpr).source.startsWith('var h = ctx;')).toBe(true);

    const method = {
      async handler(h: any) {
        h.input.note = [1, 2].map((i) => i * 2).join(',');
      },
    }.handler;
    const ext = lower(method);
    expect(ext.source.startsWith('var h = ctx;')).toBe(true);
    const ctx = hookCtx();
    await runLowered(ext.source, ctx);
    expect(ctx.input.note).toBe('2,4');
  });

  it('lets the body reassign its parameter, as the handler may (a `var`, not a `const`)', async () => {
    const handler = async ({ input }: any) => {
      input.note = 'first';
      input = { note: 'local only' };
      return input.note;
    };
    const ctx = hookCtx();
    expect(await runLowered(lower(handler).source, ctx)).toBe('local only');
    expect(ctx.input.note).toBe('first');
  });

  // The byte-identity pin. The ACTION face carries no rebind and no hook-only
  // refusal, so for a handler whose parameter is `ctx` (or that has none) it
  // is the pre-#22837 lowering — and the hook face must equal it exactly.
  it('emits nothing for a parameter already named `ctx`, or for none: byte-identical lowering', () => {
    const shapes: Fn[] = [
      async (ctx: any) => {
        ctx.input.note = String(ctx.input.name);
      },
      (ctx: any) => ctx.input.name,
      function (ctx: any) {
        ctx.input.y = 2;
      },
      {
        async h(ctx: any) {
          ctx.input.n = [1].map((i) => i).length;
        },
      }.h,
      async (ctx: any) => {
        await ctx.api.object('t').find({});
        ctx.log.info('x');
        ctx.input.id = ctx.crypto.randomUUID();
      },
      async () => {
        return 1;
      },
    ];
    for (const fn of shapes) {
      const hook = lower(fn);
      const unchanged = extractLoweredBody(fn as (...a: unknown[]) => unknown, "hook 'h'", 'action');
      expect(hook).toEqual(unchanged);
      expect(hook.source.startsWith('var ')).toBe(false);
    }
  });
});

describe('the residue the rebind cannot re-emit is refused, naming the parameter', () => {
  it('more than one parameter', () => {
    const err = refusal(async (ctx: any, extra: unknown) => {
      ctx.input.note = String(extra);
    }, "hook 'two'");
    expect(err.kind).toBe('forbidden-token');
    expect(err.originLabel).toBe("hook 'two'");
    expect(err.message).toContain('2 parameters (`ctx`, `extra`)');
  });

  it('a default value on the parameter', () => {
    const err = refusal(async (ctx: any = { input: {} }) => {
      ctx.input.note = 'd';
    });
    expect(err.kind).toBe('forbidden-token');
    expect(err.message).toMatch(/the parameter `ctx = \{ input: \{\} \}` carries a default value/);
  });

  it('a rest parameter', () => {
    const err = refusal(async (...args: any[]) => {
      args[0].input.note = 'r';
    });
    expect(err.kind).toBe('forbidden-token');
    expect(err.message).toContain('the rest parameter `...args`');
  });

  it('a pattern that binds the name `ctx` itself', () => {
    const err = refusal(async ({ input: ctx }: any) => {
      ctx.note = 'x';
    });
    expect(err.kind).toBe('forbidden-token');
    expect(err.message).toContain('binds a name `ctx`');
  });

  it('a body that declares its own `ctx`, which the prologue would read', () => {
    const err = refusal(async (hookCtx: any) => {
      const ctx = hookCtx.input;
      ctx.note = 'l';
    });
    expect(err.kind).toBe('forbidden-token');
    expect(err.message).toContain('declares `ctx` in its body');
    expect(err.message).toContain('`var hookCtx = ctx;`');
  });

  it('a capability-bearing member destructured into a nested pattern the inference cannot follow', () => {
    const err = refusal(async ({ log: { info } }: any) => {
      info('x');
    });
    expect(err.kind).toBe('forbidden-token');
    expect(err.message).toContain('reaches `ctx.log` through a nested pattern');
  });

  // CONTROL: a plain name for the same member is followed, and is lowered.
  it('CONTROL: a capability-bearing member destructured to a plain name is lowered', () => {
    expect(() => lower(async ({ log }: any) => { log.info('x'); })).not.toThrow();
  });

  it('records the refusal and bundles the handler, unchanged, through lowerCallables', () => {
    const handler = async (ctx: any, extra: unknown) => {
      ctx.input.note = String(extra);
    };
    const lowering = lowerCallables({ hooks: [{ name: 'two', object: 'note', events: ['beforeInsert'], handler }] });
    const hook = (lowering.lowered.hooks as Array<Record<string, unknown>>)[0];
    expect(hook.body).toBeUndefined();
    expect(hook.handler).toBe('two');
    expect(lowering.functions.two).toBe(handler);
    expect(lowering.bodyExtractionWarnings.map((w) => [w.origin, w.kind])).toEqual([["hook 'two'", 'forbidden-token']]);
  });
});

describe('a member destructured in the parameter list meets the refusal the body spelling meets', () => {
  it('refuses `submitted` destructured in the parameter list', () => {
    const err = refusal(async ({ input, submitted }: any) => {
      input.note = String(submitted);
    });
    expect(err.kind).toBe('forbidden-token');
    expect(err.message).toContain('`ctx.submitted`');
  });

  it('refuses `dispatch.scope` destructured in the parameter list', () => {
    const err = refusal(async ({ input, dispatch: { scope } }: any) => {
      scope.stashed = input.name;
    });
    expect(err.kind).toBe('forbidden-token');
    expect(err.message).toContain('`ctx.dispatch.scope`');
  });

  it('refuses a renamed context read the way it refuses `ctx`', () => {
    expect(refusal(async (h: any) => { h.input.note = String(h.submitted); }).message).toContain('`ctx.submitted`');
  });
});

describe('capability inference follows the rebound names', () => {
  // Each pair: the handler under its own names, and the same handler named
  // `ctx`. A rename must infer exactly what the original infers.
  const pairs: Array<[string, Fn, Fn]> = [
    ['log through a renamed context', (h: any) => { h.log.info('x'); }, (ctx: any) => { ctx.log.info('x'); }],
    [
      'crypto.uuid through a renamed context',
      (h: any) => { h.input.id = h.crypto.randomUUID(); },
      (ctx: any) => { ctx.input.id = ctx.crypto.randomUUID(); },
    ],
    ['log through a destructured member', ({ log }: any) => { log.warn('x'); }, (ctx: any) => { ctx.log.warn('x'); }],
    [
      'crypto.uuid through a renamed destructured member',
      ({ crypto: c, input }: any) => { input.id = c.randomUUID(); },
      (ctx: any) => { ctx.input.id = ctx.crypto.randomUUID(); },
    ],
    [
      'api.read through a destructured `title` with an argument',
      async ({ title, input }: any) => { input.label = await title('account_id'); },
      async (ctx: any) => { ctx.input.label = await ctx.title('account_id'); },
    ],
    [
      'api.read / api.write through a destructured `api`',
      async ({ api }: any) => { await api.object('t').insert({ n: await api.object('t').count({}) }); },
      async (ctx: any) => { await ctx.api.object('t').insert({ n: await ctx.api.object('t').count({}) }); },
    ],
    [
      'log through an object rest element',
      ({ input, ...rest }: any) => { rest.log.info(String(input.name)); },
      (ctx: any) => { ctx.log.info(String(ctx.input.name)); },
    ],
  ];
  for (const [label, renamed, original] of pairs) {
    it(label, () => {
      const want = lower(original).capabilities;
      expect(want.length).toBeGreaterThan(0);
      expect(lower(renamed).capabilities).toEqual(want);
    });
  }

  it('CONTROL: a bare `title()` earns no token, renamed or not', () => {
    expect(lower(({ title, input }: any) => { input.label = title(); }).capabilities).toEqual([]);
  });
});

describe('the hook-context members the enumeration found unrefused (#22837)', () => {
  it.each([
    ['provenance', async (ctx: any) => { if (ctx.provenance?.flowRunId) ctx.input.note = 'flow'; }],
    ['provenance', async (ctx: any) => { const { provenance } = ctx; ctx.input.note = String(provenance); }],
    ['provenance', async ({ input, provenance }: any) => { input.note = String(provenance?.attributedUserId); }],
    ['ql', async (ctx: any) => { await ctx.ql.find('t', {}); }],
    ['ql', async (ctx: any) => { const c = ctx; await c['ql'].find('t', {}); }],
    ['transaction', async (ctx: any) => { ctx.input.note = ctx.transaction ? 'tx' : 'none'; }],
    ['transaction', async ({ input, transaction }: any) => { input.note = String(transaction); }],
  ])('refuses `ctx.%s`', (member, fn) => {
    const err = refusal(fn);
    expect(err.kind).toBe('forbidden-token');
    expect(err.message).toContain(`\`ctx.${member}\``);
  });

  it('does NOT refuse the body face\'s own transaction route, or a field of the same name', () => {
    const lowered: Fn[] = [
      async (ctx: any) => { await ctx.api.transaction(async () => { await ctx.api.object('t').insert({}); }); },
      async (ctx: any) => { const api = ctx.api; await api.transaction(async () => undefined); },
      async (ctx: any) => { const { transaction } = ctx.api; await transaction(async () => undefined); },
      async (ctx: any) => { ctx.input.note = String(ctx.input.provenance ?? ctx.previous?.ql ?? ctx.input.transaction); },
    ];
    for (const fn of lowered) expect(() => lower(fn)).not.toThrow();
  });

  it('is the hook face only: an action target reading them lowers as before', () => {
    const action = async (input: any, ctx: any) => ({ who: ctx.provenance, q: input.q });
    expect(() => extractLoweredBody(action as (...a: unknown[]) => unknown, "action 'a'", 'action')).not.toThrow();
  });
});

describe('the action face is untouched (#22837)', () => {
  it('lowers an `(input, ctx)` action target with no prologue and no refusal', () => {
    const target = async (input: any, ctx: any) => {
      await ctx.api.object('t').insert({ n: input.n });
      return { ok: true };
    };
    const ext = extractLoweredBody(target as (...a: unknown[]) => unknown, "action 'global_a'", 'action');
    expect(ext.source.startsWith('var ')).toBe(false);
    expect(ext.capabilities).toEqual(['api.write']);

    const lowering = lowerCallables({ actions: [{ name: 'a', type: 'script', target }] });
    const lowered = (lowering.lowered.actions as Array<Record<string, unknown>>)[0];
    expect((lowered.body as { source: string }).source).toBe(ext.source);
    expect(lowering.bodyExtractionWarnings).toEqual([]);
  });
});
