// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#7867] A by-id `update()` / `delete()` whose id names NO ROW is refused with
 * `RECORD_NOT_FOUND`, before anything else on the write path runs.
 *
 * ## The defect, and why it is not the one it looked like
 *
 * Nothing on the action-body write path ever asked whether the target row
 * existed. `ctx.api.object(name).update({ id, … })` → `buildSandboxApi` →
 * `ObjectRepository.update` → `ObjectQL.update()`'s by-id branch, and no
 * existence gate anywhere in it: `engine.update()` on a ghost id was a SILENT
 * NO-OP that resolved `null`, and the write ran on into validation, the driver
 * and the hook chain and died on whichever complained first.
 *
 * Which one that was varied with the object's DECLARATIONS, which is what made
 * the defect read as several unrelated bugs:
 *
 *   - a hooked object → `400` `HookConditionError`, from an `afterUpdate`
 *     condition reading `previous` on a row nobody read;
 *   - an UNHOOKED object → `400` `VALIDATION_FAILED` "X is required", because
 *     with no prior row a PATCH is validated as if it were a whole record.
 *
 * ⇒ **The 400 class varied; the missing 404 was the constant.** That is why
 * this file's cases come in hooked/unhooked pairs: a suite that only covered
 * the hooked path would be pinning the symptom instead of the defect.
 *
 * ⛔ It is NOT a `previous`-binding bug. `if (priorRecord) hookContext.previous
 * = …` does exactly what ADR-0058 Addendum II / #4649 require — an absent row
 * leaves `previous` UNBOUND rather than fabricated as `{}`/`null` — and that
 * rule is untouched here. It was behaving correctly on a path that should never
 * have been entered, which is the attribution #5571 carried for six triage
 * rounds before its reproduction measured it wrong. The remedy is #5574's, one
 * path over: remove the PRODUCER, do not specialize what it produced. Hence the
 * "no handler ran" assertions below — they are the load-bearing half.
 *
 * ## Why the gate is at the engine and not at the repository
 *
 * The action body reaches the engine three ways, only ONE of which passes
 * through `ObjectRepository`:
 *
 *   1. `ctx.api.object(n).update(…)`  → `ScopedContext` → `ObjectRepository`
 *   2. `ctx.api.object(n)` when the host engine has no `createContext`
 *      → `buildEngineRepoFacade` → `ql.update(…)` DIRECTLY
 *   3. `ctx.engine.update(o, id, data)` → `buildActionEngineFacade`
 *      → `ql.update(…)` DIRECTLY
 *
 * A repository-level gate closes (1) and leaves (2) and (3) with the original
 * defect, and makes `ql.update(o, { id })` and `ctx.api.object(o).update({ id })`
 * answer one ghost id two different ways — the second de-facto contract PD #12
 * exists to keep out. The engine is where all three funnel through.
 *
 * ## Two sibling paths already had this gate; this is the third, not a fourth
 *
 *   - `protocol.updateData`/`deleteData` probe existence and throw
 *     `recordNotFoundError` (#4435)
 *   - `callData`'s ObjectQL fallback does the same (#5138)
 *
 * All three now call the SAME `recordNotFoundError` — moved to
 * `@objectstack/core` by this card so `engine.ts` can reach it without
 * importing `@objectstack/metadata-protocol`, which ADR-0076 D2's boundary
 * ratchet forbids in the `/core` closure.
 *
 * ## Scope line: BY-ID only
 *
 * A `multi: true` predicate write matching zero rows is legitimately "0 rows
 * affected", not a missing record — the same line both siblings draw. Pinned
 * below so the gate cannot creep onto the bulk path.
 */

import { describe, it, expect } from 'vitest';
import { ObjectQL } from './engine.js';
import { bindHooksToEngine } from './hook-binder.js';
import type { Hook } from '@objectstack/spec/data';

const silentLogger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

/**
 * A HOOKED object carrying the exact declaration the reproduction tripped over:
 * an `afterUpdate` condition that reads `previous`.
 */
const hookedTask = {
  name: 'nf_task',
  label: 'Task',
  fields: {
    id: { name: 'id', label: 'ID', type: 'text' as const, primaryKey: true },
    title: { name: 'title', label: 'Title', type: 'text' as const },
    done: { name: 'done', label: 'Done', type: 'boolean' as const },
  },
};

/**
 * An UNHOOKED object with a REQUIRED field — the #7867 P3 probe's shape. On
 * this one the pre-fix answer was a required-field `ValidationError`, with no
 * hook and no `previous` anywhere near it.
 */
const unhookedInvoice = {
  name: 'nf_invoice',
  label: 'Invoice',
  fields: {
    id: { name: 'id', label: 'ID', type: 'text' as const, primaryKey: true },
    status: { name: 'status', label: 'Status', type: 'text' as const },
    issued_on: { name: 'issued_on', label: 'Issued On', type: 'text' as const, required: true },
  },
};

/** A minimal store-backed driver — the same shape `hook-condition-fail-loud` uses. */
function makeStubDriver() {
  const stores = new Map<string, Map<string, Record<string, unknown>>>();
  const storeFor = (o: string) => {
    let s = stores.get(o);
    if (!s) { s = new Map(); stores.set(o, s); }
    return s;
  };
  let nextId = 0;
  const matches = (row: Record<string, unknown>, where: any): boolean => {
    if (!where || typeof where !== 'object') return true;
    for (const [k, v] of Object.entries(where)) {
      if (k.startsWith('$')) continue;
      const expected = v && typeof v === 'object' && '$eq' in (v as any) ? (v as any).$eq : v;
      if ((row[k] ?? null) !== (expected ?? null)) return false;
    }
    return true;
  };
  const calls = { update: 0, delete: 0, updateMany: 0, deleteMany: 0 };
  const d: any = {
    name: 'memory', version: '0.0.0', supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; },
    async execute() { return null; }, async syncSchema() {},
    async find(o: string, ast: any) {
      return Array.from(storeFor(o).values()).filter((r) => matches(r, ast?.where));
    },
    async findOne(o: string, ast: any) {
      for (const r of storeFor(o).values()) if (matches(r, ast?.where)) return r;
      return null;
    },
    async create(o: string, data: Record<string, unknown>) {
      nextId += 1;
      const id = (data.id as string) ?? `r_${nextId}`;
      const row = { ...data, id };
      storeFor(o).set(id, row);
      return row;
    },
    async update(o: string, id: string, data: Record<string, unknown>) {
      calls.update += 1;
      const s = storeFor(o); const cur = s.get(id); if (!cur) return null;
      const u = { ...cur, ...data, id }; s.set(id, u); return u;
    },
    async upsert(o: string, data: any) {
      const id = data.id;
      return id && storeFor(o).has(id) ? this.update(o, id, data) : this.create(o, data);
    },
    async delete(o: string, id: string) { calls.delete += 1; return storeFor(o).delete(id); },
    async count(o: string, ast: any) { return (await this.find(o, ast)).length; },
    async bulkCreate(o: string, rows: any[]) { return Promise.all(rows.map((r) => this.create(o, r))); },
    async bulkUpdate() { return []; }, async bulkDelete() {},
    async updateMany(o: string, ast: any, data: Record<string, unknown>) {
      calls.updateMany += 1;
      const rows = await this.find(o, ast);
      for (const r of rows) storeFor(o).set(r.id as string, { ...r, ...data, id: r.id });
      return rows.length;
    },
    async deleteMany(o: string, ast: any) {
      calls.deleteMany += 1;
      const rows = await this.find(o, ast);
      for (const r of rows) storeFor(o).delete(r.id as string);
      return rows.length;
    },
    async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
  };
  return { driver: d, calls };
}

