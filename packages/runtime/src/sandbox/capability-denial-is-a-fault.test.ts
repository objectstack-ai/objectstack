// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#4431] A capability denial is the sandbox FAULTING, not the body rejecting.
 *
 * The `action-crash-vs-rejection` contract (#3951) pins the table:
 *
 *   | `SandboxError` WITH `innerMessage`  — a body's deliberate throw | 400 |
 *   | `SandboxError` with NO `innerMessage` — timeout, capability denial | 500 |
 *
 * A capability gate throws `SandboxError` synchronously inside a QuickJS host
 * function, which rejects the async IIFE *inside* the VM — so it came back
 * through the `__error` side-channel, and the pump loop presumed everything
 * arriving there was user code throwing on purpose. It therefore set
 * `innerMessage`, the dispatcher's classifier read that as a deliberate
 * rejection and answered **400**, and the client got the `SandboxError: ` debug
 * prefix that only ever belonged in server logs.
 *
 * The contract's own claim — "capability denial has no user-meaningful inner
 * message" — held only for denials detected OUTSIDE evaluation (a timeout,
 * which takes the separate `budgetError` path). These tests pin the in-VM
 * host-call denials that were misclassified: `ctx.api.*`, `ctx.log`,
 * `ctx.crypto`, `ctx.api.transaction`.
 *
 * The HTTP half of the contract is asserted by
 * `domains/actions-fault-vs-rejection.test.ts`, which already states that a
 * `SandboxError` with no `innerMessage` is a 500 — this file is what makes a
 * real capability denial actually arrive in that shape.
 */

import { describe, it, expect } from 'vitest';
import { QuickJSScriptRunner, SandboxError } from './quickjs-runner.js';
import type { ScriptContext, ScriptRunOptions } from './script-runner.js';

const runner = new QuickJSScriptRunner({ hookTimeoutMs: 10_000, actionTimeoutMs: 10_000 });
const actionOpts: ScriptRunOptions = { origin: { kind: 'action', name: 'rc1_crash_probe' } };

function ctx(over: Partial<ScriptContext> = {}): ScriptContext {
  return { input: {}, ...over };
}

async function faultOf(run: () => Promise<unknown>): Promise<SandboxError> {
  const e = await run().then(() => null, (err) => err as SandboxError);
  expect(e, 'expected the sandbox to refuse, but the script resolved').toBeInstanceOf(SandboxError);
  return e!;
}

