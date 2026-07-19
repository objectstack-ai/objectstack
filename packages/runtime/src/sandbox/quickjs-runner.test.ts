// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { QuickJSScriptRunner, SandboxError } from './quickjs-runner.js';
import type { ScriptContext, ScriptRunOptions } from './script-runner.js';

// Generous hook budget: these tests exercise sandbox *behaviour*, not the stock
// 250ms hook budget. Every invocation compiles a fresh WASM module, and nested
// hooks compile another one inside the parent's budget — on a loaded CI machine
// that fixed cost alone can blow 250ms and flake (e.g. "hook 'lvl4' exceeded
// timeout of 250ms"). Tests that ARE about the default budget use
// `defaultRunner` below.
const runner = new QuickJSScriptRunner({ hookTimeoutMs: 10_000 });
const hookOpts: ScriptRunOptions = { origin: { kind: 'hook', name: 't' } };
const actionOpts: ScriptRunOptions = { origin: { kind: 'action', name: 't' } };

function ctx(over: Partial<ScriptContext> = {}): ScriptContext {
  return { input: {}, ...over };
}

describe('QuickJSScriptRunner — L1 expression', () => {
  it('evaluates a numeric expression', async () => {
    const r = await runner.evalExpression(
      { language: 'expression', source: '1 + 2 * 3' },
      ctx(),
      hookOpts,
    );
    expect(r.value).toBe(7);
  });

  it('evaluates against ctx.input via the wrapper', async () => {
    const r = await runner.run(
      { language: 'expression', source: '40 + 2' },
      ctx({ input: { x: 1 } }),
      hookOpts,
    );
    expect(r.value).toBe(42);
  });
});

describe('QuickJSScriptRunner — L2 hook script', () => {
  it('mutates ctx.input via JSON return', async () => {
    // Hook style: read ctx.input, return modified shape.
    const r = await runner.runScript(
      {
        language: 'js',
        source: 'return { ok: true, doubled: ctx.input.n * 2 };',
        capabilities: [],
      },
      ctx({ input: { n: 21 } }),
      hookOpts,
    );
    expect(r.value).toEqual({ ok: true, doubled: 42 });
  });

  it('respects the timeoutMs cap', async () => {
    await expect(
      runner.runScript(
        {
          language: 'js',
          source: 'while (true) {}',
          capabilities: [],
          timeoutMs: 50,
        },
        ctx(),
        hookOpts,
      ),
    ).rejects.toThrow();
  });

  it('rejects use of api.read without capability', async () => {
    let called = 0;
    const api = {
      object: (n: string) => ({
        count: (..._args: unknown[]) => {
          called++;
          return 1;
        },
      }),
    };
    await expect(
      runner.runScript(
        {
          language: 'js',
          source: "return ctx.api.object('opportunity').count({ a: ctx.input.id });",
          capabilities: [], // no api.read
        },
        ctx({ input: { id: 'x' }, api }),
        hookOpts,
      ),
    ).rejects.toThrow(/api\.read/);
    expect(called).toBe(0);
  });

  it('allows api.read when capability is granted', async () => {
    const api = {
      object: (_n: string) => ({
        count: (_filter: unknown) => 7,
      }),
    };
    const r = await runner.runScript(
      {
        language: 'js',
        source: "return ctx.api.object('o').count({ x: 1 });",
        capabilities: ['api.read'],
      },
      ctx({ input: {}, api }),
      hookOpts,
    );
    expect(r.value).toBe(7);
  });

  it('rejects log calls without log capability', async () => {
    const log = { info: () => {}, warn: () => {}, error: () => {} };
    await expect(
      runner.runScript(
        {
          language: 'js',
          source: "ctx.log.info('hi'); return 1;",
          capabilities: [],
        },
        ctx({ log }),
        hookOpts,
      ),
    ).rejects.toThrow(/'log'/);
  });

  it('crypto.uuid requires capability', async () => {
    await expect(
      runner.runScript(
        { language: 'js', source: 'return ctx.crypto.randomUUID();', capabilities: [] },
        ctx(),
        hookOpts,
      ),
    ).rejects.toThrow(/crypto\.uuid/);

    const r = await runner.runScript(
      { language: 'js', source: 'return ctx.crypto.randomUUID();', capabilities: ['crypto.uuid'] },
      ctx(),
      hookOpts,
    );
    expect(typeof r.value).toBe('string');
    expect((r.value as string).length).toBeGreaterThanOrEqual(36);
  });

  it('reports script-thrown errors with origin name', async () => {
    await expect(
      runner.runScript(
        { language: 'js', source: "throw new Error('bad');", capabilities: [] },
        ctx(),
        { origin: { kind: 'hook', name: 'oops' } },
      ),
    ).rejects.toThrow(/hook 'oops'/);
  });

  it('exposes the clean business message via SandboxError.innerMessage', async () => {
    // `.message` keeps the `<kind> '<name>' threw: …` debug wrapper for logs;
    // `.innerMessage` is the plain business message (no wrapper, no `Error: `
    // name prefix) that the HTTP layer surfaces to end users.
    const err = await runner
      .runScript(
        { language: 'js', source: "throw new Error('线索信息不完整');", capabilities: [] },
        ctx(),
        { origin: { kind: 'action', name: 'lead_apply_convert' } },
      )
      .then(() => null, (e) => e as SandboxError);
    expect(err).toBeInstanceOf(SandboxError);
    expect(err!.message).toContain("action 'lead_apply_convert' threw:");
    expect(err!.innerMessage).toBe('线索信息不完整');
  });

  it('marshals ctx.input containing a circular Timeout handle without crashing (#2674)', async () => {
    // A live setInterval handle links back on itself
    // (Timeout._idlePrev -> TimersList._idleNext -> …). Naive JSON.stringify
    // over ctx would throw "Converting circular structure to JSON" and take the
    // hook down. The runner must strip the back-edge and run the body.
    const timer = setInterval(() => {}, 1_000);
    try {
      const r = await runner.runScript(
        {
          language: 'js',
          source: 'return { ok: true, n: ctx.input.n };',
          capabilities: [],
        },
        ctx({ input: { n: 5, timer } as unknown as Record<string, unknown> }),
        hookOpts,
      );
      expect(r.value).toEqual({ ok: true, n: 5 });
    } finally {
      clearInterval(timer);
    }
  });

  it('marshals a BigInt in ctx.input by coercing to string rather than throwing', async () => {
    const r = await runner.runScript(
      {
        language: 'js',
        source: 'return { big: ctx.input.big };',
        capabilities: [],
      },
      ctx({ input: { big: 42n } as unknown as Record<string, unknown> }),
      hookOpts,
    );
    expect(r.value).toEqual({ big: '42' });
  });
});

