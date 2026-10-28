// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#26965] An in-VM capability denial is a coded REFUSAL, for every origin.
 *
 * ## History
 *
 * [#4431] The `action-crash-vs-rejection` contract (#3951) pins the table:
 *
 *   | `SandboxError` WITH `innerMessage`  — a body's deliberate throw | 400 |
 *   | `SandboxError` with NO `innerMessage` — timeout, internal fault | 500 |
 *
 * A capability gate throws synchronously inside a QuickJS host function, which
 * rejects the async IIFE *inside* the VM, so it comes back through the
 * `__error` side-channel. The pump loop once presumed everything arriving there
 * was user code throwing on purpose and served the denial as a deliberate 400
 * carrying the `SandboxError: ` debug prefix. #4431 fixed that by marking the
 * denial as the sandbox's own fault: no `innerMessage`, so a bare
 * `500 INTERNAL_ERROR`.
 *
 * [#26903] then ruled that a HOOK body's denial is a refusal: the body's own
 * metadata did not grant what it called, and the caller is owed a coded answer
 * naming the hook and the capability. [#26965] ruled one gate, one answer: an
 * ACTION or JOB body's denial is the same refusal, `403
 * INSUFFICIENT_PRIVILEGES` (a standard catalog code), with the remedy naming
 * that body's own `body.capabilities`. The gate is exactly as strict as before.
 *
 * ## What this file pins
 *
 * The error the runner hands the classifier for each in-VM gate (`ctx.api.*`,
 * `ctx.log`, `ctx.crypto`, `ctx.api.transaction`) under an action origin: its
 * `innerMessage` is the refusal sentence, without the debug wrapper or the
 * `SandboxError: ` prefix, and it carries `code` and `status`. The wire half
 * through the real `/actions` door (and the job arm) is
 * `action-job-capability-denial-is-a-refusal.integration.test.ts`; the hook
 * arm is `hook-capability-denial-is-a-refusal.integration.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import { QuickJSScriptRunner, SandboxError } from './quickjs-runner.js';
import type { ScriptContext, ScriptRunOptions } from './script-runner.js';

const runner = new QuickJSScriptRunner({ hookTimeoutMs: 10_000, actionTimeoutMs: 10_000 });
const actionOpts: ScriptRunOptions = { origin: { kind: 'action', name: 'rc1_crash_probe' } };

function ctx(over: Partial<ScriptContext> = {}): ScriptContext {
  return { input: {}, ...over };
}

async function refusalOf(run: () => Promise<unknown>): Promise<SandboxError> {
  const e = await run().then(() => null, (err) => err as SandboxError);
  expect(e, 'expected the sandbox to refuse, but the script resolved').toBeInstanceOf(SandboxError);
  return e!;
}

/** The coded refusal every gate answers with, read off the error the runner hands the classifier. */
function expectCodedRefusal(err: SandboxError, capability: string): void {
  // The caller's sentence: which capability, whose, and the remedy on the
  // ACTION's own `body.capabilities` (never the hook's).
  expect(err.innerMessage).toContain(`capability '${capability}' not granted to action 'rc1_crash_probe'`);
  expect(err.innerMessage).toContain(`Grant it by adding '${capability}' to the action's body.capabilities.`);
  // Neither the debug wrapper nor the VM's name prefix reaches it.
  expect(err.innerMessage).not.toMatch(/threw:|SandboxError/);
  // The standard catalog's code at its status: what `mapDataError`'s sandbox
  // unwrap arm and the `/actions` door's declared-status branch serve.
  expect(err.code).toBe('INSUFFICIENT_PRIVILEGES');
  expect(err.status).toBe(403);
  expect(err.fields).toBeUndefined();
  expect(err.name).toBe('SandboxError');
}

describe('[#26965] an in-VM capability denial reaches the classifier as a coded REFUSAL', () => {
  const api = { object: (_n: string) => ({ count: (_f: unknown) => 1 }) };

  it("ctx.api.object(x).count without api.read — #4431's exact repro", async () => {
    const err = await refusalOf(() =>
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

    // [#26965 — FLIPPED] This used to pin `innerMessage` undefined and no
    // `code`: the #4431 fault, served as a bare `500 Internal server error`.
    expectCodedRefusal(err, 'api.read');
    // The call that tripped the gate is named too.
    expect(err.innerMessage).toContain("ctx.api.object('showcase_task').count");
  });

  it('ctx.log without the log capability', async () => {
    // Four members since #7661 — `debug` is a real level of this seam, not a
    // decoration, so a host double that omits it no longer type-checks.
    const log = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
    const err = await refusalOf(() =>
      runner.runScript(
        { language: 'js', source: "ctx.log.info('hi'); return 1;", capabilities: [] },
        ctx({ log }),
        actionOpts,
      ),
    );
    expectCodedRefusal(err, 'log');
  });

  it('ctx.crypto.randomUUID without the crypto.uuid capability', async () => {
    const err = await refusalOf(() =>
      runner.runScript(
        { language: 'js', source: 'return ctx.crypto.randomUUID();', capabilities: [] },
        ctx(),
        actionOpts,
      ),
    );
    expectCodedRefusal(err, 'crypto.uuid');
  });

  it('ctx.api.transaction without the api.transaction capability', async () => {
    const err = await refusalOf(() =>
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
    expectCodedRefusal(err, 'api.transaction');
  });

  it('a JOB body names the job\'s body.capabilities', async () => {
    const err = await refusalOf(() =>
      runner.runScript(
        { language: 'js', source: 'return ctx.crypto.randomUUID();', capabilities: [] },
        ctx(),
        { origin: { kind: 'job', name: 'nightly_rollup' } },
      ),
    );
    expect(err.innerMessage).toContain("capability 'crypto.uuid' not granted to job 'nightly_rollup'");
    expect(err.innerMessage).toContain("Grant it by adding 'crypto.uuid' to the job's body.capabilities.");
    expect(err.code).toBe('INSUFFICIENT_PRIVILEGES');
    expect(err.status).toBe(403);
  });

  it('a denial the body CATCHES and rethrows as its own error stays a rejection', async () => {
    // The other direction, and the reason the marker is a property on the VM
    // error rather than a match on the flattened `SandboxError: …` text: once
    // user code has caught the denial and thrown its own business error, the
    // outcome IS a deliberate rejection and must keep its 400.
    const err = await refusalOf(() =>
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
    const err = await refusalOf(() =>
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
    const err = await refusalOf(() =>
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
