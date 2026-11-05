// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `sys_activity`'s default list: what a reader sees when Home's "view all
 * activity" or the bell's Activity tab opens the bare object route.
 *
 * Both doors name no view, so the Console opens the FIRST declared list view.
 * That view (`recent`) must answer newest first, and must leave out the rows
 * about the platform's own objects (the metadata store, the migration ledger,
 * and `sys_user`, whose sign-in stamp is written under the signing-in person's
 * own name) and the rows no person wrote (a migration, a seed: the system actor
 * is `null`, ADR-0118 D1). The second view (`all`) still lists every row, which
 * is where an administrator finds the rest.
 *
 * ## Why a real engine and a real driver
 *
 * The view is a filter and a sort the Console sends to the server. Whether
 * that filter selects the right rows is a question about the Filter Protocol
 * as a SQL driver executes it (`$null`, `$nin`), so the view's own rules are
 * lowered the way the Console lowers a view filter (one `[field, operator,
 * value]` node per rule under `and`) and parsed by the server's own
 * `parseFilterAST`, then run through the real engine on SQLite. The human and
 * system rows on a business object are written by the real audit writer, so
 * the "system write leaves `actor_id` null" premise is the writer's, not the
 * fixture's.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import { ObjectQL, ObjectQLPlugin } from '@objectstack/objectql';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';
import { parseFilterAST } from '@objectstack/spec/data';
import {
  SysMetadataObject,
  SysMetadataHistoryObject,
  SysMetadataCommitObject,
  SysMetadataAuditObject,
} from '@objectstack/metadata-core';
import { SysMigration, SysMigrationJournal } from '@objectstack/platform-objects/system';
import { SystemObjectName } from '@objectstack/spec/system';

import { AuditPlugin } from './audit-plugin.js';
import { singlePostureTenancy } from './__tests__/single-posture-tenancy.js';
import { installDefaultOrganization } from './default-organization.testkit.js';
import { SysActivity } from './objects/index.js';
import { ACTIVITY_FEED_EXCLUDED_OBJECTS } from './objects/sys-activity.object.js';

const ACTIVITY = 'sys_activity';
const DEAL = 'act_deal';
const HARNESS_PACKAGE = 'com.objectstack.audit.test.activity-default-view';

const SYS = { isSystem: true } as const;
const ADMIN = { userId: 'u_admin', tenantId: 'org_default', positions: ['org_admin'] };

const dealObject = {
  name: DEAL,
  label: 'Deal',
  fields: { name: { name: 'name', label: 'Name', type: 'text' as const } },
};

type Row = Record<string, any>;
type ViewRule = { field: string; operator: string; value?: unknown };
type ListView = { filter?: ViewRule[]; sort?: Array<{ field: string; order: 'asc' | 'desc' }> };

const views = (SysActivity as unknown as { listViews: Record<string, ListView> }).listViews;

/** The Console's lowering of a view filter: one node per rule, under `and`. */
function whereOf(view: ListView): Record<string, unknown> | undefined {
  const rules = view.filter ?? [];
  if (rules.length === 0) return undefined;
  return parseFilterAST(['and', ...rules.map((r) => [r.field, r.operator, r.value])]) as Record<string, unknown>;
}

describe('sys_activity default list view — the declaration', () => {
  it('the first declared view is `recent`, the one a door with no view name opens', () => {
    expect(Object.keys(views)[0]).toBe('recent');
  });

  it('both views read newest first', () => {
    expect(views.recent.sort).toEqual([{ field: 'timestamp', order: 'desc' }]);
    expect(views.all.sort).toEqual([{ field: 'timestamp', order: 'desc' }]);
  });

  it('the excluded objects are read from the definitions they name', () => {
    expect([...ACTIVITY_FEED_EXCLUDED_OBJECTS].sort()).toEqual(
      [
        SysMetadataObject.name,
        SysMetadataHistoryObject.name,
        SysMetadataCommitObject.name,
        SysMetadataAuditObject.name,
        SysMigration.name,
        SysMigrationJournal.name,
        SystemObjectName.USER,
      ].sort(),
    );
  });

  it('`all` carries no filter, so every readable row stays one click away', () => {
    expect(views.all.filter).toBeUndefined();
  });

  it('the description is not the developer sentence the page used to show', () => {
    expect(SysActivity.description).not.toMatch(/denormalized/i);
    expect(SysActivity.label).not.toBe('Activity');
  });
});

