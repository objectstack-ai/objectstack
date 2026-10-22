// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The ADR-0131 D10 `--apply` on walled organization-less self-registration
 * grants: before the grant waited for the registrant's first membership (ruling
 * record 6257510973 item 1, Q1 A), a walled sign-up wrote it with no
 * organization. The ceremony gives such a grant its user's sole membership's
 * organization — where the runtime settles the grant today — and reports the
 * rest, never guessing (D10 fate 4, ruling C on the C8 decision).
 *
 * The fixture is the measured legacy shape: one NULL `member_default` grant per
 * self-registrant (id, user and set only), beside a grant already stamped.
 *
 *  - Walled (`isolated`, `group`): the one-membership user's grant takes that
 *    organization; the grants of a user in two organizations, of a user in
 *    none, and of a user whose set an administrator already granted in the
 *    sole organization are reported and hold certification; nothing is
 *    deleted.
 *  - `single`: the Default Organization takes every NULL grant, as before.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildOrganizationOwnershipPlan, inventoryDigest, type OrganizationOwnershipPlan } from './organization-ownership-plan.js';
import {
  applyOrganizationOwnership,
  reviewedConflictsOf,
  type ApplyExecutor,
  type CeremonyCheckpoint,
  type CeremonyLedgerPort,
  type ColumnDropPort,
  type OrganizationOwnershipApplyReport,
} from './organization-ownership-apply.js';

let dir: string;
let db: Database.Database;
/** Every write statement the ceremony issued, in order. */
let writes: string[];

function executor(): ApplyExecutor {
  return {
    dialect: 'sqlite',
    client: 'better-sqlite3',
    async query(sql, params = []) {
      return db.prepare(sql).all(...(params as unknown[])) as Record<string, unknown>[];
    },
    async execute(sql, params = []) {
      writes.push(sql);
      db.prepare(sql).run(...(params as unknown[]));
    },
  };
}

const columnDrops: ColumnDropPort = {
  async drop(columns) {
    return columns.map(({ table, column }) => {
      db.exec(`ALTER TABLE "${table}" DROP COLUMN "${column}"`);
      return { table, column, outcome: 'dropped' as const };
    });
  },
};

function ledger(): CeremonyLedgerPort {
  let stored: CeremonyCheckpoint | null = null;
  return {
    async read() {
      return stored ? (JSON.parse(JSON.stringify(stored)) as CeremonyCheckpoint) : null;
    },
    async write(checkpoint) {
      stored = JSON.parse(JSON.stringify(checkpoint)) as CeremonyCheckpoint;
    },
  };
}

const database = (): string => join(dir, 'fixture.db');

const plan = (posture: string): Promise<OrganizationOwnershipPlan> =>
  buildOrganizationOwnershipPlan({ reader: executor(), posture, database: database() });

/** Plan, then apply that reviewed plan, as the command does. */
async function apply(posture: string, l = ledger()): Promise<OrganizationOwnershipApplyReport> {
  const reviewed = await plan(posture);
  return applyOrganizationOwnership({
    executor: executor(),
    posture,
    database: database(),
    reviewedPlan: {
      file: 'plan.json',
      generatedAt: reviewed.generatedAt,
      database: database(),
      inventoryDigest: inventoryDigest(),
      posture,
      conflicts: reviewedConflictsOf(reviewed),
    },
    // The grants' sets are declared: the rewrite verifies each name resolves.
    catalog: {
      async resolve(type, name) {
        return type === 'permission' && ['member_default', 'viewer_readonly'].includes(name) ? { definition: { name } } : undefined;
      },
    },
    door: {
      async save(type, name) {
        throw new Error(`no environment save is expected here (${type} ${name})`);
      },
    },
    templates: { async find() { return undefined; } },
    views: { async list() { return []; } },
    lock: { async verdict() { return { editable: true }; } },
    columnDrops,
    ledger: l,
    now: () => new Date('2026-10-19T00:00:00Z'),
  });
}

