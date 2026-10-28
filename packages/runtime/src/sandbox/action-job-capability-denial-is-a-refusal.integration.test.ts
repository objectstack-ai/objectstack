// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#26965] An ACTION or JOB body's capability denial is the same coded refusal
 * a hook body's is: one gate, one answer.
 *
 * ## What was measured broken
 *
 * After #26903, a hook body calling `ctx.api.object('n').find(…)` without
 * `api.read` was refused `403 INSUFFICIENT_PRIVILEGES`, naming the hook, the
 * capability and the remedy. The same call from an action body still crossed
 * the VM as the sandbox's own fault (#4431), so `POST /actions/OBJECT/ACTION`
 * answered `500 INTERNAL_ERROR` `Internal server error`: neither the caller nor
 * the author learned which action or which capability.
 *
 * ## The line this file pins
 *
 * - The gate is exactly as strict as before: the denied call never runs and
 *   nothing is written.
 * - Action: the real `/actions` door answers `403 INSUFFICIENT_PRIVILEGES`,
 *   whose sentence names the action, the capability and the remedy on the
 *   action's own `body.capabilities`. One gate per token. The BodyRunner logs
 *   it once on the refusal side of its band (`info`, coded, no stack).
 * - Job: a job reaches no HTTP caller. Its handler rejects with the same coded
 *   refusal, the remedy naming the job's `body.capabilities`; that `message` is
 *   what a job run record stores as its `error` (`DbJobAdapter.finishRun`), and
 *   the BodyRunner keeps its `error` line for the operator.
 * - Control: the same body WITH the capability runs.
 *
 * Measured in composition: a real `ObjectQL` on a real SQLite driver, the real
 * `QuickJSScriptRunner` and body-runner factories, and the real `/actions`
 * door (`HttpDispatcher.handleActions`), whose engine double only hands the
 * door's action context to the bound handler, as `ObjectQL.executeAction` does.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mapDataError } from '@objectstack/types';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { actionBodyRunnerFactory, jobBodyRunnerFactory } from './body-runner.js';
import { QuickJSScriptRunner } from './quickjs-runner.js';
import { HttpDispatcher } from '../http-dispatcher.js';

const NOTE = {
  name: 'capa_note',
  fields: { title: { type: 'text', name: 'title' } },
};

interface Line { level: 'debug' | 'info' | 'warn' | 'error'; msg: string; err?: unknown; meta?: any }

/** A `Logger`-contract double (`error` is `(message, error, meta)`) that records every call. */
function recordingLogger() {
  const lines: Line[] = [];
  return {
    lines,
    debug: (msg: string, meta?: any) => { lines.push({ level: 'debug', msg, meta }); },
    info: (msg: string, meta?: any) => { lines.push({ level: 'info', msg, meta }); },
    warn: (msg: string, meta?: any) => { lines.push({ level: 'warn', msg, meta }); },
    error: (msg: string, err?: unknown, meta?: any) => { lines.push({ level: 'error', msg, err, meta }); },
  };
}

/** One gate per `HookBodyCapability` token: the call that trips it, as a body. */
const GATES = [
  { capability: 'api.read', source: "await ctx.api.object('capa_note').find({}); return 1;" },
  { capability: 'api.write', source: "await ctx.api.object('capa_note').insert({ title: 'nested' }); return 1;" },
  { capability: 'api.transaction', source: 'await ctx.api.transaction(async () => {}); return 1;' },
  { capability: 'crypto.uuid', source: 'return ctx.crypto.randomUUID();' },
  { capability: 'log', source: "ctx.log.info('stamping'); return 1;" },
] as const;

