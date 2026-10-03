// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21624] A flow's write nodes (`create_record`, `update_record`,
 * `delete_record`) refuse a target in the stored-metadata family
 * (`sys_metadata` / `sys_metadata_history`). The family has one writer for
 * app-authored work, the metadata protocol, where a change is validated and its
 * provenance recorded; a flow is app-authored automation.
 *
 * Measured on the base before the fix, by class: in a composition without the
 * security plugin all three nodes changed both family tables under both run
 * identities; with the security plugin, `runAs: 'system'` still changed them
 * (the elevated write skips the security middleware), and `runAs: 'user'` was
 * refused by the middleware's engine-owned write guard as a routable runtime
 * failure with no code. A write node's `filter` was also an evaluate exit: an
 * `update_record` whose filter read the stored body column acted on the row
 * exactly when a guess about the body was right.
 *
 * What a refused case pins, for each node, each family table and each run
 * identity, in both compositions:
 *  - the run fails, and nothing downstream of the refused node runs;
 *  - the engine's write verb is never called on the family table, and the
 *    table is unchanged;
 *  - a flow reads `PERMISSION_DENIED` on `{$error.code}` (and on a
 *    `try_catch` region's error variable): the data door's own code for a
 *    non-platform principal's write to these tables, judged against the door
 *    (the control);
 *  - the failure is a guard failure: a `fault` edge on the node does not
 *    route it.
 *
 * Also pinned: a filter over the stored body column is refused the same way
 * whether or not it matches (the evaluate exit), a target that arrives through
 * a flow variable leaves the family table unchanged, and the three nodes write
 * an ordinary object exactly as before.
 *
 * Composition: `ObjectKernel`, `ObjectQLPlugin`, `driver-sql` on
 * better-sqlite3 `:memory:` and the real `AutomationServicePlugin`, the stack
 * the family read pins boot; the secured composition adds the real
 * `SecurityPlugin` with the default permission sets.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import { ObjectQLPlugin, type ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SecurityPlugin, securityDefaultPermissionSets } from '@objectstack/plugin-security';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { AutomationServicePlugin } from '../plugin.js';
import type { AutomationEngine, NodeExecutor } from '../engine.js';

const SYS = { isSystem: true } as const;
const FAMILY = ['sys_metadata', 'sys_metadata_history'] as const;
const WRITE_NODES = ['create_record', 'update_record', 'delete_record'] as const;

type FamilyTable = (typeof FAMILY)[number];
type WriteNode = (typeof WRITE_NODES)[number];
type RunAs = 'system' | 'user';

/** The stored body every seeded family row carries, and a fragment of it a filter can guess. */
const STORED_BODY = JSON.stringify({ name: 'pin_body', label: 'Pin body' });
const BODY_FRAGMENT = '"label":"Pin body"';

/** An ordinary object: the non-family control. */
const PLAIN_OBJECT = {
  name: 'pin_write_plain',
  label: 'Pin write plain',
  fields: {
    title: { name: 'title', label: 'Title', type: 'text' },
    state: { name: 'state', label: 'State', type: 'text' },
  },
};

/** Trigger identities: a rank-and-file member, and a platform administrator. */
const MEMBER = { userId: 'usr_pin_member', tenantId: 'org_1', positions: ['org_member'], permissions: ['member_default'] };
const ADMIN = { userId: 'usr_pin_admin', tenantId: 'org_1', positions: [] as string[], permissions: ['admin_full_access'] };

/** start → write node → mark (records that it ran) → end. */
function writeFlow(name: string, runAs: RunAs, node: Record<string, unknown>) {
  return {
    name,
    label: name,
    type: 'autolaunched',
    runAs,
    nodes: [
      { id: 'start', type: 'start', label: 'Start' },
      { id: 'write', label: 'Write', ...node },
      { id: 'mark', type: 'pin_mark', label: 'Mark' },
      { id: 'end', type: 'end', label: 'End' },
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'write' },
      { id: 'e2', source: 'write', target: 'mark' },
      { id: 'e3', source: 'mark', target: 'end' },
    ],
  };
}

async function boot(secured: boolean) {
  const kernel = new ObjectKernel({ logger: { level: 'fatal' } });
  await kernel.use(new ObjectQLPlugin());
  await kernel.use(new AutomationServicePlugin({ suspendedRunStore: 'memory' }));
  if (secured) await kernel.use(new SecurityPlugin({ defaultPermissionSets: [...securityDefaultPermissionSets] }));
  await kernel.bootstrap();
  const ql = kernel.getService<ObjectQL>('objectql');
  const automation = kernel.getService<AutomationEngine>('automation');
  const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
  await driver.connect();
  ql.registerDriver(driver, true);
  ql.registry.registerObject(PLAIN_OBJECT as any, 'pin-21624', 'pin-21624');
  await ql.syncSchemas();
  return { kernel, ql, automation };
}

