// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { createHash, createPublicKey, generateKeyPairSync, sign as edSign, verify } from 'node:crypto';
import { ObjectKernel } from '@objectstack/core';
import { ObjectQL, ObjectQLPlugin } from '@objectstack/objectql';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';
import { SysSecret } from '@objectstack/platform-objects/system';
import {
  AUDIT_CHECKPOINT_SIGNER_SERVICE,
  AUDIT_CHECKPOINT_SINK_SERVICE,
  type AuditCheckpointSinkEntry,
  type IAuditCheckpointSigner,
} from '@objectstack/spec/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { AuditPlugin } from '../audit-plugin.js';
import { installDefaultOrganization } from '../default-organization.testkit.js';
import { checkpointBodyFromRow, signedBodyBytes } from './index.js';
import { bindingCrypto } from './seal-store.testkit.js';
import type { AuditSealer } from './sealer.js';

/**
 * #34280 on a real kernel: the sealer reaches its three host seams
 * (`audit.checkpointSigner`, `audit.checkpointSink`, `cluster`, ADR-0154 D11)
 * in three states, not two. Only an ABSENT seam falls back — to the local
 * signer of D6, to no export, to the in-process lock. A seam that is
 * registered but cannot be resolved (here: a factory that throws, as a KMS
 * client that cannot start would) stops the pass — no checkpoint is signed —
 * and says so at `error`, naming the slot. A registered seam that resolves is
 * used, including one registered as a factory, which the sync accessor the
 * sealer used before could not build at all.
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
    payload: { name: 'payload', label: 'Payload', type: 'textarea' },
  },
  lifecycle: { class: 'audit', retention: { maxAge: '90d' }, seal: { valueFields: ['payload'] } },
};

/** A host-held Ed25519 key standing in for a KMS key: its own key id, its own public half. */
function hostSigner(): IAuditCheckpointSigner & { publicKey: string; keyId: string } {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const raw = Buffer.from(publicKey.export({ format: 'jwk' }).x!, 'base64url');
  const keyId = createHash('sha256').update(raw).digest('hex');
  return {
    keyId,
    publicKey: raw.toString('base64'),
    async sign(bytes) {
      return { keyId, signature: edSign(null, Buffer.from(bytes), privateKey).toString('base64') };
    },
    async trustedPublicKey(id) {
      return id === keyId ? raw.toString('base64') : null;
    },
  };
}

/** The fault a host seam's factory raises when it cannot be built. */
const unbuildable = (what: string) => () => {
  throw new Error(`${what} client cannot start: credential missing`);
};

interface Booted {
  kernel: ObjectKernel;
  engine: ObjectQL;
  sealer: AuditSealer;
  errors: string[];
  checkpoints(): Promise<Array<Record<string, unknown>>>;
}

const booted: ObjectKernel[] = [];

async function boot(register: (kernel: ObjectKernel) => void = () => {}): Promise<Booted> {
  const crypto = bindingCrypto();
  const plugin = new AuditPlugin({ cryptoProvider: crypto });
  const kernel = new ObjectKernel({ logger: { level: 'silent' } });
  booted.push(kernel);
  await kernel.use(new ObjectQLPlugin());
  await kernel.use(plugin);
  register(kernel);
  await kernel.bootstrap();
  const engine = kernel.getService<ObjectQL>('objectql');
  const sqlite = new SqliteWasmDriver({ filename: ':memory:' });
  await sqlite.connect();
  engine.registerDriver(sqlite, true);
  engine.registry.registerObject(probe as never, 'com.objectstack.audit.test.seal-probe');
  engine.registry.registerObject(SysSecret as never, 'com.objectstack.audit.test.seal-probe');
  await engine.syncSchemas();
  await installDefaultOrganization(engine);

  // One row at rest in a settled window: one checkpoint's worth.
  const past = Math.floor(Date.now() / H) * H - 3 * H;
  const hot = engine.getDriverForObject(PROBE) as unknown as { create(o: string, r: Record<string, unknown>): Promise<unknown> };
  await hot.create(PROBE, { id: 'p1', created_at: new Date(past + 60_000).toISOString(), action: 'update', tenant_id: 'org_a', payload: 'x' });

  const sealer = (plugin as unknown as { sealer: AuditSealer }).sealer;
  await sealer.stop(); // drive the pass here, not on the loop's clock
  const errors: string[] = [];
  const logger = (sealer as unknown as { options: { logger: { error(m: string): void } } }).options.logger;
  const error = logger.error.bind(logger);
  logger.error = (message: string) => {
    errors.push(message);
    error(message);
  };
  return {
    kernel,
    engine,
    sealer,
    errors,
    checkpoints: () => engine.find('sys_audit_checkpoint', { context: SYS }) as Promise<Array<Record<string, unknown>>>,
  };
}

