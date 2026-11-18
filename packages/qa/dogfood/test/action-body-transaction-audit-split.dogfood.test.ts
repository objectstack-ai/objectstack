// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#35028] An action body's write inside `ctx.api.transaction` keeps its
// compliance rows when the deployment carries a `telemetry` datasource — on a
// real boot, every half composed.
//
// ## The composition
//
// `bootStack` with the real `AuditPlugin` and a second, file-backed SQLite
// driver named `telemetry`, adopted the way `os dev` / `os serve` adopt the
// sibling telemetry database (a `DriverPlugin` whose driver is named
// `telemetry`). ADR-0057 §3.6 then routes the lifecycle-classed ledgers
// (`sys_audit_log`, `sys_activity`) to it, and the business objects stay on the
// primary. The actions are sandboxed bodies posted through the real `/actions`
// door, so the body's `ctx.api.transaction` drives `ScopedContext`'s discrete
// begin/commit/rollback trio, and plugin-audit's `afterInsert` writer runs
// under the body's transaction handle.
//
// ## What was broken
//
// The trio never publishes into the engine's `txStore`, so the same-origin gate
// had no owner for its handle and stepped aside: plugin-audit's ledger insert
// was handed the PRIMARY's handle while routed to the telemetry driver, ran on
// the primary connection — which has no `sys_audit_log` — and was lost. The
// API answered 200 and one `Audit write FAILED` line was the only trace.
//
// ## What is asserted
//
// - Two inserts inside the body's transaction each keep their `sys_audit_log`
//   row and their `sys_activity` row.
// - A body transaction that throws leaves no business row; its ledger rows are
//   the decided orphan rows of the #5351 carve-out (written outside the
//   transaction, on telemetry's own connection).
// - A BUSINESS write inside the body's transaction to an object on the other
//   datasource is refused, by name, and nothing is written.
//
// `@objectstack/objectql`, `@objectstack/runtime` and
// `@objectstack/plugin-audit` resolve through their BUILT output here, so a
// verdict on a change to any of them is a verdict on its last build.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { AuditPlugin } from '@objectstack/plugin-audit';
import { DriverPlugin } from '@objectstack/runtime';
import { SqlDriver } from '@objectstack/driver-sql';
import { defineStack } from '@objectstack/spec';
import { ObjectSchema, Field } from '@objectstack/spec/data';

const ITEM = 'abx_item';
const REMOTE = 'abx_remote';
const SYS = { context: { isSystem: true } } as const;
const TX_CAPS = ['api.write', 'api.transaction'];

const TX_INSERT = `
  const ids = [];
  await ctx.api.transaction(async () => {
    ids.push((await ctx.api.object('${ITEM}').insert({ title: 'tx-1' })).id);
    ids.push((await ctx.api.object('${ITEM}').insert({ title: 'tx-2' })).id);
  });
  return { ids };`;

const TX_ROLLBACK = `
  let id;
  try {
    await ctx.api.transaction(async () => {
      id = (await ctx.api.object('${ITEM}').insert({ title: 'tx-doomed' })).id;
      throw new Error('the body gives up');
    });
  } catch (e) {
    return { rolledBack: true, id };
  }
  return { rolledBack: false, id };`;

const TX_REMOTE = `
  await ctx.api.transaction(async () => {
    await ctx.api.object('${REMOTE}').insert({ title: 'across datasources' });
  });
  return { wrote: true };`;

const fixtureStack = defineStack({
  manifest: {
    id: 'com.dogfood.action-body-transaction-audit-split',
    namespace: 'abx',
    version: '0.0.0',
    type: 'app',
    name: 'Action Body Transaction Audit Split Fixture',
    description: 'Sandboxed action bodies writing inside ctx.api.transaction on a deployment with a telemetry datasource.',
  },
  objects: [
    ObjectSchema.create({ name: ITEM, label: 'Item', fields: { title: Field.text({ label: 'Title', required: true }) } }),
    // A BUSINESS object bound to the other datasource: no lifecycle class, so
    // it is no system ledger and the carve-out does not apply to it.
    ObjectSchema.create({ name: REMOTE, label: 'Remote', datasource: 'telemetry', fields: { title: Field.text({ label: 'Title' }) } } as any),
  ],
  actions: [
    { name: 'abx_tx_insert', label: 'Insert two in a transaction', objectName: ITEM, type: 'script', body: { language: 'js', source: TX_INSERT, capabilities: TX_CAPS } },
    { name: 'abx_tx_rollback', label: 'Insert then roll back', objectName: ITEM, type: 'script', body: { language: 'js', source: TX_ROLLBACK, capabilities: TX_CAPS } },
    { name: 'abx_tx_remote', label: 'Write across datasources', objectName: ITEM, type: 'script', body: { language: 'js', source: TX_REMOTE, capabilities: TX_CAPS } },
  ],
} as any);

