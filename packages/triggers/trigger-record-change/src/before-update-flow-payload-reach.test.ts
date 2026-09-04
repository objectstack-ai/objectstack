// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#15356] MEASUREMENT — can a `record-before-update` flow reach the BATCH
 * PAYLOAD of a `multi: true` update?
 *
 * ## Why this file exists
 *
 * #14744's census found the in-repo population of same-key / per-row-VALUE
 * `beforeUpdate` payload rewrites is ZERO across 23 production registration
 * sites. One door that zero does not bound was named there but never driven:
 * `record-change-trigger.ts`'s `start()` binds `beforeUpdate` for the
 * `record-before-update` / `record-before-write` trigger types and hands the
 * write to USER-AUTHORED FLOW METADATA. The conclusion recorded on that card —
 * `buildContext` materialises a NEW record object by overlay rather than
 * handing the flow `ctx.input.data` by reference, so a flow cannot reach the
 * batch payload — was labelled by its own author a SOURCE READING, explicitly
 * not a measurement.
 *
 * This file is the measurement. It is a HYPOTHESIS under test, not a premise:
 * the probes below start from "which write shapes does the live node registry
 * offer" and try each, rather than from "the source says it cannot".
 *
 * ## The mechanism the probes are aimed at
 *
 * On a predicate (`multi: true`) update, `ObjectQL.update()`'s predicate branch
 * calls `dispatchPerRowBeforeHooks`, whose ADR-0058 Addendum II clause D3
 * hands every per-row context THE batch payload — `rowCtx.input.data` is the
 * same object for every row, never a copy — and writes it back onto
 * `batchCtx.input.data` after each dispatch. So a `beforeUpdate` handler that
 * assigns the payload rewrites the SET clause for the WHOLE batch: with rows
 * whose pre-images differ, the LAST dispatch's value lands on EVERY row. That
 * is the residue shape, and {@link POSITIVE_CONTROL} below reproduces it in
 * this same harness with a script hook, so a "no shape reaches it" verdict
 * from the flow probes is a measurement and not a failure to observe.
 *
 * ## What the observable is
 *
 * The batch payload IS the SET clause of the single `driver.updateMany`, so
 * "reached the payload" is directly readable off the persisted rows: a value
 * that appears on EVERY row although only one row's dispatch produced it can
 * have arrived only through the shared payload. Each probe ALSO carries a
 * witness `beforeUpdate` hook at priority 1000 (lower runs first, so this runs
 * after the trigger's own handler) that snapshots `ctx.input.data` per row —
 * a direct read of the payload after the flow has run, independent of what the
 * driver then does with it.
 *
 * ## Every probe proves its own flow RAN
 *
 * `RecordChangeTrigger`'s handler swallows flow failures by design (error
 * isolation — a flow must never break the CRUD write). A probe that measured
 * only "no residue" could therefore be reporting a flow that never fired. So
 * every probe asserts a POSITIVE trace of its own run — an audit row the flow
 * wrote, or the script function's own recorded observation — before it is
 * allowed to report "does not reach".
 */
import { describe, it, expect } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import { ObjectQLPlugin } from '@objectstack/objectql';
import { AutomationServicePlugin, type AutomationEngine } from '@objectstack/service-automation';
import type { IDataEngine, IObjectQLEngine } from '@objectstack/spec/contracts';
import { RecordChangeTriggerPlugin } from './plugin.js';

/**
 * `registerObject` / `registerHook` / `registerFunction` are the concrete
 * engine's seams that the `objectql` slot's published contract does not model
 * (same narrowing `bulk-write-per-row-context.test.ts` in this package makes
 * for `registerObject`), declared structurally so the slot lookup itself stays
 * fully typed (#4127/#4251) instead of reaching for `any`.
 */
