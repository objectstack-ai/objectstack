// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { createPublicKey, verify } from 'node:crypto';
import { ObjectKernel } from '@objectstack/core';
import { ObjectQL, ObjectQLPlugin } from '@objectstack/objectql';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';
import { SysSecret } from '@objectstack/platform-objects/system';
import { AUDIT_CHECKPOINT_SINK_SERVICE, type AuditCheckpointSinkEntry, type IAuditCheckpointSink } from '@objectstack/spec/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditPlugin } from '../audit-plugin.js';
import { installDefaultOrganization } from '../default-organization.testkit.js';
// The subject, through the package entry: what a sink outside this package imports.
import { amendmentBodyFromRow, checkpointBodyFromRow } from '../index.js';
import { migrateMailLogBodyCopies } from '../mail-log-body-migration.js';
import { SysAuditLog } from '../objects/sys-audit-log.object.js';
import { canonicalJsonBytes } from './jcs.js';
import { bindingCrypto, recordingLogger } from './seal-store.testkit.js';
import type { AuditSealer } from './sealer.js';
import { signedBodyBytes } from './signed-body.js';
import { trustedSigningKey } from './signer.js';

/**
 * #34170 on a real kernel: a checkpoint sink off the host (ADR-0154 D11) is
 * handed each signed record once, and re-delivers what a failed call missed by
 * re-reading the stored rows (the `IAuditCheckpointSink` contract). The two
 * readers the package entry exports rebuild a stored `sys_audit_checkpoint`
 * row and a stored `sys_audit_amendment` row into the body the sealer and the
 * amendment writer handed the sink: the same RFC 8785 bytes, and a signature
 * that verifies over them under the stored signing key.
 *
 * The rows carry sentinels, never a real body, key or hash.
 */

const H = 60 * 60 * 1000;
const SYS = { isSystem: true } as const;
const LOG = 'sys_audit_log';
const MAIL_BODY = 'mail-body-sentinel';

type Row = Record<string, unknown>;

/** The ledger, sealed: its three value columns committed. */
const sealedLog = { ...SysAuditLog, lifecycle: { ...SysAuditLog.lifecycle, seal: { valueFields: ['metadata', 'new_value', 'old_value'] } } };

describe('a stored checkpoint or amendment row reads back, through the package entry, into the body the sink was handed (#34170)', () => {
  const crypto = bindingCrypto();
  const delivered: AuditCheckpointSinkEntry[] = [];
  const sink: IAuditCheckpointSink = { deliver: async (entry) => { delivered.push(entry); } };
  const plugin = new AuditPlugin({ cryptoProvider: crypto });
  let kernel: ObjectKernel;
  let engine: ObjectQL;

  /** Does `signature` (base64) verify over `bytes` under the stored, trusted signing key `keyId`? */
  const verifiesUnderStoredKey = async (bytes: Buffer, keyId: string, signature: string): Promise<boolean> => {
    const publicKey = await trustedSigningKey(engine as never, crypto, keyId);
    if (publicKey === null) throw new Error(`no stored signing key is trusted under ${keyId}`);
    const key = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: Buffer.from(publicKey, 'base64').toString('base64url') }, format: 'jwk' });
    return verify(null, bytes, key, Buffer.from(signature, 'base64'));
  };

  beforeAll(async () => {
    kernel = new ObjectKernel({ logger: { level: 'silent' } });
    await kernel.use(new ObjectQLPlugin());
    await kernel.use(plugin);
    kernel.registerService(AUDIT_CHECKPOINT_SINK_SERVICE, sink);
    await kernel.bootstrap();
    engine = kernel.getService<ObjectQL>('objectql');
    const sqlite = new SqliteWasmDriver({ filename: ':memory:' });
    await sqlite.connect();
    engine.registerDriver(sqlite, true);
    engine.registry.registerObject(sealedLog as never, 'com.objectstack.audit');
    engine.registry.registerObject(SysSecret as never, 'com.objectstack.audit.test.signed-body-readers');
    await engine.syncSchemas();
    await installDefaultOrganization(engine);

    // One mail-log copy at rest in a settled window: one checkpoint, then one redaction amendment.
    const past = Math.floor(Date.now() / H) * H - 3 * H;
    const hot = engine.getDriverForObject(LOG) as unknown as { create(o: string, r: Row): Promise<unknown> };
    await hot.create(LOG, {
      id: 'mail', created_at: new Date(past + 60_000).toISOString(), action: 'create', object_name: 'sys_email',
      record_id: 'mail_rec', tenant_id: 'org_a', new_value: JSON.stringify({ id: 'em_1', subject: 'kept', body_text: MAIL_BODY }),
    });
    const sealer = (plugin as unknown as { sealer: AuditSealer }).sealer;
    await sealer.stop(); // drive the pass here, not on the loop's clock
    expect(await sealer.runPass()).toBe(1);
    const report = await migrateMailLogBodyCopies(engine as never, recordingLogger(), {
      apply: true, seal: { engine: engine as never, crypto, sink }, objects: [LOG],
    });
    expect(report).toMatchObject({ rewritten: 1, refused: 0, failures: 0 });
    expect(delivered.map((e) => e.kind)).toEqual(['checkpoint', 'amendment']);
  }, 120_000);

  afterAll(async () => {
    if (kernel) await Promise.race([kernel.shutdown(), new Promise<void>((r) => setTimeout(r, 10_000))]);
  }, 30_000);

  it('a checkpoint: the stored row rebuilds the delivered body byte for byte, and its signature verifies under the stored key', async () => {
    const entry = delivered.find((e) => e.kind === 'checkpoint')!;
    const rows = (await engine.find('sys_audit_checkpoint', { context: SYS })) as Row[];
    expect(rows).toHaveLength(1);
    const [row] = rows;
    // The stored row is not the body: its JSON columns are text, and it carries `id`, `chain_key`, `leaf_hashes`, `signature`.
    expect(row).not.toEqual(entry.body);

    const body = checkpointBodyFromRow(row);
    expect(body).toEqual(entry.body);
    expect(signedBodyBytes(body).equals(canonicalJsonBytes(entry.body))).toBe(true);
    expect(row.signature).toBe(entry.signature);
    expect(body.signing_key_id).toBe(entry.keyId);
    expect(await verifiesUnderStoredKey(signedBodyBytes(body), body.signing_key_id, String(row.signature))).toBe(true);
  });

  it('an amendment: the stored row rebuilds the delivered body byte for byte, and its signature verifies under the stored key', async () => {
    const entry = delivered.find((e) => e.kind === 'amendment')!;
    const rows = (await engine.find('sys_audit_amendment', { context: SYS })) as Row[];
    expect(rows).toHaveLength(1);
    const [row] = rows;
    // The stored row is not the body: it carries the other kind's columns as NULL, and `id`, `chain_key`, `signature`.
    expect(row).not.toEqual(entry.body);

    const body = amendmentBodyFromRow(row);
    expect(body).toMatchObject({ kind: 'redaction', sealed_object: LOG, row_id: 'mail', column_name: 'new_value' });
    expect(body).toEqual(entry.body);
    expect(signedBodyBytes(body).equals(canonicalJsonBytes(entry.body))).toBe(true);
    expect(row.signature).toBe(entry.signature);
    expect(body.signing_key_id).toBe(entry.keyId);
    expect(await verifiesUnderStoredKey(signedBodyBytes(body), body.signing_key_id, String(row.signature))).toBe(true);
  });
});
