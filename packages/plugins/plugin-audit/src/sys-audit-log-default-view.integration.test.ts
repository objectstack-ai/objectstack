// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `sys_audit_log`'s default list: what an administrator sees when Setup's
 * 审计日志 opens the bare object route.
 *
 * The door names no view, so the Console opens the FIRST declared list view.
 * Measured on a fresh showcase boot, one act writes several rows, and all but
 * one of them are the platform's own machinery:
 *
 *  - a sign-in writes `login` on `sys_session` AND an `update` of `sys_user`
 *    that only stamps `last_login_at` / `last_login_ip`, under the signing-in
 *    person's own id; the first sign-in through the console also mints the
 *    token-signing key (`create` on `sys_jwks`);
 *  - a settings write writes `config_change` AND the stored setting
 *    (`sys_setting`, `sys_platform_setting`, a secret's `sys_secret`) AND the
 *    settings trail's own entry (`sys_setting_audit` / `sys_platform_setting_audit`);
 *  - a boot writes the migration ledger (`sys_migration`, `sys_migration_journal`).
 *
 * The default view (`recent`) keeps the act and leaves the machinery out. The
 * rows are still written and still readable: `all_events` lists every one.
 *
 * ## Why a real engine, a real driver and the real writer
 *
 * The view is a filter the Console sends to the server, so whether it selects
 * the right rows is a question about the Filter Protocol as a SQL driver runs
 * it (`$nin`, `$null`, `$notContains` under an `or`). The rules are lowered the
 * way the Console lowers a view filter (one node per element under `and`, an
 * any-of group as one `or` node of its rules) and parsed by the server's own
 * `parseFilterAST`. The two `sys_user` updates are written through the real
 * audit writer, so "the sign-in stamp is told apart from an administrator's
 * edit" is the writer's behaviour, not the fixture's.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import { ObjectQL, ObjectQLPlugin } from '@objectstack/objectql';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';
import { parseFilterAST } from '@objectstack/spec/data';
import { SystemObjectName } from '@objectstack/spec/system';
import {
  SysMigration,
  SysMigrationJournal,
  SysPlatformSetting,
  SysPlatformSettingAudit,
  SysSecret,
  SysSetting,
  SysSettingAudit,
} from '@objectstack/platform-objects/system';
import { SysUser } from '@objectstack/platform-objects/identity';

import { AuditPlugin } from './audit-plugin.js';
import { singlePostureTenancy } from './__tests__/single-posture-tenancy.js';
import { installDefaultOrganization } from './default-organization.testkit.js';
import { SysAuditLog } from './objects/index.js';

const LEDGER = 'sys_audit_log';
const SYS = { isSystem: true } as const;
const ADMIN = { userId: 'u_admin', tenantId: 'org_default', positions: ['org_admin'] };
/** The context `stampLastLogin` (plugin-auth) writes the sign-in stamp under. */
const SIGN_IN_STAMP_CTX = { isSystem: true, attributedUserId: 'u_ada', positions: [], permissions: [] };

type Row = Record<string, any>;
type ViewRule = { field: string; operator: string; value?: unknown };
type ViewElement = ViewRule | { or: ViewRule[] };
type ListView = { filter?: ViewElement[]; sort?: Array<{ field: string; order: 'asc' | 'desc' }> };

const views = (SysAuditLog as unknown as { listViews: Record<string, ListView> }).listViews;

/** The Console's lowering of a view filter: one node per element under `and`; a group is one `or` node. */
function whereOf(view: ListView): Record<string, unknown> | undefined {
  const elements = view.filter ?? [];
  if (elements.length === 0) return undefined;
  const node = (r: ViewRule) => [r.field, r.operator, r.value];
  return parseFilterAST([
    'and',
    ...elements.map((e) => ('or' in e ? ['or', ...e.or.map(node)] : node(e))),
  ] as any) as Record<string, unknown>;
}

/** The machinery objects, read from their definitions. */
const MACHINERY_OBJECTS = [
  SysSetting.name,
  SysPlatformSetting.name,
  SysSecret.name,
  SysSettingAudit.name,
  SysPlatformSettingAudit.name,
  SystemObjectName.JWKS,
  SysMigration.name,
  SysMigrationJournal.name,
];

describe('sys_audit_log default list view — the rows it serves', () => {
  let kernel: ObjectKernel;
  let engine: ObjectQL;

  const ledger = async (view: ListView): Promise<Row[]> =>
    (await engine.find(LEDGER, { where: whereOf(view), orderBy: view.sort, context: SYS })) as Row[];
  const userUpdates = async (): Promise<Row[]> =>
    (await engine.find(LEDGER, {
      where: { object_name: 'sys_user', action: 'update' },
      orderBy: [{ field: 'created_at', order: 'asc' }],
      context: SYS,
    })) as Row[];

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
    engine.registry.registerObject(SysUser as any, 'com.objectstack.audit.test.audit-default-view');
    await engine.syncSchemas();
    await installDefaultOrganization(engine);

    await engine.insert('sys_user', { id: 'u_ada', name: 'Ada', email: 'ada@example.com' }, { context: SYS });
    // The sign-in stamp, exactly as plugin-auth writes it.
    await engine.update(
      'sys_user',
      { id: 'u_ada', last_login_at: new Date('2026-11-05T16:05:27Z'), last_login_ip: '127.0.0.1' },
      { context: SIGN_IN_STAMP_CTX } as any,
    );
    // An administrator's edit of the same user: an act.
    await engine.update('sys_user', { id: 'u_ada', name: 'Ada Lovelace' }, { context: ADMIN } as any);
    // A write under the same envelope that also renames is not the stamp alone:
    // the mark is read off the changed fields, never off the context.
    await engine.update(
      'sys_user',
      { id: 'u_ada', name: 'Ada L.', last_login_at: new Date('2026-11-05T16:06:00Z') },
      { context: SIGN_IN_STAMP_CTX } as any,
    );

    // The rows the other writers leave, in the shapes measured on the fresh boot.
    const at = (second: number) => new Date(Date.UTC(2026, 10, 5, 16, 7, second)).toISOString();
    const rows: Row[] = [
      { action: 'login', object_name: 'sys_session', record_id: 's1', user_id: 'u_ada', created_at: at(1),
        metadata: JSON.stringify({ endpoint: '/sign-in/email' }) },
      { action: 'config_change', object_name: SysSetting.name, record_id: null, user_id: 'u_admin', created_at: at(2),
        metadata: JSON.stringify({ event: 'settings.set', namespace: 'branding', key: 'workspace_name', scope: 'tenant' }) },
      ...MACHINERY_OBJECTS.map((object, i) => ({
        action: 'create', object_name: object, record_id: `m${i}`, user_id: null, created_at: at(10 + i),
      })),
    ];
    for (const row of rows) await engine.insert(LEDGER, row, { context: SYS });
  });

  afterAll(async () => {
    await kernel?.shutdown?.();
  });

  it('the first declared view is `recent`, the one Setup opens with no view named', () => {
    expect(Object.keys(views)[0]).toBe('recent');
  });

  it('the writer marks the sign-in stamp, and only the stamp', async () => {
    const [stamp, rename, renameAndStamp] = await userUpdates();
    expect(JSON.parse(stamp.new_value)).toEqual({ last_login_at: expect.any(String), last_login_ip: '127.0.0.1' });
    expect(JSON.parse(stamp.metadata ?? 'null')).toMatchObject({ event: 'auth.last_login_stamp' });
    // Controls: an administrator's edit carries no mark, nor does an edit that also stamps.
    expect(JSON.parse(rename.new_value)).toEqual({ name: 'Ada Lovelace' });
    expect(rename.metadata ?? null).toBeNull();
    expect(Object.keys(JSON.parse(renameAndStamp.new_value)).sort()).toEqual(['last_login_at', 'name']);
    expect(renameAndStamp.metadata ?? null).toBeNull();
  });

  it('`recent` keeps the acts and leaves out the sign-in stamp and the machinery rows', async () => {
    const recent = await ledger(views.recent);
    const shape = recent.map((r) => `${r.action} ${r.object_name}`);
    expect(shape).toContain('login sys_session');
    expect(shape).toContain(`config_change ${SysSetting.name}`);
    // The administrator's two edits of the user are in; the stamp is not.
    const users = recent.filter((r) => r.object_name === 'sys_user' && r.action === 'update');
    expect(users.map((r) => Object.keys(JSON.parse(r.new_value)).sort())).toEqual(
      expect.arrayContaining([['name'], ['last_login_at', 'name']]),
    );
    expect(users).toHaveLength(2);
    for (const row of recent) expect(MACHINERY_OBJECTS).not.toContain(row.object_name);
  });

  it('`recent` reads newest first', async () => {
    const stamps = (await ledger(views.recent)).map((r) => Date.parse(r.created_at));
    expect(stamps).toEqual([...stamps].sort((a, b) => b - a));
  });

  it('`all_events` still lists every row `recent` leaves out', async () => {
    expect(views.all_events.filter).toBeUndefined();
    const all = await ledger(views.all_events);
    for (const object of MACHINERY_OBJECTS) expect(all.map((r) => r.object_name)).toContain(object);
    expect(all.filter((r) => r.object_name === 'sys_user' && r.action === 'update')).toHaveLength(3);
  });
});