describe('sys_activity default list view — the rows it serves', () => {
  let kernel: ObjectKernel;
  let engine: ObjectQL;
  const summaries = (rows: Row[]) => rows.map((r) => r.summary);

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
    engine.registry.registerObject(dealObject as any, HARNESS_PACKAGE);
    await engine.syncSchemas();
    await installDefaultOrganization(engine);

    // The real CRUD mirror: a person's write and a system write on a business object.
    await engine.insert(DEAL, { name: 'person deal' }, { context: ADMIN });
    await engine.insert(DEAL, { name: 'seeded deal' }, { context: SYS });

    // Rows in the shapes the platform's own writers leave, at known instants.
    const at = (minute: number) => new Date(Date.UTC(2026, 10, 4, 16, minute)).toISOString();
    const rows: Row[] = [
      { summary: 'person edits a deal (16:44)', object_name: DEAL, record_id: 'd1', actor_id: 'u_admin', timestamp: at(44) },
      { summary: 'person creates a deal (16:34)', object_name: DEAL, record_id: 'd2', actor_id: 'u_admin', timestamp: at(34) },
      { summary: 'person deletes a deal (16:40)', object_name: DEAL, record_id: 'd3', actor_id: 'u_admin', timestamp: at(40) },
      // Measured on a fresh `dev:crm` boot: the sign-in stamp carries the person who signed in.
      { summary: 'sign-in stamp', object_name: 'sys_user', record_id: 'u_admin', actor_id: 'u_admin', timestamp: at(45) },
      { summary: 'metadata publish', object_name: SysMetadataObject.name, record_id: 'm1', actor_id: 'u_admin', timestamp: at(46) },
      { summary: 'metadata history', object_name: SysMetadataHistoryObject.name, record_id: 'h1', actor_id: 'u_admin', timestamp: at(47) },
      { summary: 'migration', object_name: SysMigration.name, record_id: 'g1', actor_id: null, timestamp: at(48) },
    ];
    for (const row of rows) {
      await engine.insert(ACTIVITY, { type: 'updated', ...row }, { context: SYS });
    }
  });

  afterAll(async () => {
    await kernel?.shutdown?.();
  });

  it('a system write on a business object leaves actor_id null; a person\'s carries the person', async () => {
    const mirrored = (await engine.find(ACTIVITY, {
      where: { object_name: DEAL, record_id: { $nin: ['d1', 'd2', 'd3'] } },
      context: SYS,
    })) as Row[];
    const byActor = mirrored.map((r) => r.actor_id ?? null).sort();
    expect(byActor).toEqual(['u_admin', null].sort());
  });

  it('`recent` serves only what people did to records, newest first', async () => {
    const recent = (await engine.find(ACTIVITY, {
      where: whereOf(views.recent),
      orderBy: views.recent.sort,
      context: SYS,
    })) as Row[];
    const fixed = summaries(recent).filter((s) => / \(16:\d\d\)$/.test(s));
    expect(fixed).toEqual([
      'person edits a deal (16:44)',
      'person deletes a deal (16:40)',
      'person creates a deal (16:34)',
    ]);
    // The mirrored person row is in, the seeded one is not.
    expect(recent.filter((r) => r.object_name === DEAL && !/ \(16:/.test(r.summary))).toHaveLength(1);
    for (const row of recent) {
      expect(row.actor_id).toBeTruthy();
      expect(ACTIVITY_FEED_EXCLUDED_OBJECTS).not.toContain(row.object_name);
    }
    const stamps = recent.map((r) => Date.parse(r.timestamp));
    expect(stamps).toEqual([...stamps].sort((a, b) => b - a));
  });

  it('`all` still lists the rows `recent` leaves out', async () => {
    const all = summaries((await engine.find(ACTIVITY, {
      where: whereOf(views.all),
      orderBy: views.all.sort,
      context: SYS,
    })) as Row[]);
    for (const left of ['sign-in stamp', 'metadata publish', 'metadata history', 'migration']) {
      expect(all).toContain(left);
    }
  });
});
