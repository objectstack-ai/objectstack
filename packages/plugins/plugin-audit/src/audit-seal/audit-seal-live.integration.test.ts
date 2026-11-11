// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { createPublicKey, verify } from 'node:crypto';
import { ObjectKernel } from '@objectstack/core';
import { ObjectQL, ObjectQLPlugin } from '@objectstack/objectql';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';
import { SysSecret } from '@objectstack/platform-objects/system';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditPlugin } from '../audit-plugin.js';
import { installDefaultOrganization } from '../default-organization.testkit.js';
import {
  canonicalValue,
  checkpointBodyFromRow,
  checkpointSeedContext,
  columnSaltsOf,
  decodeCheckpointSeed,
  inLeafOrder,
  leafHash,
  leafInput,
  merkleRoot,
  signedBodyBytes,
  type CheckpointSignedBody,
} from './index.js';
import { bindingCrypto } from './seal-store.testkit.js';
import type { AuditSealer } from './sealer.js';
import { readAuditSealSecret } from './signer.js';

/**
 * ADR-0154 D1–D6 on a live engine over SQLite (driver-sql through the wasm
 * client): the plugin's own sealer, composed with `cryptoProvider`, seals rows
 * at rest into checkpoints that verify — the signature under the key the
 * signer vouches for, and the root recomputed from the stored rows under the
 * sealed seed — and a row changed afterwards no longer does. No cluster
 * service is registered, so the pass takes the in-process lock (Q2 (a)).
 */

const PROBE = 'seal_probe';
const H = 60 * 60 * 1000;
const SYS = { isSystem: true } as const;

const probe = {
  name: PROBE,
  label: 'Seal Probe',
  systemFields: false,
  fields: {
    id: { name: 'id', label: 'ID', type: 'text' },
    created_at: { name: 'created_at', label: 'Created At', type: 'datetime' },
    action: { name: 'action', label: 'Action', type: 'text' },
    tenant_id: { name: 'tenant_id', label: 'Organization', type: 'text' },
    day: { name: 'day', label: 'Day', type: 'date' },
    payload: { name: 'payload', label: 'Payload', type: 'textarea' },
  },
  lifecycle: { class: 'audit', retention: { maxAge: '90d' }, seal: { valueFields: ['payload'] } },
};

