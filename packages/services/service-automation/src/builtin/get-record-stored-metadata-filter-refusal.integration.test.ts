// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21623] A flow's `get_record` node does not EVALUATE the stored-metadata-body
 * family (`sys_metadata` / `sys_metadata_history`): a filter that reads the
 * stored body column or a stored content-hash column is refused before the
 * engine read runs, with the generic data door's own refusal and code.
 *
 * #21519 closed the node's serve and copy exits (the body projected, the hash
 * keyed). This closes the evaluate exit: the served row is projected, but
 * whether a row comes back answers the filter, so a filter over the body or a
 * hash is a predicate oracle. Each refused case is run twice, with a filter
 * that matches the stored row and with one that does not, and both answers
 * must be the same refusal: the answer may not depend on the stored value.
 *
 * What a refused case pins, under BOTH run identities (`runAs: 'system'`,
 * which reads elevated, and `runAs: 'user'`) and on both node branches (one
 * row through `findOne`; a row list through `find`, `limit > 1`):
 *  - the run fails (`status: 'failed'`) and declares no output;
 *  - the engine read of the family table never runs;
 *  - nothing downstream runs: the record the flow would write is absent;
 *  - the failure carries the data door's code for the same filter, judged
 *    against the door's own answer (the control), as a flow reads it on
 *    `{$error.code}` inside a `try_catch` catch region;
 *  - the failure is a guard failure: a `fault` edge on the node does not
 *    route it.
 *
 * The filter the node judges is the INTERPOLATED one, the filter the engine
 * would run: a `{token}` that resolves to a whole condition list is refused
 * when the resolved list reads the body.
 *
 * Controls: the data door refuses the same filters; a scalar-column filter on
 * a family table is served projected, as #21519 serves it; and an ordinary
 * object whose columns share the family's column names is filtered and served
 * exactly as stored.
 *
 * Composition: the real stack `get-record-stored-metadata-family.integration.test.ts`
 * boots (`ObjectKernel`, `ObjectQLPlugin`, `driver-sql` on better-sqlite3
 * `:memory:`, the real `AutomationServicePlugin`). The credential is a
 * synthetic sentinel in a credential slot the datasource redactor withholds.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import { ObjectQLPlugin, type ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { hashSpec } from '@objectstack/metadata-core';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { AutomationServicePlugin } from '../plugin.js';
import type { AutomationEngine, NodeExecutor } from '../engine.js';

const SYS = { isSystem: true } as const;
const KEYED = /^hmac-sha256:[0-9a-f]{64}$/;
const FAMILY = ['sys_metadata', 'sys_metadata_history'] as const;

/** The synthetic credential, in the slot the datasource redactor withholds (turso's `encryptionKey`). */
const SENTINEL = 'flow-filter-refusal-sentinel-91f3';
const DS_NAME = 'pin_filter_ds';
const DS_URL = 'libsql://pin-filter.example.invalid';
const DS_BODY = { name: DS_NAME, label: 'Pin filter DS', driver: 'turso', config: { url: DS_URL, encryptionKey: SENTINEL } };
const STORED_HASH = hashSpec(DS_BODY);
/** A well-formed hash that is not the stored one. */
const OTHER_HASH = hashSpec({ ...DS_BODY, label: 'another body' });

/** An ordinary object a flow would copy what it read into, and the non-family control. */
const COPY_OBJECT = {
  name: 'pin_filter_copy',
  label: 'Pin filter copy',
  fields: {
    title: { name: 'title', label: 'Title', type: 'text' },
    metadata: { name: 'metadata', label: 'Metadata', type: 'textarea' },
    checksum: { name: 'checksum', label: 'Checksum', type: 'text' },
  },
};

type RunAs = 'system' | 'user';
type Branch = 'one' | 'list';
type Filter = Record<string, unknown>;

/**
 * Each refused filter shape, as a pair: `match` is satisfied by the stored row,
 * `miss` is not. Before the fix the node answered the row for `match` and none
 * for `miss`: the oracle these cases close.
 */
const REFUSED_SHAPES: ReadonlyArray<{ label: string; object: string; match: Filter; miss: Filter }> = [
  {
    label: 'a body-column filter',
    object: 'sys_metadata',
    match: { metadata: { $contains: SENTINEL.slice(0, 12) } },
    miss: { metadata: { $contains: 'no-such-credential-prefix' } },
  },
  {
    label: 'a hash-column filter',
    object: 'sys_metadata',
    match: { checksum: STORED_HASH },
    miss: { checksum: OTHER_HASH },
  },
];

/** The trigger a user-identity run needs: a real acting user. */
const TRIGGER = { userId: 'usr_flow_filter', tenantId: 'org_1', positions: [] as string[], permissions: [] as string[] };

/**
 * start → get_record(object, filter) → create_record(copy) → end. `one` reads
 * through `findOne` (no limit); `list` through `find` (`limit > 1`).
 */
function readThenCopyFlow(name: string, object: string, runAs: RunAs, branch: Branch, filter: Filter) {
  return {
    name,
    label: name,
    type: 'autolaunched',
    runAs,
    variables: [{ name: 'rec', type: 'object', isOutput: true }],
    nodes: [
      { id: 'start', type: 'start', label: 'Start' },
      {
        id: 'read',
        type: 'get_record',
        label: 'Read',
        config: { objectName: object, filter, outputVariable: 'rec', ...(branch === 'list' ? { limit: 5 } : {}) },
      },
      { id: 'copy', type: 'create_record', label: 'Copy', config: { objectName: COPY_OBJECT.name, fields: { title: name } } },
      { id: 'end', type: 'end', label: 'End' },
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'read' },
      { id: 'e2', source: 'read', target: 'copy' },
      { id: 'e3', source: 'copy', target: 'end' },
    ],
  };
}

