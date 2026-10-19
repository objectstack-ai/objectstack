// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0139 E6] The stored-row backfill of `sys_activity`'s two writer-stamped
 * columns stamps the rows at rest exactly as the writer stamps new ones, writes
 * nothing in a dry run, is idempotent, and leaves a row it cannot judge
 * unstamped (withheld).
 *
 * ## Why a real engine and a real driver
 *
 * The backfill is a keyset walk over a NULL predicate on a multi-value column
 * and a single-id update as the platform; whether that reads every unstamped
 * row once and stores `[]` as an empty set (not as NULL) is a question about
 * the Filter Protocol as a driver executes it. The rows are written by the
 * real CRUD mirror, then their stamps cleared as the platform: the state a
 * table is in after the upgrade, before the operator runs the door.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import { ObjectQL, ObjectQLPlugin } from '@objectstack/objectql';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';

import { AuditPlugin } from './audit-plugin.js';
import { backfillActivityChangedFields } from './activity-changed-fields-backfill.js';
import { singlePostureTenancy } from './__tests__/single-posture-tenancy.js';

const ACTIVITY = 'sys_activity';
const ITEM = 'acb_item';
const HARNESS_PACKAGE = 'com.objectstack.audit.test.activity-changed-fields-backfill';
const SYS = { isSystem: true } as const;

const itemObject = {
  name: ITEM,
  label: 'Backfill Item',
  fields: {
    name: { name: 'name', label: 'Name', type: 'text' as const },
    stage: {
      name: 'stage', label: 'Stage', type: 'select' as const,
      options: [{ label: 'Open', value: 'open' }, { label: 'Won', value: 'won' }],
    },
    f_a: { name: 'f_a', label: 'A', type: 'text' as const },
    f_b: { name: 'f_b', label: 'B', type: 'text' as const },
  },
  activityMilestones: [{ field: 'stage', value: 'won', summary: 'Won {name}' }],
};

type Row = Record<string, any>;
const stampOf = (r: Row) => ({ changed_fields: r.changed_fields ?? null, milestone_key: r.milestone_key ?? null });

describe('[ADR-0139 E6] backfillActivityChangedFields', () => {
  let kernel: ObjectKernel;
  let engine: ObjectQL;
  /** The stamp the writer gave each row, read before it was cleared. */
  const written = new Map<string, ReturnType<typeof stampOf>>();
  let unjudgedId = '';

  const all = async () =>
    (await engine.find(ACTIVITY, { orderBy: [{ field: 'id', order: 'asc' }], context: SYS })) as Row[];
  const logger = () => ({ info: vi.fn(), warn: vi.fn() });

  beforeAll(async () => {
    kernel = new ObjectKernel({ logger: { level: 'silent' } });
    await kernel.use(new ObjectQLPlugin());
    await kernel.use(singlePostureTenancy());
    await kernel.use(new AuditPlugin());
    await kernel.bootstrap();
    engine = kernel.getService<ObjectQL>('objectql');
    const driver = new SqliteWasmDriver({ filename: ':memory:' });
    await driver.connect();
    engine.registerDriver(driver, true);
    engine.registry.registerObject(itemObject as any, HARNESS_PACKAGE);
    await engine.syncSchemas();

    const id = (await engine.insert(ITEM, { name: 'x', stage: 'open', f_a: '1', f_b: '1' }, { context: SYS })).id;
    const update = (patch: Row) => engine.update(ITEM, patch, { where: { id }, context: SYS });
    await update({ f_a: '2' });
    await update({ f_a: '3', f_b: '2' });
    await update({ stage: 'won' });
    await engine.insert(ACTIVITY, {
      type: 'note', summary: 'a note', object_name: ITEM, record_id: id,
      timestamp: new Date().toISOString(), metadata: JSON.stringify({ channel: 'call' }),
    }, { context: SYS });
    // A milestone row with no readable watched-field list: the planner cannot judge it.
    unjudgedId = String((await engine.insert(ACTIVITY, {
      type: 'note', summary: 'unjudged', object_name: ITEM, record_id: id,
      timestamp: new Date().toISOString(),
      metadata: JSON.stringify({ kind: 'milestone', text_sources: { summary: [], record_label: [] } }),
    }, { context: SYS })).id);

    // The state after the upgrade: every row at rest, unstamped.
    for (const row of await all()) {
      if (row.id !== unjudgedId) written.set(String(row.id), stampOf(row));
      await engine.update(ACTIVITY, { id: row.id, changed_fields: null, milestone_key: null }, { context: SYS });
    }
  }, 120_000);

  afterAll(async () => {
    if (kernel) await Promise.race([kernel.shutdown(), new Promise<void>((r) => setTimeout(r, 10_000))]);
  }, 30_000);

  it('control: the writer stamped every class of row, and the table is now unstamped', async () => {
    const stamps = [...written.values()];
    expect(stamps).toContainEqual({ changed_fields: [], milestone_key: null }); // the create, the note
    expect(stamps).toContainEqual({ changed_fields: ['f_a'], milestone_key: null });
    expect(stamps).toContainEqual({ changed_fields: ['f_a', 'f_b'], milestone_key: null });
    expect(stamps).toContainEqual({ changed_fields: ['stage'], milestone_key: 'stage' });
    for (const row of await all()) expect(stampOf(row), String(row.id)).toEqual({ changed_fields: null, milestone_key: null });
  });

  it('a dry run counts every unstamped row and writes none', async () => {
    const report = await backfillActivityChangedFields(engine, logger(), { pageSize: 2 });
    expect(report).toEqual({
      apply: false, scanned: written.size + 1, stamped: written.size, milestones: 1, unjudged: 1, failures: 0,
    });
    for (const row of await all()) expect(row.changed_fields ?? null, String(row.id)).toBeNull();
  });

  it('apply stamps each row at rest exactly as the writer stamped it, a page at a time', async () => {
    const report = await backfillActivityChangedFields(engine, logger(), { apply: true, pageSize: 2 });
    expect(report).toMatchObject({ apply: true, scanned: written.size + 1, stamped: written.size, unjudged: 1, failures: 0 });
    for (const row of await all()) {
      if (row.id === unjudgedId) expect(stampOf(row)).toEqual({ changed_fields: null, milestone_key: null });
      else expect(stampOf(row), String(row.id)).toEqual(written.get(String(row.id)));
    }
  });

  it('idempotent: a second run stamps nothing, and finds only the row it cannot judge', async () => {
    const before = await all();
    const report = await backfillActivityChangedFields(engine, logger(), { apply: true, pageSize: 2 });
    expect(report).toEqual({ apply: true, scanned: 1, stamped: 0, milestones: 0, unjudged: 1, failures: 0 });
    expect(await all()).toEqual(before);
  });

  it('a read the table refuses is a failure, never a clean report', async () => {
    const log = logger();
    const failing = { find: vi.fn(async () => { throw new Error('no such table'); }), update: vi.fn() };
    const report = await backfillActivityChangedFields(failing as any, log, { apply: true });
    expect(report.failures).toBe(1);
    expect(failing.update).not.toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalledTimes(1);
  });
});