describe('QuickJSScriptRunner — L2 action script', () => {
  it('passes input as the first argument and returns a value', async () => {
    const r = await runner.runScript(
      {
        language: 'js',
        source: 'return { sum: input.a + input.b, who: ctx.user?.id };',
        capabilities: [],
      },
      { input: { a: 2, b: 3 }, user: { id: 'u1' } },
      actionOpts,
    );
    expect(r.value).toEqual({ sum: 5, who: 'u1' });
  });
});

describe('QuickJSScriptRunner — async host APIs', () => {
  it('awaits Promise return values from host APIs (asyncified)', async () => {
    const api = { object: () => ({ count: async () => 7 }) };
    const r = await runner.runScript(
      {
        language: 'js',
        source: "return await ctx.api.object('o').count({});",
        capabilities: ['api.read'],
      },
      ctx({ api }),
      hookOpts,
    );
    expect(r.value).toBe(7);
  });

  it('propagates rejections from async host APIs as SandboxError', async () => {
    const api = {
      object: () => ({
        count: async () => {
          throw new Error('db is on fire');
        },
      }),
    };
    await expect(
      runner.runScript(
        {
          language: 'js',
          source: "return await ctx.api.object('o').count({});",
          capabilities: ['api.read'],
        },
        ctx({ api }),
        hookOpts,
      ),
    ).rejects.toThrow(/db is on fire/);
  });

  it('captures direct ctx.input mutations into result.mutatedInput', async () => {
    const r = await runner.runScript(
      {
        language: 'js',
        source: "ctx.input.normalized = (ctx.input.raw || '').toUpperCase();",
        capabilities: [],
      },
      { input: { raw: 'abc-9' } },
      hookOpts,
    );
    expect(r.mutatedInput).toMatchObject({ raw: 'abc-9', normalized: 'ABC-9' });
  });
});