/**
 * One composition's harness: seed a family row, snapshot a table, run a flow
 * with the engine's write verbs watched, and read the code a flow is handed.
 */
function harness(ql: ObjectQL, automation: AutomationEngine) {
  let seq = 0;
  const marked = new Set<string>();
  const captured: Array<{ error?: string; caught?: string }> = [];
  automation.registerNodeExecutor({
    type: 'pin_mark',
    async execute(_node, _variables, context) {
      marked.add(String((context as { params?: { flow?: string } }).params?.flow));
      return { success: true };
    },
  } as NodeExecutor);
  automation.registerNodeExecutor({
    type: 'pin_capture_error',
    async execute(_node, variables) {
      captured.push({
        error: (variables.get('$error') as { code?: string } | undefined)?.code,
        caught: (variables.get('caught') as { code?: string } | undefined)?.code,
      });
      return { success: true };
    },
  } as NodeExecutor);

  async function seed(object: FamilyTable): Promise<string> {
    const id = `pin_${object}_${seq++}`;
    const row = object === 'sys_metadata'
      ? { id, name: `pin_row_${seq}`, type: 'view', scope: 'platform', state: 'active', metadata: STORED_BODY }
      : { id, name: `pin_row_${seq}`, type: 'view', version: 1, operation_type: 'update', metadata: STORED_BODY };
    await ql.insert(object, row, { context: SYS });
    return id;
  }

  async function snapshot(object: string): Promise<string> {
    const rows = (await ql.find(object, { context: SYS })) as Array<{ id: string }>;
    return JSON.stringify([...rows].sort((a, b) => a.id.localeCompare(b.id)));
  }

  /** The node config for `nodeType` aimed at `object`, naming the row `id`. */
  function configFor(nodeType: WriteNode, object: string, id: string): Record<string, unknown> {
    if (nodeType === 'create_record') {
      return {
        objectName: object,
        fields: object === 'sys_metadata_history'
          ? { name: `pin_made_${seq++}`, type: 'view', version: 1, operation_type: 'create', metadata: '[1]' }
          : object === 'sys_metadata'
            ? { name: `pin_made_${seq++}`, type: 'view', scope: 'platform', state: 'active', metadata: '[1]' }
            : { title: `pin_made_${seq++}` },
      };
    }
    if (nodeType === 'update_record') {
      return { objectName: object, filter: { id }, fields: object === 'sys_metadata_history' ? { change_note: 'pin' } : { state: 'archived' } };
    }
    return { objectName: object, filter: { id } };
  }

  /** Run `def` with the engine's write verbs watched; count the calls aimed at the family. */
  async function runWatched(def: { name: string }, trigger: Record<string, unknown>) {
    automation.registerFlow(def.name, def as any);
    const insert = vi.spyOn(ql, 'insert');
    const update = vi.spyOn(ql, 'update');
    const remove = vi.spyOn(ql, 'delete');
    let res: any;
    let familyWrites = 0;
    try {
      res = await automation.execute(def.name, { ...trigger, params: { flow: def.name } } as any);
      const calls = [...insert.mock.calls, ...update.mock.calls, ...remove.mock.calls] as unknown[][];
      familyWrites = calls.filter((call) => (FAMILY as readonly string[]).includes(call[0] as string)).length;
    } finally {
      insert.mockRestore();
      update.mockRestore();
      remove.mockRestore();
    }
    return { res, familyWrites, downstreamRan: marked.has(def.name) };
  }

  /** The code a flow is handed for a failing write node: `{$error.code}` and the try_catch error variable. */
  async function codeAsAFlowReadsIt(runAs: RunAs, node: Record<string, unknown>, trigger: Record<string, unknown>) {
    const name = `pin_code_${seq++}`;
    captured.length = 0;
    automation.registerFlow(name, {
      name, label: name, type: 'autolaunched', runAs,
      nodes: [
        { id: 'start', type: 'start', label: 'Start' },
        {
          id: 'guarded', type: 'try_catch', label: 'Guarded write',
          config: {
            errorVariable: 'caught',
            try: { nodes: [{ id: 'write', label: 'Write', ...node }], edges: [] },
            catch: { nodes: [{ id: 'capture', type: 'pin_capture_error', label: 'Capture' }], edges: [] },
          },
        },
        { id: 'end', type: 'end', label: 'End' },
      ],
      edges: [{ id: 'e1', source: 'start', target: 'guarded' }, { id: 'e2', source: 'guarded', target: 'end' }],
    } as any);
    await automation.execute(name, { ...trigger } as any);
    expect(captured, 'the catch region must have run once').toHaveLength(1);
    return captured[0]!;
  }

  return { seed, snapshot, configFor, runWatched, codeAsAFlowReadsIt, next: () => seq++ };
}

