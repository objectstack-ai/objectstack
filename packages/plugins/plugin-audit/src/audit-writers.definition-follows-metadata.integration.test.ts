// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// [#24565] The real-engine pin that the audit writers answer from an object's
// CURRENT definition. It boots a kernel, the metadata door, a SQLite driver and
// the audit plugin, so it lives in its own file. Static imports, so the load is
// paid during collection, not by one test's timeout.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import { ObjectQL, ObjectQLPlugin } from '@objectstack/objectql';
import type { DataEngineInsertOptions, EngineQueryOptions, EngineUpdateOptions } from '@objectstack/spec/data';
import { SECRET_MASK } from '@objectstack/objectql/core';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';
import { AuditPlugin } from './audit-plugin.js';
import { singlePostureTenancy } from './__tests__/single-posture-tenancy.js';
import { installDefaultOrganization } from './default-organization.testkit.js';

/**
 * [#24565] A definition changed through the metadata door takes effect in the
 * audit writers at once, with no restart.
 *
 * `installAuditWriters` used to keep each object's first `getSchema` answer for
 * the life of the process. An object whose `enable.files` was switched on
 * through the door kept refusing attachments with 403 `FILES_DISABLED` until a
 * restart, while the door's own read-back showed the new value (that gate has
 * since left this capability: the storage service is the opt-in's one
 * enforcer). The same copy fed every other reader: the `enable.feeds` gate
 * these cases now observe, and the ledger's credential mask.
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
 * `sys_comment` is the capability's own object, registered by `AuditPlugin`;
 * the gate reads only `thread_id`, whose `object:record` prefix names the
 * target object.
 */
describe('audit writers answer from the current definition after a metadata-door change (#24565)', () => {
  const SYSTEM = { context: { isSystem: true } } satisfies DataEngineInsertOptions;

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

  /** One comment on a record of `target`: admitted, or the refusal's envelope. */
  const comment = async (target: string): Promise<{ admitted: true } | { code: unknown; status: unknown }> => {
    try {
      await engine.insert('sys_comment', { thread_id: `${target}:rec-1`, body: 'hello' }, SYSTEM);
      return { admitted: true };
    } catch (e: any) {
      return { code: e?.code, status: e?.status };
    }
  };
  const REFUSED = { code: 'FEEDS_DISABLED', status: 403 };

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
    await engine.syncSchemas();
    // A real `single` install's Default Organization: the system writes below
    // derive it (ADR-0131 D9), as a fresh NOT NULL tenant column requires (D1).
    await installDefaultOrganization(engine);
    protocol = kernel.getService('protocol') as typeof protocol;
  }, 120_000);

  afterAll(async () => {
    if (kernel) {
      await Promise.race([kernel.shutdown(), new Promise<void>((resolve) => setTimeout(resolve, 10_000))]);
    }
  }, 30_000);

  it('enable.feeds switched back ON through the door admits the same comment, with no restart', async () => {
    await save('qa_kid', { enable: { feeds: false } });
    // Refused while the object declares feeds off, and this refusal is the
    // lookup a held copy would have kept.
    expect(await comment('qa_kid')).toEqual(REFUSED);

    await save('qa_kid', { enable: { feeds: true } });
    // The registry already serves the new value, so the door's read-back shows it.
    expect(engine.getSchema('qa_kid')?.enable?.feeds).toBe(true);
    expect(await comment('qa_kid')).toEqual({ admitted: true });
  });

  it('switched OFF through the door, the same comment is refused', async () => {
    await save('qa_kid_reverse', { enable: { feeds: true } });
    expect(await comment('qa_kid_reverse')).toEqual({ admitted: true });

    await save('qa_kid_reverse', { enable: { feeds: false } });
    expect(await comment('qa_kid_reverse')).toEqual(REFUSED);
  });

  it('control: an object authored with feeds off from the start, never looked up before, refuses it', async () => {
    await save('qa_kid_from_start', { enable: { feeds: false } });
    expect(await comment('qa_kid_from_start')).toEqual(REFUSED);
  });

  // `password`, not `secret`: both are masked on the ledger copy, and a
  // `password` value is stored as written (ADR-0100) where a `secret` one needs
  // a crypto provider this harness does not wire.
  it('the ledger masks a password field added through the door after the object was first audited', async () => {
    const OBJECT = 'qa_vault';
    const TYPED = 'typed-24565';
    await save(OBJECT);
    // An audited write BEFORE the change: the ledger looks the definition up here.
    const row = (await engine.insert(OBJECT, { name: 'first' }, SYSTEM)) as { id: unknown };
    const id = String(row.id);

    await save(OBJECT, { fields: { name: text('name'), login_pw: { name: 'login_pw', label: 'Password', type: 'password' } } });
    await engine.update(OBJECT, { login_pw: TYPED }, { where: { id }, ...SYSTEM } satisfies EngineUpdateOptions);

    const updates = (await engine.find(
      'sys_audit_log',
      { where: { object_name: OBJECT, record_id: id, action: 'update' }, ...SYSTEM } satisfies EngineQueryOptions,
    )) as Array<{ new_value: unknown }>;
    expect(updates).toHaveLength(1);
    const raw = String(updates[0].new_value);
    expect(raw).not.toContain(TYPED);
    const recorded = JSON.parse(raw) as Record<string, unknown>;
    // The change IS recorded, as "a value is set", never the value.
    expect(recorded.login_pw).toBe(SECRET_MASK);
  });
});
