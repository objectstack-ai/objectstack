// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The ADR-0131 D10 preflight over a deployment that keeps objects in two
 * databases — the primary and the `telemetry` sibling a development boot keeps
 * its lifecycle-classed objects in — and over the shipped permission sets an
 * install seeded as `admin` rows before 2026-08-15.
 *
 *  - each object is planned in the database the deployment keeps it in, its
 *    anchors read in theirs (a notification in the sibling takes its
 *    organization from a record in the primary);
 *  - a table left in a database its object no longer lives in is listed and
 *    warned about, never planned: nothing reads it;
 *  - the legacy shipped-set seeds are counted in their own category and named
 *    in a warning, and a Setup-authored `admin` set is not among them;
 *  - the control: with no sibling (a production boot), the primary plans as
 *    it always did, and the run issues SELECTs only on both databases.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildOrganizationOwnershipPlan,
  type AttributionAssignment,
  type OrganizationOwnershipPlan,
  type PlanReader,
  type TablePlan,
} from './organization-ownership-plan.js';

let dir: string;
let primary: Database.Database;
let telemetry: Database.Database;
let statements: string[];

const LIFECYCLE = new Set(['sys_audit_log', 'sys_notification', 'sys_http_delivery']);

function reader(db: Database.Database): PlanReader {
  return {
    dialect: 'sqlite',
    client: 'better-sqlite3',
    async query(sql, params = []) {
      statements.push(sql);
      return db.prepare(sql).all(...(params as unknown[])) as Record<string, unknown>[];
    },
  };
}

const plan = (opts: { siblings?: boolean; onAttribution?: (batch: { object: string; assignments: AttributionAssignment[] }) => Promise<void> } = {}): Promise<OrganizationOwnershipPlan> =>
  buildOrganizationOwnershipPlan({
    reader: reader(primary),
    posture: 'isolated',
    database: join(dir, 'dev.db'),
    ...(opts.siblings === false
      ? {}
      : {
          siblings: [{ name: 'telemetry', database: join(dir, 'dev.telemetry.db'), reader: reader(telemetry) }],
          homeOf: (object: string) => (LIFECYCLE.has(object) ? 'telemetry' : 'primary'),
        }),
    ...(opts.onAttribution ? { onAttribution: opts.onAttribution } : {}),
    now: new Date('2026-10-16T00:00:00Z'),
  });

const table = (p: OrganizationOwnershipPlan, object: string): TablePlan => {
  const found = p.tables.find((t) => t.object === object);
  if (!found) throw new Error(`no ${object} in the plan`);
  return found;
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'os-d10-siblings-'));
  primary = new Database(join(dir, 'dev.db'));
  telemetry = new Database(join(dir, 'dev.telemetry.db'));
  statements = [];
  primary.exec(`
    CREATE TABLE sys_organization (id TEXT PRIMARY KEY, slug TEXT);
    INSERT INTO sys_organization VALUES ('org_default', 'default'), ('org_b', 'b');
    CREATE TABLE crm_deal (id TEXT PRIMARY KEY, organization_id TEXT, name TEXT);
    INSERT INTO crm_deal VALUES ('deal_1', 'org_b', 'Acme');
    CREATE TABLE sys_webhook (id TEXT PRIMARY KEY, organization_id TEXT, managed_by TEXT);
    INSERT INTO sys_webhook VALUES ('wh_1', 'org_b', 'admin');

    -- the shipped sets as a pre-2026-08-15 seeder wrote them, a set the
    -- platform seeded since, and one a Setup administrator authored
    CREATE TABLE sys_permission_set (id TEXT PRIMARY KEY, organization_id TEXT, name TEXT, managed_by TEXT);
    INSERT INTO sys_permission_set VALUES
      ('ps_1', NULL, 'organization_admin', 'admin'),
      ('ps_2', NULL, 'member_default', 'admin'),
      ('ps_3', NULL, 'viewer_readonly', 'platform'),
      ('ps_4', NULL, 'field_sales', 'admin');

    -- left in the primary by a boot from before the sibling existed
    CREATE TABLE sys_audit_log (id TEXT PRIMARY KEY, organization_id TEXT, tenant_id TEXT);
    INSERT INTO sys_audit_log VALUES ('old_1', 'org_b', 'org_b'), ('old_2', NULL, NULL);
  `);
  telemetry.exec(`
    -- fate 1 in the sibling: the column is still there
    CREATE TABLE sys_audit_log (id TEXT PRIMARY KEY, organization_id TEXT, tenant_id TEXT);
    INSERT INTO sys_audit_log VALUES ('al_1', 'org_b', 'org_b'), ('al_2', NULL, NULL);
    -- fate 3 in the sibling, anchored on records in the primary
    CREATE TABLE sys_notification (id TEXT PRIMARY KEY, organization_id TEXT, source_object TEXT, source_id TEXT);
    INSERT INTO sys_notification VALUES ('n_1', NULL, 'crm_deal', 'deal_1'), ('n_2', 'org_b', 'crm_deal', 'deal_1');
    CREATE TABLE sys_http_delivery (id TEXT PRIMARY KEY, organization_id TEXT, ref_id TEXT);
    INSERT INTO sys_http_delivery VALUES ('d_1', NULL, 'wh_1');
  `);
});

