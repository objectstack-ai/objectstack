// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// [#24565] The real-engine pin that the audit writers answer from an object's
// CURRENT definition. It boots a kernel, the metadata door, a SQLite driver and
// the audit plugin, so it lives in its own file. Static imports, so the load is
// paid during collection, not by one test's timeout.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import { ObjectQL, ObjectQLPlugin } from '@objectstack/objectql';
import { SECRET_MASK } from '@objectstack/objectql/core';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';
import { AuditPlugin } from './audit-plugin.js';
import { singlePostureTenancy } from './__tests__/single-posture-tenancy.js';

/**
 * [#24565] A definition changed through the metadata door takes effect in the
 * audit writers at once, with no restart.
 *
 * `installAuditWriters` used to keep each object's first `getSchema` answer for
 * the life of the process. An object whose `enable.files` was switched on
 * through the door kept refusing attachments with 403 `FILES_DISABLED` until a
 * restart, while the door's own read-back showed the new value. The same copy
 * fed every other reader, the ledger's credential mask among them: a
 * `password` field added at runtime was copied into `sys_audit_log` in
 * plaintext.
 *
 * The composition is the one the door runs in: `ObjectKernel` +
 * `ObjectQLPlugin` (which assembles the metadata protocol and registers it as
 * the `protocol` service) + `AuditPlugin` over a real SQLite driver. Every
 * definition change goes through `protocol.saveMetaItem`, the producer behind
 * `PUT /api/v1/meta/object/:name`, and nothing else touches the registry
 * between the two writes a case compares. Each case uses its own object, and
 * its first write makes the writers look the definition up BEFORE the change,
 * which is the lookup a held copy kept.
 *
 * `sys_attachment` is a stand-in under the real name: service-storage owns the
 * definition, and the gate reads only `parent_object`.
 */
describe('audit writers answer from the current definition after a metadata-door change (#24565)', () => {
  const HARNESS_PACKAGE = 'com.objectstack.audit.test.definition-follows-metadata';
  const SYSTEM = { context: { isSystem: true } };

  let kernel: ObjectKernel;
  let engine: ObjectQL;
  let protocol: { saveMetaItem(request: Record<string, unknown>): Promise<{ success?: boolean }> };

  const text = (name: string) => ({ name, label: name, type: 'text' as const });

  /** An object body as an author saves it through the door. */
  const objectBody = (name: string, extra: Record<string, unknown> = {}) => ({
    name,
    label: name,
    // The runtime object door requires an authored OWD.
    sharingModel: 'private',
    fields: { name: text('name') },
    ...extra,
  });

  const save = async (name: string, extra: Record<string, unknown> = {}) => {
    const result = await protocol.saveMetaItem({ type: 'object', name, item: objectBody(name, extra) });
    expect(result?.success).toBe(true);
  };

  /** One attachment onto `parent`: admitted, or the refusal's envelope. */
  const attach = async (parent: string): Promise<{ admitted: true } | { code: unknown; status: unknown }> => {
    try {
      await engine.insert(
        'sys_attachment',
        { parent_object: parent, parent_id: 'rec-1', file_id: 'file-1' } as any,
        SYSTEM as any,
      );
      return { admitted: true };
    } catch (e: any) {
      return { code: e?.code, status: e?.status };
    }
  };
  const REFUSED = { code: 'FILES_DISABLED', status: 403 };

  beforeAll(async () => {
    kernel = new ObjectKernel({ logger: { level: 'silent' }, gracefulShutdown: false } as any);
    await kernel.use(new ObjectQLPlugin());
    await kernel.use(singlePostureTenancy());
    await kernel.use(new AuditPlugin());
    await kernel.bootstrap();

    engine = kernel.getService<ObjectQL>('objectql');
    const driver = new SqliteWasmDriver({ filename: ':memory:' });
    await driver.connect();
    engine.registerDriver(driver, true);
    engine.registry.registerObject(
      {
        name: 'sys_attachment',
        label: 'Attachment',
        fields: { parent_object: text('parent_object'), parent_id: text('parent_id'), file_id: text('file_id') },
      } as any,
      HARNESS_PACKAGE,
    );
    await engine.syncSchemas();
    protocol = kernel.getService('protocol') as typeof protocol;
  }, 120_000);

  afterAll(async () => {
    if (kernel) {
      await Promise.race([kernel.shutdown(), new Promise<void>((resolve) => setTimeout(resolve, 10_000))]);
    }
  }, 30_000);

  it('enable.files switched ON through the door admits the same attachment, with no restart', async () => {
    await save('qa_kid');
    // Refused while the object declares no files, and this refusal is the
    // lookup a held copy would have kept.
    expect(await attach('qa_kid')).toEqual(REFUSED);

    await save('qa_kid', { enable: { files: true } });
    // The registry already serves the new value, so the door's read-back shows it.
    expect((engine.getSchema('qa_kid') as any)?.enable?.files).toBe(true);
    expect(await attach('qa_kid')).toEqual({ admitted: true });
  });

  it('switched OFF again through the door, the same attachment is refused again', async () => {
    await save('qa_kid_reverse', { enable: { files: true } });
    expect(await attach('qa_kid_reverse')).toEqual({ admitted: true });

    await save('qa_kid_reverse', { enable: { files: false } });
    expect(await attach('qa_kid_reverse')).toEqual(REFUSED);
  });

  it('control: an object authored with enable.files from the start, never looked up before, admits it', async () => {
    await save('qa_kid_from_start', { enable: { files: true } });
    expect(await attach('qa_kid_from_start')).toEqual({ admitted: true });
  });

  // `password`, not `secret`: both are masked on the ledger copy, and a
  // `password` value is stored as written (ADR-0100) where a `secret` one needs
  // a crypto provider this harness does not wire.
  it('the ledger masks a password field added through the door after the object was first audited', async () => {
    const OBJECT = 'qa_vault';
    const PLAINTEXT = 'pw-24565-plaintext';
    await save(OBJECT);
    // An audited write BEFORE the change: the ledger looks the definition up here.
    const row = (await engine.insert(OBJECT, { name: 'first' } as any, SYSTEM as any)) as { id: unknown };
    const id = String(row.id);

    await save(OBJECT, { fields: { name: text('name'), login_pw: { name: 'login_pw', label: 'Password', type: 'password' } } });
    await engine.update(OBJECT, { login_pw: PLAINTEXT } as any, { where: { id }, ...SYSTEM } as any);

    const updates = (await engine.find(
      'sys_audit_log',
      { where: { object_name: OBJECT, record_id: id, action: 'update' }, ...SYSTEM } as any,
    )) as Array<{ new_value: unknown }>;
    expect(updates).toHaveLength(1);
    const raw = String(updates[0].new_value);
    expect(raw).not.toContain(PLAINTEXT);
    const recorded = JSON.parse(raw) as Record<string, unknown>;
    // The change IS recorded, as "a value is set", never the value.
    expect(recorded.login_pw).toBe(SECRET_MASK);
  });
});