type Row = Record<string, any>;

describe('[#35028] an action body\'s write inside ctx.api.transaction keeps its ledger rows beside a telemetry datasource', () => {
  let stack: VerifyStack;
  let ql: any;
  let token = '';
  let dir = '';

  const ledgerRows = async (object: 'sys_audit_log' | 'sys_activity', recordId: string): Promise<Row[]> =>
    (await ql.find(object, { where: { object_name: ITEM, record_id: recordId }, ...SYS })) as Row[];

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'os-abx-35028-'));
    const telemetry = new SqlDriver({ client: 'better-sqlite3', connection: { filename: join(dir, 'telemetry.sqlite') }, useNullAsDefault: true });
    Object.defineProperty(telemetry, 'name', { value: 'telemetry' });
    stack = await bootStack(fixtureStack as unknown as Parameters<typeof bootStack>[0], {
      extraPlugins: [new DriverPlugin(telemetry), new AuditPlugin()],
    });
    ql = await stack.kernel.getServiceAsync('objectql');
    token = await stack.signIn();
    // Precondition: the split is real — the ledger and the business object
    // resolve to different drivers.
    expect(ql.getDriver('sys_audit_log')).toBe(telemetry);
    expect(ql.getDriver('sys_activity')).toBe(telemetry);
    expect(ql.getDriver(ITEM)).not.toBe(telemetry);
  }, 180_000);

  afterAll(async () => {
    await stack?.stop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('two inserts inside the body\'s transaction each keep their sys_audit_log and sys_activity rows', async () => {
    const r = await stack.apiAs(token, 'POST', `/actions/${ITEM}/abx_tx_insert`, {});
    const body = (await r.json()) as any;
    expect(r.status, JSON.stringify(body)).toBe(200);
    const ids: string[] = body.data?.ids ?? body.ids;
    expect(ids).toHaveLength(2);
    for (const id of ids) {
      expect(await ql.findOne(ITEM, { where: { id }, ...SYS }), `business row ${id}`).toBeTruthy();
      const audit = await ledgerRows('sys_audit_log', id);
      expect(audit.map((a) => a.action), `sys_audit_log for ${id}`).toEqual(['create']);
      expect((await ledgerRows('sys_activity', id)).length, `sys_activity for ${id}`).toBe(1);
    }
  });

  it('a body transaction that throws leaves no business row; its ledger row is the decided orphan', async () => {
    const r = await stack.apiAs(token, 'POST', `/actions/${ITEM}/abx_tx_rollback`, {});
    const body = (await r.json()) as any;
    expect(r.status, JSON.stringify(body)).toBe(200);
    const out = body.data ?? body;
    expect(out.rolledBack).toBe(true);
    expect(await ql.findOne(ITEM, { where: { id: out.id }, ...SYS })).toBeFalsy();
    // Written outside the transaction, on telemetry's own connection: it
    // survives the rollback (ADR-0119, the #5351 carve-out).
    expect((await ledgerRows('sys_audit_log', out.id)).map((a) => a.action)).toEqual(['create']);
  });

  it('a business write inside the body\'s transaction to the other datasource is refused, by name', async () => {
    const r = await stack.apiAs(token, 'POST', `/actions/${ITEM}/abx_tx_remote`, {});
    const body = (await r.json()) as any;
    expect(r.status, JSON.stringify(body)).toBe(409);
    expect(body.error?.code, JSON.stringify(body)).toBe('ERR_CROSS_DATASOURCE_TRANSACTION_WRITE');
    expect(body.error?.message).toContain(`insert of '${REMOTE}'`);
    expect(await ql.find(REMOTE, SYS)).toHaveLength(0);
  });
});
