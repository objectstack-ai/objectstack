// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#26903] A HOOK body's capability denial is a coded REFUSAL, not a fault.
 *
 * ## What was measured broken
 *
 * A `beforeInsert` hook whose sandboxed body calls `ctx.api.find(…)` without
 * `capabilities: ['api.read']` is refused by the gate ("capability 'api.read'
 * not granted"). The runner marked that denial as the sandbox's OWN fault
 * (#4431), so `mapDataError` answered the user's save with the sanitised
 * `500 INTERNAL_ERROR`: no code, no hook, no capability, nothing the caller or
 * the author could act on.
 *
 * ## The line this file pins
 *
 * - The gate is exactly as strict as before: the denied call never runs.
 * - `onError: 'abort'`: the save is refused with `403 INSUFFICIENT_PRIVILEGES`
 *   (the standard catalog's member, no new code), whose sentence names the
 *   hook and the capability, and nothing is written. One gate per token.
 * - `onError: 'log'`: the refusal is recorded where every hook error under
 *   `log` is recorded (the hook wrapper's `[hook] handler failed` line), naming
 *   the hook and the capability, and the save proceeds as `log` promises.
 * - Control: the same body WITH the capability runs as it always has.
 * - An ACTION body's denial keeps the #4431 fault contract
 *   (`capability-denial-is-a-fault.test.ts`); this card ruled on hooks only.
 *
 * Measured in composition — a real `ObjectQL`, a real driver, the real
 * `QuickJSScriptRunner` and hook wrapper — and read off `mapDataError`, the
 * ADR-0112 table every data door answers with.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mapDataError } from '@objectstack/types';
import { ObjectQL, bindHooksToEngine } from '@objectstack/objectql';
import { InMemoryDriver } from '@objectstack/driver-memory';
import { hookBodyRunnerFactory } from './body-runner.js';
import { QuickJSScriptRunner } from './quickjs-runner.js';

const NOTE = {
  name: 'cap_note',
  fields: {
    title: { type: 'text', name: 'title' },
    stamp: { type: 'text', name: 'stamp' },
  },
};

/** The object a nested write lands on, so the guard never re-fires on its own write. */
const LOG = { name: 'cap_log', fields: { title: { type: 'text', name: 'title' } } };

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

/** One gate per `HookBodyCapability` token: the call that trips it, as a hook body. */
const GATES = [
  { capability: 'api.read', source: "await ctx.api.object('cap_note').find({});" },
  { capability: 'api.write', source: "await ctx.api.object('cap_log').insert({ title: 'nested' });" },
  { capability: 'api.transaction', source: 'await ctx.api.transaction(async () => {});' },
  { capability: 'crypto.uuid', source: 'ctx.input.stamp = ctx.crypto.randomUUID();' },
  { capability: 'log', source: "ctx.log.info('stamping');" },
] as const;

describe('[#26903] a hook body\'s capability denial is a coded refusal', () => {
  let engine: ObjectQL | null = null;

  afterEach(async () => {
    try { await engine?.destroy(); } catch { /* noop */ }
    engine = null;
  });

  async function boot(hook: Record<string, unknown>) {
    const hookLog = recordingLogger();
    const bodyLog = recordingLogger();
    engine = new ObjectQL();
    engine.registerDriver(new InMemoryDriver() as any, true);
    await engine.init();
    for (const o of [NOTE, LOG]) engine.registry.registerObject(o as any);
    const bodyRunner = hookBodyRunnerFactory(new QuickJSScriptRunner(), { ql: engine, appId: 'cap', logger: bodyLog });
    bindHooksToEngine(engine, [hook as any], { packageId: 'cap', bodyRunner, logger: hookLog as any });
    return { e: engine, hookLog, bodyLog };
  }

  function guard(source: string, capabilities: string[], onError?: 'abort' | 'log') {
    return {
      name: 'cap_note_guard',
      object: 'cap_note',
      events: ['beforeInsert'],
      ...(onError ? { onError } : {}),
      body: { language: 'js', source, capabilities },
    };
  }

  async function rowCount(e: ObjectQL): Promise<number> {
    return (await e.find('cap_note', {})).length;
  }

  for (const gate of GATES) {
    it(`onError: abort — '${gate.capability}' denied answers 403 INSUFFICIENT_PRIVILEGES naming hook and capability, nothing written`, async () => {
      const { e, bodyLog } = await boot(guard(gate.source, []));

      const err = await e.insert('cap_note', { title: 'first' }).then(() => null, (x) => x);
      expect(err, 'the denied call must refuse the save').not.toBeNull();

      const { status, body } = mapDataError(err, 'cap_note');
      expect(status).toBe(403);
      expect(body.code).toBe('INSUFFICIENT_PRIVILEGES');
      expect(String(body.error)).toContain(`capability '${gate.capability}' not granted to hook 'cap_note_guard'`);
      expect(String(body.error)).toContain(`adding '${gate.capability}' to the hook's body.capabilities`);
      // The caller's sentence carries neither the sandbox debug wrapper nor its name prefix.
      expect(String(body.error)).not.toMatch(/threw:|SandboxError/);

      expect(await rowCount(e)).toBe(0);

      // Logged once on the refusal side of the BodyRunner's band: info, coded, no stack.
      const refused = bodyLog.lines.filter((l) => l.msg.includes('sandboxed hook refused'));
      expect(refused).toHaveLength(1);
      expect(refused[0].level).toBe('info');
      expect(refused[0].meta).toMatchObject({ hook: 'cap_note_guard', code: 'INSUFFICIENT_PRIVILEGES', status: 403 });
      expect(bodyLog.lines.filter((l) => l.level === 'error')).toEqual([]);
    }, 30_000);
  }

  for (const gate of GATES) {
    it(`onError: log — '${gate.capability}' denied is recorded in the hook-error log and the save proceeds`, async () => {
      const { e, hookLog } = await boot(guard(gate.source, [], 'log'));

      await expect(e.insert('cap_note', { title: 'first' })).resolves.toBeTruthy();
      expect(await rowCount(e)).toBe(1);

      const recorded = hookLog.lines.filter((l) => l.msg.includes('handler failed (onError=log'));
      expect(recorded).toHaveLength(1);
      expect(recorded[0].meta).toMatchObject({ hook: 'cap_note_guard', object: 'cap_note', event: 'beforeInsert' });
      expect(String(recorded[0].meta?.error)).toContain(`capability '${gate.capability}' not granted to hook 'cap_note_guard'`);
    }, 30_000);
  }

  for (const gate of GATES) {
    it(`control — the same body WITH '${gate.capability}' runs as before`, async () => {
      const caps = [gate.capability];
      const { e, hookLog, bodyLog } = await boot(guard(gate.source, caps));

      await expect(e.insert('cap_note', { title: 'first' })).resolves.toBeTruthy();
      expect(await rowCount(e)).toBe(1);
      expect([...hookLog.lines, ...bodyLog.lines].filter((l) => /refused|failed|threw/.test(l.msg))).toEqual([]);
    }, 30_000);
  }
});