type Harness = ReturnType<typeof harness>;

/** A refused run: failed, nothing downstream, no engine write on the family, the table unchanged. */
async function expectRefused(h: Harness, object: FamilyTable, nodeType: WriteNode, runAs: RunAs, trigger: Record<string, unknown>) {
  const id = await h.seed(object);
  const before = await h.snapshot(object);
  const node = { type: nodeType, config: h.configFor(nodeType, object, id) };
  const run = await h.runWatched(writeFlow(`pin_refused_${h.next()}`, runAs, node), trigger);
  const where = `${nodeType} on ${object}, runAs '${runAs}'`;
  expect(run.res.success, `${where}: the run must fail`).toBe(false);
  expect(run.res.status, `${where}: the run's status`).toBe('failed');
  expect(String(run.res.error), `${where}: the refusal names the metadata protocol`).toContain('the metadata protocol');
  expect(run.downstreamRan, `${where}: the node downstream of the refusal ran`).toBe(false);
  expect(run.familyWrites, `${where}: the engine's write verb was called on the family table`).toBe(0);
  expect(await h.snapshot(object), `${where}: the family table changed`).toBe(before);
  expect(await h.codeAsAFlowReadsIt(runAs, node, trigger), `${where}: the code a flow reads`)
    .toEqual({ error: 'PERMISSION_DENIED', caught: 'PERMISSION_DENIED' });
}

describe('flow write nodes refuse a stored-metadata family target (#21624): without the security plugin', () => {
  let kernel: ObjectKernel;
  let ql: ObjectQL;
  let automation: AutomationEngine;
  let h: Harness;

  beforeAll(async () => {
    ({ kernel, ql, automation } = await boot(false));
    h = harness(ql, automation);
  }, 60_000);

  afterAll(async () => {
    try { await kernel?.shutdown(); } catch { /* best-effort teardown */ }
  });

  for (const nodeType of WRITE_NODES) {
    for (const runAs of ['system', 'user'] as const) {
      it(`${nodeType}, runAs '${runAs}': both family tables are refused and left unchanged`, async () => {
        for (const object of FAMILY) await expectRefused(h, object, nodeType, runAs, MEMBER);
      });
    }
  }

  for (const nodeType of ['update_record', 'delete_record'] as const) {
    it(`${nodeType}: a filter over the stored body is refused the same way whether or not it matches`, async () => {
      const id = await h.seed('sys_metadata');
      const before = await h.snapshot('sys_metadata');
      const answers: string[] = [];
      for (const guess of [BODY_FRAGMENT, 'no-such-body-fragment']) {
        const filter = { id, metadata: { $contains: guess } };
        const config = nodeType === 'update_record'
          ? { objectName: 'sys_metadata', multi: true, filter, fields: { state: 'archived' } }
          : { objectName: 'sys_metadata', multi: true, filter };
        const run = await h.runWatched(writeFlow(`pin_guess_${h.next()}`, 'system', { type: nodeType, config }), MEMBER);
        expect(run.res.success).toBe(false);
        expect(run.familyWrites, 'the filtered write ran').toBe(0);
        answers.push(String(run.res.error));
      }
      expect(answers[0], 'the answer depends on the stored body').toBe(answers[1]);
      expect(await h.snapshot('sys_metadata')).toBe(before);
    });
  }

  it('the refusal is a guard failure: a fault edge on the node does not route it', async () => {
    for (const nodeType of WRITE_NODES) {
      const id = await h.seed('sys_metadata');
      const before = await h.snapshot('sys_metadata');
      const def = writeFlow(`pin_fault_${h.next()}`, 'system', { type: nodeType, config: h.configFor(nodeType, 'sys_metadata', id) });
      def.nodes.splice(3, 0, { id: 'handler', type: 'pin_mark', label: 'Handler' });
      def.edges.push({ id: 'e_fault', source: 'write', target: 'handler', type: 'fault' } as any, { id: 'e4', source: 'handler', target: 'end' });
      const run = await h.runWatched(def, MEMBER);
      expect(run.res.success, `${nodeType}: the run must fail`).toBe(false);
      expect(run.downstreamRan, `${nodeType}: the fault handler ran`).toBe(false);
      expect(await h.snapshot('sys_metadata')).toBe(before);
    }
  });

  for (const runAs of ['system', 'user'] as const) {
    it(`runAs '${runAs}': a target that arrives through a flow variable leaves the family table unchanged`, async () => {
      for (const nodeType of WRITE_NODES) {
        const id = await h.seed('sys_metadata');
        const before = await h.snapshot('sys_metadata');
        const config = { ...h.configFor(nodeType, 'sys_metadata', id), objectName: '{record.target}' };
        const run = await h.runWatched(
          writeFlow(`pin_variable_${h.next()}`, runAs, { type: nodeType, config }),
          { ...MEMBER, record: { target: 'sys_metadata' } },
        );
        expect(run.res.success, `${nodeType}: the run must fail`).toBe(false);
        expect(run.familyWrites, `${nodeType}: the engine's write verb was called on the family table`).toBe(0);
        expect(await h.snapshot('sys_metadata'), `${nodeType}: the family table changed`).toBe(before);
      }
    });
  }

  for (const runAs of ['system', 'user'] as const) {
    it(`runAs '${runAs}': an ordinary object is created, updated and deleted exactly as before`, async () => {
      const created = await h.runWatched(
        writeFlow(`pin_plain_create_${h.next()}`, runAs, { type: 'create_record', config: { objectName: PLAIN_OBJECT.name, fields: { title: `plain_${runAs}`, state: 'open' } } }),
        MEMBER,
      );
      expect(created.res.success, `create failed: ${JSON.stringify(created.res.error)}`).toBe(true);
      expect(created.downstreamRan).toBe(true);
      const row: any = await ql.findOne(PLAIN_OBJECT.name, { where: { title: `plain_${runAs}` }, context: SYS });
      expect(row?.state).toBe('open');

      const updated = await h.runWatched(
        writeFlow(`pin_plain_update_${h.next()}`, runAs, { type: 'update_record', config: { objectName: PLAIN_OBJECT.name, filter: { id: row.id }, fields: { state: 'closed' } } }),
        MEMBER,
      );
      expect(updated.res.success, `update failed: ${JSON.stringify(updated.res.error)}`).toBe(true);
      expect(((await ql.findOne(PLAIN_OBJECT.name, { where: { id: row.id }, context: SYS })) as any)?.state).toBe('closed');

      const deleted = await h.runWatched(
        writeFlow(`pin_plain_delete_${h.next()}`, runAs, { type: 'delete_record', config: { objectName: PLAIN_OBJECT.name, filter: { id: row.id } } }),
        MEMBER,
      );
      expect(deleted.res.success, `delete failed: ${JSON.stringify(deleted.res.error)}`).toBe(true);
      expect(await ql.findOne(PLAIN_OBJECT.name, { where: { id: row.id }, context: SYS })).toBeFalsy();
    });
  }
});

