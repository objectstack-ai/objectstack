// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectKernel } from '@objectstack/core';
import { ObjectQL, ObjectQLPlugin } from '@objectstack/objectql';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';
import { SysSecret } from '@objectstack/platform-objects/system';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditPlugin } from '../audit-plugin.js';
import { installDefaultOrganization } from '../default-organization.testkit.js';
import { migrateKeyMaterialCopies } from '../key-material-copy-migration.js';
import { migrateArchivedMailLogBodyCopies, migrateMailLogBodyCopies } from '../mail-log-body-migration.js';
import { SysAuditLog } from '../objects/sys-audit-log.object.js';
import { migrateStoredMetadataBodyCopies } from '../stored-metadata-body-migration.js';
import { RedactionAmender, type AuditRedactionSeal } from './amendment-writer.js';
import { verifyAuditLedger, type AuditVerifyReport } from './index.js';
import { bindingCrypto, recordingLogger } from './seal-store.testkit.js';
import type { AuditSealer } from './sealer.js';

/**
 * ADR-0154 D7 on a live engine over SQLite, with an `archive` datasource:
 * `sys_audit_log` sealed, the plugin's own sealer seals it, and the three real
 * rewrite migrations rewrite its copies through the one amendment writer. The
 * live check then reads each rewritten sealed row `redacted`, with the
 * amendment the writer signed. A run with no crypto provider refuses the
 * sealed row and leaves it as it is; a row no checkpoint lists yet is rewritten
 * with no amendment; a row changed outside the platform is refused, never
 * amended. The rows carry sentinels, never a real body, key or hash.
 */

const H = 60 * 60 * 1000;
const SYS = { isSystem: true } as const;
const LOG = 'sys_audit_log';
const MAIL_BODY = 'mail-body-sentinel';
const KEY_MATERIAL = 'key-material-sentinel';

type Row = Record<string, unknown>;
interface Driver {
  find(o: string, q: Row): Promise<Row[]>;
  create(o: string, r: Row): Promise<unknown>;
  update(o: string, id: string, r: Row, options?: { preserveAudit?: boolean }): Promise<unknown>;
  delete(o: string, id: string): Promise<unknown>;
}

/** The ledger, sealed: its three value columns committed (the P4 default, opted into here). */
const sealedLog = { ...SysAuditLog, lifecycle: { ...SysAuditLog.lifecycle, seal: { valueFields: ['metadata', 'new_value', 'old_value'] } } };

const verdicts = (report: AuditVerifyReport) =>
  Object.fromEntries(report.rows.map((r) => [r.row, r.verdict === 'late' && !r.sealed ? 'late!' : r.verdict]));

