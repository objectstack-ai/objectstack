// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The ADR-0131 D10 `--apply` on a database whose packages declare sharing
 * rules, on the release that retired their seeder
 * (`DECLARED_SHARING_RULE_SEEDER_RUNS` is `false`, the inventory): declared
 * rules are read from the registry, so the copies the seeder wrote are the
 * apply's to delete (ADR-0131 C3 stage 9, ruling β on the C3 epic).
 *
 * The fixture is HotCRM's measured shape: eleven uncustomized declared rules
 * the seeder wrote organization-less (`managed_by 'package'`, `customized 0`),
 * beside an organization-authored rule and a customized seeded rule with no
 * organization whose declaration its package has since dropped (a customized
 * copy of a rule still declared is the `declared-rule-copies` step's, pinned in
 * `organization-ownership-apply.declared-rule-copies.test.ts`), plus a
 * column-drop table still carrying `organization_id` —
 * and the grants those rules materialised, each naming its rule row by id.
 *
 *  - The mirror-deletion step renames every grant naming a mirror to the
 *    rule's NAME, which the registry resolves, BEFORE it deletes exactly the
 *    eleven; the customized rule and the organization's rule, and their
 *    grants, are untouched; the verdict certifies with nothing remaining.
 *  - A database whose ceremony completed while a seeding release kept the
 *    mirrors (advisory then) has them deleted by a re-run: the step runs
 *    again on a checkpointed run while a mirror stands.
 *  - A mirror whose rule no package declares any more, or whose declaration
 *    plugin-sharing refuses to serve (the reason named), blocks with nothing
 *    written while a grant still names it (one no grant names goes); so does a
 *    run with no registry to ask. `judgeDeclaredSharingRules` asks the
 *    plugin's own translation which declared names are served.
 *  - While a release's boot still seeds them (`advisoryDepartureReason`), they
 *    stay advisory and nothing deletes them.
 *  - The rule is keyed on the table AND the departure id: a host fate
 *    supplement departure of the same id on its own table still blocks.
 *
 * The command face of the same verdict (the ledger marker, the boot guard,
 * a served boot that writes no row) is
 * `commands/migrate/organization-ownership.declared-rule-mirrors.integration.test.ts`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildOrganizationOwnershipPlan, inventoryDigest } from './organization-ownership-plan.js';
import {
  applyOrganizationOwnership,
  CEREMONY_STEPS,
  judgeDeclaredSharingRules,
  reviewedConflictsOf,
  type ApplyExecutor,
  type CeremonyCheckpoint,
  type CeremonyLedgerPort,
  type ColumnDropPort,
  type OrganizationOwnershipApplyReport,
  type TableOutcome,
} from './organization-ownership-apply.js';
import { mergeHostFateSupplement, type InventoryEntry } from './organization-ownership-inventory.js';
// Loaded at module top: the plugin's first load is paid here, not inside a clocked test.
import { translateDeclaredSharingRule } from '@objectstack/plugin-sharing';

/**
 * The seeding-release case answers as a release whose boot still seeds them
 * (`runs: true`); every other case reads the shipped constant, through the
 * real function, untouched (`runs: undefined`).
 */
const seeder = vi.hoisted(() => ({ runs: undefined as boolean | undefined }));
vi.mock('./organization-ownership-inventory.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./organization-ownership-inventory.js')>();
  return {
    ...actual,
    advisoryDepartureReason: (object: string, departureId: string) =>
      seeder.runs === undefined
        ? actual.advisoryDepartureReason(object, departureId)
        : actual.advisoryDepartureReason(object, departureId, seeder.runs),
  };
});

const MIRRORS = 11;
const CITE = 'fixture: a host-declared fate (test data, not any host\'s declaration)';

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
      writes.push(`ALTER TABLE ${table} DROP COLUMN ${column}`);
      db.exec(`ALTER TABLE "${table}" DROP COLUMN "${column}"`);
      return { table, column, outcome: 'dropped' as const };
    });
  },
};