async function bootEngine(hooks: Hook[], objects: unknown[] = [hookedTask, unhookedInvoice]) {
  const engine = new ObjectQL();
  const stub = makeStubDriver();
  engine.registerDriver(stub.driver, true);
  await engine.init();
  for (const o of objects) engine.registry.registerObject(o as any);
  if (hooks.length > 0) {
    bindHooksToEngine(engine, hooks, { packageId: 'app:nf', logger: silentLogger });
  }
  return { engine, calls: stub.calls };
}

/**
 * The reproduction's own hook: an `afterUpdate` whose declarative `condition`
 * reads `previous`. Pre-fix, a ghost-id update reached this and produced the
 * `HookConditionError` 400 that #5571 spent six rounds attributing to the
 * binding site.
 */
const auditHook: Hook = {
  name: 'nf_audit_task_completion',
  object: 'nf_task',
  events: ['afterUpdate'],
  priority: 100,
  condition: 'previous.done != true && record.done == true',
  handler: () => {},
} as unknown as Hook;

/* ────────────────────────────────────────────────────────────────────────────
 * 1. update() — the 404, on BOTH declaration shapes
 * ──────────────────────────────────────────────────────────────────────────── */

describe('[#7867] a by-id update against a nonexistent id answers RECORD_NOT_FOUND', () => {
  it('HOOKED object: 404 with code + status — not the HookConditionError 400 it used to be', async () => {
    const { engine, calls } = await bootEngine([auditHook]);

    const err: any = await engine
      .update('nf_task', { id: 'ghost', done: true })
      .then(() => null, (e) => e);

    expect(err, 'the write must be refused, not silently resolved').not.toBeNull();
    // Asserted on `code` + `status`, never on "it threw": the pre-fix behaviour
    // ALSO threw here — with a 400 — so "it threw" cannot tell the two apart.
    expect(err.code).toBe('RECORD_NOT_FOUND');
    expect(err.status).toBe(404);
    expect(err.message).toContain('ghost');
    expect(err.message).toContain('nf_task');
    // …and specifically NOT the shape the defect produced.
    expect(err.name).not.toBe('HookConditionError');
    expect(String(err.message)).not.toContain('not bound for this operation');
    expect(calls.update, 'nothing may reach the driver').toBe(0);
  });

  it('UNHOOKED object with a required field: the same 404, not VALIDATION_FAILED', async () => {
    // The measurement that widened the card: no hooks, no `previous`, same
    // defect. Pre-fix this answered 400 "Issued On is required", because with
    // no prior row a PATCH is validated as if it were a whole record.
    const { engine, calls } = await bootEngine([]);

    const err: any = await engine
      .update('nf_invoice', { id: 'ghost', status: 'sent' })
      .then(() => null, (e) => e);

    expect(err).not.toBeNull();
    expect(err.code).toBe('RECORD_NOT_FOUND');
    expect(err.status).toBe(404);
    expect(String(err.message)).not.toMatch(/required/i);
    expect(calls.update).toBe(0);
  });

  it('refuses BEFORE the before phase — no handler observes a row nobody read', async () => {
    // The load-bearing assertion. Removing the PRODUCER is what makes the
    // symptom impossible; leaving the dispatch in place and only changing the
    // final status would leave every other handler on the path still running
    // against a record that does not exist.
    const ran: string[] = [];
    const { engine } = await bootEngine([
      { name: 'nf_pre', object: 'nf_task', events: ['beforeUpdate'], priority: 10,
        handler: () => { ran.push('before'); } } as unknown as Hook,
      { name: 'nf_post', object: 'nf_task', events: ['afterUpdate'], priority: 10,
        handler: () => { ran.push('after'); } } as unknown as Hook,
    ]);

    await engine.update('nf_task', { id: 'ghost', done: true }).catch(() => undefined);

    expect(ran).toEqual([]);
  });

  it('an id that DOES name a row is untouched — the control', async () => {
    const { engine, calls } = await bootEngine([auditHook]);
    const row: any = await engine.insert('nf_task', { title: 'Ship it', done: false });

    const res: any = await engine.update('nf_task', { id: row.id, done: true });

    expect(res).toMatchObject({ id: row.id, done: true });
    expect(calls.update).toBe(1);
  });

  it('reaches the gate through `where.id` as well as through the payload', async () => {
    // Both spellings dispatch by-id (`ENGINE_UPDATE_DISPATCH_CASES`), so both
    // owe the same answer — a gate wired to one of them is the #3106 shape.
    const { engine } = await bootEngine([]);

    const err: any = await engine
      .update('nf_invoice', { status: 'sent' }, { where: { id: 'ghost' } } as any)
      .then(() => null, (e) => e);

    expect(err?.code).toBe('RECORD_NOT_FOUND');
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * 2. delete() — the twin. #5138's record: the worst of the three.
 * ──────────────────────────────────────────────────────────────────────────── */

describe('[#7867] a by-id delete against a nonexistent id answers RECORD_NOT_FOUND', () => {
  it('404 instead of reporting a deletion that never happened', async () => {
    // "The delete ran and the answer was 200 { deleted: true } for any string
    // in the path, so a typo'd id, an already-deleted row and a real deletion
    // were indistinguishable" — #5138 removed that from `callData`; it was
    // still live here.
    const { engine, calls } = await bootEngine([]);

    const err: any = await engine
      .delete('nf_task', { where: { id: 'ghost' } } as any)
      .then(() => null, (e) => e);

    expect(err).not.toBeNull();
    expect(err.code).toBe('RECORD_NOT_FOUND');
    expect(err.status).toBe(404);
    expect(calls.delete, 'nothing may reach the driver').toBe(0);
  });

  it('refuses before `beforeDelete` dispatches — and before any cascade runs', async () => {
    const ran: string[] = [];
    const { engine } = await bootEngine([
      { name: 'nf_pre_del', object: 'nf_task', events: ['beforeDelete'], priority: 10,
        handler: () => { ran.push('before'); } } as unknown as Hook,
      { name: 'nf_post_del', object: 'nf_task', events: ['afterDelete'], priority: 10,
        handler: () => { ran.push('after'); } } as unknown as Hook,
    ]);

    await engine.delete('nf_task', { where: { id: 'ghost' } } as any).catch(() => undefined);

    expect(ran).toEqual([]);
  });

  it('a real id still deletes — the control', async () => {
    const { engine, calls } = await bootEngine([]);
    const row: any = await engine.insert('nf_task', { title: 'Ship it', done: false });

    await engine.delete('nf_task', { where: { id: row.id } } as any);

    expect(calls.delete).toBe(1);
    expect(await engine.count('nf_task', {})).toBe(0);
  });

  it('a SECOND delete of the same id is refused — the already-deleted case is now distinguishable', async () => {
    const { engine } = await bootEngine([]);
    const row: any = await engine.insert('nf_task', { title: 'Ship it', done: false });
    await engine.delete('nf_task', { where: { id: row.id } } as any);

    const err: any = await engine
      .delete('nf_task', { where: { id: row.id } } as any)
      .then(() => null, (e) => e);

    expect(err?.code).toBe('RECORD_NOT_FOUND');
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * 3. The scope line — the PREDICATE path keeps "0 rows affected"
 * ──────────────────────────────────────────────────────────────────────────── */

describe('[#7867] the gate is BY-ID only — a predicate write matching nothing is not a 404', () => {
  it('a multi:true update matching zero rows resolves 0, it does not throw', async () => {
    const { engine, calls } = await bootEngine([]);

    const res = await engine.update(
      'nf_task', { done: true }, { where: { title: 'nothing matches' }, multi: true } as any,
    );

    expect(res).toBe(0);
    expect(calls.updateMany).toBe(1);
  });

  it('a multi:true delete matching zero rows resolves 0, it does not throw', async () => {
    const { engine, calls } = await bootEngine([]);

    const res = await engine.delete(
      'nf_task', { where: { title: 'nothing matches' }, multi: true } as any,
    );

    expect(res).toBe(0);
    expect(calls.deleteMany).toBe(1);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * 4. The envelope is the repo's ONE not-found envelope
 * ──────────────────────────────────────────────────────────────────────────── */

describe('[#7867] the engine answers with the SAME error the protocol and callData answer with', () => {
  it('is `recordNotFoundError` itself, not a look-alike', async () => {
    // The whole point of moving the factory into `@objectstack/core`: a
    // re-spelled envelope here would be the second not-found shape #5138 ruled
    // out, and REST maps 404 by reading `error.code === 'RECORD_NOT_FOUND'`
    // (`rest-server.ts`), so a look-alike with a different code would surface as
    // a 500.
    const { recordNotFoundError } = await import('@objectstack/core');
    const reference: any = recordNotFoundError('nf_task', 'ghost');

    const { engine } = await bootEngine([]);
    const actual: any = await engine
      .update('nf_task', { id: 'ghost', done: true })
      .then(() => null, (e) => e);

    expect(actual.code).toBe(reference.code);
    expect(actual.status).toBe(reference.status);
    expect(actual.object).toBe(reference.object);
    expect(actual.message).toBe(reference.message);
  });

  it('`@objectstack/metadata-protocol` still exports it, answering byte-identically', async () => {
    // The move must be invisible to the two sibling paths that import it from
    // there. Compared by ANSWER rather than by reference: this monorepo resolves
    // `@objectstack/core` from source for objectql and from `dist` for
    // metadata-protocol, so two module instances of one source file are the
    // norm here and a `toBe` would be pinning the resolver, not the contract.
    const { recordNotFoundError: fromProtocol } = await import('@objectstack/metadata-protocol');
    const { recordNotFoundError: fromCore } = await import('@objectstack/core');

    expect(typeof fromProtocol).toBe('function');
    const a: any = fromProtocol('nf_task', 'ghost');
    const b: any = fromCore('nf_task', 'ghost');
    expect({ code: a.code, status: a.status, object: a.object, message: a.message })
      .toEqual({ code: b.code, status: b.status, object: b.object, message: b.message });
  });
});