afterEach(() => {
  primary.close();
  telemetry.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('ADR-0131 D10 preflight — the telemetry sibling', () => {
  it('⭐ plans each lifecycle object in the sibling, its anchors read where their objects live', async () => {
    const p = await plan();
    expect(p.siblings).toEqual([{ name: 'telemetry', database: join(dir, 'dev.telemetry.db') }]);

    const audit = table(p, 'sys_audit_log');
    expect(audit).toMatchObject({ database: 'telemetry', fate: 'column-drop', organizationColumn: 'present', physical: 'present' });
    expect(audit.rows).toEqual({ total: 2, organizationNull: 1, stamped: 1 });

    const notification = table(p, 'sys_notification');
    expect(notification.database).toBe('telemetry');
    expect(notification.attribution).toEqual({ 'subject:source_object/source_id': 1 });
    expect(notification.unattributable).toEqual([]);

    const delivery = table(p, 'sys_http_delivery');
    expect(delivery.attribution).toEqual({ 'parent:ref_id->sys_webhook': 1 });

    // A primary object carries no database tag.
    expect(table(p, 'crm_deal').database).toBeUndefined();
  });

  it('⭐ a table left in a database its object no longer lives in is warned about and never planned', async () => {
    const p = await plan();
    expect(p.staleCopies).toEqual([
      { object: 'sys_audit_log', database: 'primary', home: 'telemetry', tables: ['sys_audit_log'], rows: 2 },
    ]);
    expect(p.tables.filter((t) => t.object === 'sys_audit_log')).toHaveLength(1);
    expect(p.warnings.some((w) => w.startsWith('sys_audit_log has a table in the primary database, but this deployment keeps the object in the telemetry database'))).toBe(true);
  });

  it('every derived owner of a sibling row names the sibling, so the apply writes it there', async () => {
    const seen: AttributionAssignment[] = [];
    await plan({ onAttribution: async ({ assignments }) => { seen.push(...assignments); } });
    expect(seen).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'n_1', table: 'sys_notification', database: 'telemetry', organizationId: 'org_b' }),
      expect.objectContaining({ id: 'd_1', table: 'sys_http_delivery', database: 'telemetry', organizationId: 'org_b' }),
    ]));
    expect(seen.every((a) => a.database === 'telemetry')).toBe(true);
  });

  it('the control: with no sibling the primary plans as it always did, and every statement on both databases is a SELECT', async () => {
    const p = await plan({ siblings: false });
    expect(p.siblings).toBeUndefined();
    expect(p.staleCopies).toEqual([]);
    expect(table(p, 'sys_audit_log')).toMatchObject({ fate: 'column-drop', physical: 'present' });
    expect(table(p, 'sys_audit_log').database).toBeUndefined();

    statements = [];
    await plan();
    expect(statements.length).toBeGreaterThan(10);
    expect(statements.filter((s) => !/^SELECT\b/.test(s.trim()))).toEqual([]);
  });
});

describe('ADR-0131 D10 preflight — shipped permission sets seeded as admin rows', () => {
  it('⭐ counts them in their own category and names each in a warning; a Setup-authored set is not among them', async () => {
    const p = await plan();
    const sets = table(p, 'sys_permission_set');
    expect(sets.categories.find((c) => c.id === 'legacy-shipped-set-seeds')?.rows).toBe(2);
    const warning = p.warnings.find((w) => w.includes("stored as managed_by 'admin'"));
    expect(warning).toContain('(member_default, organization_admin)');
    expect(warning).not.toContain('field_sales');
    expect(warning).toContain('is not carried');
  });

  it('a database with none of them warns about nothing', async () => {
    primary.exec(`UPDATE sys_permission_set SET managed_by = 'platform' WHERE name IN ('organization_admin', 'member_default')`);
    const p = await plan({ siblings: false });
    expect(table(p, 'sys_permission_set').categories.find((c) => c.id === 'legacy-shipped-set-seeds')?.rows).toBe(0);
    expect(p.warnings).toEqual([]);
  });
});
