// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#15356 measured, #14744 closed] PIN — a `record-before-update` flow reaches
 * NO write shape into the BATCH PAYLOAD of a `multi: true` update.
 *
 * ## What changed about this file, and what did not
 *
 * It was written for #15356 as a MEASUREMENT and it answered NOT BOUNDED: one
 * shape (`S5`) reached the payload. #14744 then ruled the door closed —
 * `buildContext` decouples the flow-facing roots from the engine's own objects
 * (`decoupleFromEngineState`) — and this file was adopted whole as the pin.
 * `S5`, `S5b` and the SQL replica were FLIPPED to their opposites in that same
 * PR, keeping every observable they measured on: reference identity across the
 * boundary, the per-row readings, and the persisted rows. ⛔ Nothing was
 * weakened, and nothing was deleted: the paragraphs below still describe the
 * defect as it was measured, because a pin whose reader cannot see what it is
 * pinning against is a pin nobody dares repair.
 *
 * The two controls are why the negatives are readable, and BOTH must keep
 * firing: the positive control (a script hook that ASSIGNS the payload — the
 * #14744 residue shape — still lands the LAST dispatch's value on every row,
 * because #14744's fix is about aliasing and deliberately does not touch that
 * residue) and the #14099 armed control (divergent key sets are still refused
 * whole). If either stops firing, this file has stopped measuring.
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
 * This file is the measurement, and it FALSIFIED the reading's conclusion for
 * one shape. The overlay was real, and it was a SHALLOW spread
 * (`{ ...previous, ...inputData }`): the top-level object was new, and every
 * NESTED value in it was the payload's own object, shared by reference. A flow
 * write shape that mutated a nested value IN PLACE therefore wrote the batch
 * payload without ever assigning a top-level key. See `S5` below.
 *
 * ⭐ #14744 made the reading's sentence TRUE AS STATED rather than deleting it:
 * the overlay still materialises a new object, and `decoupleFromEngineState`
 * now makes that true of the object's CONTENTS too. The distinction is worth
 * keeping in front of the next reader — "a new object" and "reaches nothing"
 * were two different claims for the whole life of this package, and only one of
 * them was ever checked.
 *
 * ## The mechanism the probes are aimed at
 *
 * On a predicate (`multi: true`) update, `ObjectQL.update()`'s predicate branch
 * calls `dispatchPerRowBeforeHooks`, whose ADR-0058 Addendum II clause D3
 * hands every per-row context THE batch payload — `rowCtx.input.data` is the
 * same object for every row, never a copy — and writes it back onto
 * `batchCtx.input.data` after each dispatch. So a `beforeUpdate` handler that
 * writes the payload rewrites the SET clause for the WHOLE batch: with rows
 * whose pre-images differ, the LAST dispatch's value lands on EVERY row.
 *
 * ## What the observable is
 *
 * The batch payload IS the SET clause of the single `driver.updateMany`, so
 * "reached the payload" is directly readable off the persisted rows: a value
 * that appears on EVERY row although only one row's dispatch produced it can
 * have arrived only through the shared payload. Each stack ALSO carries a
 * witness `beforeUpdate` hook at priority 1000 (lower runs first, so it runs
 * after the record-change trigger's own handler) that snapshots
 * `ctx.input.data` per row — a direct read of the payload after the flow has
 * run, independent of what the driver then does with it.
 *
 * ## Every probe proves its own flow RAN
 *
 * `RecordChangeTrigger`'s handler swallows flow failures by design (error
 * isolation — a flow must never break the CRUD write). A probe that measured
 * only "no residue" could therefore be reporting a flow that never fired. So
 * every probe asserts a POSITIVE trace of its own run — an audit row the flow
 * wrote, or the script function's own recorded observation — before it is
 * allowed to report "does not reach".
 *
 * ## Two controls, because a negative needs them
 *
 *  - `positive control` — a script `beforeUpdate` hook that DOES assign the
 *    payload (the #14744 pinned residue shape), in this same harness, showing
 *    the last dispatch's value on every row. Without it firing, every "does not
 *    reach" below would be a claim about this harness, not about flows.
 *  - `#14099 armed control` — a hook writing DIVERGENT KEY SETS per row must
 *    be refused whole, so "the refusal did not fire for the nested shape" is a
 *    measurement rather than an unarmed check.
 *
 * ⚠️ #15356 was a MEASUREMENT card: no guard, no write-shape change, no ADR.
 * #14744 carries the fix, and it is still not a write-shape change: ADR-0058
 * Addendum II D3 stands untouched — the engine does not split its own write,
 * one payload still serves N rows, and every per-row context is still handed
 * that one object (asserted in `S5`). What changed is only that the object a
 * FLOW is handed no longer shares anything with it.
 */
import { describe, it, expect } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import { ObjectQLPlugin } from '@objectstack/objectql';
import { AutomationServicePlugin, type AutomationEngine } from '@objectstack/service-automation';
import type { IDataEngine, IObjectQLEngine } from '@objectstack/spec/contracts';
// `check:test-source-alias` — this package resolves `@objectstack/driver-sql`
// through `dist/`, so its first load must be paid during COLLECTION, not inside
// a clocked test body: a `it(…, 25000)` that also transforms a dependency's
// whole module graph measures loading, not behaviour.
import { SqlDriver } from '@objectstack/driver-sql';
import { RecordChangeTriggerPlugin } from './plugin.js';

/**
 * `registerObject` / `registerHook` / `registerFunction` are concrete-engine
 * seams the `objectql` slot's published contract does not model (the same
 * narrowing `bulk-write-per-row-context.test.ts` in this package makes for
 * `registerObject`), declared structurally so the slot lookup itself stays
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

/** Memory driver with a real `updateMany` (ONE SET clause for N rows). */
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
    // The caller's bound is honoured, applied AFTER the filter and by PRESENCE
    // (`check:objectql-double-limit`): a double that silently ignores `limit`
    // answers a question the engine did not ask.
    async find(o: string, ast: any, opts?: { limit?: number }) {
      // The bound is read by PRESENCE (`limit: 0` must return nothing, not
      // everything) from EITHER position it can arrive in — the engine passes
      // driver options third, the AST-shaped call carries it second.
      const bound = typeof opts?.limit === 'number'
        ? opts.limit
        : typeof ast?.limit === 'number' ? ast.limit : undefined;
      const rows = sel(o, ast);
      const page = typeof bound === 'number' ? rows.slice(0, bound) : rows;
      return page.map((r) => ({ ...r }));
    },
    async findOne(o: string, ast: any) { const [r] = sel(o, ast); return r ? { ...r } : null; },
    async delete(o: string, id: string) { return storeFor(o).delete(id); },
    async count(o: string, ast: any) { return sel(o, ast).length; },
    async upsert(o: string, d: any) { return this.create(o, d); },
    async bulkCreate(o: string, rows: any[]) { return Promise.all(rows.map((r) => this.create(o, r))); },
    async bulkUpdate() { return []; }, async bulkDelete() {},
    async updateMany(o: string, ast: any, data: any) {
      const rows = sel(o, ast);
      // The SET clause is applied to every matched row — deep-copied on the way
      // in so the stored rows do not alias the payload and the assertions below
      // read what was WRITTEN, not what was mutated afterwards.
      const set = JSON.parse(JSON.stringify(data ?? {}));
      for (const r of rows) storeFor(o).set(r.id as string, { ...r, ...set, id: r.id });
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
 * SHALLOW spread, so a flow write shape able to mutate a nested value in place
 * reaches the payload through reference sharing without assigning any
 * top-level key. That is the falsification candidate, and it cannot be tried
 * on a payload of scalars.
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

interface WitnessEntry {
  id: unknown;
  data: Record<string, unknown>;
  payloadRef: unknown;
  tagsRef: unknown;
}

interface Stack {
  data: IDataEngine;
  automation: AutomationEngine;
  objectql: IObjectQLEngine & TestHookSurface;
  /** Per-row snapshots of `ctx.input.data`, taken AFTER the trigger's handler. */
  witness: WitnessEntry[];
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

  // Priority 1000 (`entries.sort((a, b) => a.priority - b.priority)` — lower
  // runs FIRST), so the witness observes the payload after the record-change
  // trigger's handler, and therefore after the flow that handler awaited.
  const witness: WitnessEntry[] = [];
  objectql.registerHook(
    'beforeUpdate',
    (ctx: any) => {
      const payload = ctx.input?.data;
      witness.push({
        id: ctx.input?.id,
        data: JSON.parse(JSON.stringify(payload ?? {})),
        payloadRef: payload,
        tagsRef: payload?.tags,
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
  ], { context: { userId: 'u1' } });
}

/** The ONE predicate write every probe measures. */
async function batchUpdate(
  data: IDataEngine,
  object: string,
  payload: Record<string, unknown>,
): Promise<{ ok: boolean; error?: string }> {
  try {
    await data.update(object, payload, { multi: true, where: {}, context: { userId: 'u1' } });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error)?.message ?? String(err) };
  }
}

const rowsByTitle = async (data: IDataEngine, object: string) => {
  const rows: any[] = await data.find(object, {});
  return new Map<string, any>(rows.map((r) => [r.title, r]));
};

/**
 * A probe flow: [start on record-before-update] → [the shape under test] →
 * [log] → [end]. The `log` node is the flow's own proof of life, and it sits
 * AFTER the probe node, so a probe node that failed its own config takes the
 * audit row with it rather than reporting a silent "does not reach".
 */
function probeFlow(
  name: string,
  object: string,
  probeNode: Record<string, unknown>,
  startExtra: Record<string, unknown> = {},
) {
  return {
    name, label: name, type: 'record_change',
    nodes: [
      {
        id: 'start', type: 'start', label: 'Start',
        config: { objectName: object, triggerType: 'record-before-update', ...startExtra },
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

describe('[#15356] can a record-before-update flow reach a multi:true batch payload?', () => {
  it('⭐ POSITIVE CONTROL: a script beforeUpdate hook assigning the payload lands the LAST dispatch\'s value on EVERY row', async () => {
    const object = 'pc';
    const stack = await bootStack(object);
    await seedTwoRows(stack.data, object);

    // The residue shape: a per-row-VALUE write of the SAME key on every row.
    // The key SET is identical across rows, so #14099's divergence refusal does
    // not fire — that is precisely the blind spot #14744 is weighing.
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
    expect(dispatched.sort(), 'one dispatch per row, on differing pre-images').toEqual(['alpha', 'beta']);

    const rows = await rowsByTitle(stack.data, object);
    const residues = [rows.get('alpha')?.residue, rows.get('beta')?.residue];
    // ⭐ The defect, observed: ONE value — the last dispatch's — on BOTH rows.
    expect(new Set(residues).size, `residues=${JSON.stringify(residues)}`).toBe(1);
    expect(residues[0]).toBe(`from:${dispatched[dispatched.length - 1]}`);
    // Every per-row context carried the SAME payload object (D3).
    expect(new Set(stack.witness.map((w) => w.payloadRef)).size).toBe(1);
    expect(stack.witness[stack.witness.length - 1]?.data.residue).toBe(residues[0]);
  }, 20000);

  it('⭐ #14099 ARMED CONTROL: divergent key sets across rows refuse the batch whole', async () => {
    const object = 'kd';
    const stack = await bootStack(object);
    await seedTwoRows(stack.data, object);
    stack.objectql.registerHook(
      'beforeUpdate',
      (ctx: any) => {
        // Row 'alpha' writes `residue`; row 'beta' writes nothing — divergent
        // key SETS, which is what #14099 refuses.
        if (ctx.previous?.title === 'alpha') ctx.input.data.residue = 'x';
      },
      { object, priority: 10, packageId: 'test:divergent' },
    );

    const wrote = await batchUpdate(stack.data, object, { status: 'done' });
    expect(wrote.ok, 'the refusal must be ARMED in this harness').toBe(false);
    expect(wrote.error).toMatch(/residue/);
    // Refused BEFORE any write: neither row moved.
    const rows = await rowsByTitle(stack.data, object);
    expect(rows.get('alpha')?.status).toBe('todo');
    expect(rows.get('beta')?.status).toBe('blocked');
  }, 20000);

  it('A2.4 — the write-shape vocabulary is READ OFF THE LIVE REGISTRY, not remembered', async () => {
    const stack = await bootStack('vocab');
    const types = ((stack.automation as any).getRegisteredNodeTypes() as string[]).sort();
    // ADR-0018 makes this registry — not a closed enum — the authority on what
    // a node `type` may be, so the shape enumeration is derived from it.
    // eslint-disable-next-line no-console
    console.log('[#15356] registered node types:', JSON.stringify(types));
    // The types with any write sink at all. `start`/`end` are structural
    // (handled with no executor); every other registered type's ONLY variable
    // sink is `variables.set(<name>, value)` — a whole-name write into the run's
    // Map, which cannot address a key inside `record` or the payload.
    expect(types).toContain('assignment');
    expect(types).toContain('script');
    expect(types).toContain('update_record');
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

    const audit: any[] = await stack.data.find(`${object}_audit`, {});
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
      // A dotted name is a variable literally NAMED `record.residue` — the run's
      // variables are a flat `Map`, so this addresses no path inside `record`.
      config: { assignments: { 'record.residue': 'REACHED', 'input.data.residue': 'REACHED' } },
    }) as any);

    const wrote = await batchUpdate(stack.data, object, { status: 'done' });
    expect(wrote).toMatchObject({ ok: true });
    await sleep(200);

    const audit: any[] = await stack.data.find(`${object}_audit`, {});
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

    const audit: any[] = await stack.data.find(`${object}_audit`, {});
    expect(audit.map((r) => r.seen).sort(), 'the flow must have RUN, once per row').toEqual(['alpha', 'beta']);
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
        // What handles does a script function actually get? Recorded, not assumed.
        automationKeys: Object.keys(args.automation ?? {}).sort(),
        argKeys: Object.keys(args ?? {}).sort(),
        sameAsVariable: args.variables?.get('record') === rec,
        previousTitle: (args.automation?.previous as any)?.title,
        // #4862 fact 4, re-checked rather than inherited: `title` is NOT in
        // this write's payload, so a `record` that is the BARE payload could
        // not supply it. A per-row value here says `record` is the row's own
        // state, folded from its pre-image.
        recordTitle: rec?.title,
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
    console.log('[#15356] S4 script function saw:', JSON.stringify(seen));
    expect(seen, 'the script function must have RUN, once per row').toHaveLength(2);
    // #4862 re-check on today's tree: `previous` IS bound, and it is THIS row's
    // pre-image — the two rows started in different states and each run saw its own.
    expect(seen.map((s) => s.previousTitle).sort()).toEqual(['alpha', 'beta']);
    // #4862 fact 4, re-checked: `record` is NOT the bare payload — it carries
    // this row's own `title`, a field this write never mentioned.
    expect(seen.map((s) => s.recordTitle).sort()).toEqual(['alpha', 'beta']);
    // The `record` CEL root and the flow's `record` variable are ONE object.
    expect(seen.every((s) => s.sameAsVariable === true)).toBe(true);
    // The function is handed no payload handle at all: `AutomationContext`
    // declares no `input`/`data` member, and the arg bag carries only these four.
    expect(seen[0]?.argKeys).toEqual(['automation', 'input', 'logger', 'variables']);
    expect(seen[0]?.automationKeys as string[]).not.toContain('input');

    const rows = await rowsByTitle(stack.data, object);
    expect(rows.get('alpha')?.residue ?? null).toBeNull();
    expect(rows.get('beta')?.residue ?? null).toBeNull();
    expect(stack.witness.every((w) => !('residue' in w.data))).toBe(true);
  }, 20000);

  /**
   * ⭐ S5 — THE PIN. This case was written on 2026-09-04 as a CHARACTERISATION
   * of the defect (the nested in-place mutation REACHED the payload, and both
   * rows carried both dispatches' contributions). #14744 closed the door on the
   * same day by decoupling the flow-facing roots from the engine's own objects
   * (`decoupleFromEngineState`, called at the end of `buildContext`), and the
   * case was flipped in the same PR — the assertions below are the OPPOSITE of
   * what they were, not a weakened version of them.
   *
   * ⚠️ A red here now means the door was RE-OPENED: some overlay on the way to
   * the flow started sharing a nested reference with `ctx.input.data` again.
   * The repair is at that overlay, ⛔ never in this file.
   */
  it('S5 ⭐ script node mutating a NESTED payload value IN PLACE — CANNOT reach the batch payload', async () => {
    const object = 's5';
    const stack = await bootStack(object);
    const observed: Array<Record<string, unknown>> = [];
    const flowSideRefs: unknown[] = [];
    stack.objectql.registerFunction('mutate_nested', async (args: any) => {
      const rec = args.automation?.record as Record<string, unknown>;
      const tags = rec?.tags;
      flowSideRefs.push(tags);
      observed.push({
        tagsIsArray: Array.isArray(tags),
        tagsAsSeen: JSON.stringify(tags ?? null),
        previousTitle: (args.automation?.previous as any)?.title,
      });
      // An in-place mutation of a NESTED value. No top-level key is assigned,
      // so the #14088 payload-write recorder — which observes `set` traps on
      // the payload object — records nothing.
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

    expect(observed, 'the script function must have RUN, once per row').toHaveLength(2);
    // Row 2 does NOT see row 1's mutation: each dispatch is handed its own copy
    // of the nested value, so neither run can observe the other's write. Before
    // #14744 the second reading was `["seed","REACHED-alpha"]`.
    expect(observed[0]?.tagsAsSeen).toBe('["seed"]');
    expect(observed[1]?.tagsAsSeen).toBe('["seed"]');
    // Reference identity, measured across the same boundary the defect was
    // measured on: the array the flow mutated is NOT the array on
    // `ctx.input.data`, and the two rows did not even share it with each other.
    expect(stack.witness.length).toBe(2);
    expect(flowSideRefs[0]).not.toBe(stack.witness[0]?.tagsRef);
    expect(flowSideRefs[1]).not.toBe(stack.witness[1]?.tagsRef);
    expect(flowSideRefs[0]).not.toBe(flowSideRefs[1]);
    // ⭐ D3 is UNCHANGED and still the reason this matters: every per-row
    // context is handed the ONE batch payload object. The fix is the copy on the
    // way to the flow, not a split of the engine's write.
    expect(new Set(stack.witness.map((w) => w.payloadRef)).size).toBe(1);
    // Read directly off the payload, after both flows have run: untouched.
    expect(stack.witness.every((w) => JSON.stringify(w.data.tags) === '["seed"]')).toBe(true);

    // ⭐ The persisted rows: the SET clause carries what the CALLER wrote, and
    // no row carries a value derived from the other row's pre-image. Before
    // #14744 both rows read `['seed','REACHED-alpha','REACHED-beta']`.
    expect(wrote, 'and the write still succeeds — this is not a refusal').toMatchObject({ ok: true });
    const rows = await rowsByTitle(stack.data, object);
    expect(rows.get('alpha')?.tags).toEqual(['seed']);
    expect(rows.get('beta')?.tags).toEqual(['seed']);
  }, 20000);

  it('S5b the same nested mutation on a BY-ID update reaches nothing either — the fix is not multi-specific', async () => {
    const object = 's5b';
    const stack = await bootStack(object);
    stack.objectql.registerFunction('mutate_nested_single', async (args: any) => {
      const tags = (args.automation?.record as any)?.tags;
      if (Array.isArray(tags)) tags.push('REACHED');
      return { ok: true };
    });
    await seedTwoRows(stack.data, object);
    stack.automation.registerFlow('s5b_flow', probeFlow('s5b_flow', object, {
      id: 'probe', type: 'script', label: 'Script',
      config: { function: 'mutate_nested_single', inputs: {} },
    }) as any);

    const before = await rowsByTitle(stack.data, object);
    await stack.data.update(
      object,
      { id: before.get('alpha')?.id, status: 'done', tags: ['seed'] } as any,
      { context: { userId: 'u1' } },
    );
    await sleep(200);

    const rows = await rowsByTitle(stack.data, object);
    // ⚠️ THE BREAKING HALF, pinned deliberately. The aliasing was never
    // multi-specific: on a by-id write the same in-place mutation reached this
    // write's own payload and PERSISTED correctly (`['seed','REACHED']` before
    // #14744), so it read as a working per-row write path rather than as
    // corruption. It is the same alias, so closing the door closes it here too,
    // and a stack author using it loses a write that used to land. That is why
    // the changeset carries a BREAKING banner: the alternative is `update_record`
    // (S6), which is a real write and lands per row.
    expect(rows.get('alpha')?.tags).toEqual(['seed']);
    expect(rows.get('beta')?.tags ?? null).toBeNull();
    expect(rows.get('beta')?.status).toBe('blocked');
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
    expect(wrote).toMatchObject({ ok: true });
    await sleep(400);

    const rows = await rowsByTitle(stack.data, object);
    // PER-ROW values, so this did NOT travel through the shared batch payload —
    // it is the node's own by-id write, aimed at the row the flow ran for.
    expect(rows.get('alpha')?.residue).toBe('REACHED-alpha');
    expect(rows.get('beta')?.residue).toBe('REACHED-beta');
    // And the batch payload the witness saw never carried `residue`.
    const batchWitness = stack.witness.filter((w) => 'status' in w.data);
    expect(batchWitness.length).toBeGreaterThan(0);
    expect(batchWitness.every((w) => !('residue' in w.data))).toBe(true);
  }, 20000);

  it('S7 update_record forwarding `{record.tags}` into ANOTHER write — does NOT mutate the batch payload', async () => {
    const object = 's7';
    const stack = await bootStack(object);
    await seedTwoRows(stack.data, object);
    stack.automation.registerFlow('s7_flow', probeFlow('s7_flow', object, {
      id: 'probe', type: 'update_record', label: 'Update',
      config: {
        objectName: object,
        filter: { id: '{record.id}' },
        // The object token resolves to the array itself; the question is
        // whether the second write's own passes mutate the shared array.
        fields: { tags: '{record.tags}', residue: 'copied' },
      },
    }) as any);

    const wrote = await batchUpdate(stack.data, object, { status: 'done', tags: ['seed'] });
    expect(wrote).toMatchObject({ ok: true });
    await sleep(400);

    const batchWitness = stack.witness.filter((w) => 'status' in w.data);
    expect(batchWitness.length).toBeGreaterThan(0);
    // The batch payload's array is untouched by the forwarded copy.
    expect(batchWitness.every((w) => JSON.stringify(w.data.tags) === '["seed"]')).toBe(true);
    const rows = await rowsByTitle(stack.data, object);
    expect(rows.get('alpha')?.tags).toEqual(['seed']);
    expect(rows.get('beta')?.tags).toEqual(['seed']);
  }, 20000);

  /**
   * ⭐ [#14744] THE CONTROL ON THE FIX'S SHAPE — why a COPY and not a FREEZE.
   *
   * The ruling named deep-copy and freeze as alternatives. They are not
   * equivalent, and this case is the measurement that chose between them:
   * `service-automation`'s `expandDeclaredLookups` (#3475) writes
   * `record[field] = expanded` INTO the context `buildContext` returns — its own
   * docblock says "Mutates `record` in place (the same object the run's variable
   * map already references)" — and `AutomationServicePlugin` bridges that
   * expander in every deployment that has objectql.
   *
   * Under a deep FREEZE that assignment throws, `expandDeclaredLookups`'
   * best-effort `catch` swallows it, and every flow declaring `config.expand`
   * silently degrades to unexpanded scalar ids while logging "could not expand
   * lookups". Measured: with the freeze variant in `buildContext` this case goes
   * RED and the copy keeps it green. That is a shipped feature, so freeze was
   * not available and the copy is not a preference.
   *
   * ⚠️ A red here means the flow-facing `record` stopped accepting the ONE
   * in-place write the platform itself performs on it.
   */
  it('#14744 — a flow declaring `config.expand` still gets its lookup grafted onto the copy', async () => {
    const object = 'exp';
    const stack = await bootStack(object);
    const seen: unknown[] = [];
    // Stand in for the plugin-bridged expander (whose own wiring and identity
    // scoping are pinned by service-automation's `record-lookup-expand`
    // integration test); what is under test here is whether its in-place graft
    // lands on the object the flow is handed.
    stack.automation.setRecordExpander(async () => ({ owner: { id: 'u9', name: 'Owner Nine' } }));
    stack.objectql.registerFunction('read_expanded', async (args: any) => {
      seen.push((args.automation?.record as Record<string, unknown>)?.owner);
      return { ok: true };
    });
    await seedTwoRows(stack.data, object);
    stack.automation.registerFlow('exp_flow', probeFlow('exp_flow', object, {
      id: 'probe', type: 'script', label: 'Script',
      config: { function: 'read_expanded', inputs: {} },
    }, { expand: ['owner'] }) as any);

    const wrote = await batchUpdate(stack.data, object, { status: 'done' });
    expect(wrote).toMatchObject({ ok: true });
    await sleep(200);

    expect(seen, 'the script function must have RUN, once per row').toHaveLength(2);
    expect(seen[0], 'the expansion must have landed on the record the flow holds').toEqual({
      id: 'u9', name: 'Owner Nine',
    });
    expect(seen[1]).toEqual({ id: 'u9', name: 'Owner Nine' });
    // ...and grafting it still reached nothing: `owner` is not in the payload.
    expect(stack.witness.every((w) => !('owner' in w.data))).toBe(true);
  }, 20000);
});

/**
 * [#15356 measured it, #14744 closed it] S5 again, on the REAL SQL backend —
 * `@objectstack/driver-sql` over better-sqlite3 `:memory:`, built the canonical
 * way this package's `record-change-integration.test.ts` boots it.
 *
 * The reach was proven above by reference identity measured across the
 * boundary, which no driver can affect; what only a real driver could settle
 * was the CONSEQUENCE the card names — one SET clause, issued once, so the
 * accumulated mutation landed on EVERY matched row of a real `UPDATE`. That is
 * why the same probe is repeated here rather than trusted from the memory
 * double, and it is why it stays here after the fix: a copy that held on the
 * memory driver and not on a real `UPDATE` would be the same defect with a
 * narrower audience.
 */
describe('[#15356/#14744] S5 on the real SQL driver — the mutation reaches no row of a real UPDATE', () => {
  it('a flow script mutating `record.tags` in place leaves both rows carrying the caller\'s value', async () => {
    const kernel = new ObjectKernel({ logger: { level: 'silent' } });
    await kernel.use(new ObjectQLPlugin());
    await kernel.use(new AutomationServicePlugin());
    await kernel.use(new RecordChangeTriggerPlugin());
    await kernel.bootstrap();

    const objectql = kernel.getService<IObjectQLEngine>('objectql') as IObjectQLEngine & TestHookSurface & {
      syncSchemas(): Promise<void>;
    };
    const data = kernel.getService<IDataEngine>('data');
    const automation = kernel.getService<AutomationEngine>('automation');

    const driver: any = new SqlDriver({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    await driver.connect();
    objectql.registerDriver(driver, true);
    registerObjects(objectql.registry as unknown as TestObjectRegistry, 'sq');
    await objectql.syncSchemas();

    objectql.registerFunction('sq_mutate_nested', async (args: any) => {
      const tags = (args.automation?.record as any)?.tags;
      if (Array.isArray(tags)) tags.push(`REACHED-${(args.automation?.previous as any)?.title}`);
      return { ok: true };
    });
    automation.registerFlow('sq_flow', probeFlow('sq_flow', 'sq', {
      id: 'probe', type: 'script', label: 'Script',
      config: { function: 'sq_mutate_nested', inputs: {} },
    }) as any);

    await seedTwoRows(data, 'sq');
    const wrote = await batchUpdate(data, 'sq', { status: 'done', tags: ['seed'] });
    await sleep(300);

    const audit: any[] = await data.find('sq_audit', {});
    expect(audit.map((r) => r.seen).sort(), 'the flow must have RUN, once per row').toEqual(['alpha', 'beta']);
    expect(wrote, 'and #14099 did NOT refuse it').toMatchObject({ ok: true });

    const rows = await rowsByTitle(data, 'sq');
    // eslint-disable-next-line no-console
    console.log('[#15356] SQL rows:', JSON.stringify([...rows.values()].map((r) => ({ title: r.title, tags: r.tags }))));
    const alpha = rows.get('alpha')?.tags;
    const beta = rows.get('beta')?.tags;
    // Before #14744 both read `['seed','REACHED-alpha','REACHED-beta']` — one
    // SET clause carrying both dispatches, including the value derived from the
    // other row's pre-image.
    expect(alpha).toEqual(['seed']);
    expect(beta).toEqual(['seed']);

    await driver.disconnect?.();
  }, 25000);
});