type Verdict = { complete: boolean; blocking: number; advisory: number };

function ledger(): CeremonyLedgerPort & { verdicts: Verdict[] } {
  let stored: CeremonyCheckpoint | null = null;
  const verdicts: Verdict[] = [];
  return {
    verdicts,
    async read() {
      return stored ? (JSON.parse(JSON.stringify(stored)) as CeremonyCheckpoint) : null;
    },
    async write(checkpoint, verdict) {
      stored = JSON.parse(JSON.stringify(checkpoint)) as CeremonyCheckpoint;
      verdicts.push(verdict);
    },
  };
}

/** Every rule the fixture's packages declare: the eleven mirrors' names (the customized rule's is no longer declared). */
const DECLARED = Array.from({ length: MIRRORS }, (_, i) => `share_declared_${i + 1}`);

/**
 * Plan, then apply that reviewed plan, under `single`, as the command does.
 * `declared` are the rules plugin-sharing serves; `refused` are declared ones
 * its translation refuses, each with the reason.
 */
async function apply(
  l: ReturnType<typeof ledger>,
  inventory?: readonly InventoryEntry[],
  declared: readonly string[] | null = DECLARED,
  refused: ReadonlyArray<{ name: string; reason: string }> = [],
): Promise<OrganizationOwnershipApplyReport> {
  const database = join(dir, 'fixture.db');
  const reviewed = await buildOrganizationOwnershipPlan({
    reader: executor(),
    posture: 'single',
    database,
    ...(inventory ? { inventory } : {}),
  });
  return applyOrganizationOwnership({
    executor: executor(),
    posture: 'single',
    database,
    ...(inventory ? { inventory } : {}),
    reviewedPlan: {
      file: 'plan.json',
      generatedAt: reviewed.generatedAt,
      database,
      inventoryDigest: inventoryDigest(inventory),
      posture: 'single',
      conflicts: reviewedConflictsOf(reviewed),
    },
    catalog: { async resolve() { return undefined; } },
    ...(declared
      ? {
          declaredSharingRules: {
            async rules() {
              return [...declared.map((name) => ({ name, refused: null })), ...refused.map((r) => ({ name: r.name, refused: r.reason }))];
            },
          },
        }
      : {}),
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
    now: () => new Date('2026-10-16T00:00:00Z'),
  });
}

const rows = (sql: string): Record<string, unknown>[] => db.prepare(sql).all() as Record<string, unknown>[];
const tableOf = (report: OrganizationOwnershipApplyReport, object: string): TableOutcome =>
  report.tables.find((t) => t.object === object)!;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'os-d10-declared-rule-mirrors-'));
  db = new Database(join(dir, 'fixture.db'));
  writes = [];
  db.exec(`
    CREATE TABLE sys_organization (id TEXT PRIMARY KEY, slug TEXT);
    INSERT INTO sys_organization VALUES ('org_default', 'default');
    CREATE TABLE sys_sharing_rule (id TEXT PRIMARY KEY, organization_id TEXT, name TEXT, object_name TEXT,
      managed_by TEXT, customized INTEGER);
    INSERT INTO sys_sharing_rule VALUES
      ('rule_org', 'org_default', 'mine', 'crm_deal', 'admin', 0),
      ('rule_customized', NULL, 'share_custom', 'crm_deal', 'package', 1);
    CREATE TABLE sys_job (id TEXT PRIMARY KEY, organization_id TEXT, name TEXT);
    INSERT INTO sys_job VALUES ('job_v17', NULL, 'nightly');
    CREATE TABLE sys_record_share (id TEXT PRIMARY KEY, organization_id TEXT, object_name TEXT, record_id TEXT,
      recipient_id TEXT, source TEXT, source_id TEXT);
    INSERT INTO sys_record_share VALUES
      ('share_org', 'org_default', 'crm_deal', 'deal_1', 'alice', 'rule', 'rule_org'),
      ('share_customized', 'org_default', 'crm_deal', 'deal_2', 'bob', 'rule', 'rule_customized'),
      ('share_manual', 'org_default', 'crm_deal', 'deal_3', 'carol', 'manual', NULL);
  `);
  const mirror = db.prepare(`INSERT INTO sys_sharing_rule VALUES (?, NULL, ?, 'crm_deal', 'package', 0)`);
  const grant = db.prepare(`INSERT INTO sys_record_share VALUES (?, 'org_default', 'crm_deal', ?, 'dave', 'rule', ?)`);
  for (let i = 1; i <= MIRRORS; i++) {
    const id = `rule_declared_${String(i).padStart(2, '0')}`;
    mirror.run(id, `share_declared_${i}`);
    grant.run(`share_declared_grant_${i}`, `deal_declared_${i}`, id);
  }
});