describe('[#26965] an action or job body\'s capability denial is a coded refusal', () => {
  let engine: ObjectQL | null = null;
  let dir: string | null = null;

  afterEach(async () => {
    try { await engine?.destroy(); } catch { /* noop */ }
    engine = null;
    if (dir) { rmSync(dir, { recursive: true, force: true }); dir = null; }
  });

  async function boot(): Promise<ObjectQL> {
    dir = mkdtempSync(join(tmpdir(), 'os-body-cap-26965-'));
    const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: join(dir, 'data.sqlite') }, useNullAsDefault: true });
    await driver.initObjects([NOTE]);
    engine = new ObjectQL();
    engine.registerDriver(driver as any, true);
    await engine.init();
    engine.registry.registerObject(NOTE as any);
    return engine;
  }

  /** The real `/actions` door, dispatching to the action body bound on the real engine. */
  async function throughActionsDoor(e: ObjectQL, source: string, capabilities: string[]) {
    const bodyLog = recordingLogger();
    const action = { name: 'capa_probe', objectName: 'capa_note', type: 'script', body: { language: 'js', source, capabilities } };
    const handler = actionBodyRunnerFactory(new QuickJSScriptRunner(), { ql: e, appId: 'capa', logger: bodyLog })(action as any);
    expect(handler, 'the action body must bind').toBeTypeOf('function');
    const objectDef = { name: 'capa_note', actions: [action] };
    const ql: any = {
      executeAction: vi.fn(async (_o: string, _a: string, ctx: any) => handler!(ctx)),
      getSchema: (n: string) => (n === objectDef.name ? objectDef : undefined),
      registry: { getObject: (n: string) => (n === objectDef.name ? objectDef : undefined), getItem: () => undefined },
      find: vi.fn(async () => []),
      insert: vi.fn(), update: vi.fn(), delete: vi.fn(),
    };
    const metadata: any = {
      load: vi.fn(async () => null),
      listObjects: vi.fn(async () => [objectDef]),
      getObject: vi.fn(async () => objectDef),
    };
    const kernel: any = {
      context: { getService: (n: string) => (n === 'objectql' || n === 'data' ? ql : n === 'metadata' ? metadata : null) },
    };
    const res: any = await new HttpDispatcher(kernel).handleActions(
      '/capa_note/capa_probe',
      'POST',
      {},
      { request: {}, environmentId: 'platform', executionContext: { userId: 'u1', systemPermissions: [] } } as any,
    );
    expect(ql.executeAction, 'the door must reach the bound body').toHaveBeenCalledTimes(1);
    return { response: res.response, bodyLog };
  }

  function bindJob(e: ObjectQL, source: string, capabilities: string[]) {
    const bodyLog = recordingLogger();
    const handler = jobBodyRunnerFactory(new QuickJSScriptRunner(), { ql: e, appId: 'capa', logger: bodyLog })({
      name: 'capa_nightly',
      body: { language: 'js', source, capabilities },
    });
    expect(handler, 'the job body must bind').toBeTypeOf('function');
    return { handler: handler!, bodyLog };
  }

  for (const gate of GATES) {
    it(`action — '${gate.capability}' denied: POST /actions answers 403 INSUFFICIENT_PRIVILEGES naming action and capability`, async () => {
      const e = await boot();
      const { response, bodyLog } = await throughActionsDoor(e, gate.source, []);

      expect(response.status, JSON.stringify(response.body)).toBe(403);
      expect(response.body.error.code).toBe('INSUFFICIENT_PRIVILEGES');
      const sentence = String(response.body.error.message);
      expect(sentence).toContain(`capability '${gate.capability}' not granted to action 'capa_probe'`);
      expect(sentence).toContain(`Grant it by adding '${gate.capability}' to the action's body.capabilities.`);
      expect(sentence).not.toMatch(/threw:|SandboxError|Internal server error|hook's/);

      expect((await e.find('capa_note', {})).length).toBe(0);

      const refused = bodyLog.lines.filter((l) => l.msg.includes('sandboxed action refused'));
      expect(refused).toHaveLength(1);
      expect(refused[0].level).toBe('info');
      expect(refused[0].meta).toMatchObject({ action: 'capa_probe', code: 'INSUFFICIENT_PRIVILEGES', status: 403 });
      expect(bodyLog.lines.filter((l) => l.level === 'error')).toEqual([]);
    }, 30_000);
  }

  for (const gate of GATES) {
    it(`action control — the same body WITH '${gate.capability}' answers 200`, async () => {
      const e = await boot();
      const { response, bodyLog } = await throughActionsDoor(e, gate.source, [gate.capability]);
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      expect(bodyLog.lines.filter((l) => /refused|threw/.test(l.msg))).toEqual([]);
    }, 30_000);
  }

  for (const gate of GATES) {
    it(`job — '${gate.capability}' denied: the run rejects with the coded refusal naming job and capability`, async () => {
      const e = await boot();
      const { handler, bodyLog } = bindJob(e, gate.source, []);

      const err: any = await handler().then(() => null, (x) => x);
      expect(err, 'the denied call must fail the run').not.toBeNull();
      expect(err.code).toBe('INSUFFICIENT_PRIVILEGES');
      expect(err.status).toBe(403);
      // What `DbJobAdapter` stores as the run's `error` is this `message`.
      expect(String(err.message)).toContain(`capability '${gate.capability}' not granted to job 'capa_nightly'`);
      expect(String(err.message)).toContain(`Grant it by adding '${gate.capability}' to the job's body.capabilities.`);
      // Any door that ever answers it reads the same refusal.
      const { status, body } = mapDataError(err);
      expect(status).toBe(403);
      expect(body.code).toBe('INSUFFICIENT_PRIVILEGES');

      expect((await e.find('capa_note', {})).length).toBe(0);
      // The operator keeps the job's error line.
      expect(bodyLog.lines.filter((l) => l.level === 'error' && l.msg.includes('sandboxed job threw'))).toHaveLength(1);
    }, 30_000);
  }

  it('job control — the same body WITH the capability runs', async () => {
    const e = await boot();
    const { handler, bodyLog } = bindJob(e, GATES[0].source, ['api.read']);
    await expect(handler()).resolves.toBeUndefined();
    expect(bodyLog.lines.filter((l) => l.level === 'error')).toEqual([]);
  }, 30_000);
});
