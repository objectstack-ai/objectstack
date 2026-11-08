// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#31186] The package lifecycle writer stores a REAL, READ-BACK ledger row for
 * each package uninstall.
 *
 * The slot cases boot the real composition this package ships in
 * (`ObjectQLPlugin` + `AuditPlugin` on a sqlite driver) and reach the writer
 * the way the uninstall verb does: through the `audit` service slot's
 * `recordPackageLifecycleEvent`. Every assertion reads the row back through the
 * engine, for the reason `auth-event-audit.test.ts` records: every
 * `sys_audit_log` field is `readonly` and `validateRecord` skips readonly
 * fields, so "the call did not throw" is equally true when the row landed
 * right, landed wrong, or was never attempted. The verb's half — one event per
 * package it uninstalled, none for a refused uninstall — is pinned in
 * `@objectstack/metadata-protocol`'s `protocol.package-delete-refusal.test.ts`.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import { ObjectQL, ObjectQLPlugin } from '@objectstack/objectql';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';

import { AuditPlugin } from './audit-plugin.js';
import {
  PACKAGE_UNINSTALL_AUDIT_ACTION,
  buildPackageLifecycleAuditRow,
  createPackageLifecycleAuditWriter,
  type PackageLifecycleAuditEvent,
  type PackageLifecycleAuditWriter,
} from './package-lifecycle-audit.js';

const LEDGER = 'sys_audit_log';
const SYS = { isSystem: true } as const;

/** An uninstall as the verb hands it; each case overrides what it is about. */
function uninstallEvent(overrides: Partial<PackageLifecycleAuditEvent> = {}): PackageLifecycleAuditEvent {
  return {
    action: 'package_uninstall',
    packageId: 'com.acme.leave',
    version: '1.2.0',
    environmentId: 'env_31186',
    actor: 'u_admin',
    itemsRemoved: 3,
    itemsFailed: 0,
    ...overrides,
  };
}

const metadataOf = (row: Record<string, unknown>): Record<string, any> => JSON.parse(String(row.metadata));

describe('[#31186] the package lifecycle writer on the real `audit` slot', () => {
  let kernel: ObjectKernel;
  let engine: ObjectQL;
  let audit: PackageLifecycleAuditWriter;

  /** The uninstall rows at rest, oldest first. */
  const uninstallRows = async (): Promise<Array<Record<string, any>>> =>
    (await engine.find(LEDGER, {
      where: { action: PACKAGE_UNINSTALL_AUDIT_ACTION },
      orderBy: [{ field: 'created_at', order: 'asc' }],
      context: SYS,
    })) as Array<Record<string, any>>;

  beforeAll(async () => {
    kernel = new ObjectKernel({ logger: { level: 'silent' } });
    await kernel.use(new ObjectQLPlugin());
    await kernel.use(new AuditPlugin());
    await kernel.bootstrap();
    engine = kernel.getService<ObjectQL>('objectql');
    const driver = new SqliteWasmDriver({ filename: ':memory:' });
    await driver.connect();
    engine.registerDriver(driver, true);
    await engine.syncSchemas();
    audit = kernel.getService<PackageLifecycleAuditWriter>('audit');
  }, 120_000);

  afterAll(async () => {
    if (kernel) await Promise.race([kernel.shutdown(), new Promise<void>((r) => setTimeout(r, 10_000))]);
  }, 30_000);

  it('the slot carries the writer beside the other ledger ingresses', () => {
    expect(typeof audit.recordPackageLifecycleEvent).toBe('function');
    expect(typeof (audit as any).recordAuthEvent).toBe('function');
    expect(typeof (audit as any).recordDataExport).toBe('function');
  });

  it('an uninstall writes ONE row naming the actor, the package, its version and the environment', async () => {
    const before = (await uninstallRows()).length;
    await audit.recordPackageLifecycleEvent(uninstallEvent({ keepData: true }));
    const rows = await uninstallRows();
    expect(rows).toHaveLength(before + 1);
    const row = rows[rows.length - 1];
    expect(row).toMatchObject({
      action: 'package_uninstall',
      user_id: 'u_admin',
      actor: 'u_admin',
      object_name: null,
      record_id: null,
      tenant_id: null,
    });
    expect(row.old_value ?? null).toBeNull();
    expect(row.new_value ?? null).toBeNull();
    expect(metadataOf(row)).toEqual({
      package_id: 'com.acme.leave',
      version: '1.2.0',
      environment_id: 'env_31186',
      keep_data: true,
      items_removed: 3,
      items_failed: 0,
      outcome: 'complete',
    });
  });

  it('a partial uninstall records the items it left behind', async () => {
    await audit.recordPackageLifecycleEvent(uninstallEvent({ itemsRemoved: 2, itemsFailed: 1 }));
    const rows = await uninstallRows();
    expect(metadataOf(rows[rows.length - 1])).toMatchObject({ items_removed: 2, items_failed: 1, outcome: 'partial' });
  });

  it('no actor, no version, no environment: the row still names the package, and records the absences as null', async () => {
    await audit.recordPackageLifecycleEvent(uninstallEvent({ actor: undefined, version: undefined, environmentId: undefined }));
    const rows = await uninstallRows();
    const row = rows[rows.length - 1];
    expect(row).toMatchObject({ user_id: null, actor: null });
    expect(metadataOf(row)).toMatchObject({ package_id: 'com.acme.leave', version: null, environment_id: null, keep_data: false });
  });

  it('an event that names no package, or another action, writes nothing', async () => {
    const before = (await uninstallRows()).length;
    await audit.recordPackageLifecycleEvent(uninstallEvent({ packageId: '  ' }));
    await audit.recordPackageLifecycleEvent({ ...uninstallEvent(), action: 'package_install' as any });
    expect(await uninstallRows()).toHaveLength(before);
  });
});

describe('[#31186] the package_uninstall row shape', () => {
  it('a service principal is the actor and never the `sys_user` lookup', () => {
    const row = buildPackageLifecycleAuditRow(uninstallEvent({ actor: 'svc:cloud-uninstall' }));
    expect(row).toMatchObject({ user_id: null, actor: 'svc:cloud-uninstall' });
  });

  it('a ledger deployed without the `actor` column gets no `actor` key', () => {
    const row = buildPackageLifecycleAuditRow(uninstallEvent(), (_o, field) => field !== 'actor');
    expect(row).not.toHaveProperty('actor');
    expect(row.user_id).toBe('u_admin');
  });
});

describe('[#31186] the writer never changes the uninstall\'s answer', () => {
  it('with no engine it writes nothing and does not throw', async () => {
    const writer = createPackageLifecycleAuditWriter({ getEngine: () => undefined });
    await expect(writer.recordPackageLifecycleEvent(uninstallEvent())).resolves.toBeUndefined();
  });

  it('a refused insert is reported at error once per cause, and never thrown', async () => {
    const error = vi.fn();
    const debug = vi.fn();
    const failing = {
      insert: async () => {
        throw Object.assign(new Error('disk full'), { code: 'SQLITE_FULL' });
      },
      getSchema: () => undefined,
    } as any;
    const writer = createPackageLifecycleAuditWriter({ getEngine: () => failing, logger: { error, debug, warn: vi.fn() } });

    await expect(writer.recordPackageLifecycleEvent(uninstallEvent())).resolves.toBeUndefined();
    await expect(writer.recordPackageLifecycleEvent(uninstallEvent())).resolves.toBeUndefined();

    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0]?.[0])).toContain('com.acme.leave');
    expect(debug).toHaveBeenCalledTimes(1);
  });
});
