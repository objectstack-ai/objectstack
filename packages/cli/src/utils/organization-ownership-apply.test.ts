// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The ADR-0131 D10 ceremony's acceptance: a fixture database carrying every
 * fate comes through `--apply` with effective access IDENTICAL (and a positive
 * control: a grant the rewrite would lose reddens the comparison), mirrors
 * gone, attributed rows carrying their organization, the unattributable row
 * still present and reported, and row counts reconciling. Plus the ceremony's
 * guarantees: idempotent, resumable from the recorded checkpoint, gated
 * (nothing deleted while a reference does not resolve by name), and no
 * deletion outside fate 2.
 *
 * The shape is the post-stage-8 one: the catalog objects are no longer
 * registered, so every read and write here goes through the raw-SQL seam, and
 * `permission_set_id` is a plain text column beside `permission_set`.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { permissionSetDefinitionFromRow } from '@objectstack/core';
import { inventoryDigest } from './organization-ownership-plan.js';
import {
  applyOrganizationOwnership,
  ReviewedPlanRefusal,
  reviewedPlanFromFile,
  TemplateChoiceRefusal,
  type ApplyExecutor,
  type CatalogPort,
  type CeremonyCheckpoint,
  type CeremonyLedgerPort,
  type ColumnDropPort,
  type MetadataDoorPort,
  type OrganizationOwnershipApplyReport,
  type ReviewedPlan,
  type TemplatePort,
} from './organization-ownership-apply.js';

let dir: string;
let file: string;
let db: Database.Database;
/** Every write statement the ceremony issued, in order. */
let writes: string[];

function executor(opts: { failOnceOn?: RegExp } = {}): ApplyExecutor {
  let failed = false;
  return {
    client: 'better-sqlite3',
    async query(sql, params = []) {
      return db.prepare(sql).all(...(params as unknown[])) as Record<string, unknown>[];
    },
    async execute(sql, params = []) {
      if (opts.failOnceOn && !failed && opts.failOnceOn.test(sql)) {
        failed = true;
        throw new Error('SQLITE_IOERR: the process was killed mid-step');
      }
      writes.push(sql);
      db.prepare(sql).run(...(params as unknown[]));
    },
  };
}

/**
 * The declared catalog (code) plus the environment metadata the door saved.
 * Like the registry, it serves a saved definition only from the next boot on
 * ({@link boot}), never the moment it is saved.
 */
function catalog(): CatalogPort & MetadataDoorPort & TemplatePort & {
  saved: Map<string, Record<string, unknown>>;
  templates: Map<string, Record<string, unknown>>;
  boot(): void;
} {
  const declared = new Map<string, Record<string, unknown>>([
    ['permission|member_default', permissionSetDefinitionFromRow(MEMBER_DEFAULT_ROW)],
    ['position|org_admin', { name: 'org_admin', label: 'Org Admin', delegatable: false, permissionSets: ['member_default'] }],
  ]);
  const saved = new Map<string, Record<string, unknown>>();
  /** Environment `email_template` items, keyed `name|locale`; a package ships `auth.reset_password`. */
  const templates = new Map<string, Record<string, unknown>>();
  const packaged = new Map<string, Record<string, unknown>>([
    ['auth.reset_password|en-US', { name: 'auth.reset_password', label: 'Reset', locale: 'en-US', subject: 'Reset', bodyHtml: '<p>code</p>' }],
  ]);
  let hydrated = new Map<string, Record<string, unknown>>();
  return {
    saved,
    templates,
    async find(name, locale) {
      const own = templates.get(`${name}|${locale}`);
      if (own) return { definition: own, environment: true };
      const shipped = packaged.get(`${name}|${locale}`);
      return shipped ? { definition: shipped, environment: false } : undefined;
    },
    boot() {
      hydrated = new Map(saved);
    },
    async resolve(type, name) {
      const definition = hydrated.get(`${type}|${name}`) ?? declared.get(`${type}|${name}`);
      return definition ? { definition } : undefined;
    },
    async save(type, name, body) {
      if (type === 'email_template') {
        if (!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/.test(name)) throw new Error(`VALIDATION_ERROR: ${name} is not dotted snake_case`);
        templates.set(`${name}|${String(body.locale)}`, body);
        return;
      }
      if (declared.has(`${type}|${name}`)) throw new Error(`NAMESPACE_CONFLICT: ${type} ${name} is held by a package`);
      saved.set(`${type}|${name}`, body);
    },
  };
}

function ledger(): CeremonyLedgerPort & { checkpoint: CeremonyCheckpoint | null; verdicts: Array<{ complete: boolean; blocking: number; advisory: number }> } {
  const state = {
    checkpoint: null as CeremonyCheckpoint | null,
    verdicts: [] as Array<{ complete: boolean; blocking: number; advisory: number }>,
    async read() {
      return state.checkpoint ? (JSON.parse(JSON.stringify(state.checkpoint)) as CeremonyCheckpoint) : null;
    },
    async write(checkpoint: CeremonyCheckpoint, verdict: { complete: boolean; blocking: number; advisory: number }) {
      state.checkpoint = JSON.parse(JSON.stringify(checkpoint)) as CeremonyCheckpoint;
      state.verdicts.push(verdict);
    },
  };
  return state;
}

/** The schema-drift ceremony, as SQLite answers it: the column goes. */
const columnDrops: ColumnDropPort = {
  async drop(tables) {
    return tables.map((table) => {
      writes.push(`ALTER TABLE ${table} DROP COLUMN organization_id`);
      db.exec(`ALTER TABLE "${table}" DROP COLUMN organization_id`);
      return { table, outcome: 'dropped' as const };
    });
  },
};

