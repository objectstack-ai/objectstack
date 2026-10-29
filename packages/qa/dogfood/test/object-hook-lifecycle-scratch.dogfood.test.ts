// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Checklist item `records-forms.object-hook-lifecycle` (#26573): the clauses
// the item drives on SCRATCH hooks, at the REST data door of a booted stack,
// with the server log read off the process's stdout/stderr. One object per
// clause so no hook fires on another clause's write.
//
//   acceptance[6], negative[0] — a throwing beforeInsert under onError:'abort'
//     refuses the POST and a filtered count stays 0: no orphan row.
//   acceptance[7], negative[1] — a throwing async afterUpdate under
//     onError:'log' does NOT roll the PATCH back: the re-read shows the change
//     and the log carries '[hook] handler failed (onError=log; suppressing)'
//     with the hook's name.
//   acceptance[8], negative[4] — a condition that compiles but cannot be
//     evaluated (int(record.name) on a non-numeric name) FAILS CLOSED, even
//     under onError:'log' and async: the write is refused 400 VALIDATION_ERROR
//     whose text names the hook and the fault and never the condition source,
//     the row does not land, and no '[REST] Unhandled error' line is logged.
//   acceptance[9] — two hooks on the same object+event run lowest priority
//     first: one write logs the priority-10 line before the priority-90 line.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { defineStack } from '@objectstack/spec';
import { ObjectSchema, Field } from '@objectstack/spec/data';

const ABORT = 'ohl_abort';
const ASYNC = 'ohl_async';
const COND = 'ohl_cond';
const ORDER = 'ohl_order';
const ABORT_MSG = 'ohl abort guard refused this insert';

const scratch = (name: string, label: string) => ObjectSchema.create({
  name, label, pluralLabel: `${label}s`, sharingModel: 'public_read_write',
  fields: { name: Field.text({ label: 'Name', required: true }), note: Field.text({ label: 'Note' }) },
});

const ohlStack = defineStack({
  manifest: {
    id: 'com.dogfood.object-hook-lifecycle', namespace: 'ohl', version: '0.0.0', type: 'app',
    name: 'Object hook lifecycle fixture', description: 'Scratch hooks for the abort, log, fail-closed and priority variants.',
  },
  objects: [scratch(ABORT, 'Abort Item'), scratch(ASYNC, 'Async Item'), scratch(COND, 'Cond Item'), scratch(ORDER, 'Order Item')],
  hooks: [
    {
      name: 'ohl_abort_guard', object: ABORT, events: ['beforeInsert'], onError: 'abort',
      body: { language: 'js', source: `throw new Error(${JSON.stringify(ABORT_MSG)});`, capabilities: [] },
    },
    {
      name: 'ohl_async_thrower', object: ASYNC, events: ['afterUpdate'], async: true, onError: 'log',
      body: { language: 'js', source: "throw new Error('ohl async thrower failed');", capabilities: [] },
    },
    {
      name: 'ohl_unevaluable_guard', object: COND, events: ['beforeInsert'], async: false, onError: 'log',
      condition: 'int(record.name) > 0',
      body: { language: 'js', source: "ctx.input.note = 'guard ran';", capabilities: [] },
    },
    {
      name: 'ohl_order_late', object: ORDER, events: ['afterInsert'], priority: 90, onError: 'log',
      body: { language: 'js', source: "ctx.log.info('ohl-order priority-90 ran');", capabilities: ['log'] },
    },
    {
      name: 'ohl_order_early', object: ORDER, events: ['afterInsert'], priority: 10, onError: 'log',
      body: { language: 'js', source: "ctx.log.info('ohl-order priority-10 ran');", capabilities: ['log'] },
    },
  ],
} as never);

function captureLog() {
  const lines: string[] = [];
  const sink = (chunk: unknown): boolean => {
    lines.push(String(chunk));
    return true;
  };
  const outSpy = vi.spyOn(process.stdout, 'write').mockImplementation(sink as never);
  const errSpy = vi.spyOn(process.stderr, 'write').mockImplementation(sink as never);
  return {
    lines,
    matching: (needle: string) => lines.filter((l) => l.includes(needle)),
    restore: () => {
      outSpy.mockRestore();
      errSpy.mockRestore();
    },
  };
}

