// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * An action body's `ctx.api.transaction` that inserts a master-detail child
 * whose parent carries a roll-up completes on SQLite, well inside the sandbox
 * wall clock — with the platform's audit-shaped ledger write riding along, on
 * one datasource and beside a `telemetry` one.
 *
 * Measured broken in a published release (the #34998 reading): the first child
 * insert inside the body's transaction never settled, the body hit the 30 s
 * wall-clock ceiling, and the door answered `500`. `main` already passes. This
 * file guards it, and guards the #35028 change beside it: the ledger write that
 * now leaves the body's transaction for the `telemetry` datasource must not
 * reintroduce a wait on SQLite's one connection.
 *
 * Measured in composition: a real `ObjectQL` on a real better-sqlite3
 * `SqlDriver` (the `os dev` primary), the real `QuickJSScriptRunner` and
 * action-body factory, and the real `/actions` door
 * (`HttpDispatcher.handleActions`), whose engine double only hands the door's
 * action context to the bound handler, as `ObjectQL.executeAction` does. The
 * ledger writer is a stand-in with plugin-audit's shape: an `afterInsert` hook
 * writing `sys_audit_log` and `sys_activity` through `ctx.api.sudo()`, under
 * the handle the write carries.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
// Paid at collection, not inside a clocked case (`pnpm check:test-source-alias`).
import '@objectstack/metadata';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { actionBodyRunnerFactory } from './body-runner.js';
import { QuickJSScriptRunner } from './quickjs-runner.js';
import { HttpDispatcher } from '../http-dispatcher.js';
import { installDefaultOrganization } from '../default-organization.testkit.js';

const CLAIM = {
  name: 'rux_claim',
  fields: {
    name: { type: 'text', name: 'name' },
    total_amount: { type: 'summary', name: 'total_amount', summaryOperations: { object: 'rux_line', function: 'sum', field: 'amount' } },
  },
};
const LINE = {
  name: 'rux_line',
  fields: {
    claim: { type: 'master_detail', name: 'claim', reference: 'rux_claim', deleteBehavior: 'cascade' },
    amount: { type: 'number', name: 'amount' },
  },
};
const AUDIT = { name: 'sys_audit_log', lifecycle: { class: 'audit', retention: { maxAge: '90d' } }, fields: { action: { type: 'text', name: 'action' }, record_id: { type: 'text', name: 'record_id' } } };
const ACTIVITY = { name: 'sys_activity', lifecycle: { class: 'telemetry', retention: { maxAge: '14d' } }, fields: { action: { type: 'text', name: 'action' }, record_id: { type: 'text', name: 'record_id' } } };

/** The body: a claim, then two lines inside one transaction — the travel-expense shape. */
const SOURCE = `
  const claim = await ctx.api.object('rux_claim').insert({ name: 'C-1' });
  await ctx.api.transaction(async () => {
    await ctx.api.object('rux_line').insert({ claim: claim.id, amount: 860 });
    await ctx.api.object('rux_line').insert({ claim: claim.id, amount: 345 });
  });
  return { claim: claim.id };`;

/**
 * The live Postgres cell runs only where a server is provisioned (the same
 * variable `driver-sql`'s live dialect matrix reads); elsewhere it is skipped,
 * by name.
 */
const PG_URL = process.env.OS_TEST_POSTGRES_URL;

/** One insert inside the body's transaction: what COMMIT does with it is the question. */
const ONE_LINE_SOURCE = `
  const claim = await ctx.api.object('rux_claim').insert({ name: 'C-2' });
  await ctx.api.transaction(async () => {
    await ctx.api.object('rux_line').insert({ claim: claim.id, amount: 430 });
  });
  return { claim: claim.id };`;

const SYS = { context: { isSystem: true } } as const;

/** Far below the sandbox's 30 s wall clock: a stall cannot pass for a slow run. */
const WALL_CLOCK_BOUND_MS = 10_000;

describe('an action body transaction inserting a roll-up child completes on SQLite (#34998 regression, #35028)', () => {
  let engine: ObjectQL | null = null;
  let dir: string | null = null;

  afterEach(async () => {
    try { await engine?.destroy(); } catch { /* noop */ }
    engine = null;
    if (dir) { rmSync(dir, { recursive: true, force: true }); dir = null; }
    if (pgSchema) {
      const admin = new SqlDriver({ client: 'pg', connection: PG_URL } as any);
      try { await admin.getKnex().raw('drop schema if exists ?? cascade', [pgSchema]); } finally { await admin.disconnect(); }
      pgSchema = null;
    }
  });

  /** A Postgres primary in a schema of its own, dropped after the case. */
  let pgSchema: string | null = null;
  async function livePgPrimary(): Promise<SqlDriver> {
    pgSchema = `rux_35028_${process.pid}_${Date.now()}`;
    const admin = new SqlDriver({ client: 'pg', connection: PG_URL } as any);
    try { await admin.getKnex().raw('create schema ??', [pgSchema]); } finally { await admin.disconnect(); }
    return new SqlDriver({ client: 'pg', connection: PG_URL, searchPath: [pgSchema] } as any);
  }

  async function boot(split: boolean, primaryOn: 'sqlite' | 'pg' = 'sqlite') {
    dir = mkdtempSync(join(tmpdir(), 'os-rux-35028-'));
    const sqlite = (file: string) => new SqlDriver({ client: 'better-sqlite3', connection: { filename: join(dir!, file) }, useNullAsDefault: true });
    const primary = primaryOn === 'pg' ? await livePgPrimary() : sqlite('data.sqlite');
    const e = new ObjectQL();
    engine = e;
    let telemetry: SqlDriver | undefined;
    if (split) {
      telemetry = sqlite('telemetry.sqlite');
      Object.defineProperty(telemetry, 'name', { value: ObjectQL.LIFECYCLE_DATASOURCE });
      e.registerDriver(telemetry as any);
    }
    e.registerDriver(primary as any, true);
    const begins = { count: 0 };
    const begin = primary.beginTransaction.bind(primary);
    (primary as any).beginTransaction = async (...a: unknown[]) => { begins.count += 1; return (begin as any)(...a); };
    await e.init();
    for (const o of [CLAIM, LINE, AUDIT, ACTIVITY]) e.registry.registerObject(o as any);
    await installDefaultOrganization(e as any);
    const ledger: string[] = [];
    e.registerHook('afterInsert', async (ctx: any) => {
      if (ctx.object !== 'rux_line' && ctx.object !== 'rux_claim') return;
      try {
        const sys = ctx.api.sudo();
        await sys.object('sys_audit_log').create({ action: 'create', record_id: String(ctx.result?.id) });
        await sys.object('sys_activity').create({ action: 'created', record_id: String(ctx.result?.id) });
        ledger.push('ok');
      } catch (err) {
        ledger.push(`FAILED ${String((err as Error)?.message)}`);
      }
    }, { packageId: 'rux' } as any);
    return { e, ledger, primary, telemetry, begins };
  }

  async function throughActionsDoor(e: ObjectQL, source = SOURCE) {
    const action = { name: 'rux_file', objectName: 'rux_claim', type: 'script', body: { language: 'js', source, capabilities: ['api.write', 'api.transaction'] } };
    const handler = actionBodyRunnerFactory(new QuickJSScriptRunner(), { ql: e, appId: 'rux' })(action as any);
    expect(handler, 'the action body must bind').toBeTypeOf('function');
    const objectDef = { name: 'rux_claim', actions: [action] };
    const ql: any = {
      executeAction: vi.fn(async (_o: string, _a: string, ctx: any) => handler!(ctx)),
      // The door builds the body's `ctx.api` from the engine's own scoped
      // context (`buildActionApi`), as on a real boot, so the body's
      // `ctx.api.transaction` drives the real begin/commit trio.
      createContext: (ec: any) => e.createContext(ec),
      getSchema: (n: string) => (n === objectDef.name ? objectDef : undefined),
      registry: { getObject: (n: string) => (n === objectDef.name ? objectDef : undefined), getItem: () => undefined },
      find: vi.fn(async () => []),
      insert: vi.fn(), update: vi.fn(), delete: vi.fn(),
    };
    const metadata: any = { load: vi.fn(async () => null), listObjects: vi.fn(async () => [objectDef]), getObject: vi.fn(async () => objectDef) };
    const kernel: any = { context: { getService: (n: string) => (n === 'objectql' || n === 'data' ? ql : n === 'metadata' ? metadata : null) } };
    const started = Date.now();
    const res: any = await new HttpDispatcher(kernel).handleActions(
      '/rux_claim/rux_file',
      'POST',
      {},
      { request: {}, environmentId: 'platform', executionContext: { userId: 'u1', systemPermissions: [] } } as any,
    );
    return { response: res.response, elapsed: Date.now() - started };
  }

  for (const split of [false, true]) {
    const layout = split ? 'beside a telemetry datasource' : 'on one datasource';
    it(`${layout}: the body answers 200 inside the bound, the lines and the roll-up land, and every ledger write succeeds`, async () => {
      const { e, ledger, begins } = await boot(split);
      const { response, elapsed } = await throughActionsDoor(e);
      // Precondition: the body really opened a driver transaction.
      expect(begins.count).toBe(1);

      expect(response.status, JSON.stringify(response.body)).toBe(200);
      expect(elapsed).toBeLessThan(WALL_CLOCK_BOUND_MS);
      const claimId = String(response.body?.data?.claim ?? response.body?.claim);
      const lines = (await e.find('rux_line', { where: { claim: claimId }, ...SYS })) as any[];
      expect(lines.map((l) => Number(l.amount)).sort((a, b) => a - b)).toEqual([345, 860]);
      const claim = (await e.findOne('rux_claim', { where: { id: claimId }, ...SYS })) as any;
      expect(Number(claim?.total_amount)).toBe(1205);
      // One claim and two lines, each with both ledger rows.
      expect(ledger).toEqual(['ok', 'ok', 'ok']);
      const audit = (await e.find('sys_audit_log', SYS)) as any[];
      expect(audit.map((a) => a.record_id).sort()).toEqual([claimId, ...lines.map((l) => String(l.id))].sort());
    }, 30_000);
  }

  // [#35028] The Postgres face of the same defect, measured in-process by the
  // reading: the ledger statement the trio's handle carried onto the primary
  // connection failed there (42P01), which aborts a Postgres transaction — so
  // a second insert failed (25P02), and a lone insert's COMMIT resolved as a
  // ROLLBACK, with the action answering success. With the owner recorded, the
  // ledger write runs on telemetry's own connection and touches neither.
  describe.skipIf(!PG_URL)('a live Postgres primary beside a telemetry datasource (OS_TEST_POSTGRES_URL)', () => {
    it('two inserts: the body answers 200, both lines and the roll-up are on disk, every ledger write succeeds', async () => {
      const { e, ledger, begins } = await boot(true, 'pg');
      const { response } = await throughActionsDoor(e);
      expect(begins.count).toBe(1);
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      const claimId = String(response.body?.data?.claim ?? response.body?.claim);
      const lines = (await e.find('rux_line', { where: { claim: claimId }, ...SYS })) as any[];
      expect(lines.map((l) => Number(l.amount)).sort((a, b) => a - b)).toEqual([345, 860]);
      expect(Number(((await e.findOne('rux_claim', { where: { id: claimId }, ...SYS })) as any)?.total_amount)).toBe(1205);
      expect(ledger).toEqual(['ok', 'ok', 'ok']);
    }, 30_000);

    it('one insert: COMMIT keeps it — the line is on disk after the action answers 200', async () => {
      const { e, ledger } = await boot(true, 'pg');
      const { response } = await throughActionsDoor(e, ONE_LINE_SOURCE);
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      const claimId = String(response.body?.data?.claim ?? response.body?.claim);
      const lines = (await e.find('rux_line', { where: { claim: claimId }, ...SYS })) as any[];
      expect(lines.map((l) => Number(l.amount))).toEqual([430]);
      expect(ledger).toEqual(['ok', 'ok']);
    }, 30_000);
  });
});