const MEMBER_DEFAULT_ROW = {
  name: 'member_default',
  label: 'Member',
  object_permissions: '{"crm_deal":{"allowRead":true}}',
  system_permissions: '[]',
};

/** A 17.x-shaped database carrying every fate, on the post-stage-8 shape. */
function seed(): void {
  db.exec(`
    CREATE TABLE sys_organization (id TEXT PRIMARY KEY, slug TEXT);
    INSERT INTO sys_organization VALUES ('org_default', 'default'), ('org_b', 'b');

    -- fate 2: the catalog. Per-organization mirrors and NULL residue of one
    -- declared set and one declared position, beside Setup-authored rows.
    CREATE TABLE sys_permission_set (id TEXT PRIMARY KEY, organization_id TEXT, name TEXT, label TEXT, managed_by TEXT,
      active INTEGER, object_permissions TEXT, system_permissions TEXT);
    INSERT INTO sys_permission_set VALUES
      ('ps_null', NULL, 'member_default', 'Member', 'platform', 1, '{"crm_deal":{"allowRead":true}}', '[]'),
      ('ps_org', 'org_default', 'member_default', 'Member', 'package', 1, '{"crm_deal":{"allowRead":true}}', '[]'),
      ('ps_auth', 'org_default', 'field_auditor', 'Field Auditor', 'admin', 1,
        '{"crm_deal":{"allowRead":true,"allowEdit":true}}', '["export_reports"]');
    CREATE TABLE sys_position (id TEXT PRIMARY KEY, organization_id TEXT, name TEXT, label TEXT, managed_by TEXT,
      delegatable INTEGER, active INTEGER);
    INSERT INTO sys_position VALUES
      ('pos_null', NULL, 'org_admin', 'Org Admin', 'platform', 0, 1),
      ('pos_org', 'org_default', 'org_admin', 'Org Admin', 'platform', 0, 1),
      ('pos_auth', 'org_default', 'sales_lead', 'Sales Lead', 'admin', 1, 1);
    CREATE TABLE sys_position_permission_set (id TEXT PRIMARY KEY, organization_id TEXT, position_id TEXT, permission_set_id TEXT);
    INSERT INTO sys_position_permission_set VALUES
      ('bind_1', NULL, 'pos_null', 'ps_null'),
      ('bind_2', 'org_default', 'pos_org', 'ps_org'),
      ('bind_3', 'org_default', 'pos_auth', 'ps_auth');
    CREATE TABLE sys_capability (id TEXT PRIMARY KEY, organization_id TEXT, name TEXT, managed_by TEXT);
    INSERT INTO sys_capability VALUES ('cap_seeded', NULL, 'manage_users', 'platform'), ('cap_authored', 'org_default', 'audit_fields', 'admin');
    -- fate 2: templates — a seeded mirror, an organization's seeded copy, a
    -- customized seeded row, admin-authored rows (with and without an
    -- organization) and a row of unknown provenance (the last four promoted first)
    CREATE TABLE sys_email_template (id TEXT PRIMARY KEY, organization_id TEXT, name TEXT, label TEXT, locale TEXT,
      subject TEXT, body_html TEXT, active INTEGER, variables_json TEXT, customized INTEGER, managed_by TEXT);
    INSERT INTO sys_email_template VALUES
      ('tpl_seeded', NULL, 'auth.welcome', 'Welcome', 'en-US', 'Hi', '<p>hi</p>', 1, '[]', 0, 'platform'),
      ('tpl_customized', NULL, 'auth.reset_password', 'Reset', 'en-US', 'Reset your password', '<p>our code</p>', 1, '[]', 1, 'platform'),
      ('tpl_org', 'org_b', 'auth.welcome', 'Welcome', 'en-US', 'Hi', '<p>hi</p>', 1, '[]', 0, 'platform'),
      ('tpl_admin', 'org_b', 'crm.renewal', 'Renewal', 'zh-CN', '续约', '<p>续约</p>', 1, '[]', 0, 'admin'),
      ('tpl_admin_env', NULL, 'crm.note', 'Note', 'en-US', 'A note', '<p>note</p>', 1, '[]', 0, 'admin'),
      ('tpl_unknown', NULL, 'crm.memo', 'Memo', 'en-US', 'A memo', '<p>memo</p>', 1, '[]', 0, NULL);

    -- the settings global rung, still in sys_setting, and its new home
    CREATE TABLE sys_setting (id TEXT PRIMARY KEY, organization_id TEXT, namespace TEXT, key TEXT, scope TEXT, user_id TEXT,
      value TEXT, encrypted INTEGER, locked INTEGER, locked_reason TEXT, value_enc TEXT);
    INSERT INTO sys_setting VALUES
      ('set_global', NULL, 'mail', 'transport', 'global', NULL, '"smtp"', 0, 1, 'ops', NULL),
      ('set_secret', NULL, 'ai', 'api_key', 'global', NULL, NULL, 1, 0, NULL, 'secret:h_1'),
      ('set_tenant', 'org_b', 'mail', 'from', 'tenant', NULL, '"b@x.test"', 0, 0, NULL, NULL);
    CREATE TABLE sys_platform_setting (id TEXT PRIMARY KEY, namespace TEXT, key TEXT, value TEXT, encrypted INTEGER,
      locked INTEGER, locked_reason TEXT, value_enc TEXT);

    -- the references: grants by id (the rewrite names them) and assignments by name
    CREATE TABLE sys_user_permission_set (id TEXT PRIMARY KEY, organization_id TEXT, user_id TEXT,
      permission_set_id TEXT, permission_set TEXT);
    INSERT INTO sys_user_permission_set VALUES
      ('grant_1', 'org_default', 'usr_1', 'ps_org', NULL),
      ('grant_2', NULL, 'usr_2', 'ps_null', NULL),
      ('grant_3', 'org_default', 'usr_3', 'ps_auth', NULL),
      ('grant_4', 'org_default', 'usr_4', 'ps_null', 'member_default');
    CREATE TABLE sys_business_unit (id TEXT PRIMARY KEY, organization_id TEXT, parent_business_unit_id TEXT);
    INSERT INTO sys_business_unit VALUES ('bu_b', 'org_b', NULL);
    CREATE TABLE sys_user_position (id TEXT PRIMARY KEY, organization_id TEXT, user_id TEXT, position TEXT, business_unit_id TEXT);
    INSERT INTO sys_user_position VALUES
      ('up_1', 'org_default', 'usr_5', 'sales_lead', NULL),
      ('up_2', NULL, 'usr_6', 'org_admin', NULL);

    -- fate 3: NULL sys_file rows whose sys_attachment holder carries the organization
    CREATE TABLE crm_deal (id TEXT PRIMARY KEY, organization_id TEXT, name TEXT);
    INSERT INTO crm_deal VALUES ('deal_1', 'org_b', 'Acme'), ('deal_2', NULL, 'Orphan');
    CREATE TABLE sys_attachment (id TEXT PRIMARY KEY, organization_id TEXT, file_id TEXT, parent_object TEXT, parent_id TEXT);
    INSERT INTO sys_attachment VALUES ('att_1', NULL, 'file_1', 'crm_deal', 'deal_1');
    CREATE TABLE sys_file (id TEXT PRIMARY KEY, organization_id TEXT, ref_object TEXT, ref_id TEXT);
    INSERT INTO sys_file VALUES ('file_1', NULL, NULL, NULL), ('file_2', 'org_b', NULL, NULL);

    -- fate 4: one genuinely unattributable row
    CREATE TABLE sys_saved_report (id TEXT PRIMARY KEY, organization_id TEXT);
    INSERT INTO sys_saved_report VALUES ('report_orphan', NULL);

    -- fate 1: a D7 object whose column is still there
    CREATE TABLE sys_job (id TEXT PRIMARY KEY, organization_id TEXT);
    INSERT INTO sys_job VALUES ('job_1', NULL), ('job_2', 'org_b');
  `);
}

