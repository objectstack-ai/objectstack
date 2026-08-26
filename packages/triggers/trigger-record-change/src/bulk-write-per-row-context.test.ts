// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#4862, closed by #5038] A record-change flow trigger on a PREDICATE
 * (`multi: true`) write is evaluated and fired PER ROW, with `previous` bound
 * to that row's pre-write state and `record` holding that row's real state.
 *
 * ## What this used to do, measured
 *
 * #4862 recorded five facts about a `multi: true` update, all of them
 * observable here before the fix:
 *
 *   1. the engine assigned `previous` only on the single-id branch, so on a
 *      bulk write `ctx.previous` was `undefined`;
 *   2. plugin-audit's `__previous` fallback bailed out on bulk (`if (!id)
 *      return`), so the trigger's second source was empty too;
 *   3. the trigger reads exactly those two, so `previous` was always absent;
 *   4. `driver.updateMany` resolves an affected COUNT, so `ctx.result` was not
 *      an object and `record` degraded to the write's bare payload — not any
 *      row's state;
 *   5. the hook fired ONCE, so however many rows matched, the flow was
 *      evaluated a single time.
 *
 * The consequence was not theoretical: the transition condition the docs and
 * `skills/objectstack-formula` §5 teach — and that ten showcase flows use
 * verbatim — is `status == "done" && previous.status != "done"`. On a bulk
 * "mark these done" it either did not fire or fired once for a record that did
 * not exist, and **nothing anywhere said so**. A missing audit row is the one
 * failure nobody goes looking for.
 *
 * ## Why the fix has no code in this package
 *
 * All five facts were PRODUCER facts. The trigger already reads `ctx.previous`,
 * `ctx.result` and `ctx.input.data`; it was handed a context that had nothing
 * in them. #5038 made the engine dispatch one single-record-shaped context per
 * matched row, so this consumer became correct without a bulk-aware branch of
 * its own — which is the point of fixing it at the producer rather than teaching
 * every consumer to cope. These tests exist because that correctness is now a
 * CONTRACT across a package boundary, and nothing else pins it end to end.
 */
import { describe, it, expect } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import { ObjectQLPlugin } from '@objectstack/objectql';
import { AutomationServicePlugin, type AutomationEngine } from '@objectstack/service-automation';
import type { IDataEngine, IObjectQLEngine } from '@objectstack/spec/contracts';
import { RecordChangeTriggerPlugin } from './plugin.js';

/**
 * `registerObject` is the engine registry's TEST-time seam and is not part of
 * `EngineSchemaRegistryView` (the `objectql` slot's published registry
 * contract, which is read-only plus package lifecycle). Narrowed structurally
 * rather than through `any`, so the slot lookup itself stays fully contracted
 * (#4127/#4251) and only this one member is asserted.
 */
type TestObjectRegistry = {
  registerObject(schema: unknown, packageId?: string, namespace?: string): void;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Memory driver with real `updateMany` / `deleteMany` (affected-count contract). */
function makeDriver(): any {
  const stores = new Map<string, Map<string, Record<string, unknown>>>();
  const storeFor = (o: string) => {
    let s = stores.get(o);
    if (!s) { s = new Map(); stores.set(o, s); }
    return s;
  };
  let n = 0;
  const matches = (row: any, where: any): boolean => {
    if (!where || typeof where !== 'object') return true;
    for (const [k, v] of Object.entries(where)) {
      if (k.startsWith('$')) continue;
      const exp = v && typeof v === 'object' && '$eq' in (v as any) ? (v as any).$eq : v;
      if ((row[k] ?? null) !== (exp ?? null)) return false;
    }
    return true;
  };
  const sel = (o: string, ast: any) => [...storeFor(o).values()].filter((r) => matches(r, ast?.where));
  return {
    name: 'memory', version: '0', supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; },
    async execute() { return null; }, async syncSchema() {},
    async create(o: string, data: any) {
      n += 1; const id = data.id ?? `r_${n}`;
      const full = { ...data, id }; storeFor(o).set(id, full); return { ...full };
    },
    async update(o: string, id: string, data: any) {
      const cur = storeFor(o).get(id) ?? {}; const u = { ...cur, ...data, id };
      storeFor(o).set(id, u); return { ...u };
    },
    async find(o: string, ast: any) { return sel(o, ast).map((r) => ({ ...r })); },
    async findOne(o: string, ast: any) { const [r] = sel(o, ast); return r ? { ...r } : null; },
    async delete(o: string, id: string) { return storeFor(o).delete(id); },
    async count(o: string, ast: any) { return sel(o, ast).length; },
    async upsert(o: string, d: any) { return this.create(o, d); },
    async bulkCreate(o: string, rows: any[]) { return Promise.all(rows.map((r) => this.create(o, r))); },
    async bulkUpdate() { return []; }, async bulkDelete() {},
    // The contract that made `record` a bare payload: a COUNT, naming no row.
    async updateMany(o: string, ast: any, data: any) {
      const rows = sel(o, ast);
      for (const r of rows) storeFor(o).set(r.id as string, { ...r, ...data, id: r.id });
      return rows.length;
    },
    async deleteMany(o: string, ast: any) {
      const rows = sel(o, ast);
      for (const r of rows) storeFor(o).delete(r.id as string);
      return rows.length;
    },
    async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
  };
}

async function bootStack() {
  // [#11571] The blanket mute is kept here deliberately. With no datasource
  // this boot emits one invariant 3-frame ERROR trio that neither predicate
  // in `runtime/src/expected-read-refusal-noise.ts` can recognise, and the
  // console-level capture proposed to reach it intercepts ZERO: ObjectLogger
  // writes ERROR to `process.stderr`, never through `console`, under Node.
  // See that module's closing section for the measurement.
  const kernel = new ObjectKernel({ logger: { level: 'silent' } });
  await kernel.use(new ObjectQLPlugin());
  await kernel.use(new AutomationServicePlugin());
  await kernel.use(new RecordChangeTriggerPlugin());
  await kernel.bootstrap();

  const objectql = kernel.getService<IObjectQLEngine>('objectql');
  const data = kernel.getService<IDataEngine>('data');
  const automation = kernel.getService<AutomationEngine>('automation');
  const registry = objectql.registry as unknown as TestObjectRegistry;
  objectql.registerDriver(makeDriver(), true);
  registry.registerObject({
    name: 'task', label: 'Task',
    fields: {
      title: { name: 'title', label: 'Title', type: 'text' },
      status: { name: 'status', label: 'Status', type: 'text' },
      owner: { name: 'owner', label: 'Owner', type: 'text' },
    },
  }, 'test', 'test');
  // Where the flow leaves its trace: one row per firing, carrying the bindings
  // it saw. Writing to a DIFFERENT object keeps the assertion clean of the
  // trigger's own re-entrancy guard.
  registry.registerObject({
    name: 'task_audit', label: 'Task audit',
    fields: {
      task_title: { name: 'task_title', label: 'Task', type: 'text' },
      from_status: { name: 'from_status', label: 'From', type: 'text' },
      to_status: { name: 'to_status', label: 'To', type: 'text' },
      task_owner: { name: 'task_owner', label: 'Owner', type: 'text' },
    },
  }, 'test', 'test');

  return { kernel, data, automation };
}

/** The transition flow shape the docs, the formula skill and the ten showcase
 *  flows all use verbatim. */
function registerTransitionFlow(automation: AutomationEngine, event = 'record-after-update') {
  automation.registerFlow('audit_task_completion', {
    name: 'audit_task_completion', label: 'Audit completion', type: 'autolaunched',
    nodes: [
      {
        id: 'start', type: 'start', label: 'Start',
        config: {
          objectName: 'task', triggerType: event,
          condition: 'status == "done" && previous.status != "done"',
        },
      },
      {
        id: 'log', type: 'create_record', label: 'Log',
        config: {
          objectName: 'task_audit',
          fields: {
            task_title: '{record.title}',
            from_status: '{previous.status}',
            to_status: '{record.status}',
            task_owner: '{record.owner}',
          },
        },
      },
      { id: 'end', type: 'end', label: 'End' },
    ],
    edges: [{ id: 'e1', source: 'start', target: 'log' }, { id: 'e2', source: 'log', target: 'end' }],
  } as any);
}

describe('[#4862/#5038] a record-change trigger on a predicate bulk write', () => {
  it('fires PER ROW, with `previous` bound to each row\'s own pre-write state', async () => {
    const { data, automation } = await bootStack();
    registerTransitionFlow(automation);

    await data.insert('task', [
      { title: 'alpha', status: 'todo', owner: 'ann' },
      { title: 'beta', status: 'blocked', owner: 'bob' },
    ], { context: { userId: 'u1' } });

    // One predicate write over both rows — exactly "mark this batch done".
    await data.update('task', { status: 'done' }, { multi: true, where: {}, context: { userId: 'u1' } });
    await sleep(400);

    const audit: any[] = await data.find('task_audit', {});
    // Fact 5 reversed: two matched rows, two flow runs.
    expect(audit).toHaveLength(2);

    const byTitle = new Map(audit.map((r) => [r.task_title, r]));
    // Facts 1-3 reversed: `previous` is bound, and it is THIS row's pre-image —
    // the two rows started in different states and each run saw its own.
    expect(byTitle.get('alpha')?.from_status).toBe('todo');
    expect(byTitle.get('beta')?.from_status).toBe('blocked');
    // Fact 4 reversed: `record` is the row's real state. `owner` is a field this
    // write never carried, so a bare payload could not have supplied it.
    expect(byTitle.get('alpha')?.task_owner).toBe('ann');
    expect(byTitle.get('beta')?.task_owner).toBe('bob');
    expect(byTitle.get('alpha')?.to_status).toBe('done');
  }, 20000);

  it('the start condition discriminates per row — an already-done row does not fire', async () => {
    // This is what `previous` is FOR, and what a bulk write could not express:
    // `status == "done"` is true of the already-done row too, so without a
    // per-row `previous` the flow either fires for it or for nobody.
    const { data, automation } = await bootStack();
    registerTransitionFlow(automation);

    await data.insert('task', [
      { title: 'just_finished', status: 'todo', owner: 'ann' },
      { title: 'was_already_done', status: 'done', owner: 'bob' },
    ], { context: { userId: 'u1' } });

    await data.update('task', { status: 'done' }, { multi: true, where: {}, context: { userId: 'u1' } });
    await sleep(400);

    const audit: any[] = await data.find('task_audit', {});
    expect(audit.map((r) => r.task_title)).toEqual(['just_finished']);
  }, 20000);

  it('matches what the SAME flow does on a single-record write', async () => {
    // The contract's real claim: an author writes one transition condition and
    // it means the same thing whether the write carries an id or a predicate.
    // Same flow, same rows, same starting states — only the write shape differs.
    const bulk = await bootStack();
    registerTransitionFlow(bulk.automation);
    await bulk.data.insert('task', [{ title: 'x', status: 'todo', owner: 'ann' }], { context: { userId: 'u1' } });
    await bulk.data.update('task', { status: 'done' }, { multi: true, where: {}, context: { userId: 'u1' } });
    await sleep(400);
    const viaBulk: any[] = await bulk.data.find('task_audit', {});

    const single = await bootStack();
    registerTransitionFlow(single.automation);
    const [row]: any = await single.data.insert('task', [{ title: 'x', status: 'todo', owner: 'ann' }], { context: { userId: 'u1' } });
    await single.data.update('task', { status: 'done' }, { where: { id: row.id }, context: { userId: 'u1' } });
    await sleep(400);
    const viaSingle: any[] = await single.data.find('task_audit', {});

    const strip = (rows: any[]) => rows
      .map(({ task_title, from_status, to_status, task_owner }) => ({ task_title, from_status, to_status, task_owner }));
    expect(strip(viaBulk)).toEqual(strip(viaSingle));
  }, 30000);

  it('fires per deleted row for a predicate bulk DELETE', async () => {
    const { data, automation } = await bootStack();
    automation.registerFlow('audit_task_removal', {
      name: 'audit_task_removal', label: 'Audit removal', type: 'autolaunched',
      nodes: [
        {
          id: 'start', type: 'start', label: 'Start',
          config: { objectName: 'task', triggerType: 'record-after-delete', condition: 'status == "stale"' },
        },
        {
          id: 'log', type: 'create_record', label: 'Log',
          config: { objectName: 'task_audit', fields: { task_title: '{record.title}', to_status: 'deleted' } },
        },
        { id: 'end', type: 'end', label: 'End' },
      ],
      edges: [{ id: 'e1', source: 'start', target: 'log' }, { id: 'e2', source: 'log', target: 'end' }],
    } as any);

    await data.insert('task', [
      { title: 'old_a', status: 'stale', owner: 'ann' },
      { title: 'old_b', status: 'stale', owner: 'bob' },
      { title: 'keep', status: 'live', owner: 'cat' },
    ], { context: { userId: 'u1' } });

    await data.delete('task', { multi: true, where: { status: 'stale' }, context: { userId: 'u1' } });
    await sleep(400);

    const audit: any[] = await data.find('task_audit', {});
    // A bulk delete used to fire once with a context naming no row, so a
    // deletion audit could not record WHAT was deleted.
    expect(audit.map((r) => r.task_title).sort()).toEqual(['old_a', 'old_b']);
  }, 20000);
});
