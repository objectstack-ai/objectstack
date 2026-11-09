// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * What the `sys_audit_log` record page's same-record list SELECTS, on a real
 * engine, a real SQLite driver and the real CRUD mirror.
 *
 * A settings write leaves two kinds of ledger row about the stored settings
 * row: the `config_change` row service-settings writes (a digest, and since it
 * records the row it changed, that row's id as `record_id`), and the mirror's
 * own `create` / `update` row about the same write. The page lists, beside one
 * ledger row, every row whose `record_id` is that row's — so the question is
 * whether those two kinds meet on one value, and what the mirror's row shows.
 *
 * The settings rows are written the way `SettingsService` writes them through
 * the plugin's engine adapter (`wrapEngineAsSettingsEngine`): an insert, then
 * an update by the row's identity (a `where`, `multi: true`), under the system
 * context. The `config_change` rows carry the shape and the `record_id` the
 * settings sink writes; the sink's own row shape is pinned beside it, in
 * service-settings' `config-change-audit.test.ts`, which cannot see this
 * package's object.
 *
 * The list's filter is read off the page — `{ [relationshipField]:
 * parent[relationshipValueField] }`, the filter the console's related list
 * sends — never retyped here.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import { ObjectQL, ObjectQLPlugin } from '@objectstack/objectql';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';
import { SysPlatformSetting, SysSetting } from '@objectstack/platform-objects/system';

import { AuditPlugin } from './audit-plugin.js';
import { singlePostureTenancy } from './__tests__/single-posture-tenancy.js';
import { installDefaultOrganization } from './default-organization.testkit.js';
import { SysAuditLogDetailPage } from './sys-audit-log.page.js';

const LEDGER = 'sys_audit_log';
const SYS = { isSystem: true } as const;
const HARNESS_PACKAGE = 'com.objectstack.audit.test.same-record-list';

type Row = Record<string, any>;

const list = (SysAuditLogDetailPage.regions?.[0]?.components ?? []).find((c: any) => c.type === 'record:related_list') as
  | { properties: { relationshipField: string; relationshipValueField: string } }
  | undefined;

describe('sys_audit_log record page — the same-record list on a real engine', () => {
  let kernel: ObjectKernel;
  let engine: ObjectQL;
  let globalId: string;
  let tenantId: string;
  let secretId: string;

  const ledger = async (where: Record<string, unknown>): Promise<Row[]> =>
    (await engine.find(LEDGER, { where, orderBy: [{ field: 'created_at', order: 'asc' }], context: SYS })) as Row[];
  /** The rows the page's list shows beside `parent`. */
  const listedBeside = async (parent: Row): Promise<Row[]> => {
    const { relationshipField, relationshipValueField } = list!.properties;
    return ledger({ [relationshipField]: parent[relationshipValueField] });
  };
  /** A settings write as `SettingsService` makes it through the plugin's engine adapter. */
  const writeSetting = async (object: string, identity: Row, value: Row): Promise<string> => {
    const [existing] = (await engine.find(object, { where: identity, limit: 1, context: SYS })) as Row[];
    if (existing) {
      await engine.update(object, value, { where: identity, multi: true, context: SYS } as any);
      return String(existing.id);
    }
    const inserted = (await engine.insert(object, { ...identity, ...value }, { context: SYS })) as Row;
    return String(inserted.id);
  };
  /** The `config_change` row the settings sink writes, `record_id` included. */
  const configChange = (objectName: string, recordId: string, key: string, scope: string) => ({
    action: 'config_change',
    object_name: objectName,
    record_id: recordId,
    user_id: null,
    actor: null,
    new_value: JSON.stringify({ namespace: 'branding', key, scope, digest: 'sha256:fixture' }),
    metadata: JSON.stringify({ event: 'settings.set', namespace: 'branding', key, scope, encrypted: scope === 'secret' }),
  });

  beforeAll(async () => {
    kernel = new ObjectKernel({ logger: { level: 'silent' } });
    await kernel.use(new ObjectQLPlugin());
    await kernel.use(singlePostureTenancy());
    await kernel.use(new AuditPlugin());
    await kernel.bootstrap();

    engine = kernel.getService<ObjectQL>('objectql');
    const driver = new SqliteWasmDriver({ filename: ':memory:' });
    await driver.connect();
    engine.registerDriver(driver, true);
    engine.registry.registerObject(SysSetting as any, HARNESS_PACKAGE);
    engine.registry.registerObject(SysPlatformSetting as any, HARNESS_PACKAGE);
    await engine.syncSchemas();
    await installDefaultOrganization(engine);

    // A global value (the deployment's store), written twice.
    const g = { namespace: 'branding', key: 'workspace_name' };
    globalId = await writeSetting('sys_platform_setting', g, { value: 'Acme', encrypted: false });
    await engine.insert(LEDGER, configChange('sys_platform_setting', globalId, 'workspace_name', 'global'), { context: SYS });
    await writeSetting('sys_platform_setting', g, { value: 'Acme Two', encrypted: false });
    await engine.insert(LEDGER, configChange('sys_platform_setting', globalId, 'workspace_name', 'global'), { context: SYS });

    // A tenant value (the organization's store).
    const t = { namespace: 'branding', key: 'tagline', scope: 'tenant', user_id: null };
    tenantId = await writeSetting('sys_setting', t, { value: 'Hello', encrypted: false });
    await engine.insert(LEDGER, configChange('sys_setting', tenantId, 'tagline', 'tenant'), { context: SYS });

    // A secret: the row holds a handle, never the value.
    const s = { namespace: 'branding', key: 'api_key' };
    secretId = await writeSetting('sys_platform_setting', s, { value: null, value_enc: 'sec_fixture_handle', encrypted: true });
    await engine.insert(LEDGER, configChange('sys_platform_setting', secretId, 'api_key', 'global'), { context: SYS });
  });

  afterAll(async () => {
    await kernel?.shutdown?.();
  });

  it('the page declares the list it is read off', () => {
    expect(list?.properties).toMatchObject({ relationshipField: 'record_id', relationshipValueField: 'record_id' });
  });

  it('the mirror names the settings row it wrote by the id the config_change row carries', async () => {
    const mirror = await ledger({ object_name: 'sys_platform_setting', record_id: globalId, action: { $in: ['create', 'update'] } });
    expect(mirror.map((r) => r.action)).toEqual(['create', 'update']);
  });

  it('beside a global config_change row: both config_change rows and the mirror\'s create and update, the new value readable', async () => {
    const [first] = await ledger({ action: 'config_change', record_id: globalId });
    const listed = await listedBeside(first);
    expect(listed.map((r) => r.action).sort()).toEqual(['config_change', 'config_change', 'create', 'update']);
    expect(listed.every((r) => r.record_id === globalId)).toBe(true);
    // The measure-first reading: the global store's mirror row carries the
    // non-secret value in plain text, both sides of the overwrite.
    const update = listed.find((r) => r.action === 'update')!;
    expect(JSON.parse(update.old_value)).toMatchObject({ value: 'Acme' });
    expect(JSON.parse(update.new_value)).toMatchObject({ value: 'Acme Two' });
    // The config_change row itself still carries only the digest.
    expect(JSON.parse(first.new_value)).not.toHaveProperty('value');
  });

  it('beside a tenant config_change row: that sys_setting row\'s rows, and no other setting\'s', async () => {
    const [change] = await ledger({ action: 'config_change', record_id: tenantId });
    const listed = await listedBeside(change);
    expect(listed.map((r) => r.action).sort()).toEqual(['config_change', 'create']);
    expect(listed.every((r) => r.record_id === tenantId)).toBe(true);
    expect(JSON.parse(listed.find((r) => r.action === 'create')!.new_value)).toMatchObject({ value: 'Hello' });
  });

  it('beside a secret\'s config_change row: the mirror\'s row carries neither the value nor its handle', async () => {
    const [change] = await ledger({ action: 'config_change', record_id: secretId });
    const listed = await listedBeside(change);
    const create = listed.find((r) => r.action === 'create');
    expect(create).toBeTruthy();
    const snapshot = JSON.parse(create!.new_value);
    expect(snapshot.value ?? null).toBeNull();
    expect(snapshot).not.toHaveProperty('value_enc');
    expect(create!.new_value).not.toContain('sec_fixture_handle');
  });

  it('a row about no record lists nothing beside it', async () => {
    const run = (await engine.insert(LEDGER, { action: 'import', object_name: 'sys_user', record_id: null }, { context: SYS })) as Row;
    const { relationshipValueField } = list!.properties;
    // The console sends no query for a parent with no value (`RelatedList`
    // refuses to fetch an unscoped list); the value it would key on is absent.
    expect(run[relationshipValueField] ?? null).toBeNull();
  });
});