async function settle(log: ReturnType<typeof captureLog>, needle: string, ms = 5_000): Promise<string[]> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const hit = log.matching(needle);
    if (hit.length > 0) return hit;
    await new Promise((r) => setTimeout(r, 50));
  }
  return log.matching(needle);
}

type Answer = { status: number; json: any; text: string };

describe('records-forms.object-hook-lifecycle — the scratch hook variants over REST', () => {
  let stack: VerifyStack;
  let token = '';

  const call = async (method: string, path: string, body?: unknown): Promise<Answer> => {
    const res = await stack.apiAs(token, method, path, body);
    const text = await res.text();
    let json: any = {};
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, json, text };
  };

  beforeAll(async () => {
    stack = await bootStack(ohlStack);
    token = await stack.signIn();
  }, 180_000);

  afterAll(async () => {
    await stack?.stop();
  });

  it('acceptance[6], negative[0]: a throwing beforeInsert under abort refuses the POST and lands no row', async () => {
    expect(await stack.rows(ABORT, { name: 'ohl-abort' })).toHaveLength(0);
    const log = captureLog();
    let res: Answer;
    try {
      res = await call('POST', `/data/${ABORT}`, { name: 'ohl-abort' });
    } finally {
      log.restore();
    }
    expect(res.status, res.text).toBe(400);
    expect(res.text).toContain(ABORT_MSG);
    // [#27508] The abort is a refusal the route answered: the wire answer is
    // the hook's own sentence, code-less, exactly as before, and the server
    // does not log it as an unhandled error.
    expect(res.json).toEqual({ error: ABORT_MSG, object: ABORT });
    expect(log.matching('[REST] Unhandled error')).toHaveLength(0);
    expect(await stack.rows(ABORT, { name: 'ohl-abort' })).toHaveLength(0);
  });

  it('acceptance[7], negative[1]: a throwing async afterUpdate under log keeps the PATCH and only logs the failure', async () => {
    const created = await call('POST', `/data/${ASYNC}`, { name: 'ohl-async' });
    expect(created.status, created.text).toBe(201);
    const [row] = await stack.rows(ASYNC, { name: 'ohl-async' });
    const log = captureLog();
    try {
      const patched = await call('PATCH', `/data/${ASYNC}/${row.id}`, { note: 'kept' });
      expect(patched.status, patched.text).toBe(200);
      const failed = await settle(log, '[hook] handler failed (onError=log; suppressing)');
      expect(failed.join(''), log.lines.slice(-20).join('')).toContain('ohl_async_thrower');
      expect(log.matching('[hook] async handler error (fire-and-forget)')).toHaveLength(0);
    } finally {
      log.restore();
    }
    expect((await stack.rows(ASYNC, { id: row.id }))[0].note).toBe('kept');
  });

  it('acceptance[8], negative[4]: an unevaluable condition fails closed — 400 VALIDATION_ERROR naming the hook, no row, no unhandled-error line', async () => {
    const log = captureLog();
    let res: Answer;
    try {
      res = await call('POST', `/data/${COND}`, { name: 'not-a-number' });
    } finally {
      log.restore();
    }
    expect(res.status, res.text).toBe(400);
    expect(res.json.code).toBe('VALIDATION_ERROR');
    expect(String(res.json.error)).toContain("Hook 'ohl_unevaluable_guard' could not evaluate its condition");
    expect(String(res.json.error)).toContain('operation aborted');
    expect(res.text, 'the condition source never reaches the caller').not.toContain('int(record.name)');
    expect(await stack.rows(COND, { name: 'not-a-number' })).toHaveLength(0);
    expect(log.matching('[REST] Unhandled error')).toHaveLength(0);

    // Control: an evaluable name passes the gate and the guard body runs.
    const ok = await call('POST', `/data/${COND}`, { name: '42' });
    expect(ok.status, ok.text).toBe(201);
    expect((await stack.rows(COND, { name: '42' }))[0].note).toBe('guard ran');
  });

  it('acceptance[9]: two hooks on one object+event run lowest priority first', async () => {
    const log = captureLog();
    try {
      const res = await call('POST', `/data/${ORDER}`, { name: 'ohl-order' });
      expect(res.status, res.text).toBe(201);
      await settle(log, 'ohl-order priority-90 ran');
    } finally {
      log.restore();
    }
    const order = log.lines.filter((l) => l.includes('ohl-order priority-')).map((l) => (l.includes('priority-10') ? 10 : 90));
    expect(order).toEqual([10, 90]);
  });
});
