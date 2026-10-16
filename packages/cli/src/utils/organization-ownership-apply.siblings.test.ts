// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The ADR-0131 D10 `--apply` over a deployment that keeps objects in two
 * databases — the primary and the `telemetry` sibling — on an install whose
 * shipped permission sets were seeded as `admin` rows before 2026-08-15:
 *
 *  - a sibling row takes its organization from a record in the primary, and
 *    the write lands in the sibling;
 *  - a sibling table's organization column is dropped there, while the
 *    primary's leftover copy of it is touched by no step at all;
 *  - the legacy shipped-set seed is adopted (re-owned `platform`), its grant
 *    named, and the row deleted as a mirror — the shipped definition stands;
 *  - the plan's warnings reach the operator before the first write, and the
 *    report keeps them.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildOrganizationOwnershipPlan, inventoryDigest } from './organization-ownership-plan.js';
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
let primary: Database.Database;
let telemetry: Database.Database;
/** Every write, tagged with the database it went to. */
let writes: string[];

const LIFECYCLE = new Set(['sys_audit_log', 'sys_notification']);
const homeOf = (object: string): string => (LIFECYCLE.has(object) ? 'telemetry' : 'primary');

function executor(db: Database.Database, name: string): ApplyExecutor {
  return {
    dialect: 'sqlite',
    client: 'better-sqlite3',
    async query(sql, params = []) {
      return db.prepare(sql).all(...(params as unknown[])) as Record<string, unknown>[];
    },
    async execute(sql, params = []) {
      writes.push(`${name}: ${sql}`);
      db.prepare(sql).run(...(params as unknown[]));
    },
  };
}

