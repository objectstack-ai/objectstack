// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A `delete_record` node with `multi: true` walks the rows its filter matches
 * as ONE set: each relation pointing at the deleted object is asked once per
 * batch of matched ids, not once per matched row, and every row still gets
 * the outcome its declared `deleteBehavior` gives it.
 *
 * The engine's predicate arm used to run the by-id walk once per matched id,
 * so its cost was matched rows times referencing relations: deleting 1,001
 * rows of an object three relations point at made 4,004 dependents probes and
 * took about 1.7 s on SQLite, where the same delete took about 0.1 s before
 * the walk existed. The walk now takes a root set; a by-id delete is a set of
 * one.
 *
 * One walk of one set also means the matched rows are members of it: a
 * matched row held only by other matched rows refuses nothing and is cleared
 * of nothing, the #22305 set exemption, where the row-by-row walk refused or
 * not depending on which row it met first.
 *
 * Composition: the real stack `delete-record-predicate-referential-walk`
 * boots (`ObjectKernel`, `ObjectQLPlugin`, `driver-sql` on better-sqlite3
 * `:memory:`, the real `delete_record` executor). Driver calls are counted on
 * the driver itself; rows are read out of the driver, not through the engine.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FilterCondition } from '@objectstack/spec/data';
import { ObjectKernel } from '@objectstack/core';
import { ObjectQLPlugin, type ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { AutomationServicePlugin } from '../plugin.js';
import { AutomationEngine } from '../engine.js';
import { registerCrudNodes } from './crud-nodes.js';
import { installDefaultOrganization } from '../default-organization.testkit.js';

const SYS = { isSystem: true } as const;

/** Matched rows: more than two of the walk's 500-id batches. */
const N = 1_001;

const PARENT = {
  name: 'pin_batch_parent',
  label: 'Pin batch parent',
  fields: {
    title: { name: 'title', label: 'Title', type: 'text' },
    grp: { name: 'grp', label: 'Group', type: 'text' },
  },
};
/** The three relations of the rest cap test: a master_detail, a lookup and a multiple lookup. */
const DETAIL = {
  name: 'pin_batch_detail',
  label: 'Pin batch detail',
  fields: {
    title: { name: 'title', label: 'Title', type: 'text' },
    parent: { name: 'parent', label: 'Parent', type: 'master_detail', reference: 'pin_batch_parent' },
  },
};
const LINK = {
  name: 'pin_batch_link',
  label: 'Pin batch link',
  fields: {
    title: { name: 'title', label: 'Title', type: 'text' },
    parent: { name: 'parent', label: 'Parent', type: 'lookup', reference: 'pin_batch_parent' },
  },
};
const TAGS = {
  name: 'pin_batch_tags',
  label: 'Pin batch tags',
  fields: {
    title: { name: 'title', label: 'Title', type: 'text' },
    parents: { name: 'parents', label: 'Parents', type: 'lookup', reference: 'pin_batch_parent', multiple: true },
  },
};

/** A second parent with a REQUIRED multiple lookup pointing at it: the per-row escalation. */
const HOLDER = {
  name: 'pin_batch_holder',
  label: 'Pin batch holder',
  fields: {
    title: { name: 'title', label: 'Title', type: 'text' },
    grp: { name: 'grp', label: 'Group', type: 'text' },
  },
};
const MEMBERS = {
  name: 'pin_batch_members',
  label: 'Pin batch members',
  fields: {
    title: { name: 'title', label: 'Title', type: 'text' },
    holders: { name: 'holders', label: 'Holders', type: 'lookup', reference: 'pin_batch_holder', multiple: true, required: true },
  },
};

/** A self-reference with an authored `restrict`: a report holds its manager. */
const STAFF = {
  name: 'pin_batch_staff',
  label: 'Pin batch staff',
  fields: {
    title: { name: 'title', label: 'Title', type: 'text' },
    grp: { name: 'grp', label: 'Group', type: 'text' },
    manager: { name: 'manager', label: 'Manager', type: 'lookup', reference: 'pin_batch_staff', deleteBehavior: 'restrict' },
  },
};

function makeLogger(): any {
  const l: any = { info() {}, warn() {}, error() {}, debug() {}, trace() {}, fatal() {} };
  l.child = () => l;
  return l;
}

type Executor = { execute: (node: any, variables: Map<string, unknown>, context: any) => Promise<any> };

describe('[#27004] a multi delete_record walks its matched rows as a set', () => {
  let kernel: ObjectKernel;
  let ql: ObjectQL;
  let driver: SqlDriver;
  let deleteRecord: Executor;

  beforeAll(async () => {
    kernel = new ObjectKernel({ logger: { level: 'fatal' } });
    await kernel.use(new ObjectQLPlugin());
    await kernel.use(new AutomationServicePlugin({ suspendedRunStore: 'memory' }));
    await kernel.bootstrap();
    ql = kernel.getService<ObjectQL>('objectql');

    driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
    await driver.connect();
    ql.registerDriver(driver, true);
    for (const o of [PARENT, DETAIL, LINK, TAGS, HOLDER, MEMBERS, STAFF]) ql.registry.registerObject(o as any, 'pin-batch-delete', 'pin-batch-delete');
    await ql.syncSchemas();
    await installDefaultOrganization(ql);

    const executors = new Map<string, Executor>();
    const capture = new Proxy(new AutomationEngine(makeLogger()), {
      get(target, key, receiver) {
        if (key === 'registerNodeExecutor') return (e: any) => { executors.set(e.type, e); };
        return Reflect.get(target, key, receiver);
      },
    });
    registerCrudNodes(capture as AutomationEngine, { logger: makeLogger(), getService: (n: string) => (n === 'data' ? ql : undefined) } as any);
    deleteRecord = executors.get('delete_record')!;
    expect(deleteRecord, 'control: the delete_record executor was registered').toBeDefined();
  }, 60_000);

  afterAll(async () => {
    try { await kernel?.shutdown(); } catch { /* best-effort teardown */ }
  });

  const insert = async (object: string, data: Record<string, unknown>): Promise<string> =>
    ((await ql.insert(object, data, { context: SYS })) as any).id;
  /** `count` rows of `object` in one group, inserted 100 at a time; their ids in order. */
  const insertMany = async (object: string, grp: string, count: number): Promise<string[]> => {
    const ids: string[] = [];
    for (let i = 0; i < count; i += 100) {
      const batch = Array.from({ length: Math.min(100, count - i) }, (_, j) => ({ id: `${grp}_${i + j}`, title: `${grp} ${i + j}`, grp }));
      await ql.insert(object, batch, { context: SYS });
      ids.push(...batch.map((r) => r.id));
    }
    return ids;
  };
  /** Rows of `object`, read from the driver with no engine in between. */
  const rows = async (object: string, where: FilterCondition = {}): Promise<any[]> =>
    (await driver.find(object, { where })) as any[];
  const sweep = (objectName: string, grp: string) => deleteRecord.execute(
    { id: 'sweep', type: 'delete_record', config: { objectName, filter: { grp }, multi: true } },
    new Map(),
    { runAs: 'system', flowName: 'pin_batch_sweep' },
  );

  it('asks each referencing relation once per 500 matched ids, not once per matched row', async () => {
    await insertMany(PARENT.name, 'counted', N);
    const finds = vi.spyOn(driver, 'find');
    const deletes = vi.spyOn(driver, 'deleteMany');
    try {
      const res: any = await sweep(PARENT.name, 'counted');
      expect(res.success, JSON.stringify(res)).toBe(true);
      const probesOf = (object: string) => finds.mock.calls.filter((call) => call[0] === object).length;
      // ⌈1,001 / 500⌉ = 3 batches. The master_detail is read twice per batch
      // (the cascade set is collected, then walked); the lookup and the
      // multiple lookup once each. Per row it was 2,002, 1,001 and 1,001.
      expect({ detail: probesOf(DETAIL.name), link: probesOf(LINK.name), tags: probesOf(TAGS.name) })
        .toEqual({ detail: 6, link: 3, tags: 3 });
      expect(deletes.mock.calls.filter((call) => call[0] === PARENT.name)).toHaveLength(3);
    } finally {
      finds.mockRestore();
      deletes.mockRestore();
    }
    expect(await rows(PARENT.name, { grp: 'counted' })).toEqual([]);
  });

  it('every matched row still gets its own outcome, across batch boundaries', async () => {
    const ids = await insertMany(PARENT.name, 'mixed', N);
    const kept = await insert(PARENT.name, { title: 'k', grp: 'kept' });
    // Details of rows in the first and the second batch, and of the kept row.
    await insert(DETAIL.name, { title: 'd-0', parent: ids[0] });
    await insert(DETAIL.name, { title: 'd-700', parent: ids[700] });
    const keptDetail = await insert(DETAIL.name, { title: 'd-k', parent: kept });
    const l600 = await insert(LINK.name, { title: 'l-600', parent: ids[600] });
    const l1000 = await insert(LINK.name, { title: 'l-1000', parent: ids[1000] });
    const keptLink = await insert(LINK.name, { title: 'l-k', parent: kept });
    // One set spanning two batches and the kept row; one emptied by the delete.
    const spanning = await insert(TAGS.name, { title: 't-span', parents: [ids[1], ids[900], kept] });
    const emptied = await insert(TAGS.name, { title: 't-empty', parents: [ids[2], ids[3]] });

    const res: any = await sweep(PARENT.name, 'mixed');
    expect(res.success, JSON.stringify(res)).toBe(true);

    expect(await rows(PARENT.name, { grp: 'mixed' })).toEqual([]);
    expect((await rows(PARENT.name, { grp: 'kept' })).map((r) => r.id)).toEqual([kept]);
    // master_detail: cascaded on both sides of the batch boundary.
    expect((await rows(DETAIL.name)).map((r) => r.id)).toEqual([keptDetail]);
    // set_null lookup: cleared, the kept row's untouched.
    const links = new Map((await rows(LINK.name)).map((r) => [r.id, r.parent ?? null]));
    expect([links.get(l600), links.get(l1000), links.get(keptLink)]).toEqual([null, null, kept]);
    // set_null multiple lookup: every deleted member removed, the kept one
    // stays, and an emptied set is written as `[]`, never `null`.
    const tags = new Map((await rows(TAGS.name)).map((r) => [r.id, r.parents]));
    expect(tags.get(spanning)).toEqual([kept]);
    expect(tags.get(emptied)).toEqual([]);
  });

  it('a required multiple lookup emptied only by the whole set refuses, naming the row whose removal empties it', async () => {
    const ids = await insertMany(HOLDER.name, 'held', 600);
    const other = await insert(HOLDER.name, { title: 'o', grp: 'other' });
    // Keeps `other`: takes the member removal, refuses nothing.
    await insert(MEMBERS.name, { title: 'm-keeps', holders: [ids[10], other] });
    // Every member is matched, one in each batch: emptied by the delete.
    await insert(MEMBERS.name, { title: 'm-empties', holders: [ids[20], ids[550]] });

    const node: any = await sweep(HOLDER.name, 'held');
    expect(node.success).toBe(false);
    expect(node.innerRefusal).toMatchObject({ code: 'DELETE_RESTRICTED' });
    // The engine's own error, for its structured half: the count is the rows
    // the removal would empty, and the record named is the one whose removal
    // empties the set, as when the rows were walked one by one.
    const err: any = await ql.delete(HOLDER.name, { where: { grp: 'held' }, multi: true, context: SYS }).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'DELETE_RESTRICTED', status: 409, dependentObject: MEMBERS.name, dependentCount: 1 });
    expect(err.developerMessage).toContain(`Cannot delete ${HOLDER.name} (${ids[550]}): 1 dependent ${MEMBERS.name} record(s)`);
    // One unit of work: nothing deleted, nothing cleared.
    expect(await rows(HOLDER.name, { grp: 'held' })).toHaveLength(600);
    const members = new Map((await rows(MEMBERS.name)).map((r) => [r.title, r.holders]));
    expect(members.get('m-keeps')).toEqual([ids[10], other]);
    expect(members.get('m-empties')).toEqual([ids[20], ids[550]]);
  });

  it('a matched row held only by other matched rows is in the set: the delete goes through, whatever the order', async () => {
    // The manager first, so a walk of one row at a time met the report while
    // it still stood beside a set of one, and refused.
    const manager = await insert(STAFF.name, { title: 'm', grp: 'team' });
    const report = await insert(STAFF.name, { title: 'r', grp: 'team', manager });
    const removed = await ql.delete(STAFF.name, { where: { grp: 'team' }, multi: true, context: SYS });
    expect(removed).toBe(2);
    expect(await rows(STAFF.name, { id: { $in: [manager, report] } })).toEqual([]);

    // A holder outside the matched rows still refuses, and nothing is deleted.
    const held = await insert(STAFF.name, { title: 'h', grp: 'team' });
    await insert(STAFF.name, { title: 'o', grp: 'elsewhere', manager: held });
    const err: any = await ql.delete(STAFF.name, { where: { grp: 'team' }, multi: true, context: SYS }).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'DELETE_RESTRICTED', dependentObject: STAFF.name, dependentCount: 1 });
    expect((await rows(STAFF.name, { grp: 'team' })).map((r) => r.id)).toEqual([held]);
  });
});
