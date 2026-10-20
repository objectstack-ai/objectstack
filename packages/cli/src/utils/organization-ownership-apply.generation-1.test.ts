// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The four ceremony steps of ownership shape generation 1 (18.x steps 5a–5d),
 * pinned in the ceremony's own terms, over an 18.0-SHAPED database: every row
 * stamped with the Default Organization (line fact F3), so each step must
 * select by shape — a NULL selector would find nothing here.
 *
 *  - `sibling-moves` (5b): the global settings-audit rows and identity mail
 *    (reset by `related_object`, the magic link by its sign-in link) move id
 *    for id into their siblings, the organization invitation stays; a queued
 *    18.0 mail job is pointed at the sibling first; the activity rows about a
 *    moved row name its new object.
 *  - `declared-webhooks` (5a): a pristine copy is deleted, its deliveries
 *    re-sourced to `declared:NAME` and its orphaned cipher deleted; a
 *    switch-only edit becomes the declaration's activation row; any other
 *    edit becomes a clone under a new name, the declaration switched off, its
 *    deliveries still its own; a seeded row no package declares stays.
 *  - `declared-rule-copies` (5c, 9c): a customized copy and an admin rule under
 *    a declared name become clones, the declaration switched off, their grants
 *    kept; the stale name-keyed grant goes.
 *  - `not-null` (5d, 8e): every cleared table receives NOT NULL through the
 *    port, after the column drops.
 *
 * Plus: the checkpoint carries this release's shape generation; a walled
 * posture blocks on a customized copy rather than switch a declaration off
 * for every organization; every step is idempotent.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ORGANIZATION_OWNERSHIP_SHAPE_GENERATION } from '@objectstack/spec/system';
import { declaredWebhookRefId } from '@objectstack/plugin-webhooks';
import { buildOrganizationOwnershipPlan, inventoryDigest } from './organization-ownership-plan.js';
import {
  applyOrganizationOwnership,
  CEREMONY_STEPS,
  DECLARED_WEBHOOK_REF_PREFIX,
  reviewedConflictsOf,
  type ApplyExecutor,
  type CeremonyCheckpoint,
  type CeremonyLedgerPort,
  type ColumnDropPort,
  type NotNullColumn,
  type NotNullPort,
  type OrganizationOwnershipApplyReport,
} from './organization-ownership-apply.js';

const ORG = 'org_default';

let dir: string;
let db: Database.Database;
let writes: string[];
let tightened: NotNullColumn[];

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
      writes.push(`ALTER TABLE ${table} DROP COLUMN ${column}`);
      db.exec(`ALTER TABLE "${table}" DROP COLUMN "${column}"`);
      return { table, column, outcome: 'dropped' as const };
    });
  },
};

/** The schema door: records what it was asked, and answers `applied`. */
const notNull: NotNullPort = {
  async apply(columns) {
    tightened.push(...columns);
    return columns.map((c) => ({ ...c, outcome: 'applied' as const }));
  },
};

function ledger(): CeremonyLedgerPort & { stored: () => CeremonyCheckpoint | null } {
  let stored: CeremonyCheckpoint | null = null;
  return {
    stored: () => stored,
    async read() {
      return stored ? (JSON.parse(JSON.stringify(stored)) as CeremonyCheckpoint) : null;
    },
    async write(checkpoint) {
      stored = JSON.parse(JSON.stringify(checkpoint)) as CeremonyCheckpoint;
    },
  };
}

/** The webhooks and sharing rules the fixture's packages declare. */
const WEBHOOKS = [
  { name: 'task_changed', packageId: 'com.example.app' },
  { name: 'deal_won', packageId: 'com.example.app' },
  { name: 'lead_scored', packageId: 'com.example.app' },
];
const RULES = ['share_custom', 'share_collides'];