// ---------------------------------------------------------------------------
// Nested cross-object writes (#1867).
//
// A hook body that issues an engine write (`ctx.api.object('parent').update`)
// re-enters the sandbox: the host-side write fires the *parent's* hook, which
// runs its own body inside a fresh VM while the child's hook is still in flight.
// The old asyncify host-call model crashed here ("memory access out of bounds"
// — the stack cannot be unwound twice). The deferred-promise + pump model must
// compose any depth of nesting safely.
// ---------------------------------------------------------------------------
describe('QuickJSScriptRunner — nested sandbox re-entrancy (#1867)', () => {
  it('a host write that re-invokes the runner (parent hook) does not crash and returns correctly', async () => {
    // The parent's afterUpdate hook body, run when the child writes the parent.
    const parentBody = {
      language: 'js' as const,
      source: 'return { parentTouched: true, doubled: (ctx.input.n || 0) * 2 };',
      capabilities: [] as const,
    };
    const api = {
      object: (_n: string) => ({
        update: async (patch: Record<string, unknown>) => {
          // Re-enter the sandbox exactly as the engine does when the parent
          // write fires the parent's own hook body.
          const nested = await runner.run(
            parentBody,
            { input: { n: 21 } } as ScriptContext,
            { origin: { kind: 'hook', name: 'parent_hook' } },
          );
          return { updated: patch, nested: nested.value };
        },
      }),
    };
    const r = await runner.run(
      {
        language: 'js',
        source: "return await ctx.api.object('parent').update({ total: ctx.input.amount });",
        capabilities: ['api.write'],
      },
      ctx({ input: { amount: 100 }, api }),
      { origin: { kind: 'hook', name: 'child_hook' } },
    );
    expect(r.value).toEqual({
      updated: { total: 100 },
      nested: { parentTouched: true, doubled: 42 },
    });
  }, 15000);

  it('survives a multi-level nested write chain (child → parent → grandparent → …)', async () => {
    const makeApi = (depth: number): any => ({
      object: () => ({
        update: async () => {
          if (depth <= 0) return { leaf: true };
          const nested = await runner.run(
            { language: 'js', source: "return await ctx.api.object('x').update({});", capabilities: ['api.write'] },
            { input: {}, api: makeApi(depth - 1) } as ScriptContext,
            { origin: { kind: 'hook', name: `lvl${depth}` } },
          );
          return { depth, nested: nested.value };
        },
      }),
    });
    const r = await runner.run(
      { language: 'js', source: "return await ctx.api.object('x').update({});", capabilities: ['api.write'] },
      { input: {}, api: makeApi(4) } as ScriptContext,
      { origin: { kind: 'hook', name: 'child' }, timeoutMs: 10000 },
    );
    // Four levels of nesting resolve without a WASM crash.
    expect((r.value as any).nested.nested.nested.nested).toEqual({ leaf: true });
  }, 20000);

  it('runs concurrent nested invocations (fan-out) without cross-VM corruption', async () => {
    const leaf = { language: 'js' as const, source: 'return { leaf: true };', capabilities: [] as const };
    const api: any = {
      object: () => ({
        update: async () => {
          const [a, b, c] = await Promise.all([
            runner.run(leaf, { input: {} } as ScriptContext, { origin: { kind: 'hook', name: 'p1' } }),
            runner.run(leaf, { input: {} } as ScriptContext, { origin: { kind: 'hook', name: 'p2' } }),
            runner.run(leaf, { input: {} } as ScriptContext, { origin: { kind: 'hook', name: 'p3' } }),
          ]);
          return { a: a.value, b: b.value, c: c.value };
        },
      }),
    };
    const r = await runner.run(
      { language: 'js', source: "return await ctx.api.object('x').update({});", capabilities: ['api.write'] },
      { input: {}, api } as ScriptContext,
      { origin: { kind: 'hook', name: 'child' }, timeoutMs: 10000 },
    );
    expect(r.value).toEqual({ a: { leaf: true }, b: { leaf: true }, c: { leaf: true } });
  }, 20000);
});

