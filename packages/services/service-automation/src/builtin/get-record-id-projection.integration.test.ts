// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A `get_record` node answers `output: { record, id, object }` on its
 * single-row (`findOne`) branch, and a later node reads that `id` as
 * `{<node>.id}`. The `id` must be the row's id whatever the author's `fields`
 * projection names.
 *
 * The SQL drivers return exactly the columns a projection names. The node used
 * to hand the author's `fields` to the engine unchanged, so a projection
 * without `id` read the row with no `id` column: `output.id` was `undefined`,
 * and a downstream `update_record` filtering on `{read.id}` was refused for an
 * empty template. The node now names `id` in the projection it hands the
 * engine on that branch, and only there:
 *  - a projection that already names `id` is handed over as written (no
 *    second `id`);
 *  - no projection, or an empty one, stays a whole-row read (no projection is
 *    invented);
 *  - the `find` branch (`limit > 1`) declares no top-level `id` and is not
 *    touched.
 *
 * `record` carries the `id` the engine returned, so `{rec.id}` through the
 * node's `outputVariable` agrees with `{read.id}`; the row's other unnamed
 * columns stay out.
 *
 * Composition: the real stack the other `*.integration.test.ts` files in this
 * package boot: `ObjectKernel`, `ObjectQLPlugin`, `driver-sql` on
 * better-sqlite3 `:memory:`, and the real `AutomationServicePlugin` for the
 * flow-level case. The node-level cases run the registered `get_record`
 * executor itself over the same engine, behind a recorder that keeps the
 * projection each read handed it.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import { ObjectQLPlugin, type ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { AutomationServicePlugin } from '../plugin.js';
import { AutomationEngine } from '../engine.js';
import { registerCrudNodes } from './crud-nodes.js';

const SYS = { isSystem: true } as const;

const OBJECT = {
  name: 'pin_get_record_id',
  label: 'Pin get_record id',
  fields: {
    title: { name: 'title', label: 'Title', type: 'text' },
    status: { name: 'status', label: 'Status', type: 'text' },
  },
};

function makeLogger(): any {
  const l: any = { info() {}, warn() {}, error() {}, debug() {}, trace() {}, fatal() {} };
  l.child = () => l;
  return l;
}

type Executor = { execute: (node: any, variables: Map<string, unknown>, context: any) => Promise<any> };

describe('get_record answers the row id as output.id whatever its fields projection names', () => {
  let kernel: ObjectKernel;
  let ql: ObjectQL;
  let automation: AutomationEngine;
  let rowId: string;
  /** The projection each engine read was handed, in order. */
  const handed: Array<{ method: string; fields: unknown }> = [];
  let getRecord: Executor;

  beforeAll(async () => {
    kernel = new ObjectKernel({ logger: { level: 'fatal' } });
    await kernel.use(new ObjectQLPlugin());
    await kernel.use(new AutomationServicePlugin({ suspendedRunStore: 'memory' }));
    await kernel.bootstrap();
    ql = kernel.getService<ObjectQL>('objectql');
    automation = kernel.getService<AutomationEngine>('automation');

    const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
    await driver.connect();
    ql.registerDriver(driver, true);
    ql.registry.registerObject(OBJECT as any, 'pin-get-record-id', 'pin-get-record-id');
    await ql.syncSchemas();

    const row: any = await ql.insert(OBJECT.name, { title: 'alpha', status: 'open' }, { context: SYS });
    rowId = row.id;
    expect(typeof rowId, 'control: the engine assigned the row an id').toBe('string');

    // The executor itself, over the same engine: a recorder in front of the
    // engine keeps the projection each read was handed.
    const recorder = new Proxy(ql as any, {
      get(target, key) {
        const value = Reflect.get(target, key, target);
        if (key === 'findOne' || key === 'find') {
          return (object: string, query: any) => {
            handed.push({ method: key, fields: Array.isArray(query?.fields) ? [...query.fields] : query?.fields });
            return value.call(target, object, query);
          };
        }
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    const executors = new Map<string, Executor>();
    const capture = new Proxy(new AutomationEngine(makeLogger()), {
      get(target, key, receiver) {
        if (key === 'registerNodeExecutor') return (e: any) => { executors.set(e.type, e); };
        return Reflect.get(target, key, receiver);
      },
    });
    registerCrudNodes(capture as AutomationEngine, { logger: makeLogger(), getService: (n: string) => (n === 'data' ? recorder : undefined) } as any);
    getRecord = executors.get('get_record')!;
    expect(getRecord, 'control: the get_record executor was registered').toBeDefined();
  }, 60_000);

  afterAll(async () => {
    try { await kernel?.shutdown(); } catch { /* best-effort teardown */ }
  });

  /** Run the node once and return its result and the projection the engine was handed. */
  async function readOne(config: Record<string, unknown>): Promise<{ result: any; fields: unknown }> {
    handed.length = 0;
    const result = await getRecord.execute(
      { id: 'read', type: 'get_record', config: { objectName: OBJECT.name, filter: { title: 'alpha' }, ...config } },
      new Map(),
      { runAs: 'system', flowName: 'pin_get_record_id' },
    );
    expect(result.success, `the read failed: ${JSON.stringify(result)}`).toBe(true);
    expect(handed, 'the node reads through findOne exactly once').toHaveLength(1);
    expect(handed[0].method).toBe('findOne');
    return { result, fields: handed[0].fields };
  }

  it('control: the SQL driver returns exactly the columns a projection names, so a projection without id reads no id', async () => {
    const direct: any = await ql.findOne(OBJECT.name, { where: { title: 'alpha' }, fields: ['title'], context: SYS });
    expect(direct).toEqual({ title: 'alpha' });
  });

  it('fields that omit id: output.id is the row id, and record carries it beside the named columns', async () => {
    const { result, fields } = await readOne({ fields: ['title'] });
    expect(result.output.id).toBe(rowId);
    expect(result.output.record).toEqual({ id: rowId, title: 'alpha' });
    expect(fields).toEqual(['title', 'id']);
  });

  it('fields that name id: handed to the engine as written, with id once', async () => {
    const { result, fields } = await readOne({ fields: ['id', 'title'] });
    expect(fields).toEqual(['id', 'title']);
    expect(result.output.id).toBe(rowId);
    expect(result.output.record).toEqual({ id: rowId, title: 'alpha' });
  });

  for (const [label, config] of [['no fields', {}], ['empty fields', { fields: [] }]] as const) {
    it(`control, ${label}: the whole row is read and the output is the engine's own answer`, async () => {
      const whole: any = await ql.findOne(OBJECT.name, { where: { title: 'alpha' }, context: SYS });
      expect(whole.status, 'control: a whole-row read carries the unnamed columns').toBe('open');
      const { result, fields } = await readOne(config);
      expect(fields, 'no projection is invented').toEqual((config as { fields?: unknown }).fields);
      expect(result.output).toEqual({ record: whole, id: rowId, object: OBJECT.name });
    });
  }

  it('a downstream update_record filtering on {read.id} updates the row the narrowed get_record read', async () => {
    await ql.insert(OBJECT.name, { title: 'beta', status: 'open' }, { context: SYS });
    const def = {
      name: 'pin_get_record_id_flow', label: 'pin_get_record_id_flow', type: 'autolaunched', runAs: 'system',
      variables: [{ name: 'rec', type: 'object', isOutput: true }],
      nodes: [
        { id: 'start', type: 'start', label: 'Start' },
        { id: 'read', type: 'get_record', label: 'Read', config: { objectName: OBJECT.name, filter: { title: 'beta' }, fields: ['title'], outputVariable: 'rec' } },
        { id: 'close', type: 'update_record', label: 'Close', config: { objectName: OBJECT.name, filter: { id: '{read.id}' }, fields: { status: 'closed' } } },
        { id: 'end', type: 'end', label: 'End' },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'read' },
        { id: 'e2', source: 'read', target: 'close' },
        { id: 'e3', source: 'close', target: 'end' },
      ],
    };
    automation.registerFlow(def.name, def as any);
    const res: any = await automation.execute(def.name, {});
    expect(res.success, `run failed: ${JSON.stringify(res.error ?? res)}`).toBe(true);
    const beta: any = await ql.findOne(OBJECT.name, { where: { title: 'beta' }, context: SYS });
    expect(beta.status).toBe('closed');
    expect(res.output.rec).toEqual({ id: beta.id, title: 'beta' });
    const alpha: any = await ql.findOne(OBJECT.name, { where: { title: 'alpha' }, context: SYS });
    expect(alpha.status, 'the update reached only the row the node read').toBe('open');
  });
});