/** Every `source = 'rule'` grant's `source_id`, and whether it resolves: a kept rule row's id, or a declared name. */
function grantSources(): Array<{ id: string; source_id: string; resolves: 'row' | 'declared' | 'nothing' }> {
  const kept = new Set(rows(`SELECT id FROM sys_sharing_rule`).map((r) => String(r.id)));
  return rows(`SELECT id, source_id FROM sys_record_share WHERE source = 'rule' ORDER BY id`).map((r) => ({
    id: String(r.id),
    source_id: String(r.source_id),
    resolves: kept.has(String(r.source_id)) ? 'row' : DECLARED.includes(String(r.source_id)) ? 'declared' : 'nothing',
  }));
}

afterEach(() => {
  seeder.runs = undefined;
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('the declared sharing-rule mirrors, once their seeder has retired', () => {
  it('renames every grant naming a mirror to its rule\'s name, then deletes exactly the eleven: blocking 0, nothing remaining', async () => {
    const l = ledger();
    const report = await apply(l);

    expect([report.complete, report.blocking, report.advisory]).toEqual([true, 0, 0]);
    expect(l.verdicts.at(-1)).toEqual({ complete: true, blocking: 0, advisory: 0 });
    const rule = tableOf(report, 'sys_sharing_rule');
    expect(rule.departures).toEqual([]);
    expect(rule.remaining).toBe(0);
    expect(rule.deleted).toBe(MIRRORS);
    expect(report.steps.find((s) => s.step === 'mirror-deletion')).toMatchObject({
      status: 'done',
      summary: { deleted: MIRRORS, grantsRenamed: MIRRORS },
    });
    expect(report.warnings).toEqual([]);
    // Exactly the eleven went; the customized rule (Default Organization now)
    // and the organization's own rule stay.
    expect(rows(`SELECT id, organization_id FROM sys_sharing_rule ORDER BY id`)).toEqual([
      { id: 'rule_customized', organization_id: 'org_default' },
      { id: 'rule_org', organization_id: 'org_default' },
    ]);
    // Every rule grant resolves: by name for a declared rule, by row id for the
    // rules that keep their row; the manual grant is untouched.
    const sources = grantSources();
    expect(sources.filter((g) => g.resolves === 'nothing')).toEqual([]);
    expect(sources.filter((g) => g.resolves === 'declared').map((g) => g.source_id).sort()).toEqual(DECLARED.slice(0, MIRRORS).sort());
    expect(sources.filter((g) => g.resolves === 'row').map((g) => [g.id, g.source_id])).toEqual([
      ['share_customized', 'rule_customized'],
      ['share_org', 'rule_org'],
    ]);
    expect(rows(`SELECT source_id FROM sys_record_share WHERE id = 'share_manual'`)).toEqual([{ source_id: null }]);
    // (c) before any deletion: every rename precedes the first rule delete.
    const firstDelete = writes.findIndex((w) => /^DELETE FROM "sys_sharing_rule"/i.test(w));
    const lastRename = writes.map((w) => /^UPDATE "sys_record_share"/i.test(w)).lastIndexOf(true);
    expect(firstDelete).toBeGreaterThan(-1);
    expect(lastRename).toBeGreaterThan(-1);
    expect(lastRename).toBeLessThan(firstDelete);
    expect(tableOf(report, 'sys_job').columnDropped).toBe(true);
  });

  it('idempotent: a second run finds no mirror and writes nothing to either table', async () => {
    const l = ledger();
    await apply(l);
    writes = [];
    const again = await apply(l);
    expect([again.complete, again.blocking, again.advisory]).toEqual([true, 0, 0]);
    expect(writes.filter((w) => /sys_sharing_rule|sys_record_share/.test(w))).toEqual([]);
  });

  it('a ceremony completed while a seeding release kept the mirrors: the re-run deletes them, the checkpoint notwithstanding', async () => {
    // The earlier release's run: every step checkpointed, the mirrors advisory and standing.
    seeder.runs = true;
    const l = ledger();
    const earlier = await apply(l);
    expect([earlier.complete, earlier.blocking, earlier.advisory]).toEqual([true, 0, MIRRORS]);
    expect(rows(`SELECT COUNT(*) AS n FROM sys_sharing_rule`)).toEqual([{ n: MIRRORS + 2 }]);
    expect(writes.filter((w) => /^DELETE FROM "sys_sharing_rule"/i.test(w))).toEqual([]);

    // This release: the same database, re-planned and applied.
    seeder.runs = undefined;
    const report = await apply(l);
    expect(report.resumedFrom).toEqual([...CEREMONY_STEPS]);
    expect([report.complete, report.blocking, report.advisory]).toEqual([true, 0, 0]);
    expect(report.steps.find((s) => s.step === 'mirror-deletion')).toMatchObject({
      status: 'done',
      summary: { deleted: MIRRORS, grantsRenamed: MIRRORS },
    });
    expect(rows(`SELECT COUNT(*) AS n FROM sys_sharing_rule`)).toEqual([{ n: 2 }]);
    expect(grantSources().filter((g) => g.resolves === 'nothing')).toEqual([]);
  });

  it('a mirror whose rule no package declares any more, and that a grant still names, blocks; nothing is renamed or deleted', async () => {
    const l = ledger();
    const report = await apply(l, undefined, DECLARED.filter((n) => n !== 'share_declared_3'));
    expect(report.complete).toBe(false);
    const step = report.steps.find((s) => s.step === 'mirror-deletion')!;
    expect(step.status).toBe('blocked');
    expect(step.blockers).toEqual([expect.stringMatching(/^1 declared-rule mirror\(s\) on sys_sharing_rule name a sharing rule no installed package declares \(share_declared_3; rows rule_declared_03\), and sys_record_share grants still name them\./)]);
    expect(rows(`SELECT COUNT(*) AS n FROM sys_sharing_rule`)).toEqual([{ n: MIRRORS + 2 }]);
    expect(writes.filter((w) => /^(UPDATE "sys_record_share"|DELETE FROM "sys_sharing_rule")/i.test(w))).toEqual([]);
  });

  it('a mirror whose rule its package declares but plugin-sharing refuses to serve, and that a grant names, blocks with the reason; nothing is renamed or deleted', async () => {
    const reason = 'its condition does not translate (unsupported-function: matches() is not supported)';
    const l = ledger();
    const report = await apply(l, undefined, DECLARED.filter((n) => n !== 'share_declared_5'), [{ name: 'share_declared_5', reason }]);
    expect(report.complete).toBe(false);
    expect(l.verdicts.at(-1)).toMatchObject({ complete: false });
    const step = report.steps.find((s) => s.step === 'mirror-deletion')!;
    expect(step.status).toBe('blocked');
    expect(step.blockers).toHaveLength(1);
    expect(step.blockers[0]).toMatch(/^1 declared-rule mirror\(s\) on sys_sharing_rule name the sharing rule share_declared_5 \(rows rule_declared_05\), which its package declares but plugin-sharing does not serve: /);
    expect(step.blockers[0]).toContain(reason);
    expect(rows(`SELECT COUNT(*) AS n FROM sys_sharing_rule`)).toEqual([{ n: MIRRORS + 2 }]);
    expect(writes.filter((w) => /^(UPDATE "sys_record_share"|DELETE FROM "sys_sharing_rule")/i.test(w))).toEqual([]);
    expect(rows(`SELECT source_id FROM sys_record_share WHERE id = 'share_declared_grant_5'`)).toEqual([{ source_id: 'rule_declared_05' }]);
  });

  it('a refused declaration no grant names is a copy of nothing that grants nothing: its mirror goes', async () => {
    db.exec(`DELETE FROM sys_record_share WHERE source_id = 'rule_declared_05'`);
    const report = await apply(ledger(), undefined, DECLARED.filter((n) => n !== 'share_declared_5'), [{ name: 'share_declared_5', reason: 'refused' }]);
    expect([report.complete, report.blocking]).toEqual([true, 0]);
    expect(rows(`SELECT COUNT(*) AS n FROM sys_sharing_rule`)).toEqual([{ n: 2 }]);
  });

  it('a mirror whose rule no package declares, and that no grant names, goes like every fate-2 mirror', async () => {
    db.exec(`DELETE FROM sys_record_share WHERE source_id = 'rule_declared_03'`);
    const report = await apply(ledger(), undefined, DECLARED.filter((n) => n !== 'share_declared_3'));
    expect([report.complete, report.blocking]).toEqual([true, 0]);
    expect(report.steps.find((s) => s.step === 'mirror-deletion')).toMatchObject({
      status: 'done',
      summary: { deleted: MIRRORS, grantsRenamed: MIRRORS - 1 },
    });
    expect(rows(`SELECT COUNT(*) AS n FROM sys_sharing_rule`)).toEqual([{ n: 2 }]);
  });

  it('a run with no registry to read the declared rules from blocks, and nothing is deleted', async () => {
    const l = ledger();
    const report = await apply(l, undefined, null);
    expect(report.complete).toBe(false);
    // The customized seeded rule stops it first: whether it is a copy of a
    // declared rule is read from the same registry.
    expect(report.steps.find((s) => s.step === 'declared-rule-copies')).toMatchObject({
      status: 'blocked',
      blockers: [expect.stringMatching(/no registry to read them from/)],
    });
    expect(report.steps.find((s) => s.step === 'mirror-deletion')).toMatchObject({ status: 'not-reached' });
    expect(rows(`SELECT COUNT(*) AS n FROM sys_sharing_rule`)).toEqual([{ n: MIRRORS + 2 }]);
  });

  it('with no customized copy to stop it first, the mirror-deletion step blocks on the missing registry itself', async () => {
    db.exec(`DELETE FROM sys_sharing_rule WHERE id = 'rule_customized'`);
    const report = await apply(ledger(), undefined, null);
    expect(report.complete).toBe(false);
    expect(report.steps.find((s) => s.step === 'declared-rule-copies')).toMatchObject({ status: 'done' });
    expect(report.steps.find((s) => s.step === 'mirror-deletion')).toMatchObject({
      status: 'blocked',
      blockers: [expect.stringMatching(/no registry to read the declared sharing rules from/)],
    });
    expect(rows(`SELECT COUNT(*) AS n FROM sys_sharing_rule`)).toEqual([{ n: MIRRORS + 1 }]);
  });

  it('an organization-stamped mirror (a walled seeder\'s copy) goes too, its grant renamed; a customized one stays', async () => {
    db.exec(`
      INSERT INTO sys_sharing_rule VALUES
        ('rule_walled_copy', 'org_default', 'share_declared_1', 'crm_deal', 'package', 0),
        ('rule_walled_custom', 'org_default', 'share_custom', 'crm_deal', 'package', 1);
      INSERT INTO sys_record_share VALUES ('share_walled', 'org_default', 'crm_deal', 'deal_w', 'erin', 'rule', 'rule_walled_copy');
    `);
    const report = await apply(ledger());
    expect([report.complete, report.blocking]).toEqual([true, 0]);
    expect(rows(`SELECT id FROM sys_sharing_rule ORDER BY id`).map((r) => r.id)).toEqual(['rule_customized', 'rule_org', 'rule_walled_custom']);
    expect(rows(`SELECT source_id FROM sys_record_share WHERE id = 'share_walled'`)).toEqual([{ source_id: 'share_declared_1' }]);
  });

  it('while a release\'s boot still seeds them, they stay advisory and nothing deletes them', async () => {
    seeder.runs = true;
    const report = await apply(ledger());
    expect([report.complete, report.blocking, report.advisory]).toEqual([true, 0, MIRRORS]);
    expect(tableOf(report, 'sys_sharing_rule').departures).toEqual([
      expect.objectContaining({ id: 'declared-rule-mirrors', rows: MIRRORS, advisory: expect.stringMatching(/own boot still writes them/) }),
    ]);
    expect(writes.filter((w) => /^(UPDATE "sys_record_share"|DELETE FROM "sys_sharing_rule")/i.test(w))).toEqual([]);
  });

  it('keyed on the table: a host-declared departure under the same id on its own table still blocks; the sharing mirrors are deleted', async () => {
    db.exec(`
      CREATE TABLE sys_fixture_rule_copy (id TEXT PRIMARY KEY, organization_id TEXT, managed_by TEXT);
      INSERT INTO sys_fixture_rule_copy VALUES ('copy_1', NULL, 'package'), ('copy_2', NULL, 'package');
    `);
    const inventory = mergeHostFateSupplement(
      [
        {
          object: 'sys_fixture_rule_copy',
          fate: 'report',
          citation: CITE,
          departures: [
            {
              id: 'declared-rule-mirrors',
              label: 'a host table\'s seeded copies, removed by a step no ceremony runs',
              citation: CITE,
              as: 'mirror-deletion',
              where: [{ column: 'managed_by', equals: 'package' }],
            },
          ],
        },
      ],
      'host-fates.json',
    );
    const l = ledger();
    const report = await apply(l, inventory);

    expect([report.complete, report.blocking, report.advisory]).toEqual([true, 2, 0]);
    expect(l.verdicts.at(-1)).toEqual({ complete: true, blocking: 2, advisory: 0 });
    const copy = tableOf(report, 'sys_fixture_rule_copy');
    expect(copy.remaining).toBe(2);
    expect(copy.departures).toEqual([{ id: 'declared-rule-mirrors', label: expect.any(String), as: 'mirror-deletion', rows: 2 }]);
    expect(tableOf(report, 'sys_sharing_rule').remaining).toBe(0);
  });
});

describe('judgeDeclaredSharingRules — which declared names plugin-sharing serves', () => {
  it('asks the plugin\'s own translation: a served rule answers null, a refused one its reason; a nameless item is left out', async () => {
    const base = { object: 'crm_deal', sharedWith: { type: 'user', value: 'alice' }, accessLevel: 'read' };
    const judged = await judgeDeclaredSharingRules([
      { ...base, name: 'served', condition: 'record.amount >= 100000' },
      { ...base, name: 'untranslatable', condition: 'size(record.tags) > 0' },
      { ...base, name: 'dotted', sharedWith: { type: 'field', value: 'owner.manager_id' }, condition: 'record.amount > 1' },
      { ...base, name: 'match_all', condition: 'true' },
      { ...base, condition: 'record.amount > 1' },
    ]);
    expect(judged.map((r) => r.name)).toEqual(['served', 'untranslatable', 'dotted', 'match_all']);
    expect(judged[0]!.refused).toBeNull();
    expect(translateDeclaredSharingRule({ ...base, name: 'served', condition: 'record.amount >= 100000' }).rule?.name).toBe('served');
    expect(judged[1]!.refused).toMatch(/^its condition does not translate \(/);
    expect(judged[2]!.refused).toMatch(/^its recipient \(sharedWith type "field"\)/);
    expect(judged[3]!.refused).toMatch(/match-all-criteria/);
  });
});