async function apply(
  l: ReturnType<typeof ledger> = ledger(),
  opts: { posture?: string; webhooks?: boolean; rules?: boolean; notNull?: boolean } = {},
): Promise<OrganizationOwnershipApplyReport> {
  const posture = opts.posture ?? 'single';
  const database = join(dir, 'fixture.db');
  const reviewed = await buildOrganizationOwnershipPlan({ reader: executor(), posture, database });
  return applyOrganizationOwnership({
    executor: executor(),
    posture,
    database,
    reviewedPlan: {
      file: 'plan.json',
      generatedAt: reviewed.generatedAt,
      database,
      inventoryDigest: inventoryDigest(),
      posture,
      conflicts: reviewedConflictsOf(reviewed),
    },
    catalog: { async resolve() { return undefined; } },
    ...(opts.webhooks === false ? {} : { declaredWebhooks: { async list() { return WEBHOOKS; } } }),
    ...(opts.rules === false
      ? {}
      : { declaredSharingRules: { async rules() { return RULES.map((name) => ({ name, refused: null, packageId: 'com.example.app' })); } } }),
    ...(opts.notNull === false ? {} : { notNull }),
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

const rows = (sql: string): Record<string, unknown>[] => db.prepare(sql).all() as Record<string, unknown>[];
const step = (report: OrganizationOwnershipApplyReport, name: string) => report.steps.find((s) => s.step === name)!;

/** A seeded 18.0 webhook row: the seeder's mapping of the envelope, plus the snapshot it wrote. */
function seededWebhook(id: string, name: string, over: Record<string, unknown> = {}): void {
  const envelope = { name, label: `Label ${name}`, object: 'crm_deal', triggers: ['create', 'update'], url: `https://hooks.example/${name}`, method: 'POST', timeoutMs: 30000, isActive: false, _provenance: 'package', _packageId: 'com.example.app', _packageVersion: '1.0.0' };
  const row: Record<string, unknown> = {
    id, organization_id: ORG, name, label: envelope.label, object_name: 'crm_deal', triggers: JSON.stringify(envelope.triggers),
    url: envelope.url, method: 'post', description: null, active: 0, definition_json: JSON.stringify(envelope),
    headers_secret: null, signing_secret: null, managed_by: 'package', customized: 0, ...over,
  };
  const keys = Object.keys(row);
  db.prepare(`INSERT INTO sys_webhook (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`).run(...keys.map((k) => row[k]));
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'os-d10-generation-1-'));
  db = new Database(join(dir, 'fixture.db'));
  writes = [];
  tightened = [];
  db.exec(`
    CREATE TABLE sys_organization (id TEXT PRIMARY KEY, slug TEXT);
    INSERT INTO sys_organization VALUES ('${ORG}', 'default');
    CREATE TABLE crm_deal (id TEXT PRIMARY KEY, organization_id TEXT, name TEXT);
    INSERT INTO crm_deal VALUES ('deal_1', '${ORG}', 'Acme');
    CREATE TABLE sys_user (id TEXT PRIMARY KEY, email TEXT);
    INSERT INTO sys_user VALUES ('usr_b', 'b@example.test');

    CREATE TABLE sys_metadata_activation (id TEXT PRIMARY KEY, created_at TEXT, updated_at TEXT, metadata_type TEXT,
      name TEXT, package_id TEXT, active INTEGER DEFAULT 1, UNIQUE (metadata_type, name));

    CREATE TABLE sys_setting_audit (id TEXT PRIMARY KEY, created_at TEXT, organization_id TEXT, namespace TEXT, key TEXT,
      scope TEXT, action TEXT, new_hash TEXT, encrypted INTEGER);
    INSERT INTO sys_setting_audit VALUES
      ('aud_tenant', '2026-10-19T12:00:00Z', '${ORG}', 'branding', 'workspace_name', 'tenant', 'set', 'fnv32:1', 0),
      ('aud_global', '2026-10-19T12:00:01Z', '${ORG}', 'auth', 'api_key_policy', 'global', 'set', 'fnv32:2', 0),
      ('aud_global_enc', '2026-10-19T12:00:02Z', '${ORG}', 'ai', 'gateway_api_key', 'global', 'set', 'hmac:3', 1);
    CREATE TABLE sys_platform_setting_audit (id TEXT PRIMARY KEY, created_at TEXT, namespace TEXT, key TEXT, scope TEXT,
      action TEXT, new_hash TEXT, encrypted INTEGER);

    CREATE TABLE sys_email (id TEXT PRIMARY KEY, organization_id TEXT, subject TEXT, body_text TEXT, body_html TEXT,
      status TEXT, related_object TEXT, related_id TEXT);
    INSERT INTO sys_email VALUES
      ('mail_invite', '${ORG}', 'You are invited to Default Organization', 'join', NULL, 'sent', 'sys_invitation', 'inv_1'),
      ('mail_reset', '${ORG}', 'Reset your password', 'reset at /reset-password/tok', NULL, 'sent', 'sys_user', 'usr_b'),
      ('mail_magic', '${ORG}', 'Your sign-in link', 'open https://app.example/api/auth/magic-link/verify?token=abc', NULL, 'pending', NULL, NULL),
      ('mail_app', '${ORG}', 'Your invoice', 'see attached', NULL, 'sent', 'crm_deal', 'deal_1');
    CREATE TABLE sys_identity_email (id TEXT PRIMARY KEY, subject TEXT, body_text TEXT, body_html TEXT, status TEXT,
      related_object TEXT, related_id TEXT);

    CREATE TABLE sys_job_queue (id TEXT PRIMARY KEY, queue TEXT, idempotency_key TEXT, payload_json TEXT, metadata_json TEXT, status TEXT);
    INSERT INTO sys_job_queue VALUES
      ('job_magic', 'email.send.async', 'sys_email:mail_magic', '{"rowId":"mail_magic"}', '{"object":"sys_email","rowId":"mail_magic"}', 'pending'),
      ('job_app', 'email.send.async', 'sys_email:mail_app', '{"rowId":"mail_app"}', '{"object":"sys_email","rowId":"mail_app"}', 'pending'),
      ('job_done', 'email.attachment.reclaim', 'sys_email_attachments:mail_reset', '{"rowId":"mail_reset","keys":[]}', NULL, 'completed');

    CREATE TABLE sys_activity (id TEXT PRIMARY KEY, organization_id TEXT, object_name TEXT, record_id TEXT, summary TEXT);
    INSERT INTO sys_activity VALUES
      ('act_reset', '${ORG}', 'sys_email', 'mail_reset', 'mail sent'),
      ('act_audit', '${ORG}', 'sys_setting_audit', 'aud_global', 'setting changed'),
      ('act_deal', '${ORG}', 'crm_deal', 'deal_1', 'deal updated');

    CREATE TABLE sys_webhook (id TEXT PRIMARY KEY, organization_id TEXT, name TEXT, label TEXT, object_name TEXT,
      triggers TEXT, url TEXT, method TEXT, description TEXT, active INTEGER, definition_json TEXT, headers_secret TEXT,
      signing_secret TEXT, managed_by TEXT, customized INTEGER);
    CREATE TABLE sys_http_delivery (id TEXT PRIMARY KEY, organization_id TEXT, source TEXT, ref_id TEXT, dedup_key TEXT, status TEXT);
    CREATE TABLE sys_secret (id TEXT PRIMARY KEY, organization_id TEXT, namespace TEXT, key TEXT, ciphertext TEXT);
    INSERT INTO sys_secret VALUES
      ('sec_pristine', '${ORG}', 'sys_webhook', 'signing_secret', 'c1'),
      ('sec_setting', '${ORG}', 'ai', 'gateway_api_key', 'c2');

    CREATE TABLE sys_sharing_rule (id TEXT PRIMARY KEY, organization_id TEXT, name TEXT, object_name TEXT, managed_by TEXT, customized INTEGER);
    INSERT INTO sys_sharing_rule VALUES
      ('rule_custom', '${ORG}', 'share_custom', 'crm_deal', 'package', 1),
      ('rule_collides', '${ORG}', 'share_collides', 'crm_deal', 'admin', 0),
      ('rule_own', '${ORG}', 'mine', 'crm_deal', 'admin', 0);
    CREATE TABLE sys_record_share (id TEXT PRIMARY KEY, organization_id TEXT, object_name TEXT, record_id TEXT, source TEXT, source_id TEXT);
    INSERT INTO sys_record_share VALUES
      ('grant_custom', '${ORG}', 'crm_deal', 'deal_1', 'rule', 'rule_custom'),
      ('grant_stale', '${ORG}', 'crm_deal', 'deal_1', 'rule', 'share_custom'),
      ('grant_own', '${ORG}', 'crm_deal', 'deal_1', 'rule', 'rule_own');
  `);
  // A pristine copy holding a cipher; a switch-only edit; an edit beyond the switch; a row no package declares.
  seededWebhook('whk_pristine', 'task_changed', { signing_secret: 'secret:sec_pristine' });
  seededWebhook('whk_switched', 'deal_won', { active: 1, customized: 1 });
  seededWebhook('whk_edited', 'lead_scored', { url: 'https://hooks.example/admin-moved-it', customized: 1 });
  seededWebhook('whk_orphan', 'retired_hook');
  db.exec(`
    INSERT INTO sys_http_delivery VALUES
      ('dlv_1', '${ORG}', 'webhook', 'whk_pristine', 'whk_pristine:e1', 'pending'),
      ('dlv_2', '${ORG}', 'webhook', 'whk_switched', 'whk_switched:e2', 'failed'),
      ('dlv_3', '${ORG}', 'webhook', 'whk_edited', 'whk_edited:e3', 'sent'),
      ('dlv_4', '${ORG}', 'webhook', 'whk_orphan', 'whk_orphan:e4', 'sent');
  `);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('ownership shape generation 1 — the ceremony steps an 18.0 database owes', () => {
  it('runs every step in order, certifies, and records this release\'s shape generation in the checkpoint', async () => {
    const l = ledger();
    const report = await apply(l);
    expect(report.steps.map((s) => [s.step, s.status])).toEqual(CEREMONY_STEPS.map((s) => [s, 'done']));
    expect([report.complete, report.blocking]).toEqual([true, 0]);
    expect(l.stored()?.shapeGeneration).toBe(ORGANIZATION_OWNERSHIP_SHAPE_GENERATION);
    // The new steps run where the ruling put them: the moves after settings-move, NOT NULL after the column drops.
    expect(CEREMONY_STEPS.indexOf('sibling-moves')).toBe(CEREMONY_STEPS.indexOf('settings-move') + 1);
    expect(CEREMONY_STEPS.at(-1)).toBe('not-null');
    expect(CEREMONY_STEPS.indexOf('not-null')).toBeGreaterThan(CEREMONY_STEPS.indexOf('column-drops'));
  });

  it('5b ⭐ the global audit rows and identity mail move id for id — selected by shape, though stamped — and the rest stays', async () => {
    const report = await apply();
    expect(step(report, 'sibling-moves')).toMatchObject({ status: 'done', summary: { moved: 4, alreadyMoved: 0, jobsRewritten: 1, activityRepointed: 2 } });
    expect(rows(`SELECT id FROM sys_platform_setting_audit ORDER BY id`).map((r) => r.id)).toEqual(['aud_global', 'aud_global_enc']);
    expect(rows(`SELECT id FROM sys_setting_audit`).map((r) => r.id)).toEqual(['aud_tenant']);
    expect(rows(`SELECT encrypted, new_hash FROM sys_platform_setting_audit WHERE id = 'aud_global_enc'`)).toEqual([{ encrypted: 1, new_hash: 'hmac:3' }]);
    // Identity mail: the reset (a person's mail) and the magic link (its sign-in link); the invitation and app mail stay.
    expect(rows(`SELECT id FROM sys_identity_email ORDER BY id`).map((r) => r.id)).toEqual(['mail_magic', 'mail_reset']);
    expect(rows(`SELECT id FROM sys_email ORDER BY id`).map((r) => r.id)).toEqual(['mail_app', 'mail_invite']);
  });

  it('5b ⭐ a queued 18.0 mail job names its moved row\'s sibling; jobs of mail that stays, and finished jobs, are untouched', async () => {
    await apply();
    expect(rows(`SELECT id, idempotency_key, payload_json, metadata_json FROM sys_job_queue ORDER BY id`)).toEqual([
      { id: 'job_app', idempotency_key: 'sys_email:mail_app', payload_json: '{"rowId":"mail_app"}', metadata_json: '{"object":"sys_email","rowId":"mail_app"}' },
      { id: 'job_done', idempotency_key: 'sys_email_attachments:mail_reset', payload_json: '{"rowId":"mail_reset","keys":[]}', metadata_json: null },
      {
        id: 'job_magic',
        idempotency_key: 'sys_identity_email:mail_magic',
        payload_json: '{"rowId":"mail_magic","object":"sys_identity_email"}',
        metadata_json: '{"object":"sys_identity_email","rowId":"mail_magic"}',
      },
    ]);
    // The job is rewritten BEFORE its row leaves sys_email.
    const job = writes.findIndex((w) => /^UPDATE "sys_job_queue"/.test(w));
    const leave = writes.findIndex((w) => /^DELETE FROM "sys_email"/.test(w));
    expect(job).toBeGreaterThan(-1);
    expect(job).toBeLessThan(leave);
  });

  it('5b the activity rows about a moved row name its new object; the rest of the timeline is untouched', async () => {
    await apply();
    expect(rows(`SELECT id, object_name FROM sys_activity ORDER BY id`)).toEqual([
      { id: 'act_audit', object_name: 'sys_platform_setting_audit' },
      { id: 'act_deal', object_name: 'crm_deal' },
      { id: 'act_reset', object_name: 'sys_identity_email' },
    ]);
  });

  it('5b a run stopped between copy and delete finishes: the row already in the sibling is not copied twice', async () => {
    db.exec(`INSERT INTO sys_identity_email (id, subject, status, related_object, related_id) VALUES ('mail_reset', 'Reset your password', 'sent', 'sys_user', 'usr_b')`);
    const report = await apply();
    expect(step(report, 'sibling-moves')).toMatchObject({ status: 'done', summary: { moved: 3, alreadyMoved: 1 } });
    expect(rows(`SELECT COUNT(*) AS n FROM sys_identity_email WHERE id = 'mail_reset'`)).toEqual([{ n: 1 }]);
    expect(rows(`SELECT COUNT(*) AS n FROM sys_email WHERE id = 'mail_reset'`)).toEqual([{ n: 0 }]);
  });

  it('5a ⭐ a pristine copy is deleted once its deliveries name the declaration, and its orphaned cipher goes with it', async () => {
    const report = await apply();
    expect(step(report, 'declared-webhooks')).toMatchObject({
      status: 'done',
      summary: { mirrorsDeleted: 2, activationRows: 2, clones: 1, deliveriesResourced: 2, secretsDeleted: 1, undeclaredKept: 1 },
    });
    expect(rows(`SELECT ref_id FROM sys_http_delivery WHERE id = 'dlv_1'`)).toEqual([{ ref_id: declaredWebhookRefId('task_changed') }]);
    expect(rows(`SELECT id FROM sys_secret ORDER BY id`).map((r) => r.id)).toEqual(['sec_setting']);
    // The re-source precedes the delete.
    const resource = writes.findIndex((w) => /^UPDATE "sys_http_delivery"/.test(w));
    const remove = writes.findIndex((w) => /^DELETE FROM "sys_webhook"/.test(w));
    expect(resource).toBeGreaterThan(-1);
    expect(resource).toBeLessThan(remove);
  });

  it('5a ⭐ a switch-only edit becomes the declaration\'s activation row; an edit beyond it a clone, the declaration switched off', async () => {
    await apply();
    expect(rows(`SELECT metadata_type, name, package_id, active FROM sys_metadata_activation ORDER BY name`)).toEqual([
      { metadata_type: 'webhook', name: 'deal_won', package_id: 'com.example.app', active: 1 },
      { metadata_type: 'webhook', name: 'lead_scored', package_id: 'com.example.app', active: 0 },
      { metadata_type: 'sharing_rule', name: 'share_collides', package_id: 'com.example.app', active: 0 },
      { metadata_type: 'sharing_rule', name: 'share_custom', package_id: 'com.example.app', active: 0 },
    ].sort((a, b) => a.name.localeCompare(b.name)));
    expect(rows(`SELECT ref_id FROM sys_http_delivery WHERE id = 'dlv_2'`)).toEqual([{ ref_id: 'declared:deal_won' }]);
    // The clone keeps its id, its edit and its deliveries; it is the administrator's own now.
    const [clone] = rows(`SELECT id, name, url, managed_by, customized, definition_json FROM sys_webhook WHERE id = 'whk_edited'`);
    expect(clone).toMatchObject({ name: 'lead_scored_custom', url: 'https://hooks.example/admin-moved-it', managed_by: 'admin', customized: 0 });
    const def = JSON.parse(String(clone!.definition_json));
    expect(def.name).toBe('lead_scored_custom');
    expect(def).not.toHaveProperty('_packageId');
    expect(rows(`SELECT ref_id FROM sys_http_delivery WHERE id = 'dlv_3'`)).toEqual([{ ref_id: 'whk_edited' }]);
    // A seeded row no package declares stays as it is, dispatching as itself.
    expect(rows(`SELECT id, name, managed_by FROM sys_webhook ORDER BY id`)).toEqual([
      { id: 'whk_edited', name: 'lead_scored_custom', managed_by: 'admin' },
      { id: 'whk_orphan', name: 'retired_hook', managed_by: 'package' },
    ]);
    expect(rows(`SELECT ref_id FROM sys_http_delivery WHERE id = 'dlv_4'`)).toEqual([{ ref_id: 'whk_orphan' }]);
  });

  it('5a the delivery spelling is plugin-webhooks\' own', () => {
    expect(`${DECLARED_WEBHOOK_REF_PREFIX}x`).toBe(declaredWebhookRefId('x'));
  });

  it('5a a credential on a customized copy is never read as switch-only: it is cloned, which keeps it', async () => {
    db.exec(`UPDATE sys_webhook SET headers_secret = 'secret:sec_setting' WHERE id = 'whk_switched'`);
    await apply();
    expect(rows(`SELECT name, headers_secret FROM sys_webhook WHERE id = 'whk_switched'`)).toEqual([{ name: 'deal_won_custom', headers_secret: 'secret:sec_setting' }]);
    expect(rows(`SELECT id FROM sys_secret WHERE id = 'sec_setting'`)).toHaveLength(1);
  });

  it('5c ⭐ a customized copy and an admin rule under a declared name become clones, their grants theirs; the stale name grant goes', async () => {
    const report = await apply();
    expect(step(report, 'declared-rule-copies')).toMatchObject({ status: 'done', summary: { clones: 2, activationRows: 2, grantsRemoved: 1 } });
    expect(rows(`SELECT id, name, managed_by, customized FROM sys_sharing_rule ORDER BY id`)).toEqual([
      { id: 'rule_collides', name: 'share_collides_custom', managed_by: 'admin', customized: 0 },
      { id: 'rule_custom', name: 'share_custom_custom', managed_by: 'admin', customized: 0 },
      { id: 'rule_own', name: 'mine', managed_by: 'admin', customized: 0 },
    ]);
    expect(rows(`SELECT id, source_id FROM sys_record_share ORDER BY id`)).toEqual([
      { id: 'grant_custom', source_id: 'rule_custom' },
      { id: 'grant_own', source_id: 'rule_own' },
    ]);
  });

  it('5c/5a under a wall a customized copy blocks, named, and nothing of it is written: the switch is deployment-wide', async () => {
    db.exec(`DELETE FROM sys_webhook WHERE customized = 1`);
    const report = await apply(ledger(), { posture: 'isolated' });
    expect(report.complete).toBe(false);
    const rules = step(report, 'declared-rule-copies');
    expect(rules.status).toBe('blocked');
    expect(rules.blockers[0]).toMatch(/Under the isolated posture the declaration's switch is deployment-wide/);
    expect(rows(`SELECT name FROM sys_sharing_rule WHERE id = 'rule_custom'`)).toEqual([{ name: 'share_custom' }]);
    expect(rows(`SELECT COUNT(*) AS n FROM sys_metadata_activation WHERE metadata_type = 'sharing_rule'`)).toEqual([{ n: 0 }]);
  });

  it('5a without the declared webhooks to read, a seeded row blocks the step and nothing is deleted', async () => {
    const report = await apply(ledger(), { webhooks: false });
    expect(step(report, 'declared-webhooks')).toMatchObject({ status: 'blocked', blockers: [expect.stringMatching(/no registry to read them from/)] });
    expect(rows(`SELECT COUNT(*) AS n FROM sys_webhook`)).toEqual([{ n: 4 }]);
  });

  it('5d ⭐ after the column drops, every cleared table is handed to the schema door for NOT NULL — the moved-from tables among them', async () => {
    const report = await apply();
    expect(step(report, 'not-null').status).toBe('done');
    const tables = tightened.map((c) => c.table).sort();
    for (const table of ['crm_deal', 'sys_email', 'sys_setting_audit', 'sys_http_delivery', 'sys_webhook', 'sys_sharing_rule', 'sys_record_share', 'sys_activity']) {
      expect(tables, table).toContain(table);
    }
    expect(tightened.every((c) => c.column === 'organization_id')).toBe(true);
    // A column-drop table is never handed to it: its column is gone.
    expect(tables).not.toContain('sys_secret');
    expect(rows(`SELECT name FROM pragma_table_info('sys_secret') WHERE name = 'organization_id'`)).toEqual([]);
    // The door is asked only once the drops have run.
    expect(writes.some((w) => /^ALTER TABLE sys_secret DROP COLUMN organization_id$/.test(w))).toBe(true);
  });

  it('5d a table that still holds a NULL organization row is not handed to the door; the cleared ones are', async () => {
    // Under a wall nothing owns an orphan row; the copies a wall would block on are gone.
    db.exec(`
      INSERT INTO crm_deal VALUES ('deal_orphan', NULL, 'nobody');
      DELETE FROM sys_webhook WHERE customized = 1;
      DELETE FROM sys_sharing_rule WHERE id IN ('rule_custom', 'rule_collides');
    `);
    const report = await apply(ledger(), { posture: 'isolated' });
    expect(step(report, 'not-null').status).toBe('done');
    expect(tightened.map((c) => c.table)).not.toContain('crm_deal');
    expect(tightened.map((c) => c.table)).toContain('sys_email');
  });

  it('5d a run with no schema door applies nothing and says so; it does not block', async () => {
    const report = await apply(ledger(), { notNull: false });
    expect(step(report, 'not-null')).toMatchObject({ status: 'done', notes: [expect.stringMatching(/no schema door to apply it: nothing was applied/)] });
  });

  it('every new step is idempotent: a second run on a fresh checkpoint writes nothing to the tables they own', async () => {
    await apply();
    writes = [];
    const again = await apply();
    expect([again.complete, again.blocking]).toEqual([true, 0]);
    expect(writes.filter((w) => /sys_webhook|sys_http_delivery|sys_identity_email|sys_platform_setting_audit|sys_job_queue|sys_sharing_rule|sys_metadata_activation/.test(w))).toEqual([]);
  });
});
