// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
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

  it('respects the timeoutMs cap (CPU budget)', async () => {
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
    ).rejects.toThrow(/CPU budget of 50ms/);
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
    // Four members since #7661 — see `ScriptContext['log']`.
    const log = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
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

  // ── `crypto.hash` retirement pins (#4391) ─────────────────────────────────
  //
  // `ScriptContext.crypto.hash` was typed on the host seam (and `crypto.hash`
  // was an authorable token, and the CLI inferred it) while `installCtx` wired
  // only `randomUUID`. The type promised a seam that never existed; spec 17
  // removed it rather than implementing it, so nothing may re-declare it
  // without also installing it.

  it('the VM ctx.crypto exposes exactly randomUUID, under ANY grant (#4391)', async () => {
    // The EXECUTABLE pin, and the load-bearing one. `@objectstack/runtime` has
    // no `typecheck` script (it sits in the DEBT table of
    // scripts/check-type-check-coverage.mjs), so a type-level assertion here
    // would never be compiled — a dead pin reads as assurance and gives none.
    // This enumerates what `installCtx` actually put on the seam instead.
    //
    // It is deliberately exhaustive rather than `hash`-specific: the defect was
    // a member advertised ahead of its implementation, so ANY new member must
    // come through a review that also updates this list.
    //
    // Every token the enum still offers is granted, so a failure cannot be
    // misread as "the capability simply was not granted".
    const allGrants = ['api.read', 'api.write', 'api.transaction', 'crypto.uuid', 'log'] as const;

    const keys = await runner.runScript(
      {
        language: 'js',
        source: 'return Object.keys(ctx.crypto).sort().join(",");',
        capabilities: [...allGrants],
      },
      ctx(),
      hookOpts,
    );
    expect(keys.value).toBe('randomUUID');

    // And the specific regression: no hash function reachable by any spelling.
    const typeofHash = await runner.runScript(
      {
        language: 'js',
        source: 'return typeof ctx.crypto.hash;',
        capabilities: [...allGrants],
      },
      ctx(),
      hookOpts,
    );
    expect(typeofHash.value).toBe('undefined');
  });

  it('ScriptContext.crypto declares randomUUID and nothing else (#4391)', () => {
    // Compile-time companion to the pin above. It is DORMANT today (runtime is
    // not typechecked — see the note above) and arms itself the moment runtime
    // onboards `typecheck`; it is kept because re-declaring the type without an
    // implementation is the exact defect #4391 removed, and this is where the
    // next reader will look for that rule.
    type CryptoSeam = NonNullable< ScriptContext['crypto'] >;
    type ExtraMembers = Exclude< keyof CryptoSeam, 'randomUUID' >;
    const extraMembers: ExtraMembers[] = [];
    expect(extraMembers).toEqual([]);
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

// `ctx.record` is a read-only pre-fetched snapshot: nothing writes it back, so
// every write to it is discarded — for a DECLARED field exactly as much as for
// an unknown one, which is what made #4345 a false-completion trap rather than
// a typo. The engine cannot make the write land (that is the action's `ctx.api`
// channel), but it can refuse to lose it in silence.
describe('QuickJSScriptRunner — ctx.record writes are recorded, not silently dropped (#4345)', () => {
  const record = { id: 'deal_1', stage: 'negotiation', amount: 100 };

  it('reports no dropped writes when the context carries no record', async () => {
    const r = await runner.runScript(
      { language: 'js', source: 'return { ok: true };', capabilities: [] },
      ctx(),
      actionOpts,
    );
    // Distinct from `[]`: no snapshot existed, so no recorder was installed.
    expect(r.droppedRecordWrites).toBeUndefined();
  });

  it('reports an empty write set when the record is only read', async () => {
    const r = await runner.runScript(
      { language: 'js', source: 'return { stage: ctx.record.stage };', capabilities: [] },
      ctx({ record: { ...record } }),
      actionOpts,
    );
    expect(r.value).toEqual({ stage: 'negotiation' });
    expect(r.droppedRecordWrites).toEqual([]);
  });

  it('records a plain property write — and the host snapshot is untouched', async () => {
    const host = { ...record };
    const r = await runner.runScript(
      { language: 'js', source: "ctx.record.stage = 'won'; return { ok: true };", capabilities: [] },
      ctx({ record: host }),
      actionOpts,
    );
    // The action still "succeeds" — that is the trap, and the report is the fix.
    expect(r.value).toEqual({ ok: true });
    expect(r.droppedRecordWrites).toEqual(['stage']);
    expect(host.stage).toBe('negotiation');
  });

  it('forwards the write inside the VM so a body using the snapshot as scratch stays coherent', async () => {
    const r = await runner.runScript(
      {
        language: 'js',
        source: 'ctx.record.amount = ctx.record.amount * 2; return { amount: ctx.record.amount };',
        capabilities: [],
      },
      ctx({ record: { ...record } }),
      actionOpts,
    );
    expect(r.value).toEqual({ amount: 200 });
    expect(r.droppedRecordWrites).toEqual(['amount']);
  });

  it('sees what static analysis cannot: computed keys, Object.assign, aliases, delete', async () => {
    const r = await runner.runScript(
      {
        language: 'js',
        source:
          "var k = 'st' + 'age'; ctx.record[k] = 'won';" +
          "Object.assign(ctx.record, { amount: 1 });" +
          'var alias = ctx.record; alias.owner = "u1";' +
          'delete ctx.record.id;' +
          'return { ok: true };',
        capabilities: [],
      },
      ctx({ record: { ...record } }),
      actionOpts,
    );
    // First-write order, deduplicated.
    expect(r.droppedRecordWrites).toEqual(['stage', 'amount', 'owner', 'id']);
  });

  it('catches a WHOLESALE replacement, and keeps recording afterwards', async () => {
    // `ctx.record = {…}` would swap a bare proxy out and silence every later
    // write — the one shape where the recorder could go quiet exactly when the
    // author was most confident they had persisted. The accessor reports the
    // replacement's own keys, which is what the author believed they wrote.
    const r = await runner.runScript(
      {
        language: 'js',
        source: "ctx.record = { stage: 'won', amount: 9 }; ctx.record.owner = 'u1'; return { ok: true };",
        capabilities: [],
      },
      ctx({ record: { ...record } }),
      actionOpts,
    );
    expect(r.value).toEqual({ ok: true });
    expect(r.droppedRecordWrites).toEqual(['stage', 'amount', 'owner']);
  });

  it('reports a non-object replacement without inventing field names', async () => {
    const r = await runner.runScript(
      { language: 'js', source: 'ctx.record = null; return null;', capabilities: [] },
      ctx({ record: { ...record } }),
      actionOpts,
    );
    expect(r.droppedRecordWrites).toEqual(['(whole record replaced)']);
  });

  it('keeps the snapshot readable through the accessor', async () => {
    const r = await runner.runScript(
      {
        language: 'js',
        source: 'return { keys: Object.keys(ctx.record).sort(), stage: ctx.record.stage };',
        capabilities: [],
      },
      ctx({ record: { ...record } }),
      actionOpts,
    );
    expect(r.value).toEqual({ keys: ['amount', 'id', 'stage'], stage: 'negotiation' });
    expect(r.droppedRecordWrites).toEqual([]);
  });

  it('reports each field once however often it is rewritten', async () => {
    const r = await runner.runScript(
      {
        language: 'js',
        source: "ctx.record.stage = 'a'; ctx.record.stage = 'b'; ctx.record.stage = 'c'; return null;",
        capabilities: [],
      },
      ctx({ record: { ...record } }),
      actionOpts,
    );
    expect(r.droppedRecordWrites).toEqual(['stage']);
  });

  // A write is only DEAD if the snapshot never leaves the body as a value.
  // These four all LAND, so reporting them would be a false statement about the
  // stored record — worse than saying nothing.
  describe('a write whose snapshot escapes is live, and stays unreported', () => {
    const api = { object: () => ({ update: async (d: unknown) => d }) };
    const live = (source: string) =>
      runner.runScript(
        { language: 'js', source, capabilities: ['api.write'] },
        ctx({ record: { ...record }, api }),
        actionOpts,
      );

    it('handed to ctx.api as the payload — the canonical live shape', async () => {
      const r = await live("ctx.record.stage = 'won'; await ctx.api.object('d').update(ctx.record); return null;");
      expect(r.droppedRecordWrites).toEqual([]);
    });

    it('copied out of the body', async () => {
      const r = await live("ctx.record.stage = 'won'; return { patch: Object.assign({}, ctx.record) };");
      expect(r.droppedRecordWrites).toEqual([]);
    });

    it('returned whole', async () => {
      const r = await live("ctx.record.stage = 'won'; return ctx.record;");
      expect(r.droppedRecordWrites).toEqual([]);
    });

    it('serialised', async () => {
      const r = await live("ctx.record.stage = 'won'; return { n: JSON.stringify(ctx.record).length };");
      expect(r.droppedRecordWrites).toEqual([]);
    });

    it('but a property READ does not rescue the write', async () => {
      // Reading `ctx.record.id` consumes a field, not the object — the
      // assignment still goes nowhere. This is the distinction that keeps the
      // signal alive on real bodies: the showcase's own guard idiom below is
      // exactly this shape.
      const r = await live(
        "var id = ctx.recordId || (ctx.record && ctx.record.id); ctx.record.stage = 'won'; return { id: id };",
      );
      expect(r.droppedRecordWrites).toEqual(['stage']);
    });

    it('and enumerating BEFORE any write leaves the recorder armed', async () => {
      const r = await live("var keys = Object.keys(ctx.record); ctx.record.stage = 'won'; return { n: keys.length };");
      expect(r.droppedRecordWrites).toEqual(['stage']);
    });
  });

  it('leaves the hook path alone — a hook ctx carries no record, so nothing is recorded', async () => {
    const r = await runner.runScript(
      { language: 'js', source: 'ctx.input.total = 1; return null;', capabilities: [] },
      ctx({ input: {} }),
      hookOpts,
    );
    expect(r.droppedRecordWrites).toBeUndefined();
    expect(r.mutatedInput).toEqual({ total: 1 });
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
  // Pin the hook default to 250ms EXPLICITLY (not the bare stock constructor) so
  // these assertions on the effective budget stay independent of any ambient
  // `OS_SANDBOX_HOOK_TIMEOUT_MS` the environment/CI may set (#3259). They assert
  // the resolution logic — body.timeoutMs vs the runner default — which is
  // identical whether that default came from the built-in constant or an
  // explicit option. (A dedicated suite below covers the env override itself.)
  const defaultRunner = new QuickJSScriptRunner({ hookTimeoutMs: 250 });

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

  it('applies the 250ms default CPU budget when the body declares no timeoutMs', async () => {
    // A synchronous busy loop burns CPU (unlike a never-settling host call, which
    // is idle and would hit the wall ceiling instead). The error embeds the
    // effective budget — asserting on it proves the 250ms default applied.
    await expect(
      defaultRunner.runScript(
        { language: 'js', source: 'while (true) {}', capabilities: [] },
        ctx(),
        hookOpts,
      ),
    ).rejects.toThrow(/CPU budget of 250ms/);
  }, 10000);

  it('lets a hook body LOWER its CPU budget below the default', async () => {
    await expect(
      defaultRunner.runScript(
        { language: 'js', source: 'while (true) {}', capabilities: [], timeoutMs: 50 },
        ctx(),
        hookOpts,
      ),
    ).rejects.toThrow(/CPU budget of 50ms/);
  }, 10000);
});

// ---------------------------------------------------------------------------
// Env-overridable CPU-budget defaults (#3259 / ADR-0102 D1). `OS_SANDBOX_HOOK_TIMEOUT_MS`
// sets the FALLBACK per-invocation CPU budget for hooks; an explicit constructor
// option still wins over the env, and a body's own timeoutMs still wins over the
// resolved default. A synchronous busy loop (`while(true){}`) burns CPU, so the
// error embeds the RESOLVED budget — asserting on it proves which value applied
// without a flaky wall-clock measurement. Each test constructs its runner AFTER
// setting the env (the constructor reads it once), and the env is saved/restored
// so a CI-wide value doesn't leak in or out.
// ---------------------------------------------------------------------------
describe('QuickJSScriptRunner — env-overridable CPU-budget defaults (#3259)', () => {
  const HOOK_ENV = 'OS_SANDBOX_HOOK_TIMEOUT_MS';
  let saved: string | undefined;
  beforeEach(() => {
    saved = process.env[HOOK_ENV];
    delete process.env[HOOK_ENV];
  });
  afterEach(() => {
    if (saved === undefined) delete process.env[HOOK_ENV];
    else process.env[HOOK_ENV] = saved;
  });

  const runBurn = (r: QuickJSScriptRunner) =>
    r.runScript({ language: 'js', source: 'while (true) {}', capabilities: [] }, ctx(), hookOpts);

  it('falls back to the built-in 250ms CPU budget when the env var is unset', async () => {
    await expect(runBurn(new QuickJSScriptRunner())).rejects.toThrow(/CPU budget of 250ms/);
  }, 10000);

  it('uses OS_SANDBOX_HOOK_TIMEOUT_MS as the default when set', async () => {
    process.env[HOOK_ENV] = '150';
    await expect(runBurn(new QuickJSScriptRunner())).rejects.toThrow(/CPU budget of 150ms/);
  }, 10000);

  it('lets an explicit constructor option win over the env var', async () => {
    process.env[HOOK_ENV] = '150';
    await expect(runBurn(new QuickJSScriptRunner({ hookTimeoutMs: 50 }))).rejects.toThrow(/CPU budget of 50ms/);
  }, 10000);

  it('ignores a non-numeric / non-positive env value and keeps the built-in default', async () => {
    process.env[HOOK_ENV] = 'not-a-number';
    await expect(runBurn(new QuickJSScriptRunner())).rejects.toThrow(/CPU budget of 250ms/);
  }, 10000);
});

// ---------------------------------------------------------------------------
// CPU budget vs wall ceiling (ADR-0102 D1). The two bounds are distinct: CPU
// time bounds a runaway *script*; the wall ceiling bounds a body stuck on a host
// call that never settles. Critically, idle host-await time is NOT charged to the
// CPU budget — the regression that caused the #3259 flake.
// ---------------------------------------------------------------------------
describe('QuickJSScriptRunner — CPU budget vs wall ceiling (ADR-0102)', () => {
  it('does NOT charge idle host-await time to the CPU budget (#3259 root cause)', async () => {
    // Host settles ~500ms — well past the 250ms CPU budget — but the VM burns ~no
    // CPU while awaiting, so it MUST resolve. The old wall-clock 250ms killed this.
    const api = {
      object: () => ({
        update: async () => {
          await new Promise<void>((resolve) => setTimeout(resolve, 500));
          return { ok: true };
        },
      }),
    };
    const r = new QuickJSScriptRunner({ hookTimeoutMs: 250 });
    const out = await r.runScript(
      { language: 'js', source: "return await ctx.api.object('x').update({});", capabilities: ['api.write'] },
      ctx({ api }),
      hookOpts,
    );
    expect(out.value).toEqual({ ok: true });
  }, 10000);

  it('cuts a body stuck on a never-settling host call at the wall ceiling', async () => {
    // CPU budget 250ms is never reached (the VM is idle); wallCeilingMs 300ms —
    // effective ceiling max(300, 250) = 300 — is the backstop that fires.
    const api = { object: () => ({ update: () => new Promise<never>(() => {}) }) };
    const r = new QuickJSScriptRunner({ hookTimeoutMs: 250, wallCeilingMs: 300 });
    await expect(
      r.runScript(
        { language: 'js', source: "return await ctx.api.object('x').update({});", capabilities: ['api.write'] },
        ctx({ api }),
        hookOpts,
      ),
    ).rejects.toThrow(/wall-clock ceiling of 300ms/);
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

  it('still enforces the wall ceiling on a host call that never settles', async () => {
    const api = {
      object: () => ({
        // Never resolves — an idle body burns no CPU, so it is the wall ceiling
        // (not the CPU budget) that must kill it rather than hang forever.
        update: () => new Promise<never>(() => {}),
      }),
    };
    const r = new QuickJSScriptRunner({ actionTimeoutMs: 300, wallCeilingMs: 300 });
    await expect(
      r.runScript(
        {
          language: 'js',
          source: "return await ctx.api.object('wid').update({ id: 'x' });",
          capabilities: ['api.write'],
        },
        ctx({ api }),
        actionOpts,
      ),
    ).rejects.toThrow(/wall-clock ceiling/i);
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

  it('rolls back a transaction the body leaves open when the wall ceiling fires', async () => {
    const events: Array<{ op: string; tx: number | null }> = [];
    let nextTx = 0;
    const api = {
      object: () => ({
        // never settles — the in-tx op stalls until the wall ceiling cuts in
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

    // Idle in-tx op → the wall ceiling (not the CPU budget) is the backstop.
    const r = new QuickJSScriptRunner({ wallCeilingMs: 300 });
    await expect(
      r.runScript(
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
    ).rejects.toThrow(/ceiling/i);

    // begin happened, the op stalled, wall ceiling fired → finally rolled it back.
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

  // -------------------------------------------------------------------------
  // #6406 — `begin` may JOIN a transaction the host already had open
  // (ADR-0067 D2). `owned: false` in its result says the OUTER caller owns the
  // one and only commit/rollback, so every close path here abstains.
  //
  // `ScopedContext` abstains for a joined handle on its own side too, which is
  // the guarantee that holds for every caller. These cases use a hand-written
  // `ctx.api` that does NOT, so what they measure is this file's own wiring:
  // whether the runner asks at all. The end-to-end behaviour against the real
  // engine is `transaction-ambient-join.integration.test.ts`.
  // -------------------------------------------------------------------------
  /** Like {@link makeTxApi}, but `begin` JOINS a handle the host already holds. */
  function makeJoinedTxApi() {
    const events: Array<{ op: string; name?: string; tx: unknown }> = [];
    const outerHandle = { __outer: true };
    const repoFor = (tx: unknown) => (name: string) => ({
      insert: async () => { events.push({ op: 'insert', name, tx }); return { id: 'r' }; },
      findOne: async () => { events.push({ op: 'findOne', name, tx }); return null; },
    });
    const api = {
      object: repoFor(null),
      beginTransaction: async () => {
        events.push({ op: 'begin(joined)', tx: outerHandle });
        return { ctx: { object: repoFor(outerHandle) }, handle: outerHandle, owned: false };
      },
      commitTransaction: async (h: unknown) => { events.push({ op: 'commit', tx: h }); },
      rollbackTransaction: async (h: unknown) => { events.push({ op: 'rollback', tx: h }); },
    };
    return { api, events, outerHandle };
  }

  it('does NOT commit a JOINED transaction — the outer owner does', async () => {
    const { api, events, outerHandle } = makeJoinedTxApi();
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

    expect(r.value).toBe('ok');
    // The in-tx op still rides the OUTER handle — joining is what puts it on
    // the one connection — but nothing here closes that transaction.
    expect(events).toEqual([
      { op: 'begin(joined)', tx: outerHandle },
      { op: 'insert', name: 'a', tx: outerHandle },
    ]);
  }, 30000);

  it('does NOT roll back a JOINED transaction when the body throws — the error propagates instead', async () => {
    const { api, events } = makeJoinedTxApi();
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

    // The sugar's catch reaches `__txRollback`, which abstains, and re-throws —
    // so the host owner hears the failure and decides for the whole unit.
    expect(events.map((e) => e.op)).toEqual(['begin(joined)', 'insert']);
  }, 30000);

  it('does NOT roll back a JOINED transaction the body leaves open at the wall ceiling', async () => {
    const events: Array<{ op: string; tx: unknown }> = [];
    const outerHandle = { __outer: true };
    const api = {
      object: () => ({ insert: () => new Promise<never>(() => {}) }),
      beginTransaction: async () => {
        events.push({ op: 'begin(joined)', tx: outerHandle });
        return {
          ctx: { object: () => ({ insert: () => new Promise<never>(() => {}) }) },
          handle: outerHandle,
          owned: false,
        };
      },
      commitTransaction: async (h: unknown) => { events.push({ op: 'commit', tx: h }); },
      rollbackTransaction: async (h: unknown) => { events.push({ op: 'rollback', tx: h }); },
    };

    const r = new QuickJSScriptRunner({ wallCeilingMs: 300 });
    await expect(
      r.runScript(
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
    ).rejects.toThrow(/ceiling/i);

    // The owned case above rolls back here, to avoid leaking a half-applied
    // transaction on a connection nobody else holds. A JOINED handle is the
    // host's live transaction on the host's connection: rolling it back from a
    // VM teardown would discard writes the outer caller has not finished with,
    // and there is nothing to leak — the timeout error reaches that caller,
    // which decides.
    expect(events.map((e) => e.op)).toEqual(['begin(joined)']);
  }, 10000);
});

// ---------------------------------------------------------------------------
// Idle pump backoff (#3233). While the body only *waits* on an in-flight host
// promise, the pump loop must not spin setImmediate ~200k×/s doing nothing — it
// ramps up to a small capped setTimeout. Correctness (progress + deadline) is
// unchanged; these assert the spin is gone and settlements are still caught.
// ---------------------------------------------------------------------------
describe('QuickJSScriptRunner — idle pump backoff (#3233)', () => {
  it('does not busy-spin while idle-waiting on a slow host call — pump count stays bounded', async () => {
    // A host call that never settles; the wall ceiling cuts it off. Under the old
    // unconditional setImmediate yield this reported ~50k pump iterations for a
    // ~250ms wait; the adaptive backoff keeps it to a small bounded number.
    const api = { object: () => ({ update: () => new Promise<never>(() => {}) }) };
    const r = new QuickJSScriptRunner({ wallCeilingMs: 300 });
    const err = await r
      .runScript(
        { language: 'js', source: "return await ctx.api.object('x').update({});", capabilities: ['api.write'], timeoutMs: 300 },
        ctx({ api }),
        hookOpts,
      )
      .then(() => null, (e) => e as SandboxError);
    expect(err).toBeInstanceOf(SandboxError);
    const m = /after (\d+) pump iterations/.exec(err!.message);
    expect(m, `ceiling message should report the pump count: ${err?.message}`).toBeTruthy();
    const pumps = Number(m![1]);
    // ~300ms at an ≤8ms idle poll ≈ tens of pumps, not tens of thousands.
    expect(pumps).toBeLessThan(1000);
  }, 10000);

  it('still promptly catches a host call that settles during the idle backoff', async () => {
    // Settles at ~120ms — past the fast-pump window, squarely in the backoff
    // regime — and must still resolve well within the timeout.
    const api = {
      object: () => ({
        update: async () => { await new Promise<void>((r) => setTimeout(r, 120)); return { ok: true }; },
      }),
    };
    const start = Date.now();
    const r = await runner.runScript(
      { language: 'js', source: "return await ctx.api.object('x').update({});", capabilities: ['api.write'], timeoutMs: 5000 },
      ctx({ api }),
      hookOpts,
    );
    expect(r.value).toEqual({ ok: true });
    // Caught within a backoff slice of the ~120ms settlement, nowhere near the timeout.
    expect(Date.now() - start).toBeLessThan(1000);
  }, 10000);
});