const counts = (): Record<string, number> => {
  const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`).all() as { name: string }[];
  return Object.fromEntries(tables.map(({ name }) => [name, (db.prepare(`SELECT COUNT(*) AS n FROM "${name}"`).get() as { n: number }).n]));
};
const rows = (sql: string): Record<string, unknown>[] => db.prepare(sql).all() as Record<string, unknown>[];
const digestOf = (definition: Record<string, unknown>): string => {
  const keys = ['name', 'label', 'objects', 'fields', 'systemPermissions', 'rowLevelSecurity', 'tabPermissions'];
  return JSON.stringify(keys.map((k) => definition[k] ?? null));
};

/**
 * Effective access BEFORE — the 17.x reading: a grant reaches its set row by
 * id, a position reaches its sets through its rows' bindings. Under `single`
 * an organization-less row is the one organization's.
 */
function accessBefore(): string[] {
  const out = new Set<string>();
  const sets = new Map(rows('SELECT * FROM sys_permission_set').map((r) => [String(r.id), r]));
  const sees = (row: Record<string, unknown>, org: string): boolean => row.organization_id === null || row.organization_id === org;
  for (const grant of rows('SELECT * FROM sys_user_permission_set')) {
    const org = String(grant.organization_id ?? 'org_default');
    const set = sets.get(String(grant.permission_set_id));
    if (set && sees(set, org)) out.add(`${grant.user_id}|${org}|${set.name}|${digestOf(permissionSetDefinitionFromRow(set))}`);
  }
  const bindings = rows('SELECT * FROM sys_position_permission_set');
  for (const up of rows('SELECT * FROM sys_user_position')) {
    const org = String(up.organization_id ?? 'org_default');
    for (const position of rows('SELECT * FROM sys_position').filter((p) => p.name === up.position && sees(p, org))) {
      for (const binding of bindings.filter((b) => b.position_id === position.id)) {
        const set = sets.get(String(binding.permission_set_id));
        if (set) out.add(`${up.user_id}|${org}|${set.name}|${digestOf(permissionSetDefinitionFromRow(set))}`);
      }
    }
  }
  return [...out].sort();
}

/** Effective access AFTER — the v18 reading, on the next boot: every reference is a name, resolved in the catalog. */
async function accessAfter(c: ReturnType<typeof catalog>): Promise<string[]> {
  c.boot();
  const out = new Set<string>();
  const add = async (user: unknown, org: string, name: string): Promise<void> => {
    const set = await c.resolve('permission', name);
    if (set) out.add(`${user}|${org}|${name}|${digestOf(set.definition as Record<string, unknown>)}`);
  };
  for (const grant of rows('SELECT * FROM sys_user_permission_set')) {
    if (grant.permission_set) await add(grant.user_id, String(grant.organization_id), String(grant.permission_set));
  }
  for (const up of rows('SELECT * FROM sys_user_position')) {
    const position = await c.resolve('position', String(up.position));
    for (const name of (position?.definition.permissionSets as string[] | undefined) ?? []) {
      await add(up.user_id, String(up.organization_id), name);
    }
  }
  return [...out].sort();
}

const apply = (
  c: ReturnType<typeof catalog>,
  l: ReturnType<typeof ledger>,
  opts: { posture?: string; executor?: ApplyExecutor; templateChoices?: string[]; reviewed?: Partial<ReviewedPlan> } = {},
): Promise<OrganizationOwnershipApplyReport> => {
  c.boot();
  return applyOrganizationOwnership({
    // The plan the operator reviewed: by default, the one this run computes.
    reviewedPlan: {
      file: 'plan.json',
      generatedAt: '2026-10-11T00:00:00Z',
      database: file,
      inventoryDigest: inventoryDigest(),
      ...opts.reviewed,
    },
    executor: opts.executor ?? executor(),
    ...(opts.templateChoices ? { templateChoices: opts.templateChoices } : {}),
    posture: opts.posture ?? 'single',
    database: file,
    catalog: c,
    door: c,
    templates: c,
    columnDrops,
    ledger: l,
    now: () => new Date('2026-10-12T00:00:00Z'),
  });
};

/** Run `body` against a database holding nothing but the given templates, so every step can finish under any posture. */
async function onlyTemplates(values: string, body: () => Promise<void>): Promise<void> {
  const only = new Database(join(dir, 'templates.db'));
  only.exec(`
    CREATE TABLE sys_organization (id TEXT PRIMARY KEY, slug TEXT);
    CREATE TABLE sys_email_template (id TEXT PRIMARY KEY, organization_id TEXT, name TEXT, locale TEXT, subject TEXT,
      customized INTEGER, managed_by TEXT);
    INSERT INTO sys_email_template VALUES ${values};
  `);
  const saved = db;
  db = only;
  try {
    await body();
  } finally {
    db = saved;
    only.close();
  }
}

const tableOf = (report: OrganizationOwnershipApplyReport, object: string) => {
  const found = report.tables.find((t) => t.object === object);
  if (!found) throw new Error(`no ${object} in the report`);
  return found;
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'os-c7b-apply-'));
  file = join(dir, 'fixture.db');
  db = new Database(file);
  writes = [];
  seed();
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('ADR-0131 D10 --apply — the acceptance fixture', () => {
  it('comes through with effective access identical, mirrors gone, owners written, the orphan reported, counts reconciling', async () => {
    const before = accessBefore();
    const countsBefore = counts();
    const c = catalog();
    const l = ledger();

    const report = await apply(c, l);

    expect(report.steps.map((s) => [s.step, s.status])).toEqual([
      ['attribution', 'done'],
      ['authored-conversion', 'done'],
      ['template-promotion', 'done'],
      ['settings-move', 'done'],
      ['rewrite', 'done'],
      ['mirror-deletion', 'done'],
      ['column-drops', 'done'],
    ]);
    expect(report.complete).toBe(true);
    expect(report.blocking).toBe(0);
    expect(l.verdicts.at(-1)).toEqual({ complete: true, blocking: 0, advisory: 1 });

    // Effective access: identical, read the 17.x way before and the v18 way after.
    expect(before.length).toBeGreaterThan(0);
    expect(await accessAfter(c)).toEqual(before);

    // The authored catalog rows became environment metadata, through the door.
    expect(c.saved.get('permission|field_auditor')).toMatchObject({ name: 'field_auditor', systemPermissions: ['export_reports'] });
    expect(c.saved.get('position|sales_lead')).toMatchObject({ name: 'sales_lead', delegatable: true, permissionSets: ['field_auditor'] });
    expect(c.saved.has('position|org_admin')).toBe(false);

    // Mirrors gone; authored, customized and organization-stamped rows stay.
    expect(rows('SELECT id FROM sys_permission_set').map((r) => r.id)).toEqual(['ps_auth']);
    expect(rows('SELECT id FROM sys_position').map((r) => r.id)).toEqual(['pos_auth']);
    expect(rows('SELECT id FROM sys_position_permission_set')).toEqual([]);
    expect(rows('SELECT id FROM sys_capability').map((r) => r.id)).toEqual(['cap_authored']);
    expect(rows('SELECT id FROM sys_email_template')).toEqual([]);

    // Ruling C: the customized, the admin-authored and the unknown-provenance
    // templates became environment items before any row went; the seeded
    // copies were not promoted.
    expect([...c.templates.keys()].sort()).toEqual([
      'auth.reset_password|en-US', 'crm.memo|en-US', 'crm.note|en-US', 'crm.renewal|zh-CN',
    ]);
    expect(c.templates.get('auth.reset_password|en-US')).toMatchObject({ subject: 'Reset your password', bodyHtml: '<p>our code</p>' });

    // The global rung moved to sys_platform_setting, value and secret handle verbatim; the tenant row stayed.
    expect(rows('SELECT id, scope FROM sys_setting')).toEqual([{ id: 'set_tenant', scope: 'tenant' }]);
    expect(rows('SELECT * FROM sys_platform_setting ORDER BY id')).toEqual([
      { id: 'set_global', namespace: 'mail', key: 'transport', value: '"smtp"', encrypted: 0, locked: 1, locked_reason: 'ops', value_enc: null },
      { id: 'set_secret', namespace: 'ai', key: 'api_key', value: null, encrypted: 1, locked: 0, locked_reason: null, value_enc: 'secret:h_1' },
    ]);

    // Every grant names its set; the id column is still there (C7b's later drop).
    expect(rows('SELECT id, permission_set, permission_set_id FROM sys_user_permission_set ORDER BY id')).toEqual([
      { id: 'grant_1', permission_set: 'member_default', permission_set_id: 'ps_org' },
      { id: 'grant_2', permission_set: 'member_default', permission_set_id: 'ps_null' },
      { id: 'grant_3', permission_set: 'field_auditor', permission_set_id: 'ps_auth' },
      { id: 'grant_4', permission_set: 'member_default', permission_set_id: 'ps_null' },
    ]);

    // Attributed rows carry their organization — the anchor's, else the Default Organization.
    expect(rows(`SELECT organization_id FROM sys_file WHERE id = 'file_1'`)).toEqual([{ organization_id: 'org_b' }]);
    expect(rows(`SELECT organization_id FROM sys_attachment WHERE id = 'att_1'`)).toEqual([{ organization_id: 'org_b' }]);
    expect(rows(`SELECT organization_id FROM crm_deal WHERE id = 'deal_2'`)).toEqual([{ organization_id: 'org_default' }]);
    expect(rows(`SELECT organization_id FROM sys_user_permission_set WHERE id = 'grant_2'`)).toEqual([{ organization_id: 'org_default' }]);

    // The unattributable row is still present, still NULL, and reported by id.
    expect(rows(`SELECT organization_id FROM sys_saved_report`)).toEqual([{ organization_id: null }]);
    expect(tableOf(report, 'sys_saved_report').unattributable.map((u) => u.id)).toEqual(['report_orphan']);

    // Fate 1: the column is gone through the column-drop port.
    expect(tableOf(report, 'sys_job').columnDropped).toBe(true);
    expect(rows(`SELECT name FROM pragma_table_info('sys_job')`).map((r) => r.name)).toEqual(['id']);

    // Row counts reconcile: only fate 2 deletes, and exactly what it reports.
    const countsAfter = counts();
    for (const table of report.tables) {
      if (!table.before || !table.after) continue;
      expect(table.before.total - table.deleted - table.movedOut + table.movedIn, table.object).toBe(table.after.total);
      expect(countsAfter[table.object], table.object).toBe(table.after.total);
      expect(countsBefore[table.object], table.object).toBe(table.before.total);
      if (table.fate !== 'mirror-deletion') expect(table.deleted, table.object).toBe(0);
    }
    expect(tableOf(report, 'sys_setting').movedOut).toBe(2);
    expect(tableOf(report, 'sys_platform_setting').movedIn).toBe(2);
    // Every delete is fate 2's, or the moved rows leaving sys_setting.
    expect(writes.filter((w) => /^DELETE/.test(w)).every((w) =>
      /sys_permission_set|sys_position|sys_position_permission_set|sys_capability|sys_email_template|"sys_setting" WHERE \(\("scope" = \?\) AND "organization_id" IS NULL\)/.test(w))).toBe(true);
  });

  it('positive control: a grant the rewrite would lose reddens the effective-access pin', async () => {
    const before = accessBefore();
    const c = catalog();
    await apply(c, ledger());
    expect(await accessAfter(c)).toEqual(before);

    db.exec(`UPDATE sys_user_permission_set SET permission_set = NULL WHERE id = 'grant_3'`);
    const after = await accessAfter(c);
    expect(after).not.toEqual(before);
    expect(before.filter((g) => !after.includes(g))).toEqual([expect.stringMatching(/^usr_3\|org_default\|field_auditor\|/)]);
  });
});

describe('ADR-0131 D10 --apply — only the reviewed plan is executed', () => {
  it('refuses, before any write, a plan file whose inventory digest is not the one this run computes', async () => {
    const c = catalog();
    const l = ledger();
    const hash = createHash('sha256').update(readFileSync(file)).digest('hex');

    const refused = apply(c, l, { reviewed: { inventoryDigest: 'a'.repeat(64) } });

    await expect(refused).rejects.toBeInstanceOf(ReviewedPlanRefusal);
    await expect(refused).rejects.toMatchObject({
      reason: 'plan-digest-mismatch',
      detail: { reviewed: 'a'.repeat(64), current: inventoryDigest() },
    });
    expect(writes).toEqual([]);
    expect(l.checkpoint).toBeNull();
    expect(l.verdicts).toEqual([]);
    expect(createHash('sha256').update(readFileSync(file)).digest('hex')).toBe(hash);
  });

  it('refuses, before any write, a plan file computed for another database', async () => {
    const c = catalog();
    const l = ledger();

    await expect(apply(c, l, { reviewed: { database: '/elsewhere/other.db' } })).rejects.toMatchObject({
      reason: 'plan-database-mismatch',
      detail: { reviewed: '/elsewhere/other.db', current: file },
    });
    expect(writes).toEqual([]);
    expect(l.checkpoint).toBeNull();
  });

  it('a checkpoint recorded under another digest is superseded by the reviewed plan: every step runs again, and the report names it', async () => {
    const c = catalog();
    const l = ledger();
    l.checkpoint = {
      ceremony: 'ADR-0131 D10',
      inventoryDigest: 'b'.repeat(64),
      completed: { attribution: { at: '2026-10-10T00:00:00Z', summary: {} }, rewrite: { at: '2026-10-10T00:00:00Z', summary: {} } },
    };

    const report = await apply(c, l);

    expect(report.restartedFrom).toEqual({ inventoryDigest: 'b'.repeat(64), steps: ['attribution', 'rewrite'] });
    expect(report.resumedFrom).toEqual([]);
    expect(report.steps.find((s) => s.step === 'attribution')!.status).toBe('done');
    expect(report.reviewedPlan).toEqual({ file: 'plan.json', generatedAt: '2026-10-11T00:00:00Z' });
    expect(l.checkpoint!.inventoryDigest).toBe(inventoryDigest());
  });

  it('a resumed run under the same digest reports no restart', async () => {
    const c = catalog();
    const l = ledger();
    await apply(c, l);
    const again = await apply(c, l);
    expect(again.restartedFrom).toBeUndefined();
  });
});

describe('reviewedPlanFromFile', () => {
  const plan = { kind: 'organization-ownership-plan', ceremony: 'ADR-0131 D10', generatedAt: 'g', database: 'd', inventoryDigest: 'x' };

  it('reads the three compared fields of a plan file', () => {
    expect(reviewedPlanFromFile('p.json', JSON.stringify({ ...plan, tables: [] }))).toEqual({
      file: 'p.json', generatedAt: 'g', database: 'd', inventoryDigest: 'x',
    });
  });

  it.each([
    ['not JSON', '{'],
    ['an apply report, not a plan', JSON.stringify({ ...plan, kind: 'organization-ownership-apply' })],
    ['no digest', JSON.stringify({ ...plan, inventoryDigest: '' })],
    ['no database', JSON.stringify({ ...plan, database: undefined })],
  ])('refuses a file that is %s', (_label, text) => {
    expect(() => reviewedPlanFromFile('p.json', text)).toThrow(ReviewedPlanRefusal);
    try {
      reviewedPlanFromFile('p.json', text);
    } catch (error) {
      expect(error).toMatchObject({ reason: 'plan-file-unusable', detail: { file: 'p.json' } });
    }
  });
});

describe('ADR-0131 D10 --apply — idempotent, resumable, gated', () => {
  it('a second run resumes from the checkpoint and writes nothing', async () => {
    const c = catalog();
    const l = ledger();
    await apply(c, l);
    const hash = createHash('sha256').update(readFileSync(file)).digest('hex');
    writes = [];

    const again = await apply(c, l);

    expect(again.resumedFrom).toEqual([
      'attribution', 'authored-conversion', 'template-promotion', 'settings-move', 'rewrite', 'mirror-deletion', 'column-drops',
    ]);
    expect(again.steps.every((s) => s.status === 'checkpointed')).toBe(true);
    expect(again.complete).toBe(true);
    expect(writes).toEqual([]);
    expect(createHash('sha256').update(readFileSync(file)).digest('hex')).toBe(hash);
  });

  it('a run killed inside mirror deletion resumes there, never re-deriving an owner it already wrote', async () => {
    const c = catalog();
    const l = ledger();
    await expect(apply(c, l, { executor: executor({ failOnceOn: /^DELETE FROM "sys_capability"/ }) })).rejects.toThrow(/killed mid-step/);
    expect(Object.keys(l.checkpoint!.completed)).toEqual(['attribution', 'authored-conversion', 'template-promotion', 'settings-move', 'rewrite']);
    expect(rows('SELECT COUNT(*) AS n FROM sys_position_permission_set')).toEqual([{ n: 3 }]);
    writes = [];

    const resumed = await apply(c, l);

    expect(resumed.resumedFrom).toEqual(['attribution', 'authored-conversion', 'template-promotion', 'settings-move', 'rewrite']);
    expect(resumed.steps.map((s) => s.status)).toEqual(['checkpointed', 'checkpointed', 'checkpointed', 'checkpointed', 'checkpointed', 'done', 'done']);
    expect(writes.some((w) => /^UPDATE/.test(w))).toBe(false);
    expect(resumed.complete).toBe(true);
    expect(rows('SELECT COUNT(*) AS n FROM sys_position_permission_set')).toEqual([{ n: 0 }]);
  });

  it('reads the gate again before the first delete: a grant written between runs keeps every mirror', async () => {
    const c = catalog();
    const l = ledger();
    await expect(apply(c, l, { executor: executor({ failOnceOn: /^DELETE FROM "sys_capability"/ }) })).rejects.toThrow(/killed mid-step/);
    db.exec(`INSERT INTO sys_user_permission_set VALUES ('grant_late', 'org_default', 'usr_8', 'ps_gone', NULL)`);
    const countsBefore = counts();

    const resumed = await apply(c, l);

    const deletion = resumed.steps.find((s) => s.step === 'mirror-deletion')!;
    expect(deletion.status).toBe('blocked');
    expect(deletion.blockers.join('\n')).toMatch(/grant_late/);
    expect(counts()).toEqual(countsBefore);
    expect(resumed.complete).toBe(false);
  });

  it('promotes again before deleting a template: a row customized between runs is promoted, never deleted unpromoted', async () => {
    const c = catalog();
    const l = ledger();
    await expect(apply(c, l, { executor: executor({ failOnceOn: /^DELETE FROM "sys_capability"/ }) })).rejects.toThrow(/killed mid-step/);
    expect(l.checkpoint!.completed['template-promotion']).toBeDefined();
    db.exec(`INSERT INTO sys_email_template VALUES
      ('tpl_late', NULL, 'crm.late', 'Late', 'en-US', 'Edited late', '<p>late</p>', 1, '[]', 1, 'platform')`);

    const resumed = await apply(c, l);

    expect(c.templates.get('crm.late|en-US')).toMatchObject({ subject: 'Edited late' });
    expect(rows(`SELECT id FROM sys_email_template`)).toEqual([]);
    expect(resumed.complete).toBe(true);
    expect(resumed.blocking).toBe(0);
  });

  it('a customized template with no name blocks: kept, named, and verified_at stays null', async () => {
    db.exec(`INSERT INTO sys_email_template VALUES
      ('tpl_nameless', NULL, NULL, 'Untitled', 'en-US', 'S', '<p>s</p>', 1, '[]', 1, 'platform')`);
    const l = ledger();
    const report = await apply(catalog(), l);

    const promotion = report.steps.find((s) => s.step === 'template-promotion')!;
    expect(promotion.status).toBe('blocked');
    expect(promotion.blockers.join('\n')).toMatch(/tpl_nameless/);
    expect(rows(`SELECT id FROM sys_email_template WHERE id = 'tpl_nameless'`)).toHaveLength(1);
    expect(report.complete).toBe(false);
    expect(l.verdicts.at(-1)).toMatchObject({ complete: false });
  });

  it('moves no setting over a different value the new table already serves, and deletes nothing for it', async () => {
    db.exec(`INSERT INTO sys_platform_setting VALUES ('ps_1', 'mail', 'transport', '"ses"', 0, 0, NULL, NULL)`);
    const report = await apply(catalog(), ledger());

    const move = report.steps.find((s) => s.step === 'settings-move')!;
    expect(move.status).toBe('blocked');
    expect(move.blockers.join('\n')).toMatch(/mail\.transport/);
    expect(rows(`SELECT id FROM sys_setting WHERE scope = 'global' ORDER BY id`).map((r) => r.id)).toEqual(['set_global']);
    expect(rows(`SELECT value FROM sys_platform_setting WHERE key = 'transport'`)).toEqual([{ value: '"ses"' }]);
    expect(report.steps.find((s) => s.step === 'mirror-deletion')!.status).toBe('not-reached');
  });

  it('never overwrites a template the environment already holds, keeps every template row, and certifies nothing', async () => {
    const c = catalog();
    c.templates.set('crm.renewal|zh-CN', { name: 'crm.renewal', label: 'Renewal', locale: 'zh-CN', subject: '新的', bodyHtml: '<p>新的</p>' });
    const l = ledger();
    const report = await apply(c, l);

    // A blocked promotion: the ceremony stops there, verified_at stays null.
    expect(report.complete).toBe(false);
    expect(report.blocking).toBeGreaterThan(0);
    expect(l.verdicts.at(-1)).toMatchObject({ complete: false });

    const promotion = report.steps.find((s) => s.step === 'template-promotion')!;
    expect(promotion.status).toBe('blocked');
    expect(promotion.blockers.join('\n')).toMatch(/crm\.renewal \(zh-CN\)/);
    expect(c.templates.get('crm.renewal|zh-CN')).toMatchObject({ subject: '新的' });
    expect(rows('SELECT COUNT(*) AS n FROM sys_email_template')).toEqual([{ n: 6 }]);
  });

  it('deletes nothing while a reference does not resolve by name — the gate of fate 2', async () => {
    // Another organization's set row: a name carries no organization, so it is never written.
    db.exec(`
      INSERT INTO sys_permission_set VALUES ('ps_b', 'org_b', 'b_only', 'B', 'admin', 1, '{}', '[]');
      INSERT INTO sys_user_permission_set VALUES ('grant_x', 'org_default', 'usr_9', 'ps_b', NULL);
    `);
    const countsBefore = counts();
    const l = ledger();

    const report = await apply(catalog(), l);

    const rewrite = report.steps.find((s) => s.step === 'rewrite')!;
    expect(rewrite.status).toBe('blocked');
    expect(rewrite.blockers.join('\n')).toMatch(/grant_x/);
    expect(report.steps.find((s) => s.step === 'mirror-deletion')!.status).toBe('not-reached');
    // The only rows that left are the settings rung, which moved before the rewrite.
    expect(writes.filter((w) => /^DELETE/.test(w) && !/^DELETE FROM "sys_setting"/.test(w))).toEqual([]);
    const { sys_setting: _s, sys_platform_setting: _p, ...after } = counts();
    const { sys_setting: _sb, sys_platform_setting: _pb, ...before } = countsBefore;
    expect(after).toEqual(before);
    expect(report.complete).toBe(false);
    expect(report.blocking).toBeGreaterThan(0);
    expect(l.verdicts.at(-1)!.complete).toBe(false);
  });

  it('under a wall: an anchorless row is reported, never assigned, authored rows are not converted, templates are promoted', async () => {
    const c = catalog();
    const report = await apply(c, ledger(), { posture: 'isolated' });

    expect(rows(`SELECT organization_id FROM crm_deal WHERE id = 'deal_2'`)).toEqual([{ organization_id: null }]);
    expect(tableOf(report, 'crm_deal').unattributable.map((u) => u.id)).toEqual(['deal_2']);
    expect(rows(`SELECT organization_id FROM sys_file WHERE id = 'file_1'`)).toEqual([{ organization_id: 'org_b' }]);
    expect(c.saved.size).toBe(0);
    expect(report.steps.find((s) => s.step === 'mirror-deletion')!.status).toBe('not-reached');
    expect(rows('SELECT COUNT(*) AS n FROM sys_permission_set')).toEqual([{ n: 3 }]);
    // The promotion runs under every posture; nothing is deleted before mirror deletion.
    expect([...c.templates.keys()].sort()).toEqual(['auth.reset_password|en-US', 'crm.memo|en-US', 'crm.note|en-US', 'crm.renewal|zh-CN']);
    expect(rows('SELECT COUNT(*) AS n FROM sys_email_template')).toEqual([{ n: 6 }]);
  });

  it('does not certify a ceremony whose departures have not left: the declared sharing-rule mirrors keep verified_at null', async () => {
    db.exec(`
      CREATE TABLE sys_sharing_rule (id TEXT PRIMARY KEY, organization_id TEXT, name TEXT, managed_by TEXT, customized INTEGER);
      INSERT INTO sys_sharing_rule VALUES ('rule_declared', NULL, 'share_deals', 'package', 0), ('rule_org', 'org_b', 'mine', 'admin', 0);
    `);
    const l = ledger();
    const report = await apply(catalog(), l);

    // Every step ran, and the moved settings rung reads zero; the rule mirror
    // is D2's to remove, so it still counts and is named.
    expect(report.complete).toBe(true);
    expect(report.blocking).toBe(1);
    expect(l.verdicts.at(-1)).toMatchObject({ complete: true, blocking: 1 });
    expect(tableOf(report, 'sys_setting').departures).toEqual([]);
    const rule = tableOf(report, 'sys_sharing_rule');
    expect(rule.remaining).toBe(1);
    expect(rule.departures).toEqual([expect.objectContaining({ id: 'declared-rule-mirrors', as: 'mirror-deletion', rows: 1 })]);
    expect(rule.notNull.willReceive).toBe(false);
    expect(rows(`SELECT id FROM sys_sharing_rule ORDER BY id`).map((r) => r.id)).toEqual(['rule_declared', 'rule_org']);
  });

  it('promotes under a wall too: a template with no conflict ends verified, its seeded mirror and its row gone', async () => {
    await onlyTemplates(
      `('tpl_seeded', NULL, 'auth.welcome', 'en-US', 'Hi', 0, 'platform'), ('tpl_admin', 'org_b', 'crm.note', 'en-US', 'A note', 0, 'admin')`,
      async () => {
        const c = catalog();
        const l = ledger();
        const report = await apply(c, l, { posture: 'isolated' });
        expect(report.complete).toBe(true);
        expect(report.blocking).toBe(0);
        expect(l.verdicts.at(-1)).toMatchObject({ complete: true, blocking: 0 });
        expect(c.templates.get('crm.note|en-US')).toMatchObject({ name: 'crm.note', subject: 'A note' });
        expect(tableOf(report, 'sys_email_template').departures).toEqual([]);
        expect(rows('SELECT id FROM sys_email_template')).toEqual([]);
      },
    );
  });

  it('under a wall, rows of one template that differ are a conflict: listed with each candidate, kept, and blocking', async () => {
    await onlyTemplates(
      `('tpl_a', 'org_a', 'crm.note', 'en-US', 'From A', 1, 'platform'), ('tpl_b', 'org_b', 'crm.note', 'en-US', 'From B', 1, 'platform')`,
      async () => {
        const c = catalog();
        const l = ledger();
        const report = await apply(c, l, { posture: 'group' });
        const promotion = report.steps.find((s) => s.step === 'template-promotion')!;
        expect(promotion.status).toBe('blocked');
        expect(promotion.summary).toMatchObject({ conflicts: 1, promoted: 0 });
        expect(promotion.blockers.join('\n')).toMatch(/crm\.note \(en-US\).*tpl_a \(organization org_a\), tpl_b \(organization org_b\).*--template-choice/);
        expect(tableOf(report, 'sys_email_template').templateConflicts).toEqual([
          { name: 'crm.note', locale: 'en-US', candidates: [{ id: 'tpl_a', organizationId: 'org_a' }, { id: 'tpl_b', organizationId: 'org_b' }] },
        ]);
        expect(report.complete).toBe(false);
        expect(l.verdicts.at(-1)).toMatchObject({ complete: false });
        expect(c.templates.size).toBe(0);
        expect(rows('SELECT id FROM sys_email_template ORDER BY id').map((r) => r.id)).toEqual(['tpl_a', 'tpl_b']);
      },
    );
  });

  it('a chosen conflict promotes the chosen body, verifies, and only then deletes every candidate', async () => {
    await onlyTemplates(
      `('tpl_a', 'org_a', 'crm.note', 'en-US', 'From A', 1, 'platform'), ('tpl_b', 'org_b', 'crm.note', 'en-US', 'From B', 1, 'platform')`,
      async () => {
        const c = catalog();
        const l = ledger();
        const report = await apply(c, l, { posture: 'isolated', templateChoices: ['tpl_b'] });
        expect(report.complete).toBe(true);
        expect(report.blocking).toBe(0);
        expect(l.verdicts.at(-1)).toMatchObject({ complete: true, blocking: 0 });
        expect(c.templates.get('crm.note|en-US')).toMatchObject({ subject: 'From B' });
        expect(rows('SELECT id FROM sys_email_template')).toEqual([]);
        expect(tableOf(report, 'sys_email_template').deleted).toBe(2);
      },
    );
  });

  it('refuses a template choice that names no candidate, or two candidates of one conflict, before anything is written', async () => {
    await onlyTemplates(
      `('tpl_a', 'org_a', 'crm.note', 'en-US', 'From A', 1, 'platform'), ('tpl_b', 'org_b', 'crm.note', 'en-US', 'From B', 1, 'platform')`,
      async () => {
        const c = catalog();
        await expect(apply(c, ledger(), { posture: 'isolated', templateChoices: ['tpl_nope'] })).rejects.toThrow(
          new TemplateChoiceRefusal(
            '--template-choice tpl_nope names no candidate row of a listed template conflict. The conflicts are: crm.note (en-US): tpl_a, tpl_b.',
          ),
        );
        await expect(apply(c, ledger(), { posture: 'isolated', templateChoices: ['tpl_a', 'tpl_b'] })).rejects.toThrow(
          /tpl_a and tpl_b both choose for the template crm\.note \(en-US\)/,
        );
        expect(writes).toEqual([]);
        expect(c.templates.size).toBe(0);
      },
    );
  });

  it('holds a column whose rows another stage owns, and reports it', async () => {
    db.exec(`
      CREATE TABLE sys_metadata (id TEXT PRIMARY KEY, organization_id TEXT, type TEXT, name TEXT, state TEXT, package_id TEXT);
      INSERT INTO sys_metadata VALUES ('md_1', 'org_b', 'view', 'deal_list', 'active', NULL);
    `);
    const report = await apply(catalog(), ledger());

    const drops = report.steps.find((s) => s.step === 'column-drops')!;
    expect(drops.status).toBe('blocked');
    expect(drops.blockers.join('\n')).toMatch(/sys_metadata\.organization_id is not dropped/);
    expect(rows(`SELECT name FROM pragma_table_info('sys_metadata') WHERE name = 'organization_id'`)).toHaveLength(1);
    expect(rows(`SELECT name FROM pragma_table_info('sys_job') WHERE name = 'organization_id'`)).toHaveLength(0);
  });
});