describe('the redaction amendment writer on a live engine (ADR-0154 D7)', () => {
  const crypto = bindingCrypto();
  // A function, as `os serve` hands it: read when the sealer starts.
  const plugin = new AuditPlugin({ cryptoProvider: () => crypto });
  let kernel: ObjectKernel;
  let engine: ObjectQL;
  let cold: SqliteWasmDriver;
  const past = Math.floor(Date.now() / H) * H - 3 * H; // a settled window
  const iso = (ms: number) => new Date(ms).toISOString();
  const hot = () => engine.getDriverForObject(LOG) as unknown as Driver;
  const archive = () => cold as unknown as Driver;
  const verify = () => verifyAuditLedger({ engine: engine as never, crypto });
  const seal = (withCrypto = true): AuditRedactionSeal => ({ engine: engine as never, ...(withCrypto ? { crypto } : {}) });
  const amendments = () => engine.find('sys_audit_amendment', { context: SYS }) as Promise<Row[]>;
  const stored = async (id: string, store = hot()) => (await store.find(LOG, { where: { id } }))[0];
  const copy = (id: string, at: number, object: string, snapshot: Row): Row => ({
    id, created_at: iso(at), action: 'create', object_name: object, record_id: `${id}_rec`, tenant_id: 'org_a', new_value: JSON.stringify(snapshot),
  });

  beforeAll(async () => {
    kernel = new ObjectKernel({ logger: { level: 'silent' } });
    await kernel.use(new ObjectQLPlugin());
    await kernel.use(plugin);
    await kernel.bootstrap();
    engine = kernel.getService<ObjectQL>('objectql');
    const sqlite = new SqliteWasmDriver({ filename: ':memory:' });
    await sqlite.connect();
    engine.registerDriver(sqlite, true);
    cold = new SqliteWasmDriver({ filename: ':memory:' });
    Object.defineProperty(cold, 'name', { value: 'archive' });
    await cold.connect();
    engine.registerDriver(cold);
    engine.registry.registerObject(sealedLog as never, 'com.objectstack.audit');
    engine.registry.registerObject(SysSecret as never, 'com.objectstack.audit.test.redaction');
    await engine.syncSchemas();
    await cold.syncSchema(LOG, engine.registry.getObject(LOG) as never); // the registered field map, as the Archiver's table has it
    await installDefaultOrganization(engine);

    // Copies at rest in a settled window, one copy per migration, and one row nothing rewrites.
    await hot().create(LOG, copy('mail', past + 60_000, 'sys_email', { id: 'em_1', subject: 'kept', body_text: MAIL_BODY }));
    await hot().create(LOG, copy('key', past + 120_000, 'sys_secret', { id: 'sec_1', namespace: 'n', ciphertext: KEY_MATERIAL }));
    await hot().create(LOG, copy('meta', past + 150_000, 'sys_metadata', { id: 'md_1', name: 'kept', checksum: `sha256:${'a'.repeat(64)}` }));
    await hot().create(LOG, copy('tampered', past + 160_000, 'sys_email', { id: 'em_2', body_text: MAIL_BODY }));
    await hot().create(LOG, copy('moved', past + 170_000, 'sys_email', { id: 'em_3', body_text: MAIL_BODY }));
    await hot().create(LOG, copy('still', past + 180_000, 'crm_note', { id: 'n_1' }));
    // A copy too new to be sealed: no checkpoint lists it.
    await hot().create(LOG, copy('fresh', Date.now(), 'sys_email', { id: 'em_4', body_text: MAIL_BODY }));

    const sealer = (plugin as unknown as { sealer: AuditSealer }).sealer;
    await sealer.stop(); // drive the pass here, not on the loop's clock
    expect(await sealer.runPass()).toBe(1);
    // One sealed copy moves to the archive, verbatim, as the Archiver moves it.
    await archive().create(LOG, (await stored('moved'))!);
    await hot().delete(LOG, 'moved');
  }, 120_000);

  afterAll(async () => {
    if (kernel) await Promise.race([kernel.shutdown(), new Promise<void>((r) => setTimeout(r, 10_000))]);
  }, 30_000);

  it('a dry run decides each sealed copy the same way, and writes no amendment and no row', async () => {
    const before = JSON.stringify(await hot().find(LOG, { orderBy: [{ field: 'id', order: 'asc' }] }));
    const report = await migrateMailLogBodyCopies(engine as never, recordingLogger(), { seal: seal(), objects: ['sys_audit_log'] });
    expect(report).toMatchObject({ apply: false, scanned: 3, rewritten: 3, refused: 0, failures: 0 });
    expect(JSON.stringify(await hot().find(LOG, { orderBy: [{ field: 'id', order: 'asc' }] }))).toBe(before);
    expect(await amendments()).toEqual([]);
  });

  it('with no crypto provider, refuses the sealed copy and leaves it as it is; rewrites the unsealed one with no amendment', async () => {
    const logger = recordingLogger();
    const report = await migrateMailLogBodyCopies(engine as never, logger, { apply: true, seal: seal(false), objects: ['sys_audit_log'] });
    expect(report).toMatchObject({ refused: 2, rewritten: 1, failures: 0 });
    expect(report.byObject.sys_audit_log).toEqual({ scanned: 3, rewritten: 1, refused: 2 });
    expect(logger.lines.filter((l) => l.level === 'warn' && /refused to rewrite sys_audit_log\/mail, a sealed row: no crypto provider/.test(l.message))).toHaveLength(1);
    expect(String((await stored('mail'))!.new_value)).toContain(MAIL_BODY);
    expect(String((await stored('fresh'))!.new_value)).not.toContain(MAIL_BODY);
    expect(await amendments()).toEqual([]);
    const result = await verify();
    expect(result.rows).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('with a signer that cannot sign, refuses the sealed copy at the write and leaves it as it is', async () => {
    const signer = { sign: async () => { throw new Error('the signing key is offline'); }, trustedPublicKey: async () => null };
    const logger = recordingLogger();
    const report = await migrateMailLogBodyCopies(engine as never, logger, { apply: true, seal: { ...seal(), signer }, objects: ['sys_audit_log'] });
    expect(report.byObject.sys_audit_log).toEqual({ scanned: 3, rewritten: 0, refused: 2 });
    expect(logger.lines.some((l) => /refused to rewrite sys_audit_log\/mail, a sealed row: its amendment could not be written \(the signing key is offline\)/.test(l.message))).toBe(true);
    expect(String((await stored('mail'))!.new_value)).toContain(MAIL_BODY);
    expect(await amendments()).toEqual([]);
  });

  it('refuses a sealed copy changed outside the platform, never amending it: the change stays visible', async () => {
    await hot().update(LOG, 'tampered', { action: 'delete' });
    const logger = recordingLogger();
    const report = await migrateMailLogBodyCopies(engine as never, logger, { apply: true, seal: seal(), objects: ['sys_audit_log'] });
    expect(report.byObject.sys_audit_log).toEqual({ scanned: 3, rewritten: 1, refused: 1 });
    expect(logger.lines.some((l) => /refused to rewrite sys_audit_log\/tampered, a sealed row: it no longer matches checkpoint 0/.test(l.message))).toBe(true);
    expect(String((await stored('tampered'))!.new_value)).toContain(MAIL_BODY);
    expect((await amendments()).map((a) => a.row_id)).not.toContain('tampered');
    expect(verdicts(await verify())).toMatchObject({ tampered: 'modified' });
  });

  it('amends, then rewrites, a sealed copy: the live check reads it redacted, with the amendment the writer signed', async () => {
    // The mail run above already rewrote `mail` (it amended it, beside refusing `tampered`).
    expect(String((await stored('mail'))!.new_value)).not.toContain(MAIL_BODY);
    const [amendment] = (await amendments()).filter((a) => a.row_id === 'mail');
    expect(amendment).toMatchObject({ kind: 'redaction', sealed_object: LOG, column_name: 'new_value', checkpoint_sequence: 0, rewritten_by: 'os migrate audit-mail-bodies' });
    const result = await verify();
    expect(verdicts(result)).toEqual({ mail: 'redacted', tampered: 'modified' });
    expect(result.faults).toEqual([]);
    expect(result.dangling).toEqual([]);
  });

  it('the key-material and the metadata-body rewrites amend their sealed copies the same way', async () => {
    const keys = await migrateKeyMaterialCopies(engine as never, recordingLogger(), { apply: true, seal: seal(), objects: ['sys_audit_log'] });
    expect(keys).toMatchObject({ rewritten: 1, refused: 0 });
    const meta = await migrateStoredMetadataBodyCopies(engine as never, recordingLogger(), { apply: true, seal: seal() });
    expect(meta.byObject.sys_audit_log).toEqual({ scanned: 1, rewritten: 1, refused: 0 });
    expect(String((await stored('key'))!.new_value)).not.toContain(KEY_MATERIAL);
    expect(String((await stored('meta'))!.new_value)).not.toContain('sha256:');
    expect((await amendments()).filter((a) => a.row_id === 'key' || a.row_id === 'meta').map((a) => a.rewritten_by).sort()).toEqual([
      'os migrate audit-key-material',
      'os migrate audit-metadata-bodies',
    ]);
    expect(verdicts(await verify())).toEqual({ mail: 'redacted', key: 'redacted', meta: 'redacted', tampered: 'modified' });
  });

  it('amends a sealed copy in the archive datasource through the archive run', async () => {
    const report = await migrateArchivedMailLogBodyCopies(cold as never, recordingLogger(), { apply: true, seal: seal(), objects: ['sys_audit_log'] });
    expect(report).toMatchObject({ rewritten: 1, refused: 0 });
    expect(String((await stored('moved', archive()))!.new_value)).not.toContain(MAIL_BODY);
    expect(verdicts(await verify())).toMatchObject({ moved: 'redacted' });
  });

  it('a second rewrite of a redacted column names the commitment the checkpoint sealed, and still reads redacted', async () => {
    const amender = new RedactionAmender(seal(), 'a second rewrite');
    const patch = { new_value: JSON.stringify({ id: 'em_1', redacted: true }) };
    const decision = await amender.decide(LOG, 'mail', patch);
    expect(decision.kind).toBe('amend');
    await amender.write(LOG, decision);
    // Written as the ledger-copy store writes: the row's stored `updated_at` kept.
    await hot().update(LOG, 'mail', { ...patch, updated_at: (await stored('mail'))!.updated_at }, { preserveAudit: true });
    const [first, second] = (await amendments()).filter((a) => a.row_id === 'mail').sort((a, b) => String(a.amended_at).localeCompare(String(b.amended_at)));
    expect(second.sealed_commitment).toBe(first.sealed_commitment);
    expect(verdicts(await verify())).toMatchObject({ mail: 'redacted' });
  });
});

describe('a one-shot boot arms no sealer (ADR-0154 D3)', () => {
  it('starts no sealer with `armSealer: false`, whatever crypto provider it is handed', async () => {
    const plugin = new AuditPlugin({ cryptoProvider: bindingCrypto(), armSealer: false });
    const kernel = new ObjectKernel({ logger: { level: 'silent' } });
    await kernel.use(new ObjectQLPlugin());
    await kernel.use(plugin);
    await kernel.bootstrap();
    try {
      expect((plugin as unknown as { sealer: AuditSealer | null }).sealer).toBeNull();
    } finally {
      await kernel.shutdown();
    }
  }, 60_000);
});