describe('[#4431] an in-VM capability denial reaches the classifier as a FAULT', () => {
  const api = { object: (_n: string) => ({ count: (_f: unknown) => 1 }) };

  it("ctx.api.object(x).count without api.read — the issue's exact repro", async () => {
    const err = await faultOf(() =>
      runner.runScript(
        {
          language: 'js',
          source: "return ctx.api.object('showcase_task').count({});",
          capabilities: [], // the denial under test
        },
        ctx({ api }),
        actionOpts,
      ),
    );

    // THE fix: no `innerMessage`. `domains/actions.ts` reads its absence (plus
    // the non-`Error` name) as an unexpected fault → `errorFromThrown(err, 500)`.
    // With it set, the denial was served as a deliberate 400 and stayed
    // invisible to gateway error rates, APM and alerting.
    expect(err.innerMessage).toBeUndefined();

    // The debug prefix must not reach the client. The runner's own doc says
    // only the business message should — and a sandbox fault has none, so what
    // the client sees is this text, minus the prefix.
    expect(err.message).not.toContain('SandboxError:');
    // …while the actionable content survives: which capability, whose, and the
    // call that tripped the gate.
    expect(err.message).toContain("capability 'api.read' not granted");
    expect(err.message).toContain("action 'rc1_crash_probe'");
    expect(err.message).toContain("ctx.api.object('showcase_task').count");

    // Nor does it get the `<kind> '<name>' threw:` wrapper — nothing threw; the
    // sandbox refused before user code could run the call.
    expect(err.message).not.toContain('threw:');

    // No `code`/`fields` either: both are "structured domain failure" markers
    // the classifier reads as a REJECTION, so carrying one would re-break the
    // 500 the same way `innerMessage` did.
    expect(err.code).toBeUndefined();
    expect(err.fields).toBeUndefined();

    // The classifier's own predicate, spelled out.
    expect(err.name).toBe('SandboxError');
  });

  it('ctx.log without the log capability', async () => {
    // Four members since #7661 — `debug` is a real level of this seam, not a
    // decoration, so a host double that omits it no longer type-checks.
    const log = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
    const err = await faultOf(() =>
      runner.runScript(
        { language: 'js', source: "ctx.log.info('hi'); return 1;", capabilities: [] },
        ctx({ log }),
        actionOpts,
      ),
    );
    expect(err.innerMessage).toBeUndefined();
    expect(err.message).not.toContain('SandboxError:');
    expect(err.message).toContain("capability 'log' not granted");
  });

  it('ctx.crypto.randomUUID without the crypto.uuid capability', async () => {
    const err = await faultOf(() =>
      runner.runScript(
        { language: 'js', source: 'return ctx.crypto.randomUUID();', capabilities: [] },
        ctx(),
        actionOpts,
      ),
    );
    expect(err.innerMessage).toBeUndefined();
    expect(err.message).not.toContain('SandboxError:');
    expect(err.message).toContain("capability 'crypto.uuid' not granted");
  });

  it('ctx.api.transaction without the api.transaction capability', async () => {
    const err = await faultOf(() =>
      runner.runScript(
        {
          language: 'js',
          source: 'return await ctx.api.transaction(async () => 1);',
          capabilities: ['api.read'],
        },
        ctx({ api }),
        actionOpts,
      ),
    );
    expect(err.innerMessage).toBeUndefined();
    expect(err.message).not.toContain('SandboxError:');
    expect(err.message).toContain("capability 'api.transaction' not granted");
  });

  it('a denial the body CATCHES and rethrows as its own error stays a rejection', async () => {
    // The other direction, and the reason the marker is a property on the VM
    // error rather than a match on the flattened `SandboxError: …` text: once
    // user code has caught the denial and thrown its own business error, the
    // outcome IS a deliberate rejection and must keep its 400.
    const err = await faultOf(() =>
      runner.runScript(
        {
          language: 'js',
          source: `try { await ctx.api.object('t').count({}); }
                   catch (e) { throw new Error('权限不足，请联系管理员'); }
                   return 1;`,
          capabilities: [],
        },
        ctx({ api }),
        actionOpts,
      ),
    );
    expect(err.innerMessage).toBe('权限不足，请联系管理员');
    expect(err.message).toContain("action 'rc1_crash_probe' threw:");
  });
});

describe('[#4431] the rejection side of the contract is untouched', () => {
  it('a deliberate throw still carries innerMessage and the debug wrapper', async () => {
    const err = await faultOf(() =>
      runner.runScript(
        { language: 'js', source: "throw new Error('线索信息不完整');", capabilities: [] },
        ctx(),
        actionOpts,
      ),
    );
    expect(err.innerMessage).toBe('线索信息不完整');
    expect(err.message).toContain("action 'rc1_crash_probe' threw:");
  });

  it('a structured error crossing out of ctx.api keeps its code and fields', async () => {
    // The #3937/#4345 passthrough: a record ValidationError raised by a host
    // call is a REJECTION, and its structure must survive. Pinned here because
    // the fault marker is set on the same path (`hostErrorToVm`) — a marker
    // applied too broadly would turn every failed write into a 500.
    const api = {
      object: (_n: string) => ({
        update: async () => {
          const e: any = new Error('issued_on is required');
          e.name = 'ValidationError';
          e.code = 'VALIDATION_FAILED';
          e.fields = [{ field: 'issued_on', code: 'required', message: 'issued_on is required' }];
          throw e;
        },
      }),
    };
    const err = await faultOf(() =>
      runner.runScript(
        {
          language: 'js',
          source: "return await ctx.api.object('inv').update('1', {});",
          capabilities: ['api.write'],
        },
        ctx({ api }),
        actionOpts,
      ),
    );
    expect(err.code).toBe('VALIDATION_FAILED');
    expect(err.fields).toHaveLength(1);
    expect(err.innerMessage).toContain('issued_on is required');
  });
});
