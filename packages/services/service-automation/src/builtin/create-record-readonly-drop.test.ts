// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #14147 — `create_record`'s `onFieldsDropped` channel, driven END TO END
 * against a real ObjectQL engine.
 *
 * The card's second finding: `create_record` passes `onFieldsDropped` to
 * `data.insert` and surfaces the result as `output.droppedFields` + node
 * `warnings` (#3407, symmetric with `update_record`) — but the engine's insert
 * path ran no readonly strip, so that channel could never carry a readonly
 * drop. A flow without `runAs: 'system'` could set a `readonly` column at
 * insert and the run reported a clean success over a write that did not happen
 * the way the author wrote it.
 *
 * The maintainer ruling of 2026-09-03 (option C) closed the strip half; this
 * file is the proof that the SIGNAL half arrives with it. ⛔ A unit test on the
 * strip alone does not demonstrate the channel — the stub-engine pins in
 * `crud-dropped-fields.test.ts` prove the node forwards an event it is GIVEN,
 * which is exactly what stayed green for the entire life of the defect. So the
 * `data` service here is a real `ObjectQL` over a recording driver, and the
 * assertions are on what a FLOW RUN reports.
 */
import { describe, it, expect } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { AutomationEngine } from '../engine.js';
import { registerCrudNodes } from './crud-nodes.js';

function makeLogger(): any {
  const l: any = { info() {}, warn() {}, error() {}, debug() {}, trace() {}, fatal() {} };
  l.child = () => l;
  return l;
}

/** Records what actually reaches the store — the row is the verdict. */
function makeRecordingDriver() {
  const creates: Array<Record<string, unknown>> = [];
  const driver: any = {
    name: 'recording', version: '0.0.0', supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
    async find() { return []; },
    async findOne() { return null; },
    async create(_o: string, data: Record<string, unknown>) {
      creates.push({ ...data });
      return { id: 'rec_1', ...data };
    },
    async update(_o: string, id: string, data: Record<string, unknown>) { return { id, ...data }; },
    async updateMany() { return 0; },
    async delete() { return true; },
    async deleteMany() { return 0; },
    async count() { return 0; },
    async bulkCreate(o: string, rows: Record<string, unknown>[]) {
      return Promise.all(rows.map((r) => driver.create(o, r)));
    },
    async bulkUpdate() { return []; }, async bulkDelete() {},
    async beginTransaction() { return { __trx: true, commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
  };
  return { driver, creates };
}

/** A real data engine, registered as the `data` service the CRUD nodes resolve. */
async function makeStack() {
  const logger = makeLogger();
  const engine = new ObjectQL({ logger });
  const { driver, creates } = makeRecordingDriver();
  engine.registerDriver(driver, true);
  await engine.init();
  engine.registry.registerObject({
    name: 'duly_task',
    fields: {
      id: { name: 'id', type: 'text', primaryKey: true },
      title: { name: 'title', type: 'text' },
      // The application-reported column: author-declared, statically readonly.
      completed_at: { name: 'completed_at', type: 'datetime', readonly: true },
    },
  } as any, 'test');

  const automation = new AutomationEngine(logger);
  registerCrudNodes(automation, {
    logger,
    getService: (n: string) => (n === 'data' ? engine : undefined),
  } as any);
  return { automation, engine, creates };
}

function seedFlow(name: string, runAs?: 'system' | 'user') {
  return {
    name, label: name, type: 'autolaunched',
    ...(runAs ? { runAs } : {}),
    nodes: [
      { id: 'start', type: 'start', label: 'Start' },
      {
        id: 'mk', type: 'create_record', label: 'Create',
        config: {
          objectName: 'duly_task',
          fields: { title: 'T', completed_at: '2019-04-01T00:00:00Z' },
          outputVariable: 'made',
        },
      },
      { id: 'end', type: 'end', label: 'End' },
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'mk' },
      { id: 'e2', source: 'mk', target: 'end' },
    ],
  } as any;
}

describe('#14147 — a NON-system create_record now receives the readonly drop', () => {
  it('the column does not land, and the run says so — a node warning naming the field', async () => {
    const { automation, creates } = await makeStack();
    automation.registerFlow('seed', seedFlow('seed'));
    const res = await automation.execute('seed', { userId: 'u1' });
    expect(res.success, 'a strip is legal semantics, not a failure').toBe(true);

    // 1. The write happened, and it happened WITHOUT the forged column.
    expect(creates).toHaveLength(1);
    expect(creates[0], 'a non-system flow may not seed a readonly column').not.toHaveProperty('completed_at');
    expect(creates[0].title).toBe('T');

    // 2. ...and the RUN reports it — the half that could never fire before.
    const runs = await automation.listRuns('seed');
    const step = runs[0].steps.find((s: any) => s.nodeId === 'mk')!;
    expect(step.status).toBe('success');
    expect(step.warnings, 'the channel #3407 wired and #14147 filled').toHaveLength(1);
    expect(step.warnings![0]).toContain('create_record(duly_task)');
    expect(step.warnings![0]).toContain('completed_at');
  });

  it('runAs:system still seeds it, with no drop and no warning — the intended channel', async () => {
    const { automation, creates } = await makeStack();
    automation.registerFlow('seed_sys', seedFlow('seed_sys', 'system'));
    const res = await automation.execute('seed_sys', { userId: 'u1' });
    expect(res.success).toBe(true);

    expect(creates[0].completed_at, 'seeding a readonly column at create time is a SYSTEM act')
      .toBe('2019-04-01T00:00:00Z');
    const runs = await automation.listRuns('seed_sys');
    const step = runs[0].steps.find((s: any) => s.nodeId === 'mk')!;
    expect(step.warnings, 'no warning is manufactured for a write that landed').toBeUndefined();
  });
});