type TestObjectRegistry = {
  registerObject(schema: unknown, packageId?: string, namespace?: string): void;
};
type TestHookSurface = {
  registerHook(
    event: string,
    handler: (ctx: any) => unknown | Promise<unknown>,
    options?: { object?: string | string[]; priority?: number; packageId?: string },
  ): void;
  registerFunction(name: string, handler: (...args: any[]) => unknown, packageId?: string): void;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Memory driver with a real `updateMany` (one SET clause for N rows). */
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
    // ONE SET clause for N rows — the contract that makes the batch payload
    // batch-scoped in the first place.
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

/**
 * `residue` and `tags` are DECLARED fields on purpose: the engine's
 * declared-field door (#8738 pre-hook / #13657 post-hook) refuses a payload
 * carrying an undeclared key, so a probe writing an undeclared name would be
 * measuring that refusal instead of the reach question.
 *
 * `tags` is a `multiselect` — an ARRAY-valued declared field, which is what
 * gives the payload a NESTED value at all. `buildContext`'s overlay is a
 * SHALLOW spread, so if any flow write shape can mutate a nested value in
 * place it reaches the payload through reference sharing without ever
 * assigning a top-level key. That is the falsification candidate this file
 * exists to try, and it cannot be tried on a payload of scalars.
 */
function registerObjects(registry: TestObjectRegistry, object: string): void {
  registry.registerObject({
    name: object, label: object,
    fields: {
      title: { name: 'title', label: 'Title', type: 'text' },
      status: { name: 'status', label: 'Status', type: 'text' },
      residue: { name: 'residue', label: 'Residue', type: 'text' },
      tags: { name: 'tags', label: 'Tags', type: 'multiselect' },
    },
  }, 'test', 'test');
  registry.registerObject({
    name: `${object}_audit`, label: 'audit',
    fields: {
      seen: { name: 'seen', label: 'Seen', type: 'text' },
      note: { name: 'note', label: 'Note', type: 'text' },
    },
  }, 'test', 'test');
}

interface Stack {
  data: IDataEngine;
  automation: AutomationEngine;
  objectql: IObjectQLEngine & TestHookSurface;
  /** Per-row snapshots of `ctx.input.data` taken AFTER the trigger handler ran. */
  witness: Array<{ id: unknown; data: Record<string, unknown>; sameRef: boolean }>;
}

async function bootStack(object: string): Promise<Stack> {
  const kernel = new ObjectKernel({ logger: { level: 'silent' } });
  await kernel.use(new ObjectQLPlugin());
  await kernel.use(new AutomationServicePlugin());
  await kernel.use(new RecordChangeTriggerPlugin());
  await kernel.bootstrap();

  const objectql = kernel.getService<IObjectQLEngine>('objectql') as IObjectQLEngine & TestHookSurface;
  const data = kernel.getService<IDataEngine>('data');
  const automation = kernel.getService<AutomationEngine>('automation');
  objectql.registerDriver(makeDriver(), true);
  registerObjects(objectql.registry as unknown as TestObjectRegistry, object);

  // The witness. Priority 1000 (`entries.sort((a,b) => a.priority - b.priority)`
  // — lower runs FIRST), so it observes the payload after the record-change
  // trigger's own handler, and therefore after the flow that handler awaited.
  const witness: Stack['witness'] = [];
  let firstPayloadRef: unknown;
  objectql.registerHook(
    'beforeUpdate',
    (ctx: any) => {
      const payload = ctx.input?.data;
      if (firstPayloadRef === undefined) firstPayloadRef = payload;
      witness.push({
        id: ctx.input?.id,
        data: JSON.parse(JSON.stringify(payload ?? {})),
        sameRef: payload === firstPayloadRef,
      });
    },
    { object, priority: 1000, packageId: 'test:witness' },
  );

  return { data, automation, objectql, witness };
}

/** Two rows whose pre-images DIFFER — one batch cannot separate the residue from the clock. */
async function seedTwoRows(data: IDataEngine, object: string): Promise<void> {
  await data.insert(object, [
    { title: 'alpha', status: 'todo' },
    { title: 'beta', status: 'blocked' },
  ] as any, { context: { userId: 'u1' } } as any);
}

/** The ONE predicate write every probe measures. */
async function batchUpdate(
  data: IDataEngine,
  object: string,
  payload: Record<string, unknown>,
): Promise<{ ok: boolean; error?: string }> {
  try {
    await data.update(object, payload as any, { multi: true, where: {}, context: { userId: 'u1' } } as any);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error)?.message ?? String(err) };
  }
}

