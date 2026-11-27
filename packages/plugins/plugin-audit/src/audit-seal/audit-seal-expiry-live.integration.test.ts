// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectKernel } from '@objectstack/core';
import { ObjectQL, ObjectQLPlugin, type LifecycleService } from '@objectstack/objectql';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';
import { SysSecret } from '@objectstack/platform-objects/system';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AuditPlugin } from '../audit-plugin.js';
import { installDefaultOrganization } from '../default-organization.testkit.js';
import { SysAuditLog } from '../objects/sys-audit-log.object.js';
import { RedactionAmender } from './amendment-writer.js';
import { auditExpiryCutoff } from './expiry.js';
import { amendmentBodyFromRow, checkpointBodyFromRow, checkpointDigest, type ExpiryAmendmentBody } from './signed-body.js';
import { bindingCrypto } from './seal-store.testkit.js';
import type { AuditSealer } from './sealer.js';
import { verifyAuditLedger, type AuditVerifyReport } from './verifier.js';

/**
 * ADR-0154 D8 + D10, end to end on a real kernel over SQLite with an `archive`
 * datasource: `sys_audit_log` is sealed by its own declaration (no opt-in
 * here), the plugin's sealer seals it, and the kernel's own LifecycleService
 * archives it and expires it past `archive.keep` through the sealer — each
 * chain's signed `expiry` amendment stored before a row goes. The live check
 * then tells every case apart: a row changed outside the platform reads
 * `modified`, a deleted one `missing`, a rewritten one `redacted`, an expired
 * one `expired` (while its checkpoint stands) or gone with its checkpoint
 * under an honoured expiry, and an untouched window reads `unmodified`
 * whether its rows sit in the hot store or the archive. The rows carry
 * sentinels only.
 */

const H = 60 * 60 * 1000;
const DAY = 24 * H;
const YEAR = 365 * DAY;
const SYS = { isSystem: true } as const;
const LOG = 'sys_audit_log';

type Row = Record<string, unknown>;
interface Driver {
  find(o: string, q: Row): Promise<Row[]>;
  create(o: string, r: Row): Promise<unknown>;
  update(o: string, id: string, r: Row, options?: { preserveAudit?: boolean }): Promise<unknown>;
  delete(o: string, id: string): Promise<unknown>;
}

const verdicts = (report: AuditVerifyReport, ids: readonly string[]) =>
  Object.fromEntries(report.rows.filter((r) => ids.includes(r.row)).map((r) => [r.row, r.verdict === 'late' && !r.sealed ? 'late!' : r.verdict]));
const chainOf = (report: AuditVerifyReport, chain: string) => report.chains.find((c) => c.object === LOG && c.chain === chain);

/** A kernel over SQLite with an `archive` datasource and `plugin` composed; the ledger as the plugin declares it. */
async function boot(plugin: AuditPlugin) {
  const kernel = new ObjectKernel({ logger: { level: 'silent' } });
  await kernel.use(new ObjectQLPlugin({ lifecycle: { initialDelayMs: 24 * H, sweepIntervalMs: 24 * H } }));
  await kernel.use(plugin);
  await kernel.bootstrap();
  const engine = kernel.getService<ObjectQL>('objectql');
  const sqlite = new SqliteWasmDriver({ filename: ':memory:' });
  await sqlite.connect();
  engine.registerDriver(sqlite, true);
  const cold = new SqliteWasmDriver({ filename: ':memory:' });
  Object.defineProperty(cold, 'name', { value: 'archive' });
  await cold.connect();
  engine.registerDriver(cold);
  engine.registry.registerObject(SysSecret as never, 'com.objectstack.audit.test.expiry');
  await engine.syncSchemas();
  await cold.syncSchema(LOG, engine.registry.getObject(LOG) as never);
  await installDefaultOrganization(engine);
  const lifecycle = kernel.getService<LifecycleService>('lifecycle');
  const sealer = (plugin as unknown as { sealer: AuditSealer }).sealer;
  await sealer.stop(); // drive the passes here, not on the loop's clock
  return { kernel, engine, cold, lifecycle, sealer };
}