afterEach(async () => {
  for (const kernel of booted.splice(0)) {
    await Promise.race([kernel.shutdown(), new Promise<void>((r) => setTimeout(r, 10_000))]);
  }
}, 60_000);

const signedBy = (row: Record<string, unknown>, publicKey: string): boolean =>
  verify(
    null,
    signedBodyBytes(checkpointBodyFromRow(row)),
    createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: Buffer.from(publicKey, 'base64').toString('base64url') }, format: 'jwk' }),
    Buffer.from(String(row.signature), 'base64'),
  );

describe('the sealer resolves its host seams in three states (#34280)', () => {
  it('no host signer registered: seals with the local key, as before', async () => {
    const s = await boot();
    expect(await s.sealer.runPass()).toBe(1);
    const [row] = await s.checkpoints();
    const keys = await s.engine.find('sys_audit_signing_key', { context: SYS });
    expect(keys.map((k: Record<string, unknown>) => k.fingerprint)).toEqual([row.signing_key_id]);
    expect(s.errors).toEqual([]);
  }, 120_000);

  it('a registered host signer whose resolution throws: seals nothing, and says so at error naming the slot', async () => {
    const s = await boot((k) => k.registerServiceFactory(AUDIT_CHECKPOINT_SIGNER_SERVICE, unbuildable('KMS')));
    expect(await s.sealer.runPass()).toBe(0);
    expect(await s.checkpoints()).toEqual([]);
    // Nothing was signed with the local key either: no local key was ever made.
    expect(await s.engine.find('sys_audit_signing_key', { context: SYS })).toEqual([]);
    expect(s.errors).toHaveLength(1);
    expect(s.errors[0]).toContain(`the '${AUDIT_CHECKPOINT_SIGNER_SERVICE}' service is registered but could not be resolved`);
    expect(s.errors[0]).toContain('KMS client cannot start');
    expect(s.errors[0]).toContain('does not sign with the local key');
    // Reported once while it lasts, not once per pass.
    expect(await s.sealer.runPass()).toBe(0);
    expect(s.errors).toHaveLength(1);
  }, 120_000);

  it('a registered host signer that resolves is used — as an instance, and as a factory', async () => {
    for (const how of ['instance', 'factory'] as const) {
      const host = hostSigner();
      const s = await boot((k) => {
        if (how === 'instance') k.registerService(AUDIT_CHECKPOINT_SIGNER_SERVICE, host);
        else k.registerServiceFactory(AUDIT_CHECKPOINT_SIGNER_SERVICE, () => host);
      });
      expect(await s.sealer.runPass(), how).toBe(1);
      const [row] = await s.checkpoints();
      expect(row.signing_key_id, how).toBe(host.keyId);
      expect(signedBy(row, host.publicKey), how).toBe(true);
      expect(await s.engine.find('sys_audit_signing_key', { context: SYS }), how).toEqual([]);
      expect(s.errors, how).toEqual([]);
    }
  }, 240_000);

  it('a registered sink whose resolution throws: seals nothing, and says so; a resolved sink is handed the checkpoint', async () => {
    const broken = await boot((k) => k.registerServiceFactory(AUDIT_CHECKPOINT_SINK_SERVICE, unbuildable('SIEM')));
    expect(await broken.sealer.runPass()).toBe(0);
    expect(await broken.checkpoints()).toEqual([]);
    expect(broken.errors).toHaveLength(1);
    expect(broken.errors[0]).toContain(`the '${AUDIT_CHECKPOINT_SINK_SERVICE}' service is registered but could not be resolved`);
    expect(broken.errors[0]).toContain('does not seal without the off-host export');

    const delivered: AuditCheckpointSinkEntry[] = [];
    const working = await boot((k) => k.registerServiceFactory(AUDIT_CHECKPOINT_SINK_SERVICE, () => ({
      deliver: async (entry: AuditCheckpointSinkEntry) => { delivered.push(entry); },
    })));
    expect(await working.sealer.runPass()).toBe(1);
    expect(delivered.map((e) => e.kind)).toEqual(['checkpoint']);
    expect(working.errors).toEqual([]);
  }, 240_000);

  it('a registered cluster service whose resolution throws: seals nothing, and says so', async () => {
    const s = await boot((k) => k.registerServiceFactory('cluster', unbuildable('Redis')));
    expect(await s.sealer.runPass()).toBe(0);
    expect(await s.checkpoints()).toEqual([]);
    expect(s.errors).toHaveLength(1);
    expect(s.errors[0]).toContain("the 'cluster' service is registered but could not be resolved");
    expect(s.errors[0]).toContain('does not hold the audit.sealer lock in-process only');
  }, 120_000);
});
