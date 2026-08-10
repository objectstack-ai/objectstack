// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #3475 — end-to-end proof that a record-change flow can opt in to expanding a
// single-hop lookup (`{record.account.name}`) SAFELY. The engine re-reads the
// declared relation AFTER identity resolution, as the RUN's own principal
// (resolveRunDataContext honors runAs), and grafts it onto the run record so
// every node's `{record.<lookup>.<field>}` template resolves — without bypassing
// the triggering user's RLS/FLS on the referenced object.
//
// Boots AutomationServicePlugin on a LiteKernel with a fake objectql that
// records the `context` + `expand` each findOne receives and returns a
// pre-expanded lead row (standing in for ObjectQL's own expand). A downstream
// update_record interpolates `{record.account.name}`, so the fake's captured
// update fields prove the record was enriched and the template resolved.

import { describe, it, expect } from 'vitest';
import { LiteKernel } from '@objectstack/core';
import { AutomationServicePlugin } from './plugin.js';
import { AutomationEngine } from './engine.js';

interface CrudCall { op: string; obj: string; ctx: any; expand?: any; fields?: any }

/**
 * A fake ObjectQL engine. `findOne('lead', …)` returns the lead row with
 * `account` already expanded to an object (as real ObjectQL would when passed
 * `expand`), and records the `context`/`expand` it was called with. `update`
 * records the interpolated `fields`. Registered under both `objectql` and `data`.
 * `throwOnFindOne` simulates a read failure for the fail-safe test.
 */
function fakeObjectQl(opts: { throwOnFindOne?: boolean } = {}) {
  const crud: CrudCall[] = [];
  const LEAD = { id: 'lead1', company: 'Acme', account: { id: 'acc1', name: 'Acme Corp' }, owner: 'u9' };
  const engine: any = {
    async find(object: string, o: any) { crud.push({ op: 'find', obj: object, ctx: o?.context }); return []; },
    async findOne(object: string, o: any) {
      crud.push({ op: 'findOne', obj: object, ctx: o?.context, expand: o?.expand });
      if (opts.throwOnFindOne) throw new Error('boom');
      return object === 'lead' ? { ...LEAD } : undefined;
    },
    async insert(object: string, _f: any, o: any) { crud.push({ op: 'insert', obj: object, ctx: o?.context }); return { id: `${object}_1` }; },
    async update(object: string, fields: any, o: any) { crud.push({ op: 'update', obj: object, ctx: o?.context, fields }); return { ok: true }; },
    async delete(object: string, o: any) { crud.push({ op: 'delete', obj: object, ctx: o?.context }); return { ok: true }; },
  };
  return { engine, crud };
}

/** record-change flow: start(expand) → update_record('audit', { … }) → end. */
function expandFlow(name: string, runAs: 'system' | 'user', expand: string[], fields: Record<string, unknown>) {
  return {
    name, label: name, type: 'record_change', runAs,
    variables: [{ name: 'noteId', type: 'text', isInput: true }],
    nodes: [
      { id: 'start', type: 'start', label: 'Start', config: { objectName: 'lead', triggerType: 'record-after-create', expand } },
      { id: 'up', type: 'update_record', label: 'Up', config: { objectName: 'audit', filter: { id: '{noteId}' }, fields } },
      { id: 'end', type: 'end', label: 'End' },
    ],
    edges: [{ id: 'e1', source: 'start', target: 'up' }, { id: 'e2', source: 'up', target: 'end' }],
  };
}

async function boot(ql: any): Promise<LiteKernel> {
  const kernel = new LiteKernel({ logger: { level: 'silent' } } as never);
  kernel.use(new AutomationServicePlugin({ suspendedRunStore: 'memory' }));
  kernel.use({
    name: 'test.harness', type: 'standard' as const, version: '1.0.0', dependencies: [] as string[],
    async init(ctx: any) { ctx.registerService('objectql', ql); ctx.registerService('data', ql); },
    async start() {},
  } as never);
  await kernel.bootstrap();
  return kernel;
}

/** The seeded trigger record: lookups are scalar FK ids, as the hook row carries them. */
const SEED = { id: 'lead1', company: 'Acme', account: 'acc1', owner: 'u9' };