// ---------------------------------------------------------------------------
// Timeout resolution (#1867). The engine default is a FALLBACK, not a hard
// ceiling: a hook body may declare a larger `timeoutMs` (spec allows ≤30s) so a
// legitimate nested-write rollup has room to settle instead of being clamped to
// the 250ms hook default and killed mid-flight.
// ---------------------------------------------------------------------------
describe('QuickJSScriptRunner — timeout resolution honors body.timeoutMs (#1867)', () => {
  // Stock engine defaults (250ms hooks) — these tests assert the default budget
  // itself, so they must NOT use the generous shared `runner` above.
  const defaultRunner = new QuickJSScriptRunner();

  it('honors a hook body timeoutMs above the 250ms hook default', async () => {
    // Host call settles at ~600ms — comfortably past the old 250ms hook cap but
    // within the body's declared 5000ms budget. Must resolve, not time out.
    const api = {
      object: () => ({
        update: async () => {
          await new Promise<void>((resolve) => setTimeout(resolve, 600));
          return { ok: true };
        },
      }),
    };
    const r = await defaultRunner.runScript(
      {
        language: 'js',
        source: "return await ctx.api.object('x').update({});",
        capabilities: ['api.write'],
        timeoutMs: 5000,
      },
      ctx({ api }),
      hookOpts, // hook origin → old code hard-capped at 250ms
    );
    expect(r.value).toEqual({ ok: true });
  }, 10000);

  it('still applies the 250ms hook default when the body declares no timeoutMs', async () => {
    const api = { object: () => ({ update: () => new Promise<never>(() => {}) }) };
    await expect(
      defaultRunner.runScript(
        { language: 'js', source: "return await ctx.api.object('x').update({});", capabilities: ['api.write'] },
        ctx({ api }),
        hookOpts,
      ),
      // The error message embeds the effective budget — asserting on it proves
      // the 250ms default applied without a flaky wall-clock measurement.
    ).rejects.toThrow(/timeout of 250ms/);
  }, 10000);

  it('lets a hook body LOWER its timeout below the default', async () => {
    const api = { object: () => ({ update: () => new Promise<never>(() => {}) }) };
    await expect(
      defaultRunner.runScript(
        { language: 'js', source: "return await ctx.api.object('x').update({});", capabilities: ['api.write'], timeoutMs: 50 },
        ctx({ api }),
        hookOpts,
      ),
    ).rejects.toThrow(/timeout of 50ms/);
  }, 10000);
});

describe('QuickJSScriptRunner — long-running async host work (pump budget)', () => {
  // Regression: an action's single `ctx.api.update(...)` can synchronously drive
  // a large amount of awaited host work — e.g. a record-change flow that the
  // engine runs inline inside the afterUpdate hook chain (see tianshun-mtc
  // `lead_apply_convert` → `lead_convert_approval`). From the sandbox's view
  // that is ONE asyncified host call that takes many event-loop turns to settle.
  //
  // The pump loop must bound that wait by the configured `timeoutMs`, NOT by a
  // fixed iteration count: a legitimately-progressing call that needs >1000
  // event-loop turns but finishes well within the timeout must still resolve.
  // The old fixed `pumps < 1000` cap fired in ~tens of ms and surfaced as
  // "did not resolve after 1000 pump iterations" — the exact production error.

  it('resolves an action whose host call settles after >1000 event-loop turns', async () => {
    const TURNS = 1500; // comfortably exceeds the old 1000-pump cap
    let observed = 0;
    const api = {
      object: () => ({
        // One asyncified host call that internally needs many macrotask turns
        // before its promise settles — mirrors a CRUD write that synchronously
        // runs a long downstream automation.
        update: async () => {
          for (let i = 0; i < TURNS; i++) {
            await new Promise<void>((resolve) => setImmediate(resolve));
          }
          observed = TURNS;
          return { ok: true };
        },
      }),
    };

    const r = await runner.runScript(
      {
        language: 'js',
        source: "return await ctx.api.object('wid').update({ id: 'x', status: 'pending' });",
        capabilities: ['api.write'],
        timeoutMs: 30000,
      },
      ctx({ api }),
      actionOpts,
    );

    expect(r.value).toEqual({ ok: true });
    expect(observed).toBe(TURNS);
  }, 40000);

  it('resolves an action that makes >1000 sequential host calls', async () => {
    const N = 1500;
    let calls = 0;
    const api = {
      object: () => ({
        update: async () => {
          calls++;
          return { i: calls };
        },
      }),
    };

    const r = await runner.runScript(
      {
        language: 'js',
        source: `
          const o = ctx.api.object('wid');
          for (let i = 0; i < ${N}; i++) { await o.update({ id: 'x', i }); }
          return { calls: ${N} };
        `,
        capabilities: ['api.write'],
        timeoutMs: 30000,
      },
      ctx({ api }),
      actionOpts,
    );

    expect(r.value).toEqual({ calls: N });
    expect(calls).toBe(N);
  }, 40000);

  it('still enforces the timeout on a host call that never settles', async () => {
    const api = {
      object: () => ({
        // Never resolves — must be killed by the deadline, not hang forever.
        update: () => new Promise<never>(() => {}),
      }),
    };

    await expect(
      runner.runScript(
        {
          language: 'js',
          source: "return await ctx.api.object('wid').update({ id: 'x' });",
          capabilities: ['api.write'],
          timeoutMs: 300,
        },
        ctx({ api }),
        actionOpts,
      ),
    ).rejects.toThrow(/timeout/i);
  }, 10000);
});