/** The schema-drift ceremony: each column dropped in the database its object lives in. */
const columnDrops: ColumnDropPort = {
  async drop(columns) {
    return columns.map(({ table, column }) => {
      const name = homeOf(table);
      writes.push(`${name}: ALTER TABLE ${table} DROP COLUMN ${column}`);
      (name === 'telemetry' ? telemetry : primary).exec(`ALTER TABLE "${table}" DROP COLUMN "${column}"`);
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

/** The shipped definition the catalog serves for `member_default` (what the security plugin declares). */
const SHIPPED_MEMBER_DEFAULT = { name: 'member_default', label: 'Member', objects: { crm_deal: { allowRead: true } }, systemPermissions: [] };

async function apply(warnings: string[] = []): Promise<OrganizationOwnershipApplyReport> {
  const siblings = [{ name: 'telemetry', database: join(dir, 'dev.telemetry.db'), executor: executor(telemetry, 'telemetry') }];
  const reviewed = await buildOrganizationOwnershipPlan({
    reader: executor(primary, 'primary'),
    posture: 'single',
    database: join(dir, 'dev.db'),
    siblings: siblings.map((d) => ({ name: d.name, database: d.database, reader: d.executor })),
    homeOf,
  });
  return applyOrganizationOwnership({
    executor: executor(primary, 'primary'),
    siblings,
    homeOf,
    posture: 'single',
    database: join(dir, 'dev.db'),
    reviewedPlan: {
      file: 'plan.json',
      generatedAt: reviewed.generatedAt,
      database: join(dir, 'dev.db'),
      inventoryDigest: inventoryDigest(),
      posture: 'single',
      conflicts: reviewedConflictsOf(reviewed),
    },
    catalog: {
      async resolve(type, name) {
        return type === 'permission' && name === 'member_default' ? { definition: SHIPPED_MEMBER_DEFAULT } : undefined;
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
    ledger: ledger(),
    onWarning: (message) => warnings.push(message),
    now: () => new Date('2026-10-16T00:00:00Z'),
  });
}

const rows = (db: Database.Database, sql: string): Record<string, unknown>[] => db.prepare(sql).all() as Record<string, unknown>[];
const columns = (db: Database.Database, table: string): string[] =>
  (db.prepare(`SELECT name FROM pragma_table_info(?)`).all(table) as { name: string }[]).map((c) => c.name);

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'os-d10-apply-siblings-'));
  primary = new Database(join(dir, 'dev.db'));
  telemetry = new Database(join(dir, 'dev.telemetry.db'));
  writes = [];
  primary.exec(`
    CREATE TABLE sys_organization (id TEXT PRIMARY KEY, slug TEXT);
    INSERT INTO sys_organization VALUES ('org_default', 'default');
    CREATE TABLE crm_deal (id TEXT PRIMARY KEY, organization_id TEXT, name TEXT);
    INSERT INTO crm_deal VALUES ('deal_1', 'org_default', 'Acme');

    -- member_default as a pre-2026-08-15 seeder wrote it: managed_by 'admin',
    -- its body older than the shipped one — and the grant naming it by id
    CREATE TABLE sys_permission_set (id TEXT PRIMARY KEY, organization_id TEXT, name TEXT, label TEXT, managed_by TEXT,
      active INTEGER, object_permissions TEXT, system_permissions TEXT);
    INSERT INTO sys_permission_set VALUES
      ('ps_legacy', NULL, 'member_default', 'Member', 'admin', 1, '{"crm_deal":{"allowRead":true,"allowEdit":true}}', '[]');
    CREATE TABLE sys_user_permission_set (id TEXT PRIMARY KEY, organization_id TEXT, user_id TEXT,
      permission_set_id TEXT, permission_set TEXT);
    INSERT INTO sys_user_permission_set VALUES ('grant_1', 'org_default', 'usr_1', 'ps_legacy', NULL);

    -- left in the primary by a boot from before the sibling existed
    CREATE TABLE sys_audit_log (id TEXT PRIMARY KEY, organization_id TEXT, tenant_id TEXT);
    INSERT INTO sys_audit_log VALUES ('old_1', NULL, NULL);
    CREATE TABLE sys_notification (id TEXT PRIMARY KEY, organization_id TEXT, source_object TEXT, source_id TEXT);
    INSERT INTO sys_notification VALUES ('n_old', NULL, 'crm_deal', 'deal_1');
  `);
  telemetry.exec(`
    CREATE TABLE sys_audit_log (id TEXT PRIMARY KEY, organization_id TEXT, tenant_id TEXT);
    INSERT INTO sys_audit_log VALUES ('al_1', 'org_default', 'org_default');
    CREATE TABLE sys_notification (id TEXT PRIMARY KEY, organization_id TEXT, source_object TEXT, source_id TEXT);
    INSERT INTO sys_notification VALUES ('n_1', NULL, 'crm_deal', 'deal_1');
  `);
});

afterEach(() => {
  primary.close();
  telemetry.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('ADR-0131 D10 --apply — the telemetry sibling', () => {
  it('⭐ attributes and drops in the sibling, and leaves the primary\'s leftover copies untouched', async () => {
    const report = await apply();
    expect(report.steps.filter((s) => s.status !== 'done').map((s) => `${s.step}: ${s.blockers.join(' | ')}`)).toEqual([]);

    // The sibling row took its organization from the record in the primary.
    expect(rows(telemetry, 'SELECT id, organization_id FROM sys_notification')).toEqual([{ id: 'n_1', organization_id: 'org_default' }]);
    // The sibling's audit ledger lost its column; its rows stayed.
    expect(columns(telemetry, 'sys_audit_log')).toEqual(['id', 'tenant_id']);
    expect(rows(telemetry, 'SELECT id FROM sys_audit_log')).toEqual([{ id: 'al_1' }]);

    // The primary's leftover copies: no step wrote to them.
    expect(columns(primary, 'sys_audit_log')).toContain('organization_id');
    expect(rows(primary, 'SELECT organization_id FROM sys_notification')).toEqual([{ organization_id: null }]);
    expect(writes.filter((w) => w.startsWith('primary:') && /sys_audit_log|sys_notification/.test(w))).toEqual([]);
  });
});

describe('ADR-0131 D10 --apply — shipped permission sets seeded as admin rows', () => {
  it('⭐ adopts the seed, names its grant, and deletes it as a mirror: the shipped definition stands', async () => {
    const warnings: string[] = [];
    const report = await apply(warnings);
    const conversion = report.steps.find((s) => s.step === 'authored-conversion')!;
    expect(conversion).toMatchObject({ status: 'done', summary: expect.objectContaining({ legacySeedsAdopted: 1, converted: 0 }) });
    expect(conversion.notes.join(' ')).toContain('(member_default)');

    expect(rows(primary, 'SELECT id FROM sys_permission_set')).toEqual([]);
    expect(rows(primary, 'SELECT id, permission_set FROM sys_user_permission_set')).toEqual([{ id: 'grant_1', permission_set: 'member_default' }]);

    // Warned before the first write, and kept in the report.
    expect(warnings.some((w) => w.includes("stored as managed_by 'admin' (member_default)"))).toBe(true);
    expect(report.warnings).toEqual(warnings);
  });

  it('a re-run adopts nothing more: idempotent', async () => {
    await apply();
    const again = await apply();
    expect(again.steps.find((s) => s.step === 'authored-conversion')?.summary.legacySeedsAdopted).toBeUndefined();
    expect(again.warnings.filter((w) => w.includes("managed_by 'admin'"))).toEqual([]);
  });
});