describe("flow get_record refuses a filter that evaluates the stored-metadata family, with the data door's refusal (#21623)", () => {
  let kernel: ObjectKernel;
  let ql: ObjectQL;
  let automation: AutomationEngine;
  let door: ObjectStackProtocolImplementation;
  let seq = 0;
  /** What the capture node saw on `$error` and on the `try_catch`'s error variable. */
  const captured: Array<{ error?: { code?: string }; caught?: { code?: string } }> = [];

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
    ql.registry.registerObject(COPY_OBJECT as any, 'pin-21623', 'pin-21623');
    await ql.syncSchemas();

    const metadata = JSON.stringify(DS_BODY);
    await ql.insert('sys_metadata', {
      id: 'meta_pin_filter_ds', name: DS_NAME, type: 'datasource', scope: 'platform', state: 'active',
      metadata, checksum: STORED_HASH,
    }, { context: SYS });
    await ql.insert('sys_metadata_history', {
      id: 'hist_pin_filter_ds', name: DS_NAME, type: 'datasource', version: 2, operation_type: 'update',
      metadata, checksum: STORED_HASH, previous_checksum: OTHER_HASH,
    }, { context: SYS });

    automation.registerNodeExecutor({
      type: 'pin_capture_error',
      async execute(_node, variables) {
        captured.push({
          error: variables.get('$error') as { code?: string } | undefined,
          caught: variables.get('caught') as { code?: string } | undefined,
        });
        return { success: true };
      },
    } as NodeExecutor);

    door = new ObjectStackProtocolImplementation(ql as any);
  }, 60_000);

  afterAll(async () => {
    try { await kernel?.shutdown(); } catch { /* best-effort teardown */ }
  });

  /** The data door's answer to the same filter: the control each refusal is judged against. */
  async function doorRefusal(object: string, filter: Filter): Promise<{ code: string; status: number }> {
    let thrown: any;
    try {
      await door.findData({ object, query: { where: filter } });
    } catch (err) {
      thrown = err;
    }
    expect(thrown, `control: the data door must refuse this filter on ${object}`).toBeDefined();
    return { code: thrown.code, status: thrown.status };
  }

  /**
   * Run `def` with the engine's reads watched. Returns the run result, the
   * family-table reads the engine received while it ran, and whether the
   * flow's downstream copy landed.
   */
  async function runWatched(def: { name: string }, context: Record<string, unknown> = {}) {
    automation.registerFlow(def.name, def as any);
    const find = vi.spyOn(ql, 'find');
    const findOne = vi.spyOn(ql, 'findOne');
    let res: any;
    let familyReads = 0;
    try {
      res = await automation.execute(def.name, { ...TRIGGER, ...context });
      familyReads = [...find.mock.calls, ...findOne.mock.calls]
        .filter(([object]) => (FAMILY as readonly string[]).includes(object as string)).length;
    } finally {
      find.mockRestore();
      findOne.mockRestore();
    }
    const copy = await ql.findOne(COPY_OBJECT.name, { where: { title: def.name }, context: SYS });
    return { res, familyReads, copy };
  }

  /** Every refused run: failed, no output, no engine read, nothing downstream. */
  function expectRefusedRun(run: Awaited<ReturnType<typeof runWatched>>, where: string) {
    expect(run.res.success, `${where}: the run must fail`).toBe(false);
    expect(run.res.status, `${where}: the run's status`).toBe('failed');
    expect(run.res.output?.rec, `${where}: the run declared an output`).toBeUndefined();
    expect(run.familyReads, `${where}: the engine read of the family table ran`).toBe(0);
    expect(run.copy, `${where}: the node downstream of the refusal ran`).toBeFalsy();
  }

  /**
   * The code the flow is handed for the refused node, read where a flow reads
   * it: `{$error.code}` inside a `try_catch` catch region, and the region's
   * own error variable.
   */
  async function refusalCodeAsAFlowReadsIt(object: string, runAs: RunAs, filter: Filter): Promise<{ error?: string; caught?: string }> {
    const name = `refusal_code_${seq++}`;
    captured.length = 0;
    automation.registerFlow(name, {
      name, label: name, type: 'autolaunched', runAs,
      nodes: [
        { id: 'start', type: 'start', label: 'Start' },
        {
          id: 'guarded', type: 'try_catch', label: 'Guarded read',
          config: {
            errorVariable: 'caught',
            try: { nodes: [{ id: 'read', type: 'get_record', label: 'Read', config: { objectName: object, filter, outputVariable: 'rec' } }], edges: [] },
            catch: { nodes: [{ id: 'capture', type: 'pin_capture_error', label: 'Capture' }], edges: [] },
          },
        },
        { id: 'end', type: 'end', label: 'End' },
      ],
      edges: [{ id: 'e1', source: 'start', target: 'guarded' }, { id: 'e2', source: 'guarded', target: 'end' }],
    } as any);
    await automation.execute(name, { ...TRIGGER });
    expect(captured, 'the catch region must have run once').toHaveLength(1);
    return { error: captured[0]!.error?.code, caught: captured[0]!.caught?.code };
  }

  it('control: the data door refuses each filter shape on both family tables with INVALID_FIELD / 400', async () => {
    for (const shape of REFUSED_SHAPES) {
      for (const object of FAMILY) {
        for (const filter of [shape.match, shape.miss]) {
          expect(await doorRefusal(object, filter), `${shape.label} on ${object}`).toEqual({ code: 'INVALID_FIELD', status: 400 });
        }
      }
    }
  });

  for (const runAs of ['system', 'user'] as const) {
    for (const branch of ['one', 'list'] as const) {
      for (const shape of REFUSED_SHAPES) {
        it(`runAs:'${runAs}', ${branch === 'one' ? 'findOne' : 'find'} branch: ${shape.label} is refused before the engine read, whether or not it matches`, async () => {
          for (const [side, filter] of [['match', shape.match], ['miss', shape.miss]] as const) {
            const run = await runWatched(readThenCopyFlow(`refused_${seq++}`, shape.object, runAs, branch, filter));
            expectRefusedRun(run, `${shape.label} (${side})`);
          }
          const control = await doorRefusal(shape.object, shape.match);
          expect(await refusalCodeAsAFlowReadsIt(shape.object, runAs, shape.match))
            .toEqual({ error: control.code, caught: control.code });
        });
      }
    }
  }

  it("the history table's hash columns and a cross-field comparand on the body are refused the same way", async () => {
    const shapes: Array<[string, Filter]> = [
      ['the parent-hash column', { previous_checksum: OTHER_HASH }],
      ['the hash column', { checksum: STORED_HASH }],
      ['the change-note column, which can quote a hash', { change_note: { $contains: 'sha256' } }],
      ['a comparand reading the body column', { name: { $ne: { $field: 'metadata' } } }],
    ];
    for (const [label, filter] of shapes) {
      const control = await doorRefusal('sys_metadata_history', filter);
      const run = await runWatched(readThenCopyFlow(`history_${seq++}`, 'sys_metadata_history', 'system', 'one', filter));
      expectRefusedRun(run, label);
      expect(await refusalCodeAsAFlowReadsIt('sys_metadata_history', 'system', filter), label)
        .toEqual({ error: control.code, caught: control.code });
    }
  });

  it('the refusal is a guard failure: a fault edge on the node does not route it', async () => {
    const def = readThenCopyFlow(`faulted_${seq++}`, 'sys_metadata', 'system', 'one', { checksum: STORED_HASH });
    def.nodes.splice(3, 0, { id: 'handler', type: 'pin_capture_error', label: 'Handler' } as any);
    def.edges.push(
      { id: 'e_fault', source: 'read', target: 'handler', type: 'fault' } as any,
      { id: 'e4', source: 'handler', target: 'end' },
    );
    captured.length = 0;
    const run = await runWatched(def);
    expectRefusedRun(run, 'a refused read with a fault edge');
    expect(captured, 'the fault handler ran').toHaveLength(0);
  });

  for (const runAs of ['system', 'user'] as const) {
    it(`runAs:'${runAs}': a filter whose body condition is built from a flow variable is judged after interpolation and refused`, async () => {
      // The authored filter names no family column: the condition list arrives
      // through `{record.conds}`. Only the interpolated filter (the one the
      // engine would run) shows that it reads the body.
      const authored: Filter = { $and: '{record.conds}' };
      for (const conds of [[{ metadata: { $contains: SENTINEL.slice(0, 12) } }], [{ metadata: { $contains: 'no-such-credential-prefix' } }]]) {
        const run = await runWatched(readThenCopyFlow(`built_${seq++}`, 'sys_metadata', runAs, 'one', authored), { record: { conds } });
        expectRefusedRun(run, 'a variable-built body filter');
      }
      // …and a body condition whose value is a flow variable.
      const run = await runWatched(
        readThenCopyFlow(`valued_${seq++}`, 'sys_metadata', runAs, 'list', { metadata: { $contains: '{record.guess}' } }),
        { record: { guess: SENTINEL.slice(0, 12) } },
      );
      expectRefusedRun(run, 'a body filter with a variable value');
    });
  }

  for (const runAs of ['system', 'user'] as const) {
    it(`runAs:'${runAs}': a scalar-column filter on a family read is served projected, with the door's keyed hash`, async () => {
      const control: any = await door.findData({ object: 'sys_metadata', query: { where: { name: DS_NAME } } });
      expect(control.records).toHaveLength(1);
      const controlRow = control.records[0];
      expect(controlRow.checksum).toMatch(KEYED);

      const run = await runWatched(readThenCopyFlow(`scalar_${seq++}`, 'sys_metadata', runAs, 'one', { name: DS_NAME, type: 'datasource' }));
      expect(run.res.success, `run failed: ${JSON.stringify(run.res.error)}`).toBe(true);
      expect(run.familyReads).toBeGreaterThan(0);
      expect(run.copy, 'the node downstream of the read ran').toBeTruthy();
      const row = run.res.output.rec;
      const text = JSON.stringify(row);
      expect(text.includes(SENTINEL), 'the stored credential reached the output').toBe(false);
      expect(text.includes(STORED_HASH), 'the stored content hash reached the output').toBe(false);
      expect(JSON.parse(row.metadata)).toEqual(JSON.parse(controlRow.metadata));
      expect(JSON.parse(row.metadata).config.url).toBe(DS_URL);
      expect(row.checksum).toBe(controlRow.checksum);
    });
  }

  it('a non-family read is unchanged: a filter over columns that share the family\'s names runs and serves the row as stored', async () => {
    await ql.insert(COPY_OBJECT.name, { title: 'plain_source', metadata: SENTINEL, checksum: STORED_HASH }, { context: SYS });
    for (const [filter, expected] of [
      [{ metadata: { $contains: SENTINEL.slice(0, 12) } }, 1],
      [{ checksum: STORED_HASH }, 1],
      [{ checksum: OTHER_HASH }, 0],
    ] as const) {
      const def = {
        name: `plain_${seq++}`, label: 'plain', type: 'autolaunched', runAs: 'system',
        variables: [{ name: 'rec', type: 'object', isOutput: true }],
        nodes: [
          { id: 'start', type: 'start', label: 'Start' },
          { id: 'read', type: 'get_record', label: 'Read', config: { objectName: COPY_OBJECT.name, filter, outputVariable: 'rec', limit: 5 } },
          { id: 'end', type: 'end', label: 'End' },
        ],
        edges: [{ id: 'e1', source: 'start', target: 'read' }, { id: 'e2', source: 'read', target: 'end' }],
      };
      automation.registerFlow(def.name, def as any);
      const res: any = await automation.execute(def.name, { ...TRIGGER });
      expect(res.success, `run failed: ${JSON.stringify(res.error)}`).toBe(true);
      expect(res.output.rec).toHaveLength(expected);
      if (expected) {
        expect(res.output.rec[0].metadata).toBe(SENTINEL);
        expect(res.output.rec[0].checksum).toBe(STORED_HASH);
      }
    }
  });
});
