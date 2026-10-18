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
import { anonymousFormIntakeCandidates, anonymousFormIntakeWithdrawnIn, hashSpec } from '@objectstack/metadata-core';
import { buildOrganizationOwnershipPlan, inventoryDigest } from './organization-ownership-plan.js';
import {
  applyOrganizationOwnership,
  CEREMONY_STEPS,
  MetadataChoiceRefusal,
  ReviewedPlanRefusal,
  reviewedConflictsOf,
  reviewedPlanFromFile,
  TemplateChoiceRefusal,
  type ApplyExecutor,
  type CatalogPort,
  type CeremonyCheckpoint,
  type CeremonyLedgerPort,
  type ColumnDropPort,
  type DefaultOrganizationPort,
  type MetadataDoorPort,
  type MetadataLockPort,
  type OrganizationOwnershipApplyReport,
  type ReviewedConflict,
  type ReviewedPlan,
  type ServedViewsPort,
  type TemplatePort,
} from './organization-ownership-apply.js';
import { backfillOrgAdminGrants } from '@objectstack/plugin-security';
import { assertEngineDeleteDispatch } from '@objectstack/metadata-core';
import { describeSecurityPluginComposition, type SchemaMigrationComposition } from './schema-migration-plugins.js';

let dir: string;
let file: string;
let db: Database.Database;
/** Every write statement the ceremony issued, in order. */
let writes: string[];