// ---------------------------------------------------------------------------
// ctx.api.transaction(fn) — explicit transaction boundary inside the sandbox.
//
// The body drives begin / op / op / commit through deferred promises across
// many pump iterations; we assert the handle is threaded explicitly (every
// in-tx op carries the SAME tx number, out-of-tx ops carry none), commit/
// rollback fire correctly, and a tx left open by a throw or a timeout is
// rolled back by the runner's finally.
// ---------------------------------------------------------------------------
describe('QuickJSScriptRunner — ctx.api.transaction', () => {
  /** A ScopedContext-shaped mock that records every op with its tx binding. */
  function makeTxApi() {
    const events: Array<{ op: string; name?: string; tx: number | null }> = [];
    let nextTx = 0;
    const repoFor = (tx: number | null) => (name: string) => ({
      insert: async (rec: unknown) => { events.push({ op: 'insert', name, tx }); return { id: 'r', tx, rec }; },
      findOne: async () => { events.push({ op: 'findOne', name, tx }); return { tx }; },
      count: async () => { events.push({ op: 'count', name, tx }); return 0; },
    });
    const api = {
      object: repoFor(null),
      beginTransaction: async () => {
        const handle = ++nextTx;
        events.push({ op: 'begin', tx: handle });
        return { ctx: { object: repoFor(handle) }, handle };
      },
      commitTransaction: async (handle: number) => { events.push({ op: 'commit', tx: handle }); },
      rollbackTransaction: async (handle: number) => { events.push({ op: 'rollback', tx: handle }); },
    };
    return { api, events };
  }

  it('threads one tx handle through all in-tx ops and commits on success', async () => {
    const { api, events } = makeTxApi();
    const r = await runner.runScript(
      {
        language: 'js',
        source: `
          await ctx.api.object('a').insert({ pre: 1 });        // out of tx
          const out = await ctx.api.transaction(async () => {
            await ctx.api.object('a').insert({ x: 1 });
            await ctx.api.object('b').insert({ y: 2 });
            return 'done';
          });
          await ctx.api.object('a').insert({ post: 1 });       // out of tx
          return out;
        `,
        capabilities: ['api.write', 'api.transaction'],
        timeoutMs: 30000,
      },
      ctx({ api }),
      actionOpts,
    );

    // The callback's return value is forwarded.
    expect(r.value).toBe('done');
    // Strict ordering + handle threading.
    expect(events).toEqual([
      { op: 'insert', name: 'a', tx: null },  // before tx
      { op: 'begin', tx: 1 },
      { op: 'insert', name: 'a', tx: 1 },     // both in-tx ops share handle #1
      { op: 'insert', name: 'b', tx: 1 },
      { op: 'commit', tx: 1 },
      { op: 'insert', name: 'a', tx: null },  // after tx — unbound again
    ]);
  }, 30000);

  it('reads inside the tx also reuse the handle', async () => {
    const { api, events } = makeTxApi();
    await runner.runScript(
      {
        language: 'js',
        source: `
          await ctx.api.transaction(async () => {
            await ctx.api.object('a').findOne({ id: 1 });
            await ctx.api.object('a').insert({ x: 1 });
          });
        `,
        capabilities: ['api.read', 'api.write', 'api.transaction'],
        timeoutMs: 30000,
      },
      ctx({ api }),
      actionOpts,
    );
    expect(events).toEqual([
      { op: 'begin', tx: 1 },
      { op: 'findOne', name: 'a', tx: 1 },
      { op: 'insert', name: 'a', tx: 1 },
      { op: 'commit', tx: 1 },
    ]);
  }, 30000);

  it('rolls back (not commits) when the callback throws, and re-throws the original error', async () => {
    const { api, events } = makeTxApi();
    await expect(
      runner.runScript(
        {
          language: 'js',
          source: `
            await ctx.api.transaction(async () => {
              await ctx.api.object('a').insert({ x: 1 });
              throw new Error('boom');
            });
          `,
          capabilities: ['api.write', 'api.transaction'],
          timeoutMs: 30000,
        },
        ctx({ api }),
        actionOpts,
      ),
    ).rejects.toThrow(/boom/);

    expect(events.map((e) => e.op)).toEqual(['begin', 'insert', 'rollback']);
    expect(events.some((e) => e.op === 'commit')).toBe(false);
  }, 30000);

  it('rejects a nested transaction', async () => {
    const { api } = makeTxApi();
    await expect(
      runner.runScript(
        {
          language: 'js',
          source: `
            await ctx.api.transaction(async () => {
              await ctx.api.transaction(async () => {});
            });
          `,
          capabilities: ['api.write', 'api.transaction'],
          timeoutMs: 30000,
        },
        ctx({ api }),
        actionOpts,
      ),
    ).rejects.toThrow(/nested/i);
  }, 30000);

  it('requires the api.transaction capability', async () => {
    const { api } = makeTxApi();
    await expect(
      runner.runScript(
        {
          language: 'js',
          source: `await ctx.api.transaction(async () => {});`,
          capabilities: ['api.write'], // no api.transaction
          timeoutMs: 30000,
        },
        ctx({ api }),
        actionOpts,
      ),
    ).rejects.toThrow(/api\.transaction/);
  }, 30000);

  it('rolls back a transaction the body leaves open when the deadline fires', async () => {
    const events: Array<{ op: string; tx: number | null }> = [];
    let nextTx = 0;
    const api = {
      object: () => ({
        // never settles — the in-tx op stalls until the deadline cuts in
        insert: () => new Promise<never>(() => {}),
      }),
      beginTransaction: async () => {
        const handle = ++nextTx;
        events.push({ op: 'begin', tx: handle });
        return { ctx: { object: () => ({ insert: () => new Promise<never>(() => {}) }) }, handle };
      },
      commitTransaction: async (h: number) => { events.push({ op: 'commit', tx: h }); },
      rollbackTransaction: async (h: number) => { events.push({ op: 'rollback', tx: h }); },
    };

    await expect(
      runner.runScript(
        {
          language: 'js',
          source: `
            await ctx.api.transaction(async () => {
              await ctx.api.object('a').insert({ x: 1 });
            });
          `,
          capabilities: ['api.write', 'api.transaction'],
          timeoutMs: 300,
        },
        ctx({ api }),
        actionOpts,
      ),
    ).rejects.toThrow(/timeout/i);

    // begin happened, the op stalled, deadline fired → finally rolled it back.
    expect(events.map((e) => e.op)).toEqual(['begin', 'rollback']);
  }, 10000);

  it('degrades to non-transactional when the driver lacks tx support', async () => {
    const events: Array<{ op: string; tx: number | null }> = [];
    // No beginTransaction — mimics an in-memory driver without tx primitives.
    const api = {
      object: () => ({
        insert: async () => { events.push({ op: 'insert', tx: null }); return { id: 'r' }; },
      }),
    };
    const r = await runner.runScript(
      {
        language: 'js',
        source: `
          return await ctx.api.transaction(async () => {
            await ctx.api.object('a').insert({ x: 1 });
            return 'ok';
          });
        `,
        capabilities: ['api.write', 'api.transaction'],
        timeoutMs: 30000,
      },
      ctx({ api }),
      actionOpts,
    );
    // Callback still runs and returns; the op simply isn't wrapped in a tx.
    expect(r.value).toBe('ok');
    expect(events).toEqual([{ op: 'insert', tx: null }]);
  }, 30000);
});
