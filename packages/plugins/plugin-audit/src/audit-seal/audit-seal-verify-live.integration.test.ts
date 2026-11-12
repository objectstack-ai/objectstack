// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { ObjectKernel } from '@objectstack/core';
import { ObjectQL, ObjectQLPlugin } from '@objectstack/objectql';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';
import { SysSecret } from '@objectstack/platform-objects/system';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditPlugin } from '../audit-plugin.js';
import { installDefaultOrganization } from '../default-organization.testkit.js';
import { checkpointBodyFromRow, signedBodyBytes, verifyAuditLedger, type AuditVerifyReport } from './index.js';
import { bindingCrypto } from './seal-store.testkit.js';
import type { AuditSealer } from './sealer.js';

/**
 * ADR-0154 D9 on a live engine over SQLite (driver-sql through the wasm
 * client), with an `archive` datasource: the plugin's own sealer seals rows at
 * rest, and the live check reads them back from the hot store and the archive
 * against the key the deployment vouches for. Each leg changes the stores the
 * way a database-level actor would — through the driver, below every hook.
 */

const PROBE = 'verify_probe';
const H = 60 * 60 * 1000;
const DAY = 24 * H;
const SYS = { isSystem: true } as const;

const probe = {
  name: PROBE,
  label: 'Verify Probe',
  systemFields: false,
  fields: {
    id: { name: 'id', label: 'ID', type: 'text' },
    created_at: { name: 'created_at', label: 'Created At', type: 'datetime' },
    action: { name: 'action', label: 'Action', type: 'text' },
    tenant_id: { name: 'tenant_id', label: 'Organization', type: 'text' },
    payload: { name: 'payload', label: 'Payload', type: 'textarea' },
  },
  lifecycle: { class: 'audit', retention: { maxAge: '90d' }, archive: { after: '90d', to: 'archive' }, seal: { valueFields: ['payload'] } },
};

type Row = Record<string, unknown>;
interface Driver {
  find(o: string, q: Row): Promise<Row[]>;
  create(o: string, r: Row): Promise<unknown>;
  update(o: string, id: string, r: Row): Promise<unknown>;
  delete(o: string, id: string): Promise<unknown>;
}

const verdicts = (report: AuditVerifyReport) =>
  Object.fromEntries(report.rows.map((r) => [r.row, r.verdict === 'late' && !r.sealed ? 'late!' : r.verdict]));