describe('record-change lookup expansion (#3475)', () => {
  it("expands a declared lookup as the triggering user and resolves {record.account.name}", async () => {
    const { engine: ql, crud } = fakeObjectQl();
    const kernel = await boot(ql);
    const automation = kernel.getService<AutomationEngine>('automation');
    automation.registerFlow('u', expandFlow('u', 'user', ['account'], { note: '{record.account.name}' }) as never);

    const res = await automation.execute('u', {
      object: 'lead', record: { ...SEED }, userId: 'u1', params: { noteId: 'n1' },
    });
    expect(res.success, `run failed: ${JSON.stringify(res)}`).toBe(true);

    // The expander re-read the lead with an expand map, as the USER (not system).
    const read = crud.find((c) => c.op === 'findOne' && c.obj === 'lead');
    expect(read, 'expander never re-read the record').toBeTruthy();
    expect(read!.expand).toHaveProperty('account');
    expect(read!.ctx?.isSystem).toBe(false);
    expect(read!.ctx?.userId).toBe('u1');

    // The record was enriched, so the downstream template resolved.
    const upd = crud.find((c) => c.op === 'update' && c.obj === 'audit');
    expect(upd!.fields.note).toBe('Acme Corp');

    await kernel.shutdown();
  });

  it("runAs:'system' expands with an elevated context", async () => {
    const { engine: ql, crud } = fakeObjectQl();
    const kernel = await boot(ql);
    const automation = kernel.getService<AutomationEngine>('automation');
    automation.registerFlow('s', expandFlow('s', 'system', ['account'], { note: '{record.account.name}' }) as never);

    await automation.execute('s', { object: 'lead', record: { ...SEED }, userId: 'u1', params: { noteId: 'n1' } });

    const read = crud.find((c) => c.op === 'findOne' && c.obj === 'lead');
    expect(read!.ctx?.isSystem).toBe(true);
    // #5494 — the acting user rides the elevated context as attribution; what
    // makes this read ELEVATED is `isSystem` (the middleware short-circuits
    // before any gate reads `userId`), not the absence of a user.
    expect(read!.ctx?.userId).toBe('u1');

    await kernel.shutdown();
  });

  it('grafts ONLY the declared relation — a non-declared lookup stays a scalar id', async () => {
    const { engine: ql, crud } = fakeObjectQl();
    const kernel = await boot(ql);
    const automation = kernel.getService<AutomationEngine>('automation');
    // Declare only `account`; `owner` is left un-expanded.
    automation.registerFlow('sel', expandFlow('sel', 'user', ['account'], {
      acc: '{record.account.name}', own: '{record.owner}',
    }) as never);

    await automation.execute('sel', { object: 'lead', record: { ...SEED }, userId: 'u1', params: { noteId: 'n1' } });

    const upd = crud.find((c) => c.op === 'update' && c.obj === 'audit');
    expect(upd!.fields.acc).toBe('Acme Corp'); // declared → expanded object → resolved
    expect(upd!.fields.own).toBe('u9');         // not declared → scalar id preserved (#1872)

    await kernel.shutdown();
  });

  it('is fail-safe: a re-read error leaves the record unexpanded and the flow still runs', async () => {
    const { engine: ql, crud } = fakeObjectQl({ throwOnFindOne: true });
    const kernel = await boot(ql);
    const automation = kernel.getService<AutomationEngine>('automation');
    automation.registerFlow('fs', expandFlow('fs', 'user', ['account'], { note: '{record.account.name}' }) as never);

    const res = await automation.execute('fs', { object: 'lead', record: { ...SEED }, userId: 'u1', params: { noteId: 'n1' } });
    expect(res.success, `run failed: ${JSON.stringify(res)}`).toBe(true);

    // account stayed the scalar id 'acc1', so the single-token `{record.account.name}`
    // could not resolve (undefined — the interpolator's unresolved single-token value)
    // — but the run completed rather than throwing.
    const upd = crud.find((c) => c.op === 'update' && c.obj === 'audit');
    expect(upd).toBeTruthy();
    expect(upd!.fields.note).toBeUndefined();

    await kernel.shutdown();
  });
});