const rowsByTitle = async (data: IDataEngine, object: string) => {
  const rows: any[] = await data.find(object, {} as any);
  return new Map<string, any>(rows.map((r) => [r.title, r]));
};

/**
 * A probe flow: [start on record-before-update] → [the shape under test] →
 * [log] → [end]. The `log` node is the flow's own proof of life — a probe
 * reporting "does not reach" while its flow never fired would be a failure to
 * observe dressed as a result.
 */
function probeFlow(name: string, object: string, probeNode: Record<string, unknown>) {
  return {
    name, label: name, type: 'record_change',
    nodes: [
      {
        id: 'start', type: 'start', label: 'Start',
        config: { objectName: object, triggerType: 'record-before-update' },
      },
      probeNode,
      {
        id: 'log', type: 'create_record', label: 'Log',
        config: {
          objectName: `${object}_audit`,
          fields: { seen: '{previous.title}', note: '{previous.status}' },
        },
      },
      { id: 'end', type: 'end', label: 'End' },
    ],
    edges: [
      { id: 'e1', source: 'start', target: probeNode.id as string },
      { id: 'e2', source: probeNode.id as string, target: 'log' },
      { id: 'e3', source: 'log', target: 'end' },
    ],
  };
}

/**
 * ⭐ THE POSITIVE CONTROL — the load-bearing half of every negative below.
 *
 * A script `beforeUpdate` hook that DOES assign the batch payload, in this
 * same harness, on the same two-rows-with-differing-pre-images batch: the
 * #14744 pinned residue shape. It must show the LAST dispatch's value landing
 * on EVERY row. Without it firing, "no flow shape reached the payload" is a
 * claim about this harness, not about flows.
 */
const POSITIVE_CONTROL = 'positive control';