function executor(opts: { failOnceOn?: RegExp } = {}): ApplyExecutor {
  let failed = false;
  return {
    dialect: 'sqlite',
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
  /** Environment `view` saves, in order, with the package each was saved into. */
  viewSaves: Array<{ name: string; body: Record<string, unknown>; packageId: string | null }>;
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
  const viewSaves: Array<{ name: string; body: Record<string, unknown>; packageId: string | null }> = [];
  return {
    saved,
    templates,
    viewSaves,
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
    async save(type, name, body, target) {
      if (type === 'view') {
        viewSaves.push({ name, body, packageId: target?.packageId ?? null });
        return;
      }
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

/** A form view the code package `pkg_a` ships, open to anonymous intake at `/forms/lead-intake`. */
const formView = (open: boolean, label = 'Lead intake'): Record<string, unknown> => ({
  name: 'crm_lead.intake',
  label,
  object: 'crm_lead',
  viewKind: 'form',
  config: { sharing: { enabled: open, allowAnonymous: true, publicLink: '/forms/lead-intake' } },
});

/**
 * The env-wide view list as the anonymous doors read it: the code package's
 * items, replaced per (name, package) by the active environment rows of
 * `sys_metadata` and then by the door's saves this run.
 */
function servedViews(c: ReturnType<typeof catalog>, code: Array<Record<string, unknown>> = [{ ...formView(true), _packageId: 'pkg_a' }]): ServedViewsPort {
  return {
    async list() {
      const slots = new Map<string, Record<string, unknown>>();
      const put = (item: Record<string, unknown>, pkg: string | null): void => {
        slots.set(`${String(item.name)}|${pkg ?? ''}`, { ...item, ...(pkg ? { _packageId: pkg } : {}) });
      };
      for (const item of code) put(item, (item._packageId as string | undefined) ?? null);
      const hasTable = rows(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'sys_metadata'`).length > 0;
      if (hasTable) {
        // Once column-drops has run, every row left is the environment's.
        const scoped = rows(`SELECT name FROM pragma_table_info('sys_metadata') WHERE name = 'organization_id'`).length > 0;
        for (const row of rows(`SELECT * FROM sys_metadata WHERE type = 'view' AND state = 'active'${scoped ? ' AND organization_id IS NULL' : ''}`)) {
          put(JSON.parse(String(row.metadata)) as Record<string, unknown>, (row.package_id as string | null) ?? null);
        }
      }
      for (const save of c.viewSaves) put(save.body, save.packageId);
      return [...slots.values()];
    },
  };
}

/**
 * The door as the metadata repository writes a save: onto the key's one active
 * environment row of `sys_metadata` (created when the key has none), numbered
 * from history in the environment's own scope while the column stands
 * (`event_seq` and the item's `version`, each `MAX + 1`). A key holding two
 * environment rows is refused: the repository's own pick there is a coin toss.
 */
function storingDoor(c: ReturnType<typeof catalog>): ReturnType<typeof catalog> & { envRowsAtSave: number[] } {
  const has = (table: string, column?: string): boolean =>
    column === undefined
      ? rows(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = '${table}'`).length > 0
      : rows(`SELECT name FROM pragma_table_info('${table}') WHERE name = '${column}'`).length > 0;
  const envRowsAtSave: number[] = [];
  return {
    ...c,
    envRowsAtSave,
    async save(type, name, body, target) {
      await c.save(type, name, body, target);
      // The catalog conversion and the template promotion keep the catalog double's own store.
      if (!['view', 'dashboard', 'report', 'translation'].includes(type)) return;
      const pkg = target?.packageId ?? null;
      let version = 1;
      if (has('sys_metadata_history')) {
        const scoped = has('sys_metadata_history', 'organization_id');
        const env = scoped ? 'organization_id IS NULL' : '1 = 1';
        const seq = Number((db.prepare(`SELECT COALESCE(MAX(event_seq), 0) + 1 AS n FROM sys_metadata_history WHERE ${env}`).get() as { n: number }).n);
        version = Number(
          (db.prepare(`SELECT COALESCE(MAX(version), 0) + 1 AS n FROM sys_metadata_history WHERE ${env} AND type = ? AND name = ?`).get(type, name) as { n: number }).n,
        );
        db.prepare(
          `INSERT INTO sys_metadata_history (id, ${scoped ? 'organization_id, ' : ''}type, name, version, event_seq, checksum) ` +
            `VALUES (?, ${scoped ? 'NULL, ' : ''}?, ?, ?, ?, ?)`,
        ).run(`h_save_${seq}`, type, name, version, seq, `save_${pkg ?? ''}`);
      }
      if (!has('sys_metadata')) return;
      const scoped = has('sys_metadata', 'organization_id');
      const where = `${scoped ? 'organization_id IS NULL AND ' : ''}type = ? AND name = ? AND COALESCE(package_id, '') = ? AND state = 'active'`;
      const found = db.prepare(`SELECT id FROM sys_metadata WHERE ${where}`).all(type, name, pkg ?? '') as Array<{ id: string }>;
      envRowsAtSave.push(found.length);
      if (found.length > 1) throw new Error(`two environment rows hold ${type} ${name}: the write head is a coin toss`);
      const versioned = has('sys_metadata', 'version');
      if (found.length === 1) {
        db.prepare(`UPDATE sys_metadata SET metadata = ?${versioned ? ', version = ?' : ''} WHERE id = ?`).run(
          JSON.stringify(body),
          ...(versioned ? [version] : []),
          found[0]!.id,
        );
        return;
      }
      const cols = ['id', 'type', 'name', 'state', 'package_id', 'metadata', ...(versioned ? ['version'] : [])];
      db.prepare(`INSERT INTO sys_metadata (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).run(
        `door_${type}_${name}_${pkg ?? ''}`,
        type,
        name,
        'active',
        pkg,
        JSON.stringify(body),
        ...(versioned ? [version] : []),
      );
    },
  };
}

/** What the anonymous doors serve for a slug, by their own judgement over the env-wide list. */
async function doorsServe(views: ServedViewsPort, slug: string): Promise<string[]> {
  const list = await views.list();
  return list
    .filter((v) => anonymousFormIntakeCandidates(v).some((cand) => cand.slug === slug && !anonymousFormIntakeWithdrawnIn(list, v, cand)))
    .map((v) => `${String(v.name)}|${String(v._packageId ?? '')}`)
    .sort();
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
  async drop(columns) {
    return columns.map(({ table, column }) => {
      writes.push(`ALTER TABLE ${table} DROP COLUMN ${column}`);
      db.exec(`ALTER TABLE "${table}" DROP COLUMN "${column}"`);
      return { table, column, outcome: 'dropped' as const };
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
  opts: {
    posture?: string;
    executor?: ApplyExecutor;
    templateChoices?: string[];
    metadataChoices?: string[];
    views?: ServedViewsPort;
    columnDrops?: ColumnDropPort;
    reviewed?: Partial<ReviewedPlan>;
    lock?: MetadataLockPort;
    securityPlugin?: SchemaMigrationComposition['securityPlugin'];
    defaultOrganization?: DefaultOrganizationPort;
  } = {},
): Promise<OrganizationOwnershipApplyReport> => {
  c.boot();
  return reviewedConflictsNow(opts.posture ?? 'single').then((conflicts) => applyOrganizationOwnership({
    views: opts.views ?? servedViews(c),
    lock: opts.lock ?? { verdict: async () => ({ editable: true }) },
    // The plan the operator reviewed: by default, the one a plan run computes
    // over the database as it stands, conflict groups included.
    reviewedPlan: {
      file: 'plan.json',
      generatedAt: '2026-10-11T00:00:00Z',
      database: file,
      inventoryDigest: inventoryDigest(),
      posture: opts.posture ?? 'single',
      conflicts,
      ...opts.reviewed,
    },
    executor: opts.executor ?? executor(),
    ...(opts.templateChoices ? { templateChoices: opts.templateChoices } : {}),
    ...(opts.metadataChoices ? { metadataChoices: opts.metadataChoices } : {}),
    ...(opts.securityPlugin ? { securityPlugin: opts.securityPlugin } : {}),
    ...(opts.defaultOrganization ? { defaultOrganization: opts.defaultOrganization } : {}),
    posture: opts.posture ?? 'single',
    database: file,
    catalog: c,
    door: c,
    templates: c,
    columnDrops: opts.columnDrops ?? columnDrops,
    ledger: l,
    now: () => new Date('2026-10-12T00:00:00Z'),
  }));
};

/** The conflict groups a plan run lists over the database as it stands (none when the plan itself refuses). */
async function reviewedConflictsNow(posture: string): Promise<ReviewedConflict[]> {
  try {
    return reviewedConflictsOf(await buildOrganizationOwnershipPlan({ reader: executor(), posture, database: file }));
  } catch {
    return [];
  }
}

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
      ['metadata-promotion', 'done'],
      ['template-promotion', 'done'],
      ['settings-move', 'done'],
      ['rewrite', 'done'],
      ['mirror-deletion', 'done'],
      ['history-renumber', 'done'],
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

    // Every grant names its set, and the id column the rewrite read is gone (C7b).
    expect(rows('SELECT id, permission_set FROM sys_user_permission_set ORDER BY id')).toEqual([
      { id: 'grant_1', permission_set: 'member_default' },
      { id: 'grant_2', permission_set: 'member_default' },
      { id: 'grant_3', permission_set: 'field_auditor' },
      { id: 'grant_4', permission_set: 'member_default' },
    ]);
    expect(rows(`SELECT name FROM pragma_table_info('sys_user_permission_set') WHERE name = 'permission_set_id'`)).toEqual([]);
    expect(writes).toContain('ALTER TABLE sys_user_permission_set DROP COLUMN permission_set_id');

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

  it('refuses, before any write, a plan computed under another tenancy posture, naming both and the remedy', async () => {
    const c = catalog();
    const l = ledger();
    const hash = createHash('sha256').update(readFileSync(file)).digest('hex');

    // Reviewed under a wall, where anchorless rows are reported; run under single, where they would take an owner.
    const refused = apply(c, l, { posture: 'single', reviewed: { posture: 'isolated' } });

    await expect(refused).rejects.toBeInstanceOf(ReviewedPlanRefusal);
    await expect(refused).rejects.toMatchObject({
      reason: 'plan-posture-mismatch',
      detail: { reviewed: 'isolated', current: 'single' },
      message: expect.stringMatching(/computed under the isolated tenancy posture, and this run resolves single .*Nothing was written\..*--plan-file/s),
    });
    expect(writes).toEqual([]);
    expect(l.checkpoint).toBeNull();
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
  const plan = {
    kind: 'organization-ownership-plan', ceremony: 'ADR-0131 D10', generatedAt: 'g', database: 'd', inventoryDigest: 'x', posture: 'single',
  };

  it('reads the compared fields of a plan file', () => {
    expect(reviewedPlanFromFile('p.json', JSON.stringify({ ...plan, tables: [] }))).toEqual({
      file: 'p.json', generatedAt: 'g', database: 'd', inventoryDigest: 'x', posture: 'single', conflicts: [],
    });
  });

  it('reads both conflict lists the plan file records, keyed and sorted', () => {
    const tables = [
      {
        object: 'sys_metadata',
        metadataConflicts: [{ type: 'view', name: 'deal_list', packageId: 'pkg_a', bundleMember: null, candidates: [{ id: 'md_b' }, { id: 'md_a' }] }],
      },
      { object: 'sys_email_template', templateConflicts: [{ name: 'crm.note', locale: 'en-US', candidates: [{ id: 'tpl_b' }, { id: 'tpl_a' }] }] },
    ];
    expect(reviewedPlanFromFile('p.json', JSON.stringify({ ...plan, tables })).conflicts).toEqual([
      { kind: 'metadata', key: 'view deal_list (package pkg_a)', candidates: ['md_a', 'md_b'] },
      { kind: 'template', key: 'crm.note (en-US)', candidates: ['tpl_a', 'tpl_b'] },
    ]);
  });

  it.each([
    ['not JSON', '{'],
    ['an apply report, not a plan', JSON.stringify({ ...plan, kind: 'organization-ownership-apply' })],
    ['no digest', JSON.stringify({ ...plan, inventoryDigest: '' })],
    ['no database', JSON.stringify({ ...plan, database: undefined })],
    ['no posture', JSON.stringify({ ...plan, posture: undefined })],
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
      'attribution', 'authored-conversion', 'metadata-promotion', 'template-promotion', 'settings-move', 'rewrite', 'mirror-deletion', 'history-renumber', 'column-drops',
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
    expect(Object.keys(l.checkpoint!.completed)).toEqual(['attribution', 'authored-conversion', 'metadata-promotion', 'template-promotion', 'settings-move', 'rewrite']);
    expect(rows('SELECT COUNT(*) AS n FROM sys_position_permission_set')).toEqual([{ n: 3 }]);
    writes = [];

    const resumed = await apply(c, l);

    expect(resumed.resumedFrom).toEqual(['attribution', 'authored-conversion', 'metadata-promotion', 'template-promotion', 'settings-move', 'rewrite']);
    expect(resumed.steps.map((s) => s.status)).toEqual(['checkpointed', 'checkpointed', 'checkpointed', 'checkpointed', 'checkpointed', 'checkpointed', 'done', 'done', 'done']);
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

  it('certifies a ceremony whose only remaining NULL rows are the declared sharing-rule mirrors this release still seeds: advisory, named, kept', async () => {
    db.exec(`
      CREATE TABLE sys_sharing_rule (id TEXT PRIMARY KEY, organization_id TEXT, name TEXT, managed_by TEXT, customized INTEGER);
      INSERT INTO sys_sharing_rule VALUES ('rule_declared', NULL, 'share_deals', 'package', 0), ('rule_org', 'org_b', 'mine', 'admin', 0);
    `);
    const l = ledger();
    const report = await apply(catalog(), l);

    // Every step ran, and the moved settings rung reads zero. The rule mirror
    // is D2's to remove, and this release's own boot keeps seeding it, so it
    // is advisory: named and counted beside the unattributable rows, never a
    // discrepancy (the restore and the negative legs:
    // `organization-ownership-apply.declared-rule-mirrors.test.ts`).
    const unattributable = report.tables.reduce((n, t) => n + t.unattributable.length, 0);
    expect(report.complete).toBe(true);
    expect(report.blocking).toBe(0);
    expect(report.advisory).toBe(unattributable + 1);
    expect(l.verdicts.at(-1)).toEqual({ complete: true, blocking: 0, advisory: unattributable + 1 });
    expect(tableOf(report, 'sys_setting').departures).toEqual([]);
    const rule = tableOf(report, 'sys_sharing_rule');
    expect(rule.remaining).toBe(0);
    expect(rule.departures).toEqual([
      { id: 'declared-rule-mirrors', label: expect.any(String), as: 'mirror-deletion', rows: 1, advisory: expect.stringMatching(/own boot still writes them/) },
    ]);
    // Still NULL, so the column takes no NOT NULL; the operator was told before the first write.
    expect(rule.notNull).toEqual({ willReceive: false, reason: expect.stringMatching(/^1 row\(s\) stay NULL on this release, reported as advisory: /) });
    expect(report.warnings.filter((w) => w.startsWith('sys_sharing_rule holds 1 organization-less row(s) of '))).toHaveLength(1);
    expect(rows(`SELECT id, organization_id FROM sys_sharing_rule ORDER BY id`)).toEqual([
      { id: 'rule_declared', organization_id: null },
      { id: 'rule_org', organization_id: 'org_b' },
    ]);
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

  it('a column-drop table the booted composition does not declare is not-declared, counted, kept and blocking — not blamed on the release', async () => {
    db.exec(`CREATE TABLE sys_flow_dispatch (id TEXT PRIMARY KEY, organization_id TEXT)`);
    const c = catalog();
    const l = ledger();
    const answering = async (outcome: 'not-declared' | 'not-proposed'): Promise<OrganizationOwnershipApplyReport> => {
      const real = columnDrops.drop;
      columnDrops.drop = async (columns) => [
        ...(await real(columns.filter((c) => c.table !== 'sys_flow_dispatch'))),
        ...(columns.some((c) => c.table === 'sys_flow_dispatch')
          ? [{ table: 'sys_flow_dispatch', column: 'organization_id', outcome }]
          : []),
      ];
      try {
        return await apply(c, l);
      } finally {
        columnDrops.drop = real;
      }
    };
    const flowDispatchBlocker = (report: OrganizationOwnershipApplyReport): string[] =>
      report.steps.find((s) => s.step === 'column-drops')!.blockers.filter((b) => b.includes('sys_flow_dispatch.organization_id'));

    const notDeclared = await answering('not-declared');
    const drops = notDeclared.steps.find((s) => s.step === 'column-drops')!;
    expect(drops.status).toBe('blocked');
    // sys_job.organization_id and the grant's retired permission_set_id drop; sys_flow_dispatch is kept.
    expect(drops.summary).toEqual({ dropped: 2, due: 3, notDeclared: 1 });
    expect(flowDispatchBlocker(notDeclared)).toHaveLength(1);
    expect(rows(`SELECT name FROM pragma_table_info('sys_flow_dispatch') WHERE name = 'organization_id'`)).toHaveLength(1);
    expect(rows(`SELECT name FROM pragma_table_info('sys_job') WHERE name = 'organization_id'`)).toHaveLength(0);

    // The control: the same table on the resumed run, answered `not-proposed`
    // (a declared object the differ proposed no drop for).
    const notProposed = await answering('not-proposed');
    expect(notProposed.resumedFrom).toEqual([
      'attribution', 'authored-conversion', 'metadata-promotion', 'template-promotion', 'settings-move', 'rewrite', 'mirror-deletion', 'history-renumber',
    ]);
    const control = notProposed.steps.find((s) => s.step === 'column-drops')!;
    expect(control.status).toBe('blocked');
    expect(control.summary).toEqual({ dropped: 0, due: 1, notDeclared: 0 });
    expect(flowDispatchBlocker(notProposed)).toHaveLength(1);
    expect(flowDispatchBlocker(notProposed)[0]).not.toBe(flowDispatchBlocker(notDeclared)[0]);
  });

  it('holds a column whose rows another stage owns, and reports it', async () => {
    db.exec(`
      CREATE TABLE sys_metadata (id TEXT PRIMARY KEY, organization_id TEXT, type TEXT, name TEXT, state TEXT, package_id TEXT);
      INSERT INTO sys_metadata VALUES ('md_1', 'org_b', 'object', 'deal', 'active', NULL);
    `);
    const report = await apply(catalog(), ledger());

    const drops = report.steps.find((s) => s.step === 'column-drops')!;
    expect(drops.status).toBe('blocked');
    expect(drops.blockers.join('\n')).toMatch(/sys_metadata\.organization_id is not dropped/);
    expect(rows(`SELECT name FROM pragma_table_info('sys_metadata') WHERE name = 'organization_id'`)).toHaveLength(1);
    expect(rows(`SELECT name FROM pragma_table_info('sys_job') WHERE name = 'organization_id'`)).toHaveLength(0);
  });
});

describe('ADR-0131 D10 --apply — organization customizations and form withdrawals (rulings A on #22011 and #22008)', () => {
  const metadataTable = (values: string): void => {
    db.exec(`
      CREATE TABLE sys_metadata (id TEXT PRIMARY KEY, organization_id TEXT, type TEXT, name TEXT, state TEXT,
        package_id TEXT, bundle_member TEXT, metadata TEXT);
      ${values ? `INSERT INTO sys_metadata VALUES ${values};` : ''}
    `);
  };
  const md = (id: string, org: string | null, type: string, name: string, body: Record<string, unknown>, pkg: string | null = null): string =>
    `('${id}', ${org === null ? 'NULL' : `'${org}'`}, '${type}', '${name}', 'active', ${pkg === null ? 'NULL' : `'${pkg}'`}, NULL, '${JSON.stringify(body)}')`;
  const step = (report: OrganizationOwnershipApplyReport) => report.steps.find((s) => s.step === 'metadata-promotion')!;
  /** Each row's owner; once column-drops has dropped the column, every row reads as the environment's (`null`). */
  const owners = (): Array<[unknown, unknown]> => {
    const scoped = rows(`SELECT name FROM pragma_table_info('sys_metadata') WHERE name = 'organization_id'`).length > 0;
    return rows(`SELECT id${scoped ? ', organization_id' : ''} FROM sys_metadata ORDER BY id`).map((r) => [r.id, r.organization_id ?? null]);
  };

  it('under single, an organization customization no other row holds becomes an environment row in place', async () => {
    metadataTable([
      md('md_dash', 'org_default', 'dashboard', 'sales_board', { name: 'sales_board', label: 'Org board' }),
      md('md_env', null, 'report', 'pipeline', { name: 'pipeline', label: 'Env report' }),
      md('md_obj', 'org_default', 'object', 'deal', { name: 'deal' }),
    ].join(', '));

    const report = await apply(catalog(), ledger());

    expect(step(report)).toMatchObject({ status: 'done', summary: { promoted: 1, conflicts: 0 } });
    // The non-presentational row is reported, never promoted; nothing is deleted.
    expect(owners()).toEqual([['md_dash', null], ['md_env', null], ['md_obj', 'org_default']]);
  });

  it('a key held by an organization row and the environment row is a conflict: kept, listed by id, blocking; nothing is written', async () => {
    metadataTable([
      md('md_org', 'org_default', 'view', 'deal_list', { name: 'deal_list', label: 'Org list' }),
      md('md_env', null, 'view', 'deal_list', { name: 'deal_list', label: 'Env list' }),
    ].join(', '));
    const c = catalog();

    const report = await apply(c, ledger());

    expect(step(report).status).toBe('blocked');
    expect(step(report).blockers.join('\n')).toMatch(/view deal_list is held by 2 rows .*md_env \(environment, active\), md_org \(organization org_default, active\)/);
    expect(writes.filter((w) => /sys_metadata/.test(w))).toEqual([]);
    expect(owners()).toEqual([['md_env', null], ['md_org', 'org_default']]);
    expect(c.viewSaves).toEqual([]);

    // The operator keeps one row; the re-run promotes nothing more and goes on.
    db.exec(`DELETE FROM sys_metadata WHERE id = 'md_org'`);
    const again = await apply(c, ledger());
    expect(step(again)).toMatchObject({ status: 'done', summary: { promoted: 0, conflicts: 0 } });
  });

  it('two organizations holding one key is a conflict too', async () => {
    metadataTable([
      md('md_a', 'org_a', 'translation', 'fr', { name: 'fr' }),
      md('md_b', 'org_b', 'translation', 'fr', { name: 'fr' }),
    ].join(', '));
    const report = await apply(catalog(), ledger());
    expect(step(report).summary.conflicts).toBe(1);
    expect(owners()).toEqual([['md_a', 'org_a'], ['md_b', 'org_b']]);
  });

  it('under a wall the rows are reported, never promoted, and they hold the column', async () => {
    metadataTable(md('md_dash', 'org_a', 'dashboard', 'sales_board', { name: 'sales_board' }));
    const report = await apply(catalog(), ledger(), { posture: 'isolated' });
    expect(step(report)).toMatchObject({ status: 'done', summary: { promoted: 0, reported: 1 } });
    expect(owners()).toEqual([['md_dash', 'org_a']]);
  });

  for (const posture of ['single', 'isolated'] as const) {
    it(`⭐ a form an organization withdrew before the upgrade is refused at the anonymous doors after it, across packages (${posture})`, async () => {
      // The organization withdrew the package-less copy; package pkg_a serves its own copy, open.
      metadataTable(md('md_org', 'org_default', 'view', 'crm_lead.intake', formView(false, 'Org copy')));
      const c = catalog();
      const views = servedViews(c);
      expect(await doorsServe(views, 'lead-intake')).toEqual(['crm_lead.intake|pkg_a']);

      const report = await apply(c, ledger(), { posture, views });

      expect(step(report).status).toBe('done');
      expect(step(report).summary.withdrawalsCarried).toBe(1);
      // Carried onto pkg_a's own copy, through the door, into its own package.
      expect(c.viewSaves.map((v) => [v.name, v.packageId, (v.body.config as any).sharing.enabled])).toEqual([
        ['crm_lead.intake', 'pkg_a', false],
      ]);
      expect(await doorsServe(views, 'lead-intake')).toEqual([]);

      // Idempotent: a second run (no checkpoint) carries nothing more.
      const again = await apply(c, ledger(), { posture, views });
      expect(step(again).summary.withdrawalsCarried).toBe(0);
      expect(c.viewSaves).toHaveLength(1);
    });
  }

  it('⭐ under single, a withdrawal the organization holds on the key it alone holds travels with the promoted row', async () => {
    metadataTable(md('md_org', 'org_default', 'view', 'crm_lead.intake', formView(false, 'Org copy'), 'pkg_a'));
    const c = catalog();
    const views = servedViews(c);

    const report = await apply(c, ledger(), { views });

    expect(step(report).summary).toMatchObject({ promoted: 1, withdrawalsCarried: 0 });
    expect(c.viewSaves).toEqual([]);
    expect(owners()).toEqual([['md_org', null]]);
    expect(await doorsServe(views, 'lead-intake')).toEqual([]);
  });

  it('control: an organization row that withdraws nothing carries nothing, and the form stays served', async () => {
    metadataTable(md('md_org', 'org_default', 'view', 'crm_lead.intake', formView(true, 'Org copy')));
    const c = catalog();
    const views = servedViews(c);
    const report = await apply(c, ledger(), { views });
    expect(step(report).summary.withdrawalsCarried).toBe(0);
    expect(c.viewSaves).toEqual([]);
    expect(await doorsServe(views, 'lead-intake')).toEqual(['crm_lead.intake|', 'crm_lead.intake|pkg_a']);
  });

  it('a door that refuses the carry blocks the step, naming the form and the remedy', async () => {
    metadataTable(md('md_org', 'org_default', 'view', 'crm_lead.intake', formView(false)));
    const c = catalog();
    const refusing: ReturnType<typeof catalog> = {
      ...c,
      async save(type, name, body, target) {
        if (type === 'view') throw new Error('NOT_OVERRIDABLE: the view is sealed');
        return c.save(type, name, body, target);
      },
    };
    const report = await apply(refusing, ledger(), { views: servedViews(c) });
    expect(step(report).status).toBe('blocked');
    expect(step(report).blockers.join('\n')).toMatch(/lead-intake of the view crm_lead\.intake \(package pkg_a\).*NOT_OVERRIDABLE.*sharing\.enabled false/);
  });
});

describe('ADR-0131 D10 --apply — a customization conflict resolved by --metadata-choice (ruling 6163114098: Q1 B, Q6 A)', () => {
  const metadataTable = (values: string): void => {
    db.exec(`
      CREATE TABLE sys_metadata (id TEXT PRIMARY KEY, organization_id TEXT, type TEXT, name TEXT, state TEXT,
        package_id TEXT, bundle_member TEXT, metadata TEXT);
      INSERT INTO sys_metadata VALUES ${values};
    `);
  };
  const md = (id: string, org: string | null, type: string, name: string, body: Record<string, unknown>, pkg: string | null = null): string =>
    `('${id}', ${org === null ? 'NULL' : `'${org}'`}, '${type}', '${name}', 'active', ${pkg === null ? 'NULL' : `'${pkg}'`}, NULL, '${JSON.stringify(body)}')`;
  const step = (report: OrganizationOwnershipApplyReport) => report.steps.find((s) => s.step === 'metadata-promotion')!;
  const owners = (): Array<[unknown, unknown]> => {
    const scoped = rows(`SELECT name FROM pragma_table_info('sys_metadata') WHERE name = 'organization_id'`).length > 0;
    return rows(`SELECT id${scoped ? ', organization_id' : ''} FROM sys_metadata ORDER BY id`).map((r) => [r.id, r.organization_id ?? null]);
  };
  const labelOf = (id: string): unknown => (JSON.parse(String(rows(`SELECT metadata FROM sys_metadata WHERE id = '${id}'`)[0]!.metadata)) as { label?: unknown }).label;
  const deletes = (): string[] => writes.filter((w) => /^DELETE FROM "sys_metadata"/.test(w));
  const conflictRows = [
    md('md_org', 'org_default', 'view', 'deal_list', { name: 'deal_list', label: 'Org list' }),
    md('md_env', null, 'view', 'deal_list', { name: 'deal_list', label: 'Env list' }),
  ].join(', ');

  it('⭐ no row of a conflict is deleted before a choice is made', async () => {
    metadataTable(conflictRows);
    const report = await apply(storingDoor(catalog()), ledger());
    expect(step(report).status).toBe('blocked');
    expect(step(report).blockers.join('\n')).toMatch(/choose one with --metadata-choice ROW_ID/);
    expect(deletes()).toEqual([]);
    expect(owners()).toEqual([['md_env', null], ['md_org', 'org_default']]);
  });

  it('⭐ choosing the organization\'s row over the environment\'s: the one environment row takes its body in place, then the organization row goes', async () => {
    metadataTable(conflictRows);
    const c = storingDoor(catalog());
    const report = await apply(c, ledger(), { metadataChoices: ['md_org'] });
    expect(step(report)).toMatchObject({ status: 'done', summary: { chosen: 1, organizationRowsDeleted: 1, conflicts: 0 } });
    expect(owners()).toEqual([['md_env', null]]);
    expect(labelOf('md_env')).toBe('Org list');
    // Exactly one environment row at every point: the environment row took the
    // body in place, by one UPDATE, and no UPDATE ever cleared an organization
    // row of this key. No withdrawal to record, so the door was not asked.
    expect(writes.filter((w) => /^UPDATE "sys_metadata" SET "metadata" = \?/.test(w))).toHaveLength(1);
    expect(writes.some((w) => /^UPDATE "sys_metadata" SET "organization_id" = NULL/.test(w))).toBe(false);
    expect(c.viewSaves).toEqual([]);
  });

  it('⭐ an item a package ships: a package-less environment row of the key takes the body, though the door writes only into the package', async () => {
    // The real door writes an environment customization of a packaged item into
    // that package's slot, whatever the target (measured on the showcase).
    metadataTable([
      md('md_org', 'org_default', 'view', 'crm_lead.intake', formView(true, 'Org copy')),
      md('md_env', null, 'view', 'crm_lead.intake', formView(false, 'Env copy')),
    ].join(', '));
    const base = storingDoor(catalog());
    const packaged: ReturnType<typeof catalog> = {
      ...base,
      async save(type, name, body) {
        return base.save(type, name, body, { packageId: 'pkg_a' });
      },
    };
    const report = await apply(packaged, ledger(), { views: servedViews(base, []), metadataChoices: ['md_org'] });
    expect(step(report)).toMatchObject({ status: 'done', summary: { chosen: 1, organizationRowsDeleted: 1 } });
    // The key's own environment row holds the chosen body, with the environment row's withdrawal kept.
    expect(labelOf('md_env')).toBe('Org copy');
    expect((JSON.parse(String(rows(`SELECT metadata FROM sys_metadata WHERE id = 'md_env'`)[0]!.metadata)) as any).config.sharing.enabled).toBe(false);
    expect(rows(`SELECT id FROM sys_metadata WHERE id = 'md_org'`)).toEqual([]);
  });

  it('the environment row is read back before any delete: a write that does not land deletes nothing', async () => {
    metadataTable(conflictRows);
    const c = catalog();
    const base = executor();
    const lost: ApplyExecutor = {
      ...base,
      async execute(statement, params) {
        if (/^UPDATE "sys_metadata" SET "metadata"/.test(statement)) return;
        return base.execute(statement, params);
      },
    };
    await expect(apply(c, ledger(), { metadataChoices: ['md_org'], executor: lost })).rejects.toThrow(/did not read back as one environment row/);
    expect(deletes()).toEqual([]);
    expect(owners()).toEqual([['md_env', null], ['md_org', 'org_default']]);
  });

  it('⭐ a crash between the replacement and the delete: the same --metadata-choice finishes it', async () => {
    metadataTable(conflictRows);
    const c = storingDoor(catalog());
    const l = ledger();
    await expect(apply(c, l, { metadataChoices: ['md_org'], executor: executor({ failOnceOn: /^DELETE FROM "sys_metadata"/ }) })).rejects.toThrow(
      /killed mid-step/,
    );
    // The replacement landed and is recorded; the organization row is still there.
    expect(labelOf('md_env')).toBe('Org list');
    expect(owners()).toEqual([['md_env', null], ['md_org', 'org_default']]);
    expect(l.checkpoint!.metadataChoicesApplied).toEqual(['md_org']);

    const again = await apply(c, l, { metadataChoices: ['md_org'] });
    expect(step(again)).toMatchObject({ status: 'done', summary: { chosen: 1, organizationRowsDeleted: 1 } });
    expect(owners()).toEqual([['md_env', null]]);

    // And after the delete, before the step's checkpoint: the choice names a row
    // that is gone, which the checkpoint records as applied.
    l.checkpoint!.completed = {};
    const third = await apply(c, l, { metadataChoices: ['md_org'] });
    expect(step(third).status).toBe('done');
    expect(owners()).toEqual([['md_env', null]]);
  });

  it('choosing the environment\'s row: the organization row is deleted by id, and nothing is promoted', async () => {
    metadataTable(conflictRows);
    const report = await apply(storingDoor(catalog()), ledger(), { metadataChoices: ['md_env'] });
    expect(step(report)).toMatchObject({ status: 'done', summary: { chosen: 1, organizationRowsDeleted: 1, promoted: 0 } });
    expect(owners()).toEqual([['md_env', null]]);
    expect(labelOf('md_env')).toBe('Env list');
  });

  it('two organizations on one key and no environment row: the chosen one is promoted in place, the other deleted', async () => {
    metadataTable([md('md_a', 'org_a', 'translation', 'fr', { name: 'fr', a: 1 }), md('md_b', 'org_b', 'translation', 'fr', { name: 'fr', b: 1 })].join(', '));
    const l = ledger();
    const c = storingDoor(catalog());
    const report = await apply(c, l, { metadataChoices: ['md_b'] });
    expect(step(report).summary).toMatchObject({ chosen: 1, organizationRowsDeleted: 1 });
    expect(owners()).toEqual([['md_b', null]]);
    // A rerun with the same choice: the chosen row is the key's environment row now.
    l.checkpoint!.completed = {};
    expect(step(await apply(c, l, { metadataChoices: ['md_b'] })).status).toBe('done');
  });

  it('⭐ fail-closed: choosing a row that serves a form an unchosen row withdraws carries the withdrawal onto it before the delete', async () => {
    metadataTable([
      md('md_org', 'org_default', 'view', 'crm_lead.intake', formView(false, 'Org copy')),
      md('md_env', null, 'view', 'crm_lead.intake', formView(true, 'Env copy')),
    ].join(', '));
    const c = storingDoor(catalog());
    const views = servedViews(c, []);
    const report = await apply(c, ledger(), { views, metadataChoices: ['md_env'] });
    expect(step(report).status).toBe('done');
    expect(owners()).toEqual([['md_env', null]]);
    expect((JSON.parse(String(rows(`SELECT metadata FROM sys_metadata WHERE id = 'md_env'`)[0]!.metadata)) as any).config.sharing.enabled).toBe(false);
    expect(await doorsServe(views, 'lead-intake')).toEqual([]);
  });

  it('a door that refuses the chosen body blocks the conflict, and no organization row is deleted', async () => {
    metadataTable([
      md('md_org', 'org_default', 'view', 'crm_lead.intake', formView(false, 'Org copy')),
      md('md_env', null, 'view', 'crm_lead.intake', formView(true, 'Env copy')),
    ].join(', '));
    const c = storingDoor(catalog());
    const refusing: ReturnType<typeof catalog> = {
      ...c,
      async save(type, name, body, target) {
        if (type === 'view' && target?.packageId === null) throw new Error('VALIDATION_ERROR: refused');
        return c.save(type, name, body, target);
      },
    };
    const report = await apply(refusing, ledger(), { views: servedViews(c, []), metadataChoices: ['md_env'] });
    expect(step(report).status).toBe('blocked');
    expect(step(report).blockers.join('\n')).toMatch(/Nothing was deleted; fix the cause, then re-run/);
    expect(deletes()).toEqual([]);
    expect(owners()).toEqual([['md_env', null], ['md_org', 'org_default']]);
  });

  describe('the in-place write does what the door does to that row (N2)', () => {
    const withChecksum = (): void => {
      db.exec(`ALTER TABLE sys_metadata ADD COLUMN checksum TEXT; UPDATE sys_metadata SET checksum = 'sha256:stale';`);
    };

    it('⭐ restamps checksum from the written body, as the door does (the version, the etag, the no-op check)', async () => {
      metadataTable(conflictRows);
      withChecksum();
      await apply(storingDoor(catalog()), ledger(), { metadataChoices: ['md_org'] });
      const [row] = rows(`SELECT metadata, checksum FROM sys_metadata WHERE id = 'md_env'`);
      expect(row!.checksum).toBe(hashSpec(JSON.parse(String(row!.metadata)), 'view'));
      expect(row!.checksum).not.toBe('sha256:stale');
    });

    it('⭐ keeps the lock family the environment row stores, whatever the chosen body carries', async () => {
      metadataTable([
        md('md_org', 'org_default', 'view', 'deal_list', { name: 'deal_list', label: 'Org list', _lock: 'none' }),
        md('md_env', null, 'view', 'deal_list', { name: 'deal_list', label: 'Env list', _lock: 'customize', _lockReason: 'stamped' }),
      ].join(', '));
      await apply(storingDoor(catalog()), ledger(), { metadataChoices: ['md_org'] });
      const body = JSON.parse(String(rows(`SELECT metadata FROM sys_metadata WHERE id = 'md_env'`)[0]!.metadata)) as Record<string, unknown>;
      expect(body).toMatchObject({ label: 'Org list', _lock: 'customize', _lockReason: 'stamped' });
    });

    it('⭐ a locked item stays locked: the door\'s verdict refuses the write, and nothing is written or deleted', async () => {
      metadataTable(conflictRows);
      const asked: Array<[string, string, string | null]> = [];
      const report = await apply(storingDoor(catalog()), ledger(), {
        metadataChoices: ['md_org'],
        lock: {
          verdict: async (type, name, packageId) => {
            asked.push([type, name, packageId]);
            return { editable: false, lock: 'full', lockReason: 'shipped locked' };
          },
        },
      });
      expect(asked).toEqual([['view', 'deal_list', null]]);
      expect(step(report).status).toBe('blocked');
      expect(step(report).blockers.join('\n')).toMatch(/is locked \(_lock=full: shipped locked\).*Nothing was written or deleted/s);
      expect(labelOf('md_env')).toBe('Env list');
      expect(deletes()).toEqual([]);
    });
  });

  it('⭐ the lock is asked before the history fold and the promotion: under a wall, a refusal leaves history and rows as they were', async () => {
    metadataTable([
      md('md_org', 'org_default', 'view', 'deal_list', { name: 'deal_list', label: 'Org list' }),
      md('md_env', null, 'view', 'deal_list', { name: 'deal_list', label: 'Env list' }),
      md('md_lone', 'org_default', 'dashboard', 'sales', { name: 'sales' }),
    ].join(', '));
    db.exec(`
      CREATE TABLE sys_metadata_history (id TEXT PRIMARY KEY, organization_id TEXT, type TEXT, name TEXT,
        version INTEGER, event_seq INTEGER, checksum TEXT);
      INSERT INTO sys_metadata_history VALUES
        ('h_env', NULL, 'view', 'deal_list', 1, 1, 'e1'),
        ('h_org1', 'org_default', 'view', 'deal_list', 1, 1, 'o1'), ('h_org2', 'org_default', 'view', 'deal_list', 2, 2, 'o2');
    `);
    const history = rows('SELECT * FROM sys_metadata_history ORDER BY id');
    const report = await apply(storingDoor(catalog()), ledger(), {
      posture: 'isolated',
      metadataChoices: ['md_org'],
      columnDrops: { drop: async (columns) => columns.map(({ table, column }) => ({ table, column, outcome: 'not-proposed' as const })) },
      lock: { verdict: async (type) => (type === 'view' ? { editable: false, lock: 'full' } : { editable: true }) },
    });
    expect(step(report).status).toBe('blocked');
    expect(step(report).blockers.join('\n')).toMatch(/view deal_list could not take the body .*Nothing was written or deleted/s);
    // No fold, no promotion, no write: history and both rows of the key are as they were.
    expect(writes.filter((w) => /sys_metadata/.test(w))).toEqual([]);
    expect(rows('SELECT * FROM sys_metadata_history ORDER BY id')).toEqual(history);
    expect(owners()).toEqual([['md_env', null], ['md_lone', 'org_default'], ['md_org', 'org_default']]);
    expect(labelOf('md_env')).toBe('Env list');
  });

  it('the door save after the in-place write sends the row as written, its stored lock family kept', async () => {
    metadataTable([
      md('md_org', 'org_default', 'view', 'crm_lead.intake', formView(true, 'Org copy')),
      md('md_other', 'org_b', 'view', 'crm_lead.intake', formView(false, 'Other copy')),
      md('md_env', null, 'view', 'crm_lead.intake', { ...formView(true, 'Env copy'), _lock: 'customize' }),
    ].join(', '));
    const c = storingDoor(catalog());
    const report = await apply(c, ledger(), { views: servedViews(c, []), metadataChoices: ['md_org'] });
    expect(step(report).status).toBe('done');
    expect(c.viewSaves.at(-1)!.body).toMatchObject({ label: 'Org copy', _lock: 'customize' });
    expect((c.viewSaves.at(-1)!.body.config as any).sharing.enabled).toBe(false);
  });

  it('two conflicts of one item that differ only by bundle member are two conflicts, each chosen for', async () => {
    db.exec(`
      CREATE TABLE sys_metadata (id TEXT PRIMARY KEY, organization_id TEXT, type TEXT, name TEXT, state TEXT,
        package_id TEXT, bundle_member TEXT, metadata TEXT);
      INSERT INTO sys_metadata VALUES
        ('en_org', 'org_default', 'email_template', 'crm.note', 'active', NULL, 'en-US', '{"name":"crm.note","locale":"en-US","s":"o"}'),
        ('en_env', NULL, 'email_template', 'crm.note', 'active', NULL, 'en-US', '{"name":"crm.note","locale":"en-US","s":"e"}'),
        ('fr_org', 'org_default', 'email_template', 'crm.note', 'active', NULL, 'fr-FR', '{"name":"crm.note","locale":"fr-FR","s":"o"}'),
        ('fr_env', NULL, 'email_template', 'crm.note', 'active', NULL, 'fr-FR', '{"name":"crm.note","locale":"fr-FR","s":"e"}');
    `);
    const report = await apply(storingDoor(catalog()), ledger(), { metadataChoices: ['en_org', 'fr_env'] });
    expect(step(report)).toMatchObject({ status: 'done', summary: { chosen: 2 } });
  });

  describe('under a wall (ruling 6163114098, Q6 A: the ceremony never deletes the unchosen rows)', () => {
    it('⭐ a chosen organization row defines the environment row, and nothing is deleted', async () => {
      metadataTable(conflictRows);
      const report = await apply(storingDoor(catalog()), ledger(), { posture: 'isolated', metadataChoices: ['md_org'] });
      expect(step(report)).toMatchObject({ status: 'done', summary: { chosen: 1, organizationRowsDeleted: 0 } });
      expect(deletes()).toEqual([]);
      expect(owners()).toEqual([['md_env', null], ['md_org', 'org_default']]);
      expect(labelOf('md_env')).toBe('Org list');
      // The ruled report line: each organization row left, named as remaining and blocking column-drops, with the remedy.
      expect(step(report).notes).toContainEqual(
        expect.stringMatching(
          /^Remaining: sys_metadata row md_org \(organization org_default, the chosen row, whose body the environment row md_env now holds\) of the view deal_list blocks column-drops on sys_metadata: .*never deletes it\. Remedy: check the environment row, then delete this row yourself/,
        ),
      );
    });

    it('⭐ two organizations on one key: the chosen one is promoted, the other stays', async () => {
      metadataTable([md('md_a', 'org_a', 'dashboard', 'sales', { name: 'sales', a: 1 }), md('md_b', 'org_b', 'dashboard', 'sales', { name: 'sales', b: 1 })].join(', '));
      const report = await apply(storingDoor(catalog()), ledger(), { posture: 'isolated', metadataChoices: ['md_b'] });
      expect(step(report).status).toBe('done');
      expect(deletes()).toEqual([]);
      expect(owners()).toEqual([['md_a', 'org_a'], ['md_b', null]]);
    });

    it('a conflict nobody chose for is reported, not blocking the step; its rows hold the column', async () => {
      metadataTable(conflictRows);
      const report = await apply(storingDoor(catalog()), ledger(), { posture: 'isolated' });
      expect(step(report)).toMatchObject({ status: 'done', summary: { conflicts: 1, reported: 1 } });
      expect(step(report).notes.join('\n')).toMatch(/view deal_list is held by 2 rows/);
      expect(deletes()).toEqual([]);
    });

    it('a lone row is promoted only when chosen; the rest stay reported', async () => {
      metadataTable([md('md_a', 'org_a', 'dashboard', 'sales', { name: 'sales' }), md('md_b', 'org_a', 'report', 'pipe', { name: 'pipe' })].join(', '));
      const report = await apply(catalog(), ledger(), { posture: 'isolated', metadataChoices: ['md_a'] });
      expect(step(report).summary).toMatchObject({ promoted: 1, reported: 1 });
      expect(owners()).toEqual([['md_a', null], ['md_b', 'org_a']]);
    });
  });

  it('refuses, before any write, a choice naming no row awaiting one, and two choices for one conflict', async () => {
    metadataTable([conflictRows, md('md_lone', 'org_default', 'dashboard', 'sales', { name: 'sales' })].join(', '));
    await expect(apply(catalog(), ledger(), { metadataChoices: ['md_nope'] })).rejects.toBeInstanceOf(MetadataChoiceRefusal);
    await expect(apply(catalog(), ledger(), { metadataChoices: ['md_org', 'md_env'] })).rejects.toThrow(
      /md_org and md_env both choose for view deal_list/,
    );
    expect(writes).toEqual([]);
  });
});

describe('ADR-0131 D10 --apply — a choice deletes only rows the reviewed plan listed (plan-conflict-mismatch)', () => {
  const metadataConflict = (extra = ''): void => {
    db.exec(`
      CREATE TABLE sys_metadata (id TEXT PRIMARY KEY, organization_id TEXT, type TEXT, name TEXT, state TEXT,
        package_id TEXT, bundle_member TEXT, metadata TEXT);
      INSERT INTO sys_metadata VALUES
        ('md_org', 'org_default', 'view', 'deal_list', 'active', NULL, NULL, '{"name":"deal_list","label":"Org"}'),
        ('md_env', NULL, 'view', 'deal_list', 'active', NULL, NULL, '{"name":"deal_list","label":"Env"}')${extra};
    `);
  };
  const reviewedMetadata = (candidates: string[]): Partial<ReviewedPlan> => ({
    conflicts: [{ kind: 'metadata', key: 'view deal_list', candidates }],
  });
  const refusalOf = async (run: Promise<unknown>): Promise<ReviewedPlanRefusal> => {
    try {
      await run;
    } catch (error) {
      return error as ReviewedPlanRefusal;
    }
    throw new Error('expected the apply to be refused');
  };

  it('⭐ --metadata-choice: a row that joined the conflict since the review refuses the apply, naming it; nothing is written', async () => {
    metadataConflict(`, ('md_new', 'org_b', 'view', 'deal_list', 'active', NULL, NULL, '{"name":"deal_list","label":"New"}')`);
    const err = await refusalOf(apply(storingDoor(catalog()), ledger(), { metadataChoices: ['md_org'], reviewed: reviewedMetadata(['md_env', 'md_org']) }));
    expect(err).toBeInstanceOf(ReviewedPlanRefusal);
    expect(err).toMatchObject({
      reason: 'plan-conflict-mismatch',
      detail: { flag: '--metadata-choice', choice: 'md_org', conflict: 'view deal_list', reviewed: 'md_env,md_org', current: 'md_env,md_new,md_org' },
    });
    expect(err.message).toMatch(/added since: md_new.*Nothing was written/s);
    expect(writes).toEqual([]);
    expect(rows('SELECT id FROM sys_metadata ORDER BY id').map((r) => r.id)).toEqual(['md_env', 'md_new', 'md_org']);
  });

  it('--metadata-choice: a reviewed row gone since refuses too, and a plan file that lists no such conflict', async () => {
    metadataConflict();
    const gone = await refusalOf(apply(storingDoor(catalog()), ledger(), { metadataChoices: ['md_org'], reviewed: reviewedMetadata(['md_env', 'md_old', 'md_org']) }));
    expect(gone).toMatchObject({ reason: 'plan-conflict-mismatch' });
    expect(gone.message).toMatch(/gone since: md_old/);
    const unlisted = await refusalOf(apply(storingDoor(catalog()), ledger(), { metadataChoices: ['md_org'], reviewed: { conflicts: [] } }));
    expect(unlisted.message).toMatch(/lists no such conflict/);
    expect(writes).toEqual([]);
  });

  it('--metadata-choice: the reviewed group, unchanged, resolves as reviewed', async () => {
    metadataConflict();
    const report = await apply(storingDoor(catalog()), ledger(), { metadataChoices: ['md_org'], reviewed: reviewedMetadata(['md_env', 'md_org']) });
    expect(report.steps.find((s) => s.step === 'metadata-promotion')!.summary).toMatchObject({ chosen: 1, organizationRowsDeleted: 1 });
  });

  it('⭐ --template-choice: a row that joined the conflict since the review refuses the apply, naming it; nothing is written', async () => {
    await onlyTemplates(
      `('tpl_a', 'org_a', 'crm.note', 'en-US', 'From A', 1, 'platform'), ('tpl_b', 'org_b', 'crm.note', 'en-US', 'From B', 1, 'platform'),
       ('tpl_c', 'org_c', 'crm.note', 'en-US', 'From C', 1, 'platform')`,
      async () => {
        const c = catalog();
        const err = await refusalOf(apply(c, ledger(), {
          posture: 'isolated',
          templateChoices: ['tpl_b'],
          reviewed: { conflicts: [{ kind: 'template', key: 'crm.note (en-US)', candidates: ['tpl_a', 'tpl_b'] }] },
        }));
        expect(err).toMatchObject({
          reason: 'plan-conflict-mismatch',
          detail: { flag: '--template-choice', choice: 'tpl_b', conflict: 'crm.note (en-US)', current: 'tpl_a,tpl_b,tpl_c' },
        });
        expect(err.message).toMatch(/added since: tpl_c/);
        expect(writes).toEqual([]);
        expect(c.templates.size).toBe(0);
        expect(rows('SELECT id FROM sys_email_template ORDER BY id').map((r) => r.id)).toEqual(['tpl_a', 'tpl_b', 'tpl_c']);
      },
    );
  });

  it('--template-choice: the reviewed group, unchanged, resolves as reviewed', async () => {
    await onlyTemplates(
      `('tpl_a', 'org_a', 'crm.note', 'en-US', 'From A', 1, 'platform'), ('tpl_b', 'org_b', 'crm.note', 'en-US', 'From B', 1, 'platform')`,
      async () => {
        const report = await apply(catalog(), ledger(), {
          posture: 'isolated',
          templateChoices: ['tpl_b'],
          reviewed: { conflicts: [{ kind: 'template', key: 'crm.note (en-US)', candidates: ['tpl_a', 'tpl_b'] }] },
        });
        expect(report.complete).toBe(true);
      },
    );
  });
});

describe('ADR-0131 D10 --apply — history renumbering (seat answers 6162538253, Q2 A)', () => {
  /**
   * The unique indexes a 17.x runtime created on history (its per-scope
   * counters), checked row by row: a renumbering may never land a row on a
   * sibling's number mid-statement.
   */
  const HISTORY_UNIQUE = `
    CREATE UNIQUE INDEX uniq_history_org_seq ON sys_metadata_history (organization_id, event_seq);
    CREATE UNIQUE INDEX uniq_history_org_version ON sys_metadata_history (organization_id, type, name, version);`;

  // A database holding only what each pin plants, so every step can finish
  // under any posture and the late step is reached.
  beforeEach(() => {
    db.close();
    file = join(dir, 'renumber.db');
    db = new Database(file);
    db.exec(`CREATE TABLE sys_organization (id TEXT PRIMARY KEY, slug TEXT); INSERT INTO sys_organization VALUES ('org_default', 'default');`);
    writes = [];
  });
  /** The schema-drift ceremony declining the drop: the column stays, so each pin reads whose a row is after the run. */
  const keepColumn: ColumnDropPort = {
    async drop(columns) {
      return columns.map(({ table, column }) => ({ table, column, outcome: 'not-proposed' as const }));
    },
  };

  const history = (): void => {
    db.exec(`
      CREATE TABLE sys_metadata (id TEXT PRIMARY KEY, organization_id TEXT, type TEXT, name TEXT, state TEXT,
        package_id TEXT, bundle_member TEXT, version INTEGER);
      INSERT INTO sys_metadata VALUES
        ('row_env', NULL, 'object', 'deal', 'active', NULL, NULL, 2),
        ('row_a', 'org_a', 'view', 'board', 'active', NULL, NULL, 3),
        ('row_b', 'org_b', 'view', 'board', 'active', 'pkg_b', NULL, 2);
      ALTER TABLE sys_metadata ADD COLUMN metadata TEXT;
      CREATE TABLE sys_metadata_history (id TEXT PRIMARY KEY, organization_id TEXT, type TEXT, name TEXT,
        version INTEGER, event_seq INTEGER, checksum TEXT);
      ${HISTORY_UNIQUE}
      INSERT INTO sys_metadata_history VALUES
        ('h_env1', NULL, 'object', 'deal', 1, 1, 'e1'),
        ('h_env2', NULL, 'object', 'deal', 2, 2, 'e2'),
        ('h_env3', NULL, 'view', 'board', 1, 3, 'e3'),
        ('h_a1', 'org_a', 'view', 'board', 1, 1, 'a1'),
        ('h_a2', 'org_a', 'view', 'board', 2, 2, 'a2'),
        ('h_a3', 'org_a', 'view', 'board', 3, 3, 'a3'),
        ('h_b1', 'org_b', 'view', 'board', 1, 1, 'b1'),
        ('h_b2', 'org_b', 'view', 'board', 2, 2, 'b2'),
        ('h_c1', 'org_c', 'report', 'solo', 1, 1, 'c1');
      CREATE TABLE sys_metadata_commit (id TEXT PRIMARY KEY, organization_id TEXT, event_seq_start INTEGER, event_seq_end INTEGER);
      INSERT INTO sys_metadata_commit VALUES
        ('c_env', NULL, 1, 3), ('c_a', 'org_a', 1, 3), ('c_b', 'org_b', 1, 2);
    `);
  };
  const seqs = (): Array<[unknown, unknown, unknown, unknown]> =>
    rows('SELECT id, organization_id, event_seq, version FROM sys_metadata_history ORDER BY id').map((r) => [r.id, r.organization_id, r.event_seq, r.version]);
  const step = (report: OrganizationOwnershipApplyReport) => report.steps.find((s) => s.step === 'history-renumber')!;
  const duplicates = (): unknown[] => [
    ...rows('SELECT event_seq, COUNT(*) AS n FROM sys_metadata_history GROUP BY event_seq HAVING COUNT(*) > 1'),
    ...rows('SELECT type, name, version FROM sys_metadata_history GROUP BY type, name, version HAVING COUNT(*) > 1'),
  ];

  it('makes event_seq and every (type, name, version) unique environment-wide, writing numbers only', async () => {
    history();
    const before = rows('SELECT COUNT(*) AS n FROM sys_metadata_history');
    const report = await apply(catalog(), ledger(), { posture: 'isolated', columnDrops: keepColumn });
    expect(step(report)).toMatchObject({ status: 'done', summary: { organizationsShifted: 3, lineagesShifted: 2 } });
    expect(rows('SELECT COUNT(*) AS n FROM sys_metadata_history')).toEqual(before);
    expect(rows('SELECT event_seq, COUNT(*) AS n FROM sys_metadata_history GROUP BY event_seq HAVING COUNT(*) > 1')).toEqual([]);
    expect(rows('SELECT type, name, version FROM sys_metadata_history GROUP BY type, name, version HAVING COUNT(*) > 1')).toEqual([]);
    expect(writes.some((w) => /^DELETE/.test(w))).toBe(false);
  });

  it('⭐ order within each organization and the version a rollback resolves are unchanged', async () => {
    history();
    await apply(catalog(), ledger(), { posture: 'isolated', columnDrops: keepColumn });
    const ordered = (org: string): string[] =>
      rows(`SELECT checksum FROM sys_metadata_history WHERE organization_id = '${org}' ORDER BY event_seq`).map((r) => String(r.checksum));
    expect(ordered('org_a')).toEqual(['a1', 'a2', 'a3']);
    expect(ordered('org_b')).toEqual(['b1', 'b2']);
    // The overlay row's version still names its own snapshot: a rollback by
    // version lands on that organization's body, never another lineage's.
    for (const id of ['row_a', 'row_b']) {
      const [row] = rows(`SELECT organization_id, version FROM sys_metadata WHERE id = '${id}'`);
      const snap = rows(
        `SELECT checksum FROM sys_metadata_history WHERE type = 'view' AND name = 'board' AND version = ${Number(row!.version)}`,
      );
      expect(snap).toEqual([{ checksum: id === 'row_a' ? 'a3' : 'b2' }]);
    }
    // A lineage no other one shares keeps its numbers.
    expect(rows(`SELECT version FROM sys_metadata_history WHERE id = 'h_c1'`)).toEqual([{ version: 1 }]);
    expect(rows(`SELECT version FROM sys_metadata WHERE id = 'row_env'`)).toEqual([{ version: 2 }]);
  });

  it('commit ranges move with their organization\'s history', async () => {
    history();
    await apply(catalog(), ledger(), { posture: 'isolated', columnDrops: keepColumn });
    for (const [commit, org] of [['c_a', 'org_a'], ['c_b', 'org_b']] as const) {
      const [c] = rows(`SELECT event_seq_start AS s, event_seq_end AS e FROM sys_metadata_commit WHERE id = '${commit}'`);
      const [range] = rows(`SELECT MIN(event_seq) AS lo, MAX(event_seq) AS hi FROM sys_metadata_history WHERE organization_id = '${org}'`);
      expect([c!.s, c!.e]).toEqual([range!.lo, range!.hi]);
    }
    expect(rows(`SELECT event_seq_start AS s, event_seq_end AS e FROM sys_metadata_commit WHERE id = 'c_env'`)).toEqual([{ s: 1, e: 3 }]);
  });

  it('a second run moves nothing, and a run killed between the commit and history writes resumes without moving a commit twice', async () => {
    history();
    await apply(catalog(), ledger(), { posture: 'isolated', columnDrops: keepColumn });
    const settled = seqs();
    const commits = rows('SELECT * FROM sys_metadata_commit ORDER BY id');
    const again = await apply(catalog(), ledger(), { posture: 'isolated', columnDrops: keepColumn });
    expect(step(again).summary).toMatchObject({ organizationsShifted: 0, lineagesShifted: 0 });
    expect(seqs()).toEqual(settled);
    expect(rows('SELECT * FROM sys_metadata_commit ORDER BY id')).toEqual(commits);

    // Killed after org_a's commit range moved, before its history did.
    db.close();
    db = new Database(file);
    db.exec('DROP TABLE sys_metadata; DROP TABLE sys_metadata_history; DROP TABLE sys_metadata_commit;');
    history();
    await expect(apply(catalog(), ledger(), {
      posture: 'isolated',
      columnDrops: keepColumn,
      executor: executor({ failOnceOn: /^UPDATE "sys_metadata_history" SET "event_seq"/ }),
    })).rejects.toThrow(/killed mid-step/);
    const l = ledger();
    await apply(catalog(), l, { posture: 'isolated', columnDrops: keepColumn });
    expect(seqs()).toEqual(settled);
    expect(rows('SELECT * FROM sys_metadata_commit ORDER BY id')).toEqual(commits);
  });

  /** A view row and its history: one lineage per scope, as planted. */
  const viewWithHistory = (orgRows: string, historyRows: string, versioned = true): void => {
    db.exec(`
      CREATE TABLE sys_metadata (id TEXT PRIMARY KEY, organization_id TEXT, type TEXT, name TEXT, state TEXT,
        package_id TEXT, bundle_member TEXT, version INTEGER, metadata TEXT);
      INSERT INTO sys_metadata VALUES ${orgRows};
      CREATE TABLE sys_metadata_history (id TEXT PRIMARY KEY, organization_id TEXT, type TEXT, name TEXT,
        version INTEGER, event_seq INTEGER, checksum TEXT);
      ${HISTORY_UNIQUE}
      ${historyRows ? `INSERT INTO sys_metadata_history VALUES ${historyRows};` : ''}
    `);
    void versioned;
  };
  const withdrawn = JSON.stringify(formView(false, 'Org copy'));
  const snapshotOf = (id: string): unknown[] => {
    const [row] = rows(`SELECT type, name, version FROM sys_metadata WHERE id = '${id}'`);
    return rows(`SELECT checksum FROM sys_metadata_history WHERE type = '${String(row!.type)}' AND name = '${String(row!.name)}' AND version = ${Number(row!.version)}`)
      .map((r) => r.checksum);
  };

  it('⭐ the ceremony\'s own environment saves never land on a number an organization holds (the withdrawal carry)', async () => {
    viewWithHistory(
      `('md_org', 'org_default', 'view', 'crm_lead.intake', 'active', NULL, NULL, 2, '${withdrawn}')`,
      `('h_env1', NULL, 'view', 'crm_lead.intake', 1, 1, 'e1'), ('h_env2', NULL, 'view', 'crm_lead.intake', 2, 2, 'e2'),
       ('h_org1', 'org_default', 'view', 'crm_lead.intake', 1, 1, 'o1'), ('h_org2', 'org_default', 'view', 'crm_lead.intake', 2, 2, 'o2')`,
    );
    const c = storingDoor(catalog());

    const report = await apply(c, ledger(), { views: servedViews(c), columnDrops: keepColumn });

    expect(report.steps.find((s) => s.step === 'metadata-promotion')!.summary).toMatchObject({ withdrawalsCarried: 1, promoted: 1 });
    expect(rows(`SELECT COUNT(*) AS n FROM sys_metadata_history WHERE id LIKE 'h_save_%' AND type = 'view'`)).toEqual([{ n: 1 }]);
    expect(duplicates()).toEqual([]);
    // The promoted row took its history with it, and still names its own snapshot.
    expect(rows(`SELECT organization_id FROM sys_metadata_history WHERE id IN ('h_org1', 'h_org2')`)).toEqual([{ organization_id: null }, { organization_id: null }]);
    expect(snapshotOf('md_org')).toEqual(['o2']);
    expect(rows(`SELECT checksum FROM sys_metadata_history WHERE id IN ('h_org1', 'h_org2') ORDER BY event_seq`).map((r) => r.checksum)).toEqual(['o1', 'o2']);
  });

  it('⭐ an item with only an organization history: no environment save, during the run or after it, lands on its numbers', async () => {
    // F2: no environment lineage at all. The package's code view is carried
    // onto (another key), the package-less organization row is promoted.
    viewWithHistory(
      `('md_org', 'org_default', 'view', 'crm_lead.intake', 'active', NULL, NULL, 2, '${withdrawn}')`,
      `('h_org1', 'org_default', 'view', 'crm_lead.intake', 1, 1, 'o1'), ('h_org2', 'org_default', 'view', 'crm_lead.intake', 2, 2, 'o2')`,
    );
    const c = storingDoor(catalog());

    await apply(c, ledger(), { views: servedViews(c), columnDrops: keepColumn });
    expect(duplicates()).toEqual([]);
    expect(snapshotOf('md_org')).toEqual(['o2']);

    // A runtime save of the promoted item, and of the package's copy, after the run.
    await c.save('view', 'crm_lead.intake', formView(false, 'Edited'), { packageId: null });
    await c.save('view', 'crm_lead.intake', formView(false, 'Edited'), { packageId: 'pkg_a' });
    expect(duplicates()).toEqual([]);
  });

  it('⭐ under a wall, a carry onto an item an organization row still holds is numbered apart by the late step', async () => {
    viewWithHistory(
      `('md_org', 'org_default', 'view', 'crm_lead.intake', 'active', NULL, NULL, 2, '${withdrawn}')`,
      `('h_org1', 'org_default', 'view', 'crm_lead.intake', 1, 1, 'o1'), ('h_org2', 'org_default', 'view', 'crm_lead.intake', 2, 2, 'o2')`,
    );
    const c = storingDoor(catalog());

    const report = await apply(c, ledger(), { posture: 'isolated', views: servedViews(c), columnDrops: keepColumn });

    expect(report.steps.find((s) => s.step === 'metadata-promotion')!.summary).toMatchObject({ withdrawalsCarried: 1, promoted: 0 });
    expect(duplicates()).toEqual([]);
    // The organization row stays its organization's, and still names its own snapshot.
    expect(rows(`SELECT organization_id FROM sys_metadata WHERE id = 'md_org'`)).toEqual([{ organization_id: 'org_default' }]);
    expect(snapshotOf('md_org')).toEqual(['o2']);
  });

  it('⭐ two organizations on one key, no environment history, one chosen and carried onto (single)', async () => {
    viewWithHistory(
      `('md_a', 'org_a', 'view', 'crm_lead.intake', 'active', NULL, NULL, 2, '${withdrawn}'),
       ('md_b', 'org_b', 'view', 'crm_lead.intake', 'active', NULL, NULL, 2, '${JSON.stringify(formView(true, 'B copy'))}')`,
      `('h_a1', 'org_a', 'view', 'crm_lead.intake', 1, 1, 'a1'), ('h_a2', 'org_a', 'view', 'crm_lead.intake', 2, 2, 'a2'),
       ('h_b1', 'org_b', 'view', 'crm_lead.intake', 1, 1, 'b1'), ('h_b2', 'org_b', 'view', 'crm_lead.intake', 2, 2, 'b2')`,
    );
    const c = storingDoor(catalog());

    const report = await apply(c, ledger(), { views: servedViews(c, []), metadataChoices: ['md_b'], columnDrops: keepColumn });

    expect(report.steps.find((s) => s.step === 'metadata-promotion')!.summary).toMatchObject({ chosen: 1, organizationRowsDeleted: 1 });
    expect(duplicates()).toEqual([]);
    // The chosen row now carries the unchosen row's withdrawal, saved above its own lineage.
    expect((JSON.parse(String(rows(`SELECT metadata FROM sys_metadata WHERE id = 'md_b'`)[0]!.metadata)) as any).config.sharing.enabled).toBe(false);
    await c.save('view', 'crm_lead.intake', formView(false, 'Edited'), { packageId: null });
    expect(duplicates()).toEqual([]);
  });

  it('⭐ N1: folding one item of an organization never lands on that organization\'s other events, on a rerun too', async () => {
    // The review's smallest case: the environment holds event 1; the
    // organization holds view A at 1-2 and view B at 3-4, both lone under single.
    viewWithHistory(
      `('md_a', 'org_default', 'view', 'view_a', 'active', NULL, NULL, 2, '{"name":"view_a"}'),
       ('md_b', 'org_default', 'view', 'view_b', 'active', NULL, NULL, 4, '{"name":"view_b"}')`,
      `('h_env', NULL, 'object', 'deal', 1, 1, 'e'),
       ('h_a1', 'org_default', 'view', 'view_a', 1, 1, 'a1'), ('h_a2', 'org_default', 'view', 'view_a', 2, 2, 'a2'),
       ('h_b1', 'org_default', 'view', 'view_b', 3, 3, 'b1'), ('h_b2', 'org_default', 'view', 'view_b', 4, 4, 'b2')`,
    );
    const c = storingDoor(catalog());
    // A crash right after the first fold's event move, then the rerun.
    await expect(apply(c, ledger(), { views: servedViews(c, []), columnDrops: keepColumn, executor: executor({ failOnceOn: /^UPDATE "sys_metadata_history" SET "organization_id" = NULL/ }) }))
      .rejects.toThrow(/killed mid-step/);
    const report = await apply(c, ledger(), { views: servedViews(c, []), columnDrops: keepColumn });
    expect(report.steps.find((s) => s.step === 'metadata-promotion')!.summary).toMatchObject({ promoted: 2 });
    expect(duplicates()).toEqual([]);
    expect(snapshotOf('md_a')).toEqual(['a2']);
    expect(snapshotOf('md_b')).toEqual(['b2']);
    expect(rows(`SELECT checksum FROM sys_metadata_history WHERE id LIKE 'h_a%' OR id LIKE 'h_b%' ORDER BY event_seq`).map((r) => r.checksum))
      .toEqual(['a1', 'a2', 'b1', 'b2']);
  });

  it('⭐ column-drops never runs unless this apply\'s history-renumber verified uniqueness environment-wide', async () => {
    // Two environment events share a number: the 17.x index never covered the
    // environment scope (NULL is distinct), and no layout can move them.
    viewWithHistory(
      `('md_env', NULL, 'object', 'deal', 'active', NULL, NULL, 1, '{"name":"deal"}')`,
      `('h_e1', NULL, 'object', 'deal', 1, 7, 'e1'), ('h_e2', NULL, 'object', 'deal', 2, 7, 'e2'),
       ('h_v1', NULL, 'object', 'account', 3, 8, 'v1'), ('h_v2', NULL, 'object', 'account', 3, 9, 'v2')`,
    );
    const drops: string[][] = [];
    const report = await apply(catalog(), ledger(), {
      columnDrops: {
        drop: async (columns) => {
          drops.push(columns.map(({ table, column }) => `${table}.${column}`));
          return columns.map(({ table, column }) => ({ table, column, outcome: 'dropped' as const }));
        },
      },
    });
    const renumber = report.steps.find((s) => s.step === 'history-renumber')!;
    expect(renumber.status).toBe('blocked');
    // The refusal names the table, each item holding the number, and the remedy.
    expect(renumber.blockers).toContainEqual(
      'sys_metadata_history: event_seq is not unique environment-wide — event_seq 7: object deal (row h_e1), object deal ' +
        '(row h_e2). The ceremony never renumbers history a database numbered twice: the organization_id column is not ' +
        'dropped until every event has its own number. Remedy: give each of these rows a number no other row holds (or ' +
        'remove the duplicate), then re-run --apply.',
    );
    expect(renumber.blockers).toContainEqual(expect.stringMatching(
      /^sys_metadata_history: a version of an item is held more than once — object account version 3 \(2 rows\)\. .*Remedy: give each of these rows a version no other row of the item holds/,
    ));
    expect(report.steps.find((s) => s.step === 'column-drops')!.status).toBe('not-reached');
    expect(drops).toEqual([]);
  });

  it('an environment save made between two runs is renumbered by the next one, the checkpoint notwithstanding', async () => {
    history();
    const l = ledger();
    await apply(catalog(), l, { posture: 'isolated', columnDrops: keepColumn });
    // Environment saves since (numbered in the environment's own scope) have
    // reached the numbers the first run gave org_a: the next one lands there.
    const [seq] = rows(`SELECT MIN(event_seq) AS n FROM sys_metadata_history WHERE organization_id = 'org_a'`);
    const [ver] = rows(`SELECT MIN(version) AS n FROM sys_metadata_history WHERE organization_id = 'org_a' AND type = 'view' AND name = 'board'`);
    db.prepare(`INSERT INTO sys_metadata_history VALUES ('h_late', NULL, 'view', 'board', ?, ?, 'late')`).run(ver!.n, seq!.n);
    expect(duplicates()).not.toEqual([]);

    const again = await apply(catalog(), l, { posture: 'isolated', columnDrops: keepColumn });

    expect(step(again)).toMatchObject({ status: 'done', summary: { organizationsShifted: 3, lineagesShifted: 2 } });
    expect(duplicates()).toEqual([]);
    expect(snapshotOf('row_a')).toEqual(['a3']);
    expect(snapshotOf('row_b')).toEqual(['b2']);
  });
});

describe('ADR-0131 D10 --apply — the grant\'s retired id column (C7b, seat answers 6162538253 Q5 A)', () => {
  const plan = () => buildOrganizationOwnershipPlan({ reader: executor(), posture: 'single', database: file });
  const grantsPlan = async () => (await plan()).tables.find((t) => t.object === 'sys_user_permission_set')!.grants!;
  const idColumn = () => rows(`SELECT name FROM pragma_table_info('sys_user_permission_set') WHERE name = 'permission_set_id'`);

  /**
   * The engine surface the organization-administrator sweep reads and writes,
   * over the fixture database. An insert keeps the columns the 17.x table has.
   */
  const sqliteQl = {
    async find(object: string, query: { where?: Record<string, unknown>; limit?: number }) {
      const where = query?.where ?? {};
      const keys = Object.keys(where);
      const text = keys.map((k) => (where[k] === null ? `"${k}" IS NULL` : `"${k}" = ?`)).join(' AND ');
      return db.prepare(`SELECT * FROM "${object}"${keys.length ? ` WHERE ${text}` : ''}${query?.limit ? ` LIMIT ${query.limit}` : ''}`)
        .all(...keys.filter((k) => where[k] !== null).map((k) => where[k] as never)) as Record<string, unknown>[];
    },
    async insert(object: string, data: Record<string, unknown>) {
      const columns = new Set(rows(`SELECT name FROM pragma_table_info('${object}')`).map((r) => String(r.name)));
      const keys = Object.keys(data).filter((k) => columns.has(k));
      db.prepare(`INSERT INTO "${object}" (${keys.map((k) => `"${k}"`).join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`)
        .run(...keys.map((k) => data[k] as never));
      return data;
    },
    async delete(object: string, options: { where?: { id?: unknown } }) {
      assertEngineDeleteDispatch(options as never);
      db.prepare(`DELETE FROM "${object}" WHERE id = ?`).run(options?.where?.id as never);
      return 1;
    },
  };

  /** A 17.x organization owner: a membership, and a legacy grant of the organization-administrator set by id. */
  function seedOrgAdminLegacyGrant(): void {
    db.exec(`
      CREATE UNIQUE INDEX uniq_grant_key ON sys_user_permission_set (user_id, permission_set, COALESCE(organization_id, '__global__'));
      CREATE TABLE sys_member (id TEXT PRIMARY KEY, organization_id TEXT, user_id TEXT, role TEXT);
      INSERT INTO sys_member VALUES ('mem_oa', 'org_default', 'usr_oa', 'owner');
      INSERT INTO sys_permission_set VALUES ('ps_oa', NULL, 'organization_admin_no_bypass', 'Org Admin', 'platform', 1, '{}', '[]');
      INSERT INTO sys_user_permission_set VALUES ('grant_oa', 'org_default', 'usr_oa', 'ps_oa', NULL);
    `);
  }
  const withOrgAdminSet = (c: ReturnType<typeof catalog>): ReturnType<typeof catalog> => {
    const resolve = c.resolve.bind(c);
    c.resolve = async (type, name) =>
      type === 'permission' && name === 'organization_admin_no_bypass' ? { definition: { name, label: 'Org Admin' } } : resolve(type, name);
    return c;
  };

  it('[Q-S3b (ii)] on a 17.x grant table carrying the declared index, the first boot\'s organization-administrator sweep writes NO row beside the owner\'s legacy grant, so --plan counts no collision and the rewrite names it and completes', async () => {
    seedOrgAdminLegacyGrant();
    const swept = await backfillOrgAdminGrants(sqliteQl, { posture: 'single' });
    expect(swept).toMatchObject({ granted: 0, skipped: 1 });
    expect(rows(`SELECT id FROM sys_user_permission_set WHERE user_id = 'usr_oa'`)).toEqual([{ id: 'grant_oa' }]);
    expect((await grantsPlan()).rewriteCollisions).toEqual([]);

    const report = await apply(withOrgAdminSet(catalog()), ledger());
    const rewrite = report.steps.find((s) => s.step === 'rewrite')!;
    expect(rewrite.status).toBe('done');
    expect(rewrite.summary.collisions).toBe(0);
    expect(rows(`SELECT id, permission_set FROM sys_user_permission_set WHERE user_id = 'usr_oa'`))
      .toEqual([{ id: 'grant_oa', permission_set: 'organization_admin_no_bypass' }]);
    // …and once named, the next sweep finds it and writes nothing either.
    expect(await backfillOrgAdminGrants(sqliteQl, { posture: 'single' })).toMatchObject({ granted: 0 });
  });

  it('the safety net — a legacy grant whose name its user already holds in its organization (written by any other writer) is not named, on a database carrying the declared index: --plan counts the pair, --apply blocks the rewrite naming both ids, deletes neither, and finishes once the operator removes one', async () => {
    db.exec(`
      CREATE UNIQUE INDEX uniq_grant_key ON sys_user_permission_set (user_id, permission_set, COALESCE(organization_id, '__global__'));
      INSERT INTO sys_user_permission_set VALUES ('grant_named', 'org_default', 'usr_1', NULL, 'member_default');
    `);
    expect((await grantsPlan()).rewriteCollisions).toEqual([{ id: 'grant_1', name: 'member_default', heldBy: 'grant_named' }]);

    const report = await apply(catalog(), ledger());
    const rewrite = report.steps.find((s) => s.step === 'rewrite')!;
    expect(rewrite.status).toBe('blocked');
    expect(rewrite.summary.collisions).toBe(1);
    expect(rewrite.blockers.join('\n')).toMatch(/1 legacy grant\(s\) would name a permission set their user already holds in the same organization \(grant_1 \(member_default, held by grant_named\)\)/);
    expect(rows(`SELECT id, permission_set FROM sys_user_permission_set WHERE user_id = 'usr_1' ORDER BY id`))
      .toEqual([{ id: 'grant_1', permission_set: null }, { id: 'grant_named', permission_set: 'member_default' }]);
    expect(writes.some((w) => /DELETE FROM "sys_user_permission_set"/.test(w))).toBe(false);
    expect(idColumn()).toHaveLength(1);

    // The operator keeps the named grant; the re-run names the rest and drops the column.
    db.exec(`DELETE FROM sys_user_permission_set WHERE id = 'grant_1'`);
    const again = await apply(catalog(), ledger());
    expect(again.steps.find((s) => s.step === 'rewrite')!.status).toBe('done');
    expect(again.steps.find((s) => s.step === 'column-drops')!.status).toBe('done');
    expect(idColumn()).toEqual([]);
  });

  it('two NAMED grants of one set to one user in one organization (an index that never built) block the id column\'s drop; neither is deleted', async () => {
    db.exec(`INSERT INTO sys_user_permission_set VALUES
      ('grant_d1', 'org_default', 'usr_7', NULL, 'member_default'),
      ('grant_d2', 'org_default', 'usr_7', NULL, 'member_default')`);
    expect((await grantsPlan()).duplicates).toEqual({ groups: 1, rows: 2 });

    const report = await apply(catalog(), ledger());
    expect(report.steps.find((s) => s.step === 'rewrite')!.status).toBe('done');
    const drops = report.steps.find((s) => s.step === 'column-drops')!;
    expect(drops.status).toBe('blocked');
    expect(drops.blockers.join('\n')).toMatch(/sys_user_permission_set\.permission_set_id is not dropped: 2 grant\(s\) in 1 group\(s\)/);
    expect(rows(`SELECT id FROM sys_user_permission_set WHERE user_id = 'usr_7' ORDER BY id`)).toEqual([{ id: 'grant_d1' }, { id: 'grant_d2' }]);
    expect(idColumn()).toHaveLength(1);
    expect(writes.some((w) => /DELETE FROM "sys_user_permission_set"/.test(w))).toBe(false);

    db.exec(`DELETE FROM sys_user_permission_set WHERE id = 'grant_d2'`);
    const again = await apply(catalog(), ledger());
    expect(again.steps.find((s) => s.step === 'column-drops')!.status).toBe('done');
    expect(idColumn()).toEqual([]);
  });

  it('a second platform-wide grant (organization NULL) is a duplicate too: GROUP BY keys NULLs together, as the index\'s NULL-safe organization key part does', async () => {
    await onlyTemplates(`('tpl_none', NULL, 'crm.none', 'en-US', 'x', 0, 'package')`, async () => {
      db.exec(`
        CREATE TABLE sys_user_permission_set (id TEXT PRIMARY KEY, organization_id TEXT, user_id TEXT,
          permission_set_id TEXT, permission_set TEXT);
        INSERT INTO sys_user_permission_set VALUES
          ('g1', NULL, 'usr_p', NULL, 'member_default'),
          ('g2', NULL, 'usr_p', NULL, 'member_default');
      `);
      const report = await apply(catalog(), ledger(), { posture: 'isolated' });
      const drops = report.steps.find((s) => s.step === 'column-drops')!;
      expect(drops.blockers.join('\n')).toMatch(/permission_set_id is not dropped: 2 grant\(s\) in 1 group\(s\)/);
    });
  });

  it('a 17.x database this release has not booted against (no permission_set column): --plan counts zero and names the boot, --apply blocks the rewrite with the same remedy', async () => {
    await onlyTemplates(`('tpl_none', NULL, 'crm.none', 'en-US', 'x', 0, 'package')`, async () => {
      db.exec(`
        CREATE TABLE sys_user_permission_set (id TEXT PRIMARY KEY, organization_id TEXT, user_id TEXT, permission_set_id TEXT);
        INSERT INTO sys_user_permission_set VALUES ('g1', NULL, 'usr_p', 'ps_x');
      `);
      const grants = await grantsPlan();
      expect(grants).toMatchObject({ nameColumn: 'absent', duplicates: { groups: 0, rows: 0 }, rewriteCollisions: [] });
      expect(grants.note).toMatch(/Boot this release once against the database/);

      const report = await apply(catalog(), ledger(), { posture: 'isolated' });
      const rewrite = report.steps.find((s) => s.step === 'rewrite')!;
      expect(rewrite.status).toBe('blocked');
      expect(rewrite.blockers.join('\n')).toMatch(/has no permission_set column.*Boot this release once against the database/);
    });
  });
});

describe('ADR-0131 D10 --apply — a name only the uncomposed security plugin declares (triage 6159130107)', () => {
  /** What the boot's auth gate answers with no auth secret and no development boot: the card's setup. */
  const NO_SECRET = { composed: false, reason: 'no-secret' } as const;
  const COMPOSITION = describeSecurityPluginComposition(NO_SECRET);
  type Step = OrganizationOwnershipApplyReport['steps'][number];
  const step = (report: OrganizationOwnershipApplyReport, name: Step['step']): Step => report.steps.find((s) => s.step === name)!;
  /** The one blocker of `s` that names `subject`. */
  const blockerOf = (s: Step, subject: string): string => {
    const found = s.blockers.filter((b) => b.includes(subject));
    expect(found, subject).toHaveLength(1);
    return found[0]!;
  };
  /** Every DELETE the run issued, beside the settings rung that moves before the rewrite. */
  const deletes = (): string[] => writes.filter((w) => /^DELETE/.test(w) && !/^DELETE FROM "sys_setting"/.test(w));
  const v17Bindings = `
    INSERT INTO sys_position VALUES
      ('pos_everyone', NULL, 'everyone', 'Everyone', 'platform', 0, 1),
      ('pos_gone', NULL, 'zz_undeclared', 'Undeclared', 'platform', 0, 1);
    INSERT INTO sys_position_permission_set VALUES
      ('bind_everyone', NULL, 'pos_everyone', 'ps_null'),
      ('bind_gone', NULL, 'pos_gone', 'ps_null');
  `;

  it('rewrite: a grant naming a shipped set gets the composition, never removal; an unknown set keeps its remedy', async () => {
    db.exec(`
      INSERT INTO sys_user_permission_set VALUES
        ('grant_admin', 'org_default', 'usr_admin', NULL, 'admin_full_access'),
        ('grant_nobypass', 'org_default', 'usr_admin', NULL, 'organization_admin_no_bypass'),
        ('grant_unknown', 'org_default', 'usr_9', NULL, 'zz_unknown_set');
    `);
    const report = await apply(catalog(), ledger(), { securityPlugin: NO_SECRET });

    const rewrite = step(report, 'rewrite');
    expect(rewrite.status).toBe('blocked');
    const unknown = blockerOf(rewrite, 'the permission set zz_unknown_set,');
    expect(unknown).not.toContain(COMPOSITION);
    expect(unknown).toMatch(/or remove the grants/);
    for (const name of ['admin_full_access', 'organization_admin_no_bypass']) {
      const blocker = blockerOf(rewrite, `the permission set ${name},`);
      expect(blocker).toContain(COMPOSITION);
      expect(blocker).not.toMatch(/\bremove\b/);
    }
    // Still refused: the gate holds and nothing is deleted.
    expect(step(report, 'mirror-deletion').status).toBe('not-reached');
    expect(deletes()).toEqual([]);
  });

  it('rewrite: a legacy grant whose set row is a shipped set gets the composition, never removal; an unknown set row keeps its remedy', async () => {
    db.exec(`
      INSERT INTO sys_permission_set VALUES
        ('ps_admin', NULL, 'admin_full_access', 'Admin', 'platform', 1, '{}', '[]'),
        ('ps_gone', NULL, 'zz_unknown_set', 'Gone', 'platform', 1, '{}', '[]');
      INSERT INTO sys_user_permission_set VALUES
        ('grant_admin_legacy', 'org_default', 'usr_admin', 'ps_admin', NULL),
        ('grant_gone_legacy', 'org_default', 'usr_9', 'ps_gone', NULL);
    `);
    const report = await apply(catalog(), ledger(), { securityPlugin: NO_SECRET });

    const rewrite = step(report, 'rewrite');
    expect(rewrite.status).toBe('blocked');
    const unknown = blockerOf(rewrite, 'grant_gone_legacy');
    expect(unknown).not.toContain(COMPOSITION);
    expect(unknown).toMatch(/name or remove each/);
    const shipped = blockerOf(rewrite, 'grant_admin_legacy');
    expect(shipped).toContain('admin_full_access');
    expect(shipped).toContain(COMPOSITION);
    expect(shipped).not.toMatch(/\bremove\b/);
    expect(step(report, 'mirror-deletion').status).toBe('not-reached');
    expect(deletes()).toEqual([]);
  });

  it('authored-conversion: the seeded everyone binding gets the composition, never removal; an undeclared position keeps its remedy', async () => {
    db.exec(v17Bindings);
    const report = await apply(catalog(), ledger(), { securityPlugin: NO_SECRET });

    const conversion = step(report, 'authored-conversion');
    expect(conversion.status).toBe('blocked');
    const undeclared = blockerOf(conversion, 'position zz_undeclared ');
    expect(undeclared).not.toContain(COMPOSITION);
    expect(undeclared).toMatch(/or remove the bindings/);
    const everyone = blockerOf(conversion, 'position everyone ');
    expect(everyone).toContain(COMPOSITION);
    expect(everyone).not.toMatch(/\bremove\b/);
    expect(step(report, 'rewrite').status).toBe('not-reached');
    expect(deletes()).toEqual([]);
  });

  it('under a wall, the rewrite gate: the everyone binding gets the composition; an undeclared position gets the walled remedy', async () => {
    db.exec(v17Bindings);
    const report = await apply(catalog(), ledger(), { posture: 'isolated', securityPlugin: NO_SECRET });

    expect(step(report, 'authored-conversion').status).toBe('done');
    const rewrite = step(report, 'rewrite');
    expect(rewrite.status).toBe('blocked');
    const undeclared = blockerOf(rewrite, 'position zz_undeclared ');
    expect(undeclared).not.toContain(COMPOSITION);
    expect(undeclared).toContain('PUT /api/v1/meta/position/zz_undeclared');
    expect(undeclared).not.toMatch(/resolve its blocker/);
    const everyone = blockerOf(rewrite, 'position everyone ');
    expect(everyone).toContain(COMPOSITION);
    expect(everyone).not.toMatch(/\bremove\b/);
    expect(deletes()).toEqual([]);
  });

  it.each([
    ['composed', { composed: true } as const],
    ['not said', undefined],
  ])('control (%s): authored-conversion keeps the remedy — the composition is the boot\'s answer, never inferred', async (_label, securityPlugin) => {
    db.exec(v17Bindings);
    const conversion = step(await apply(catalog(), ledger(), { securityPlugin }), 'authored-conversion');
    expect(blockerOf(conversion, 'position everyone ')).toMatch(/or remove the bindings/);
    expect(conversion.blockers.join('\n')).not.toContain(COMPOSITION);
  });

  it.each([
    ['composed', { composed: true } as const],
    ['not said', undefined],
  ])('control (%s), under a wall: the rewrite keeps every remedy', async (_label, securityPlugin) => {
    db.exec(`
      INSERT INTO sys_user_permission_set VALUES ('grant_admin', 'org_default', 'usr_admin', NULL, 'admin_full_access');
      ${v17Bindings}
    `);
    const rewrite = step(await apply(catalog(), ledger(), { posture: 'isolated', securityPlugin }), 'rewrite');
    expect(blockerOf(rewrite, 'the permission set admin_full_access,')).toMatch(/or remove the grants/);
    // Not the pointer. This fake catalog declares no `everyone` (a composed boot declares it, sealed), so which
    // walled remedy follows is not this control's question.
    expect(blockerOf(rewrite, 'position everyone ')).not.toMatch(/resolve its blocker/);
    expect(rewrite.blockers.join('\n')).not.toContain(COMPOSITION);
  });
});

describe('ADR-0131 D10 --apply — under a wall, the rewrite gate names the act the wall allows for a converted binding', () => {
  type Step = OrganizationOwnershipApplyReport['steps'][number];
  const step = (report: OrganizationOwnershipApplyReport, name: Step['step']): Step => report.steps.find((s) => s.step === name)!;
  /** The one blocker of `s` that names `subject`. */
  const blockerOf = (s: Step, subject: string): string => {
    const found = s.blockers.filter((b) => b.includes(subject));
    expect(found, subject).toHaveLength(1);
    return found[0]!;
  };
  /** The remedy half of a binding blocker: what follows the fact. */
  const remedyOf = (blocker: string): string => blocker.slice(blocker.indexOf('deleting them would lose a grant.'));
  /** Every DELETE the run issued, beside the settings rung that moves before the rewrite. */
  const deletes = (): string[] => writes.filter((w) => /^DELETE/.test(w) && !/^DELETE FROM "sys_setting"/.test(w));
  /** An act, a door or a re-run: what a blocker with no sanctioned act never names. */
  const ACT = /\b(Declare|Add|remove|resolve)\b|PUT |re-run/;
  const POINTER = 'The authored-conversion step carries them; resolve its blocker, then re-run.';
  /** The metadata door's lock verdict, answering `answer` and recording what it was asked. */
  const lockAnswering = (answer: Awaited<ReturnType<MetadataLockPort['verdict']>> | Error): MetadataLockPort & { asked: string[] } => {
    const asked: string[] = [];
    return {
      asked,
      async verdict(type, name, packageId) {
        asked.push(`${type}|${name}|${packageId}`);
        if (answer instanceof Error) throw answer;
        return answer;
      },
    };
  };
  /** A seeded position no catalog declares, its row binding member_default. */
  const UNDECLARED = `
    INSERT INTO sys_position VALUES ('pos_gone', NULL, 'zz_undeclared', 'Undeclared', 'platform', 0, 1);
    INSERT INTO sys_position_permission_set VALUES ('bind_gone', NULL, 'pos_gone', 'ps_null');
  `;
  /** A seeded position whose rows bind member_default and zz_extra; the catalog's definition names member_default only. */
  const DECLARED = `
    INSERT INTO sys_permission_set VALUES ('ps_extra', NULL, 'zz_extra', 'Extra', 'platform', 1, '{}', '[]');
    INSERT INTO sys_position VALUES ('pos_env', NULL, 'zz_env', 'Env', 'platform', 0, 1);
    INSERT INTO sys_position_permission_set VALUES ('bind_env_1', NULL, 'pos_env', 'ps_null'), ('bind_env_2', NULL, 'pos_env', 'ps_extra');
  `;
  /** The catalog, declaring zz_env as `definition` from the next boot on. */
  const declaring = async (definition: Record<string, unknown>): Promise<ReturnType<typeof catalog>> => {
    const c = catalog();
    await c.save('position', 'zz_env', { name: 'zz_env', label: 'Env', permissionSets: ['member_default'], ...definition });
    return c;
  };

  it('⭐ undeclared: declare it with the bound sets through ONE of its two doors — never the step that reports done; nothing is deleted', async () => {
    db.exec(UNDECLARED);
    const lock = lockAnswering({ editable: true });
    const report = await apply(catalog(), ledger(), { posture: 'isolated', lock });

    expect(step(report, 'authored-conversion')).toMatchObject({ status: 'done', blockers: [] });
    const rewrite = step(report, 'rewrite');
    expect(rewrite.status).toBe('blocked');
    const remedy = remedyOf(blockerOf(rewrite, 'position zz_undeclared '));
    expect(remedy).not.toContain(POINTER);
    expect(remedy).toContain('member_default');
    // Both doors, and one only: the deployment's code, or the metadata door as the platform administrator.
    expect(remedy).toContain('deployment\'s code');
    expect(remedy).toContain('PUT /api/v1/meta/position/zz_undeclared');
    expect(remedy).toMatch(/one door only/);
    // The organization-authored position the base fixture binds is undeclared too, and gets the same act.
    expect(remedyOf(blockerOf(rewrite, 'position sales_lead '))).toContain('PUT /api/v1/meta/position/sales_lead');
    // An undeclared name has no definition for the door to judge.
    expect(lock.asked).toEqual([]);
    // Still refused: nothing is deleted or guessed.
    expect(step(report, 'mirror-deletion').status).toBe('not-reached');
    expect(deletes()).toEqual([]);
  });

  it('⭐ declared and editable: add the missing sets through the metadata door alone, as the door itself answers', async () => {
    db.exec(DECLARED);
    const lock = lockAnswering({ editable: true });
    const report = await apply(await declaring({}), ledger(), { posture: 'group', lock });

    const remedy = remedyOf(blockerOf(step(report, 'rewrite'), 'position zz_env '));
    expect(remedy).not.toContain(POINTER);
    expect(remedy).toContain('zz_extra');
    expect(remedy).not.toContain('member_default');
    expect(remedy).toContain('PUT /api/v1/meta/position/zz_env');
    // The environment holds the name: the code door would refuse the cold boot.
    expect(remedy).not.toContain('deployment\'s code');
    expect(lock.asked).toEqual(['position|zz_env|null']);
    expect(deletes()).toEqual([]);
  });

  it.each([
    ['a package ships it (ADR-0131 D6)', { _packageId: 'com.example.vendor', _provenance: 'package' }, { editable: false, lock: 'no-overlay' }, ['com.example.vendor', 'ADR-0131 D6']],
    ['an item lock', {}, { editable: false, lock: 'full', lockReason: 'frozen by the operator' }, ['full', 'frozen by the operator']],
    ['the door\'s verdict is unreadable', {}, new Error('no metadata protocol is composed on this stack'), ['no metadata protocol is composed on this stack']],
  ] as const)('⭐ declared and not editable — %s: the fact, and no act', async (_label, definition, answer, facts) => {
    db.exec(DECLARED);
    const lock = lockAnswering(answer as Awaited<ReturnType<MetadataLockPort['verdict']>> | Error);
    const report = await apply(await declaring(definition), ledger(), { posture: 'isolated', lock });

    const blocker = blockerOf(step(report, 'rewrite'), 'position zz_env ');
    for (const fact of facts) expect(blocker).toContain(fact);
    expect(blocker).not.toMatch(ACT);
    expect(lock.asked).toEqual(['position|zz_env|null']);
    expect(deletes()).toEqual([]);
  });

  it('conflicting, under a wall: the fact, and no act', async () => {
    db.exec(`
      INSERT INTO sys_position VALUES ('pos_c1', 'org_default', 'zz_conflict', 'C', 'platform', 0, 1),
        ('pos_c2', 'org_b', 'zz_conflict', 'C', 'platform', 0, 1);
      INSERT INTO sys_position_permission_set VALUES ('bind_c1', 'org_default', 'pos_c1', 'ps_null');
    `);
    const report = await apply(catalog(), ledger(), { posture: 'isolated' });

    const blocker = blockerOf(step(report, 'rewrite'), 'Position zz_conflict:');
    expect(blocker).not.toMatch(ACT);
    expect(deletes()).toEqual([]);
  });

  it('control — single: the gate keeps the pointer at authored-conversion, and asks the door nothing', async () => {
    const c = catalog();
    const l = ledger();
    await expect(apply(c, l, { executor: executor({ failOnceOn: /^DELETE FROM "sys_capability"/ }) })).rejects.toThrow(/killed mid-step/);
    db.exec(UNDECLARED);
    const lock = lockAnswering({ editable: true });

    const resumed = await apply(c, l, { lock });

    const deletion = step(resumed, 'mirror-deletion');
    expect(deletion.status).toBe('blocked');
    expect(remedyOf(blockerOf(deletion, 'position zz_undeclared '))).toBe(`deleting them would lose a grant. ${POINTER}`);
    expect(lock.asked).toEqual([]);
  });
});

describe('ADR-0131 D10 --apply — a single-posture database that holds no organization (D3: the Default Organization exists before the first write that needs an owner)', () => {
  /** What a 17.x single-posture install whose seed ran before any organization existed left: rows, and no owner. */
  const NO_ORGANIZATION = `
    CREATE TABLE sys_organization (id TEXT PRIMARY KEY, slug TEXT, name TEXT);
    CREATE TABLE crm_event (id TEXT PRIMARY KEY, organization_id TEXT, subject TEXT);
    INSERT INTO crm_event VALUES ('ev_1', NULL, 'one'), ('ev_2', NULL, 'two'), ('ev_3', NULL, 'three');
    CREATE TABLE sys_job (id TEXT PRIMARY KEY, organization_id TEXT);
    INSERT INTO sys_job VALUES ('job_1', NULL);
  `;

  /** Run `body` against a database holding `schema` alone. */
  async function withDatabase(schema: string, body: () => Promise<void>): Promise<void> {
    const own = new Database(join(dir, 'no-organization.db'));
    own.exec(schema);
    const saved = db;
    db = own;
    try {
      await body();
    } finally {
      db = saved;
      own.close();
    }
  }

  /** The producer double: the Default Organization a single-posture boot creates, written where the plan reads it. */
  function defaultOrganizationPort(opts: { fails?: string } = {}): DefaultOrganizationPort & { calls: number } {
    const port = {
      calls: 0,
      async create() {
        port.calls++;
        if (opts.fails) throw new Error(opts.fails);
        db.prepare(`INSERT INTO sys_organization (id, slug, name) VALUES ('org_created', 'default', 'Default Organization')`).run();
        return { id: 'org_created' };
      },
    };
    return port;
  }

  it('⭐ the plan says --apply creates the Default Organization; --apply creates it before its first write and gives it every row no anchor names: nothing stays NULL, and the marker verifies', async () => {
    await withDatabase(NO_ORGANIZATION, async () => {
      const plan = await buildOrganizationOwnershipPlan({ reader: executor(), posture: 'single', database: file });
      expect(plan).toMatchObject({ organizations: 0, defaultOrganization: null, defaultOrganizationCreatedByApply: true });
      expect(plan.summary.unattributableRows).toBe(0);
      const events = plan.tables.find((t) => t.object === 'crm_event')!;
      expect(events.attribution).toEqual({ 'default-organization': 3 });
      expect(events.fateCounts).toMatchObject({ rowsToAttribute: 3, unattributableRows: 0 });
      expect(events.notNull.willReceive).toBe(true);
      expect(plan.warnings).toContainEqual(expect.stringMatching(
        /^This database holds no organization, and the tenancy posture is single: --apply creates the Default Organization \(slug 'default'\) before its first write and gives it the 3 organization-less row\(s\) no anchor names/,
      ));
      // The plan only reads.
      expect(rows('SELECT COUNT(*) AS n FROM sys_organization')).toEqual([{ n: 0 }]);

      const port = defaultOrganizationPort();
      const l = ledger();
      const report = await apply(catalog(), l, { defaultOrganization: port });

      expect(port.calls).toBe(1);
      expect(report.warnings).toEqual(plan.warnings);
      expect(report.steps[0]).toMatchObject({ step: 'attribution', status: 'done', summary: { rowsAttributed: 3 } });
      expect(rows('SELECT id, organization_id FROM crm_event ORDER BY id')).toEqual([
        { id: 'ev_1', organization_id: 'org_created' },
        { id: 'ev_2', organization_id: 'org_created' },
        { id: 'ev_3', organization_id: 'org_created' },
      ]);
      expect(tableOf(report, 'crm_event')).toMatchObject({ attributed: 3, unattributable: [], remaining: 0, after: { organizationNull: 0 } });
      expect([report.complete, report.blocking, report.advisory]).toEqual([true, 0, 0]);
      expect(l.verdicts.at(-1)).toEqual({ complete: true, blocking: 0, advisory: 0 });
    });
  });

  it('with no way to create it, the run blocks at attribution: nothing is written, nothing is checkpointed, nothing is certified', async () => {
    await withDatabase(NO_ORGANIZATION, async () => {
      const l = ledger();
      const report = await apply(catalog(), l);

      expect(report.steps[0]).toMatchObject({ step: 'attribution', status: 'blocked' });
      expect(report.steps[0]!.blockers).toEqual([
        expect.stringMatching(/^This single-posture database holds no organization, and this run has no way to create the Default Organization/),
      ]);
      expect(report.steps.slice(1).every((s) => s.status === 'not-reached')).toBe(true);
      expect([report.complete, report.blocking]).toEqual([false, 1]);
      expect(l.checkpoint?.completed.attribution).toBeUndefined();
      expect(rows('SELECT COUNT(*) AS n FROM crm_event WHERE organization_id IS NULL')).toEqual([{ n: 3 }]);
      expect(writes).toEqual([]);
    });
  });

  it('a producer that fails blocks at attribution, naming its cause; nothing is attributed', async () => {
    await withDatabase(NO_ORGANIZATION, async () => {
      const report = await apply(catalog(), ledger(), { defaultOrganization: defaultOrganizationPort({ fails: 'UNIQUE constraint failed: sys_organization.slug' }) });

      expect(report.steps[0]).toMatchObject({ step: 'attribution', status: 'blocked' });
      expect(report.steps[0]!.blockers[0]).toMatch(/^The Default Organization could not be created \(UNIQUE constraint failed: sys_organization\.slug\)/);
      expect(rows('SELECT COUNT(*) AS n FROM crm_event WHERE organization_id IS NULL')).toEqual([{ n: 3 }]);
    });
  });

  it('control — under a wall nothing is created: the rows are reported, never assigned', async () => {
    await withDatabase(NO_ORGANIZATION, async () => {
      const plan = await buildOrganizationOwnershipPlan({ reader: executor(), posture: 'isolated', database: file });
      expect(plan.defaultOrganizationCreatedByApply).toBe(false);
      expect(plan.warnings.some((w) => /creates the Default Organization/.test(w))).toBe(false);
      const port = defaultOrganizationPort();
      const report = await apply(catalog(), ledger(), { posture: 'isolated', defaultOrganization: port });

      expect(port.calls).toBe(0);
      expect(tableOf(report, 'crm_event').unattributable.map((u) => u.id)).toEqual(['ev_1', 'ev_2', 'ev_3']);
      expect(rows('SELECT COUNT(*) AS n FROM sys_organization')).toEqual([{ n: 0 }]);
    });
  });

  it('control — organizations exist and none is the Default Organization: nothing is created, the rows are reported with the reason', async () => {
    await withDatabase(`${NO_ORGANIZATION} INSERT INTO sys_organization VALUES ('org_acme', 'acme', 'Acme');`, async () => {
      const plan = await buildOrganizationOwnershipPlan({ reader: executor(), posture: 'single', database: file });
      expect(plan).toMatchObject({ organizations: 1, defaultOrganizationCreatedByApply: false });
      const port = defaultOrganizationPort();
      const report = await apply(catalog(), ledger(), { defaultOrganization: port });

      expect(port.calls).toBe(0);
      expect(tableOf(report, 'crm_event').unattributable).toEqual([
        expect.objectContaining({ id: 'ev_1', reason: expect.stringContaining("no Default Organization (slug 'default') exists to fall back to") }),
        expect.objectContaining({ id: 'ev_2' }),
        expect.objectContaining({ id: 'ev_3' }),
      ]);
    });
  });

  it('⭐ a checkpointed attribution runs again when the plan derives an owner for rows still NULL — the state an earlier run left when it found no Default Organization — and the ceremony verifies', async () => {
    await withDatabase(NO_ORGANIZATION, async () => {
      // What the release before this one left after a later boot created the
      // Default Organization: every step checkpointed (attribution at zero rows),
      // the column dropped, and the rows still NULL.
      db.exec(`INSERT INTO sys_organization VALUES ('org_boot', 'default', 'Default Organization'); ALTER TABLE sys_job DROP COLUMN organization_id;`);
      const l = ledger();
      l.checkpoint = {
        ceremony: 'ADR-0131 D10',
        inventoryDigest: inventoryDigest(),
        completed: Object.fromEntries(CEREMONY_STEPS.map((s) => [s, {
          at: '2026-10-17T00:00:00.000Z',
          summary: s === 'attribution' ? { rowsAttributed: 0, passes: 1 } : {},
        }])),
      };

      const report = await apply(catalog(), l);

      expect(report.resumedFrom).toEqual([...CEREMONY_STEPS]);
      expect(report.steps.map((s) => `${s.step}:${s.status}`)).toEqual(
        CEREMONY_STEPS.map((s) => `${s}:${s === 'attribution' ? 'done' : 'checkpointed'}`),
      );
      expect(report.steps[0]!.summary).toEqual({ rowsAttributed: 3, passes: 2 });
      expect(l.checkpoint!.completed.attribution!.summary).toEqual({ rowsAttributed: 3, passes: 2 });
      expect(rows('SELECT DISTINCT organization_id FROM crm_event')).toEqual([{ organization_id: 'org_boot' }]);
      expect([report.complete, report.blocking, report.advisory]).toEqual([true, 0, 0]);
      expect(l.verdicts.at(-1)).toEqual({ complete: true, blocking: 0, advisory: 0 });
    });
  });
});