describe('os audit verify, the live check, on a live engine (ADR-0154 D9)', () => {
  const crypto = bindingCrypto();
  const plugin = new AuditPlugin({ cryptoProvider: crypto });
  let kernel: ObjectKernel;
  let engine: ObjectQL;
  let cold: SqliteWasmDriver;
  const past = Math.floor(Date.now() / H) * H - 3 * H; // a window three hours ago: settled
  const iso = (ms: number) => new Date(ms).toISOString();
  const hot = () => engine.getDriverForObject(PROBE) as unknown as Driver;
  const archive = () => cold as unknown as Driver;
  const verify = () => verifyAuditLedger({ engine: engine as never, crypto });
  const sealer = () => (plugin as unknown as { sealer: AuditSealer }).sealer;

  beforeAll(async () => {
    kernel = new ObjectKernel({ logger: { level: 'silent' } });
    await kernel.use(new ObjectQLPlugin());
    await kernel.use(plugin);
    await kernel.bootstrap();
    engine = kernel.getService<ObjectQL>('objectql');
    const sqlite = new SqliteWasmDriver({ filename: ':memory:' });
    await sqlite.connect();
    engine.registerDriver(sqlite, true);
    // The archive datasource, registered under its name as the datasource-connection service does.
    cold = new SqliteWasmDriver({ filename: ':memory:' });
    Object.defineProperty(cold, 'name', { value: 'archive' });
    await cold.connect();
    engine.registerDriver(cold);
    engine.registry.registerObject(probe as never, 'com.objectstack.audit.test.verify-probe');
    engine.registry.registerObject(SysSecret as never, 'com.objectstack.audit.test.verify-probe');
    await engine.syncSchemas();
    await cold.syncSchema(PROBE, probe);
    await installDefaultOrganization(engine);

    // Three rows of one organization in one checkpoint, and one of the deployment chain.
    await hot().create(PROBE, { id: 'p1', created_at: iso(past + 60_000), action: 'update', tenant_id: 'org_a', payload: '{"from":1}' });
    await hot().create(PROBE, { id: 'p2', created_at: iso(past + 120_000), action: 'delete', tenant_id: 'org_a', payload: null });
    await hot().create(PROBE, { id: 'p4', created_at: iso(past + 150_000), action: 'update', tenant_id: 'org_a', payload: 'kept' });
    await hot().create(PROBE, { id: 'p3', created_at: iso(past + 180_000), action: 'config', tenant_id: null, payload: 'x' });

    await sealer().stop(); // drive the passes here, not on the loop's clock
    expect(await sealer().runPass()).toBe(2);
  }, 120_000);

  afterAll(async () => {
    if (kernel) await Promise.race([kernel.shutdown(), new Promise<void>((r) => setTimeout(r, 10_000))]);
  }, 30_000);

  it('reads the sealed ledger unmodified, a row the archive now holds included, and names the key it trusted', async () => {
    const [moved] = await hot().find(PROBE, { where: { id: 'p3' } });
    await archive().create(PROBE, moved);
    await hot().delete(PROBE, 'p3');
    const report = await verify();
    expect(report.faults).toEqual([]);
    expect(report.rows).toEqual([]);
    expect(report.totals.unmodified).toBe(4);
    const [checkpoint] = await engine.find('sys_audit_checkpoint', { context: SYS });
    expect(report.keys).toEqual({ trusted: [checkpointBodyFromRow(checkpoint).signing_key_id], untrusted: [] });
    expect(report.ok).toBe(true);
  });

  it('reads an edited row modified and a deleted one missing, and their untouched sibling unmodified', async () => {
    await hot().update(PROBE, 'p1', { payload: '{"from":2}' });
    await hot().delete(PROBE, 'p2');
    const report = await verify();
    expect(verdicts(report)).toEqual({ p1: 'modified', p2: 'missing' });
    expect(report.chains.find((c) => c.chain === 'org:org_a')!.counts).toMatchObject({ unmodified: 1, modified: 1, missing: 1 });
    expect(report.ok).toBe(false);
  });

  it('reads a row back-dated past the late horizon late and unsealed, though a sealing pass ran after it', async () => {
    await hot().create(PROBE, { id: 'backdated', created_at: iso(past - 8 * DAY), action: 'update', tenant_id: 'org_a', payload: 'forged' });
    await sealer().runPass();
    const report = await verify();
    expect(report.rows.find((r) => r.row === 'backdated')).toMatchObject({ verdict: 'late', sealed: false, sequence: null });
    expect(report.totals.unsealed).toBe(1);
  });

  it('trusts no key planted beside the real one: a checkpoint re-signed under it holds nothing', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const raw = Buffer.from((publicKey.export({ format: 'jwk' }) as { x: string }).x, 'base64url');
    const fingerprint = createHash('sha256').update(raw).digest('hex');
    await hot().create('sys_audit_signing_key', {
      id: 'planted', fingerprint, public_key: raw.toString('base64'), private_handle: 'no-such-secret', status: 'active', created_at: iso(Date.now()), retired_at: null,
    });
    const [deployment] = await engine.find('sys_audit_checkpoint', { where: { chain_key: 'deployment' }, context: SYS });
    const body = { ...checkpointBodyFromRow(deployment), signing_key_id: fingerprint };
    await hot().update('sys_audit_checkpoint', String(deployment.id), { signing_key_id: fingerprint, signature: sign(null, signedBodyBytes(body), privateKey).toString('base64') });
    const report = await verify();
    expect(report.keys.untrusted).toEqual([fingerprint]);
    expect(report.faults.map((f) => [f.chain, f.kind])).toEqual([['deployment', 'untrusted_key']]);
    expect(verdicts(report)).toMatchObject({ p3: 'late!' });
    expect(report.ok).toBe(false);
  });
});