describe('[#15356] can a record-before-update flow reach a multi:true batch payload?', () => {
  it(`${POSITIVE_CONTROL}: a script beforeUpdate hook that assigns the payload DOES land the last dispatch's value on every row`, async () => {
    const object = 'pc';
    const stack = await bootStack(object);
    await seedTwoRows(stack.data, object);

    // The residue shape: a per-row-VALUE write of the SAME key on every row.
    // Same key set across rows, so #14099's divergence refusal does NOT fire —
    // that is exactly the blind spot #14744 is weighing.
    const dispatched: string[] = [];
    stack.objectql.registerHook(
      'beforeUpdate',
      (ctx: any) => {
        const seen = String(ctx.previous?.title ?? '?');
        dispatched.push(seen);
        ctx.input.data.residue = `from:${seen}`;
      },
      { object, priority: 10, packageId: 'test:residue' },
    );

    const wrote = await batchUpdate(stack.data, object, { status: 'done' });
    expect(wrote, `the control's own write must succeed: ${wrote.error}`).toMatchObject({ ok: true });

    // The control fired once per row, on rows whose pre-images differ.
    expect(dispatched.sort()).toEqual(['alpha', 'beta']);

    const rows = await rowsByTitle(stack.data, object);
    const residues = [rows.get('alpha')?.residue, rows.get('beta')?.residue];
    // ⭐ The defect, observed: ONE value — the last dispatch's — on BOTH rows.
    expect(new Set(residues).size, `residues=${JSON.stringify(residues)}`).toBe(1);
    expect(residues[0]).toBe(`from:${dispatched[dispatched.length - 1]}`);

    // And the witness saw it on the shared payload object itself.
    expect(stack.witness.every((w) => w.sameRef)).toBe(true);
    expect(stack.witness.at(-1)?.data.residue).toBe(residues[0]);
  }, 20000);

  it('A2.4 — the write-shape vocabulary is READ OFF THE LIVE REGISTRY, not remembered', async () => {
    const stack = await bootStack('vocab');
    const types = (stack.automation as any).getRegisteredNodeTypes() as string[];
    // Recorded so the report quotes a measured list. ADR-0018 makes this
    // registry — not a closed enum — the authority on what a node `type` may be.
    // eslint-disable-next-line no-console
    console.log('[#15356] registered node types:', JSON.stringify(types.sort()));
    expect(types.length).toBeGreaterThan(0);
  }, 20000);

  it('S1 assignment node (canonical `assignments` map) — does NOT reach the payload', async () => {
    const object = 's1';
    const stack = await bootStack(object);
    await seedTwoRows(stack.data, object);
    stack.automation.registerFlow('s1_flow', probeFlow('s1_flow', object, {
      id: 'probe', type: 'assignment', label: 'Assign',
      config: { assignments: { residue: 'REACHED-{previous.title}' } },
    }) as any);

    const wrote = await batchUpdate(stack.data, object, { status: 'done' });
    expect(wrote).toMatchObject({ ok: true });
    await sleep(200);

    const audit: any[] = await stack.data.find(`${object}_audit`, {} as any);
    expect(audit.map((r) => r.seen).sort(), 'the flow must have RUN, once per row').toEqual(['alpha', 'beta']);

    const rows = await rowsByTitle(stack.data, object);
    expect(rows.get('alpha')?.residue ?? null).toBeNull();
    expect(rows.get('beta')?.residue ?? null).toBeNull();
    expect(stack.witness.every((w) => !('residue' in w.data))).toBe(true);
  }, 20000);

  it('S2 assignment node with a DOTTED target (`record.residue`) — does NOT reach the payload', async () => {
    const object = 's2';
    const stack = await bootStack(object);
    await seedTwoRows(stack.data, object);
    stack.automation.registerFlow('s2_flow', probeFlow('s2_flow', object, {
      id: 'probe', type: 'assignment', label: 'Assign',
      config: { assignments: { 'record.residue': 'REACHED', 'input.data.residue': 'REACHED' } },
    }) as any);

    const wrote = await batchUpdate(stack.data, object, { status: 'done' });
    expect(wrote).toMatchObject({ ok: true });
    await sleep(200);

    const audit: any[] = await stack.data.find(`${object}_audit`, {} as any);
    expect(audit.map((r) => r.seen).sort()).toEqual(['alpha', 'beta']);
    const rows = await rowsByTitle(stack.data, object);
    expect(rows.get('alpha')?.residue ?? null).toBeNull();
    expect(rows.get('beta')?.residue ?? null).toBeNull();
    expect(stack.witness.every((w) => !('residue' in w.data))).toBe(true);
  }, 20000);

  it('S3 assignment node REPLACING the `record` variable — does NOT reach the payload', async () => {
    const object = 's3';
    const stack = await bootStack(object);
    await seedTwoRows(stack.data, object);
    stack.automation.registerFlow('s3_flow', probeFlow('s3_flow', object, {
      id: 'probe', type: 'assignment', label: 'Assign',
      config: { assignments: { record: { residue: 'REACHED', status: 'HIJACKED' } } },
    }) as any);

    const wrote = await batchUpdate(stack.data, object, { status: 'done' });
    expect(wrote).toMatchObject({ ok: true });
    await sleep(200);

    const rows = await rowsByTitle(stack.data, object);
    expect(rows.get('alpha')?.residue ?? null).toBeNull();
    expect(rows.get('alpha')?.status).toBe('done');
    expect(stack.witness.every((w) => !('residue' in w.data))).toBe(true);
  }, 20000);

  it('S4 script node — a function assigning `automation.record.<key>` does NOT reach the payload', async () => {
    const object = 's4';
    const stack = await bootStack(object);
    const seen: Array<Record<string, unknown>> = [];
    stack.objectql.registerFunction('mutate_top_level', async (args: any) => {
      const rec = args.automation?.record as Record<string, unknown>;
      seen.push({
        hasRecord: !!rec,
        // What handles does a script function actually get? Recorded, not assumed.
        automationKeys: Object.keys(args.automation ?? {}).sort(),
        argKeys: Object.keys(args ?? {}).sort(),
        sameAsVariable: args.variables?.get('record') === rec,
        previousTitle: (args.automation?.previous as any)?.title,
      });
      rec.residue = 'REACHED';
      return { ok: true };
    });
    await seedTwoRows(stack.data, object);
    stack.automation.registerFlow('s4_flow', probeFlow('s4_flow', object, {
      id: 'probe', type: 'script', label: 'Script',
      config: { function: 'mutate_top_level', inputs: {} },
    }) as any);

    const wrote = await batchUpdate(stack.data, object, { status: 'done' });
    expect(wrote).toMatchObject({ ok: true });
    await sleep(200);

    // eslint-disable-next-line no-console
    console.log('[#15356] S4 script function saw:', JSON.stringify(seen, null, 1));
    expect(seen, 'the script function must have RUN, once per row').toHaveLength(2);
    // #4862 re-check, on today's tree: `previous` IS bound, per row.
    expect(seen.map((s) => s.previousTitle).sort()).toEqual(['alpha', 'beta']);
    expect(seen.every((s) => s.sameAsVariable === true)).toBe(true);

    const rows = await rowsByTitle(stack.data, object);
    expect(rows.get('alpha')?.residue ?? null).toBeNull();
    expect(rows.get('beta')?.residue ?? null).toBeNull();
    expect(stack.witness.every((w) => !('residue' in w.data))).toBe(true);
  }, 20000);

  it('S5 ⭐ script node — a function mutating a NESTED payload value IN PLACE (aliasing probe)', async () => {
    const object = 's5';
    const stack = await bootStack(object);
    const observed: Array<Record<string, unknown>> = [];
    stack.objectql.registerFunction('mutate_nested', async (args: any) => {
      const rec = args.automation?.record as Record<string, unknown>;
      const tags = rec?.tags;
      observed.push({
        tagsIsArray: Array.isArray(tags),
        tagsBefore: JSON.stringify(tags ?? null),
        previousTitle: (args.automation?.previous as any)?.title,
      });
      if (Array.isArray(tags)) tags.push(`REACHED-${(args.automation?.previous as any)?.title}`);
      return { ok: true };
    });
    await seedTwoRows(stack.data, object);
    stack.automation.registerFlow('s5_flow', probeFlow('s5_flow', object, {
      id: 'probe', type: 'script', label: 'Script',
      config: { function: 'mutate_nested', inputs: {} },
    }) as any);

    // The payload carries a NESTED (array) value — without one there is no
    // reference to share and this probe would measure nothing.
    const wrote = await batchUpdate(stack.data, object, { status: 'done', tags: ['seed'] });
    await sleep(200);

    // eslint-disable-next-line no-console
    console.log('[#15356] S5 observed:', JSON.stringify(observed), 'write=', JSON.stringify(wrote));
    // eslint-disable-next-line no-console
    console.log('[#15356] S5 witness:', JSON.stringify(stack.witness));
    expect(observed, 'the script function must have RUN, once per row').toHaveLength(2);

    const rows = await rowsByTitle(stack.data, object);
    // eslint-disable-next-line no-console
    console.log('[#15356] S5 rows:', JSON.stringify([...rows.values()]));
    // Verdict recorded by the assertions the measurement produces — see the
    // report. Asserted concretely once measured.
    expect(rows.size).toBe(2);
  }, 20000);

  it('S6 update_record node aimed at the triggering row — a SEPARATE write, not the batch payload', async () => {
    const object = 's6';
    const stack = await bootStack(object);
    await seedTwoRows(stack.data, object);
    stack.automation.registerFlow('s6_flow', probeFlow('s6_flow', object, {
      id: 'probe', type: 'update_record', label: 'Update',
      config: {
        objectName: object,
        filter: { id: '{record.id}' },
        fields: { residue: 'REACHED-{previous.title}' },
      },
    }) as any);

    const wrote = await batchUpdate(stack.data, object, { status: 'done' });
    await sleep(400);

    const rows = await rowsByTitle(stack.data, object);
    // eslint-disable-next-line no-console
    console.log('[#15356] S6 rows:', JSON.stringify([...rows.values()]), 'write=', JSON.stringify(wrote));
    // eslint-disable-next-line no-console
    console.log('[#15356] S6 witness:', JSON.stringify(stack.witness));
    expect(rows.size).toBe(2);
  }, 20000);
});