describe('flow write nodes refuse a stored-metadata family target (#21624): with the security plugin', () => {
  let kernel: ObjectKernel;
  let ql: ObjectQL;
  let h: Harness;

  beforeAll(async () => {
    let automation: AutomationEngine;
    ({ kernel, ql, automation } = await boot(true));
    h = harness(ql, automation);
  }, 60_000);

  afterAll(async () => {
    try { await kernel?.shutdown(); } catch { /* best-effort teardown */ }
  });

  it("control: the data door answers a non-platform principal's family write with PERMISSION_DENIED / 403", async () => {
    const door = new ObjectStackProtocolImplementation(ql as any);
    for (const principal of [MEMBER, ADMIN]) {
      const context = { ...principal, isSystem: false };
      const id = await h.seed('sys_metadata');
      for (const write of [
        () => door.createData({ object: 'sys_metadata', data: { name: `pin_door_${h.next()}`, type: 'view', scope: 'platform', state: 'active', metadata: '[1]' }, context }),
        () => door.updateData({ object: 'sys_metadata', id, data: { state: 'archived' }, context }),
        () => door.deleteData({ object: 'sys_metadata', id, context }),
      ]) {
        let thrown: any;
        try { await write(); } catch (err) { thrown = err; }
        expect(thrown, 'the data door must refuse this write').toBeDefined();
        expect({ code: thrown.code, status: thrown.status }).toEqual({ code: 'PERMISSION_DENIED', status: 403 });
      }
    }
  });

  for (const nodeType of WRITE_NODES) {
    it(`${nodeType}: both family tables are refused and left unchanged under runAs 'system' and under 'user' (member and administrator)`, async () => {
      for (const object of FAMILY) {
        await expectRefused(h, object, nodeType, 'system', MEMBER);
        await expectRefused(h, object, nodeType, 'user', MEMBER);
        await expectRefused(h, object, nodeType, 'user', ADMIN);
      }
    });
  }
});