describe('sys_audit_log seals by default, and expires by whole checkpoints across hot and archive (ADR-0154 D8, D10)', () => {
  const crypto = bindingCrypto();
  const plugin = new AuditPlugin({ cryptoProvider: () => crypto });
  let kernel: ObjectKernel;
  let engine: ObjectQL;
  let cold: SqliteWasmDriver;
  let lifecycle: LifecycleService;
  let sealer: AuditSealer;
  const now = Date.now();
  const hour = Math.floor(now / H) * H;
  const old = hour - 8 * YEAR; // past `archive.keep: 7y`
  const mid = hour - YEAR; // past `archive.after: 90d`, within `keep`
  const recent = hour - 3 * H; // a settled window, still hot
  const iso = (ms: number) => new Date(ms).toISOString();
  const hot = () => engine.getDriverForObject(LOG) as unknown as Driver;
  const archive = () => cold as unknown as Driver;
  const verify = () => verifyAuditLedger({ engine: engine as never, crypto });
  const entry = (id: string, at: number, tenant: string): Row => ({
    id, created_at: iso(at), action: 'update', object_name: 'crm_note', record_id: `${id}_rec`, tenant_id: tenant,
    new_value: JSON.stringify({ id: `${id}_rec`, note: 'sentinel' }),
  });
  const checkpoints = async (chain?: string) =>
    ((await engine.find('sys_audit_checkpoint', { where: { sealed_object: LOG, ...(chain ? { chain_key: chain } : {}) }, context: SYS })) as Row[])
      .map((row) => ({ row, body: checkpointBodyFromRow(row) }))
      .sort((a, b) => a.body.sequence - b.body.sequence);
  const expiries = async () =>
    ((await engine.find('sys_audit_amendment', { where: { sealed_object: LOG, kind: 'expiry' }, context: SYS })) as Row[])
      .map((row) => amendmentBodyFromRow(row) as ExpiryAmendmentBody)
      .sort((a, b) => a.tenant_id!.localeCompare(b.tenant_id!));
  const secretExists = async (handle: string) =>
    ((await engine.find('sys_secret', { where: { id: handle }, context: SYS })) as Row[]).length > 0;
  const where = async (id: string) => ({
    hot: (await hot().find(LOG, { where: { id } })).length > 0,
    archive: (await archive().find(LOG, { where: { id } })).length > 0,
  });
  const keepRequest = () => ({ object: LOG, policy: 'archive.keep', policyValue: '7y', cutoff: iso(now - 7 * YEAR) });

  let oldSeeds: string[] = [];

  beforeAll(async () => {
    ({ kernel, engine, cold, lifecycle, sealer } = await boot(plugin));
    // org_a: an expired window, a window that goes to the archive, and a recent window that stays hot.
    await hot().create(LOG, entry('a_old1', old + 60_000, 'org_a'));
    await hot().create(LOG, entry('a_old2', old + 120_000, 'org_a'));
    await hot().create(LOG, entry('a_mid', mid + 60_000, 'org_a'));
    await hot().create(LOG, entry('a_keep', recent + 60_000, 'org_a'));
    await hot().create(LOG, entry('a_mod', recent + 120_000, 'org_a'));
    await hot().create(LOG, entry('a_del', recent + 180_000, 'org_a'));
    await hot().create(LOG, entry('a_red', recent + 240_000, 'org_a'));
    // org_b: one expired window only, so the whole chain expires.
    await hot().create(LOG, entry('b_old', old + 180_000, 'org_b'));
    // Seals 3 windows for org_a and one for org_b, one pass after another.
    for (let pass = 0; pass < 5 && (await sealer.runPass()) > 0; pass++);
    oldSeeds = (await checkpoints()).filter((c) => c.body.window_start === iso(Math.floor(old / H) * H)).map((c) => c.body.seed_handle);
  }, 120_000);

  afterAll(async () => {
    if (kernel) await Promise.race([kernel.shutdown(), new Promise<void>((r) => setTimeout(r, 10_000))]);
  }, 30_000);

  it('the ledger carries the seal by its own declaration, and every row is sealed', async () => {
    expect((engine.registry.getObject(LOG) as { lifecycle: { seal?: unknown } }).lifecycle.seal).toEqual({ valueFields: ['old_value', 'new_value', 'metadata'] });
    expect(SysAuditLog.lifecycle?.seal).toEqual({ valueFields: ['old_value', 'new_value', 'metadata'] });
    expect((await checkpoints('org:org_a')).map((c) => [c.body.sequence, c.body.row_ids])).toEqual([
      [0, ['a_old1', 'a_old2']],
      [1, ['a_mid']],
      [2, ['a_keep', 'a_mod', 'a_del', 'a_red']],
    ]);
    expect((await checkpoints('org:org_b')).map((c) => [c.body.sequence, c.body.row_ids])).toEqual([[0, ['b_old']]]);
    expect(oldSeeds).toHaveLength(2);
    const report = await verify();
    expect(report.faults).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it('the kernel\'s lifecycle service holds the sealer\'s expiry: an interrupted expiry has signed its amendment, and its rows read expired', async () => {
    // What a sweep stopped right after the amendment leaves: the amendment stored, every row and checkpoint still there.
    const runs = await sealer.expire(keepRequest());
    expect(runs.map((r) => [r.chain, [...r.rowIds].sort()])).toEqual([
      ['org:org_a', ['a_old1', 'a_old2']],
      ['org:org_b', ['b_old']],
    ]);
    const [a, b] = await expiries();
    const [a0] = await checkpoints('org:org_a');
    expect(a).toMatchObject({
      kind: 'expiry', tenant_id: 'org_a', first_sequence: 0, last_sequence: 0, policy: 'archive.keep', policy_value: '7y',
      last_removed_digest: checkpointDigest(a0.body),
    });
    expect(Date.parse(a.covered_to)).toBeLessThanOrEqual(auditExpiryCutoff(now - 7 * YEAR));
    expect(b).toMatchObject({ tenant_id: 'org_b', first_sequence: 0, last_sequence: 0 });

    const report = await verify();
    expect(verdicts(report, ['a_old1', 'a_old2', 'b_old'])).toEqual({ a_old1: 'expired', a_old2: 'expired', b_old: 'expired' });
    expect(report.faults).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it('the sweep finishes it: archives, then deletes exactly the expired rows from both stores, and their checkpoints and seeds after them', async () => {
    const report = await lifecycle.sweep();
    expect(report.errors).toEqual([]);
    expect(report.swept).toContainEqual(expect.objectContaining({ object: LOG, policy: 'archive', archived: 4 }));
    expect(report.swept).toContainEqual(expect.objectContaining({ object: LOG, policy: 'expiry', deleted: 3 }));
    // Resumed under the stored amendments: no second one.
    expect((await expiries()).length).toBe(2);
    for (const id of ['a_old1', 'a_old2', 'b_old']) expect(await where(id)).toEqual({ hot: false, archive: false });
    expect(await where('a_mid')).toEqual({ hot: false, archive: true });
    expect(await where('a_keep')).toEqual({ hot: true, archive: false });
    expect((await checkpoints('org:org_a')).map((c) => c.body.sequence)).toEqual([1, 2]);
    expect(await checkpoints('org:org_b')).toEqual([]);
    for (const handle of oldSeeds) expect(await secretExists(handle)).toBe(false);
  });

  it('a second sweep the same day signs nothing more and deletes nothing', async () => {
    const report = await lifecycle.sweep();
    expect(report.swept).toContainEqual(expect.objectContaining({ object: LOG, policy: 'expiry', deleted: 0 }));
    expect((await expiries()).length).toBe(2);
  });

  it('the live check honours the expiries: no gap, the untouched windows read unmodified across hot and archive', async () => {
    const report = await verify();
    expect(report.faults).toEqual([]);
    expect(report.rows).toEqual([]);
    expect(chainOf(report, 'org:org_a')).toMatchObject({ checkpoints: 2, counts: expect.objectContaining({ unmodified: 5, expired: 0 }) });
    expect(report.ok).toBe(true);
  });

  it('a chain that expired whole chains its next checkpoint onto the expiry: it links to the last removed digest', async () => {
    await hot().create(LOG, entry('b_next', recent + 300_000, 'org_b'));
    expect(await sealer.runPass()).toBeGreaterThan(0);
    const [next] = await checkpoints('org:org_b');
    const [, b] = await expiries();
    expect(next.body).toMatchObject({ sequence: 1, row_ids: ['b_next'], previous_digest: b.last_removed_digest });
    const report = await verify();
    expect(report.faults).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it('still tells modified, missing and redacted rows apart beside the expiry', async () => {
    await hot().update(LOG, 'a_mod', { action: 'delete' });
    await hot().delete(LOG, 'a_del');
    const amender = new RedactionAmender({ engine: engine as never, crypto }, 'pin: expiry e2e');
    const patch = { new_value: JSON.stringify({ id: 'a_red_rec', redacted: true }) };
    const decision = await amender.decide(LOG, 'a_red', patch);
    expect(decision.kind).toBe('amend');
    await amender.write(LOG, decision);
    const stored = (await hot().find(LOG, { where: { id: 'a_red' } }))[0]!;
    await hot().update(LOG, 'a_red', { ...patch, updated_at: stored.updated_at }, { preserveAudit: true });

    const report = await verify();
    expect(verdicts(report, ['a_mod', 'a_del', 'a_red', 'a_keep', 'a_mid', 'b_next'])).toEqual({ a_mod: 'modified', a_del: 'missing', a_red: 'redacted' });
    expect(report.faults).toEqual([]);
    expect(report.ok).toBe(false);
  });
});

describe('an expiry signs only what it can show the platform sealed (ADR-0154 D6, D8)', () => {
  const crypto = bindingCrypto();
  const plugin = new AuditPlugin({ cryptoProvider: crypto });
  let kernel: ObjectKernel;
  let engine: ObjectQL;
  let lifecycle: LifecycleService;
  let sealer: AuditSealer;
  const now = Date.now();
  const old = Math.floor(now / H) * H - 8 * YEAR;
  const iso = (ms: number) => new Date(ms).toISOString();
  const hot = () => engine.getDriverForObject(LOG) as unknown as Driver;
  const entry = (id: string, at: number, tenant: string): Row => ({ id, created_at: iso(at), action: 'update', object_name: 'crm_note', record_id: `${id}_rec`, tenant_id: tenant });
  const checkpointOf = async (chain: string, sequence: number) =>
    ((await engine.find('sys_audit_checkpoint', { where: { sealed_object: LOG, chain_key: chain, sequence }, context: SYS })) as Row[])[0]!;
  const expiries = async () => (await engine.find('sys_audit_amendment', { where: { sealed_object: LOG, kind: 'expiry' }, context: SYS })) as Row[];
  let cold: SqliteWasmDriver;
  /** Whether either store still holds row `id`: the sweep archives every row here before it expires any. */
  const present = async (id: string) =>
    (await hot().find(LOG, { where: { id } })).length + (await (cold as unknown as Driver).find(LOG, { where: { id } })).length > 0;

  beforeAll(async () => {
    ({ kernel, engine, cold, lifecycle, sealer } = await boot(plugin));
    // Each chain seals two windows, both past `keep`.
    for (const tenant of ['org_gap', 'org_forged', 'org_ok']) {
      await hot().create(LOG, entry(`${tenant}_0`, old + 60_000, tenant));
      await hot().create(LOG, entry(`${tenant}_1`, old + H + 60_000, tenant));
    }
    for (let pass = 0; pass < 5 && (await sealer.runPass()) > 0; pass++);
    // org_gap: its first checkpoint removed outside the platform. org_forged: its second re-signed by no trusted key.
    await hot().delete('sys_audit_checkpoint', String((await checkpointOf('org:org_gap', 0)).id));
    await hot().update('sys_audit_checkpoint', String((await checkpointOf('org:org_forged', 1)).id), { signature: Buffer.alloc(64).toString('base64') });
  }, 120_000);

  afterAll(async () => {
    if (kernel) await Promise.race([kernel.shutdown(), new Promise<void>((r) => setTimeout(r, 10_000))]);
  }, 30_000);

  it('expires a sound chain whole, stops a chain at a checkpoint no trusted key signed, and keeps a chain with a gap', async () => {
    const logger = (sealer as unknown as { options: { logger: { warn(m: string): void } } }).options.logger;
    const warn = vi.spyOn(logger, 'warn');
    const report = await lifecycle.sweep();
    expect(report.errors).toEqual([]);
    const warned = warn.mock.calls.map(([m]) => String(m));
    warn.mockRestore();

    const byChain = Object.fromEntries((await expiries()).map((row) => {
      const body = amendmentBodyFromRow(row) as ExpiryAmendmentBody;
      return [body.tenant_id, [body.first_sequence, body.last_sequence]];
    }));
    expect(byChain).toEqual({ org_ok: [0, 1], org_forged: [0, 0] });
    expect([await present('org_ok_0'), await present('org_ok_1')]).toEqual([false, false]);
    expect([await present('org_forged_0'), await present('org_forged_1')]).toEqual([false, true]);
    expect([await present('org_gap_0'), await present('org_gap_1')]).toEqual([true, true]);
    expect(warned.filter((m) => /'sys_audit_log' chain 'org:org_gap' is NOT expired: its first remaining checkpoint is sequence 1/.test(m))).toHaveLength(1);
    expect(warned.filter((m) => /'sys_audit_log' chain 'org:org_forged' is expired only up to its checkpoint 1/.test(m))).toHaveLength(1);
  });

  it('never resumes a stored expiry over a checkpoint no trusted key signed: it deletes no row and no seed it lists', async () => {
    // org_forged's admitted expiry ends at sequence 0, which the sweep removed. A row put there by hand, listing a
    // live row and another chain's seed, sits inside that expiry's range.
    const real = await checkpointOf('org:org_forged', 1);
    const seed = String((await checkpointOf('org:org_gap', 1)).seed_handle);
    await hot().create('sys_audit_checkpoint', { ...real, id: 'forged_resume_0', sequence: 0, previous_digest: null, seed_handle: seed });
    const before = (await expiries()).length;
    const logger = (sealer as unknown as { options: { logger: { warn(m: string): void } } }).options.logger;
    const warn = vi.spyOn(logger, 'warn');
    const report = await lifecycle.sweep();
    const warned = warn.mock.calls.map(([m]) => String(m));
    warn.mockRestore();

    expect(report.errors).toEqual([]);
    expect(await present('org_forged_1')).toBe(true);
    expect((await engine.find('sys_secret', { where: { id: seed }, context: SYS })) as Row[]).toHaveLength(1);
    expect(((await engine.find('sys_audit_checkpoint', { where: { id: 'forged_resume_0' }, context: SYS })) as Row[])).toHaveLength(1);
    expect((await expiries()).length).toBe(before);
    expect(warned.filter((m) => /'sys_audit_log' chain 'org:org_forged' is NOT expired further: the range its expiry 0–0/.test(m))).toHaveLength(1);
  });

  it('a chain head never follows an expiry amendment no trusted key signed', async () => {
    // org_ok expired whole: its head is its expiry. A newer amendment row put there by hand names a later sequence.
    const [stored] = (await expiries()).filter((row) => (amendmentBodyFromRow(row) as ExpiryAmendmentBody).tenant_id === 'org_ok');
    const admitted = amendmentBodyFromRow(stored) as ExpiryAmendmentBody;
    await hot().create('sys_audit_amendment', {
      ...stored, id: 'forged_head', last_sequence: admitted.last_sequence + 5, first_sequence: admitted.last_sequence + 1,
      last_removed_digest: 'f'.repeat(64), signature: Buffer.alloc(64).toString('base64'),
    });
    await hot().create(LOG, entry('org_ok_next', Math.floor(now / H) * H - 3 * H + 60_000, 'org_ok'));
    expect(await sealer.runPass()).toBeGreaterThan(0);
    const next = checkpointBodyFromRow(await checkpointOf('org:org_ok', admitted.last_sequence + 1));
    expect(next).toMatchObject({ row_ids: ['org_ok_next'], previous_digest: admitted.last_removed_digest });
  });
});