const grants = (): Record<string, unknown>[] =>
  db.prepare(`SELECT id, organization_id FROM sys_user_permission_set ORDER BY id`).all() as Record<string, unknown>[];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'os-d10-sole-membership-'));
  db = new Database(database());
  writes = [];
  db.exec(`
    CREATE TABLE sys_organization (id TEXT PRIMARY KEY, slug TEXT);
    INSERT INTO sys_organization VALUES ('org_default', 'default'), ('org_a', 'acme'), ('org_b', 'beta');
    CREATE TABLE sys_user (id TEXT PRIMARY KEY, name TEXT, email TEXT);
    INSERT INTO sys_user VALUES ('usr_one', 'One', 'one@example.com'), ('usr_two', 'Two', 'two@example.com'),
      ('usr_none', 'None', 'none@example.com'), ('usr_held', 'Held', 'held@example.com');
    CREATE TABLE sys_member (id TEXT PRIMARY KEY, organization_id TEXT, user_id TEXT, role TEXT);
    INSERT INTO sys_member VALUES
      ('mem_one', 'org_a', 'usr_one', 'member'),
      ('mem_two_a', 'org_a', 'usr_two', 'member'),
      ('mem_two_b', 'org_b', 'usr_two', 'member'),
      ('mem_held', 'org_a', 'usr_held', 'member');
    CREATE TABLE sys_user_permission_set (id TEXT PRIMARY KEY, organization_id TEXT, user_id TEXT, permission_set TEXT);
    CREATE UNIQUE INDEX uniq_grant ON sys_user_permission_set (user_id, permission_set, COALESCE(organization_id, '__global__'));
    INSERT INTO sys_user_permission_set VALUES
      ('ups_one', NULL, 'usr_one', 'member_default'),
      ('ups_two', NULL, 'usr_two', 'member_default'),
      ('ups_none', NULL, 'usr_none', 'member_default'),
      ('ups_held', NULL, 'usr_held', 'member_default'),
      ('ups_held_admin', 'org_a', 'usr_held', 'member_default'),
      ('ups_stamped', 'org_b', 'usr_two', 'viewer_readonly');
  `);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe.each(['isolated', 'group'])('walled (%s): a NULL self-registration grant takes its user\'s sole membership\'s organization', (posture) => {
  it('the plan attributes the one-membership grant and reports the others, each with its reason', async () => {
    const reviewed = await plan(posture);
    const table = reviewed.tables.find((t) => t.object === 'sys_user_permission_set')!;
    expect(table.fateCounts).toMatchObject({ rowsToAttribute: 1, unattributableRows: 3 });
    expect(table.attribution).toEqual({ 'sole-membership:user_id->sys_member': 1 });
    expect(table.unattributable).toEqual([
      { id: 'ups_held', reason: expect.stringMatching(/user usr_held's sole membership names org_a, where row ups_held_admin already holds this key$/) },
      { id: 'ups_none', reason: expect.stringMatching(/user usr_none is a member of no organization$/) },
      { id: 'ups_two', reason: expect.stringMatching(/user usr_two is a member of 2 organizations, so the grant's is not derivable$/) },
    ]);
  });

  it('⭐ --apply writes the one-membership grant\'s organization; the reported grants stay NULL, hold certification, and none is deleted', async () => {
    const report = await apply(posture);
    expect(report.complete).toBe(true);
    expect(report.blocking).toBe(3);
    const table = report.tables.find((t) => t.object === 'sys_user_permission_set')!;
    expect(table).toMatchObject({ attributed: 1, remaining: 3, held: { rows: 3 } });
    expect(grants()).toEqual([
      { id: 'ups_held', organization_id: null },
      { id: 'ups_held_admin', organization_id: 'org_a' },
      { id: 'ups_none', organization_id: null },
      { id: 'ups_one', organization_id: 'org_a' },
      { id: 'ups_stamped', organization_id: 'org_b' },
      { id: 'ups_two', organization_id: null },
    ]);
    expect(writes.filter((w) => /^DELETE/i.test(w) && /sys_user_permission_set/.test(w))).toEqual([]);
  });
});

describe('single: the Default Organization takes every NULL grant, as before', () => {
  it('no grant is attributed through a membership', async () => {
    const reviewed = await plan('single');
    const table = reviewed.tables.find((t) => t.object === 'sys_user_permission_set')!;
    expect(table.attribution).toEqual({ 'default-organization': 4 });
    expect(table.unattributable).toEqual([]);
  });
});