describe('the sealer on a live engine (ADR-0154)', () => {
  const crypto = bindingCrypto();
  const plugin = new AuditPlugin({ cryptoProvider: crypto });
  let kernel: ObjectKernel;
  let engine: ObjectQL;
  let checkpoints: Array<{ body: CheckpointSignedBody; signature: string }> = [];
  const past = Math.floor(Date.now() / H) * H - 3 * H; // a window three hours ago: settled
  const iso = (ms: number) => new Date(ms).toISOString();

  const driver = () => engine.getDriverForObject(PROBE) as unknown as {
    find(o: string, q: Record<string, unknown>): Promise<Array<Record<string, unknown>>>;
    create(o: string, r: Record<string, unknown>): Promise<unknown>;
    update(o: string, id: string, r: Record<string, unknown>): Promise<unknown>;
  };

  const recomputedRoot = async (body: CheckpointSignedBody): Promise<string> => {
    const handle = await readAuditSealSecret(engine as never, body.seed_handle);
    const seed = decodeCheckpointSeed(await crypto.decrypt(handle!, checkpointSeedContext(body.sealed_object, body.tenant_id, body.sequence)));
    const rows = await driver().find(PROBE, { where: { id: { $in: [...body.row_ids] } } });
    const salts = columnSaltsOf(seed, body.sealed_object);
    return merkleRoot(inLeafOrder(rows).map((row) => leafHash(leafInput(row, body.columns, probe.fields, salts))));
  };

  beforeAll(async () => {
    kernel = new ObjectKernel({ logger: { level: 'silent' } });
    await kernel.use(new ObjectQLPlugin());
    await kernel.use(plugin);
    await kernel.bootstrap();
    engine = kernel.getService<ObjectQL>('objectql');
    const sqlite = new SqliteWasmDriver({ filename: ':memory:' });
    await sqlite.connect();
    engine.registerDriver(sqlite, true);
    engine.registry.registerObject(probe as never, 'com.objectstack.audit.test.seal-probe');
    // The cipher store `PlatformObjectsPlugin` registers on a real host.
    engine.registry.registerObject(SysSecret as never, 'com.objectstack.audit.test.seal-probe');
    await engine.syncSchemas();
    await installDefaultOrganization(engine);

    // Rows at rest in a settled window (two organizations and the deployment), and one too new to seal.
    await driver().create(PROBE, { id: 'p1', created_at: iso(past + 60_000), action: 'update', tenant_id: 'org_a', day: '2026-11-10', payload: '{"from":1}' });
    await driver().create(PROBE, { id: 'p2', created_at: iso(past + 120_000), action: 'delete', tenant_id: 'org_a', day: null, payload: null });
    await driver().create(PROBE, { id: 'p3', created_at: iso(past + 180_000), action: 'config', tenant_id: null, day: '2026-01-31', payload: 'x' });
    await engine.insert(PROBE, { id: 'fresh', created_at: iso(Date.now()), action: 'update', tenant_id: 'org_a' }, { context: SYS });

    const sealer = (plugin as unknown as { sealer: AuditSealer }).sealer;
    await sealer.stop(); // drive the pass here, not on the loop's clock
    expect(await sealer.runPass()).toBe(2);
    const stored = await engine.find('sys_audit_checkpoint', { context: SYS });
    checkpoints = stored.map((r: Record<string, unknown>) => ({ body: checkpointBodyFromRow(r), signature: String(r.signature) }));
  }, 120_000);

  afterAll(async () => {
    if (kernel) await Promise.race([kernel.shutdown(), new Promise<void>((r) => setTimeout(r, 10_000))]);
  }, 30_000);

  it('wrote one checkpoint per chain of the settled window, and none for the row too new to seal', () => {
    expect(checkpoints.map((c) => [c.body.tenant_id, c.body.row_ids, c.body.window_start]).sort()).toEqual([
      ['org_a', ['p1', 'p2'], iso(past)],
      [null, ['p3'], iso(past)],
    ].sort());
  });

  it('signed each body under the key the signer vouches for', async () => {
    const signer = await import('./signer.js');
    const local = new signer.LocalCheckpointSigner({ engine: engine as never, crypto });
    for (const { body, signature } of checkpoints) {
      const pub = await local.trustedPublicKey(body.signing_key_id);
      const key = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: Buffer.from(pub!, 'base64').toString('base64url') }, format: 'jwk' });
      expect(verify(null, signedBodyBytes(body), key, Buffer.from(signature, 'base64'))).toBe(true);
    }
  });

  it('recorded the key creation as one deployment-level audit_signing_key_change row', async () => {
    const rows = await engine.find('sys_audit_log', { where: { action: 'audit_signing_key_change' }, context: SYS });
    expect(rows).toHaveLength(1);
    expect(rows[0].tenant_id ?? null).toBeNull();
    expect(JSON.parse(rows[0].metadata).new_fingerprint).toBe(checkpoints[0].body.signing_key_id);
  });

  it('recomputes each root from the stored rows under the sealed seed — and a row changed afterwards no longer matches', async () => {
    for (const { body } of checkpoints) expect(await recomputedRoot(body)).toBe(body.root);
    await driver().update(PROBE, 'p1', { payload: '{"from":2}' });
    const orgA = checkpoints.find((c) => c.body.tenant_id === 'org_a')!.body;
    expect(await recomputedRoot(orgA)).not.toBe(orgA.root);
  });

  it('reads a date column back from SQLite as YYYY-MM-DD text, whichever spelling was written (Q7 (a))', async () => {
    await engine.insert(PROBE, { id: 'd1', created_at: iso(Date.now()), day: '2026-11-10' }, { context: SYS });
    await engine.insert(PROBE, { id: 'd2', created_at: iso(Date.now()), day: new Date('2026-11-10T00:00:00.000Z') }, { context: SYS });
    const rows = await driver().find(PROBE, { where: { id: { $in: ['d1', 'd2'] } } });
    for (const row of rows) {
      expect(row.day).toBe('2026-11-10');
      expect(canonicalValue(row.day, { type: 'date' })).toBe('2026-11-10');
    }
  });
});
