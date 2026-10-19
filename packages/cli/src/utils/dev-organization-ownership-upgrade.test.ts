// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os dev`'s in-place upgrade of a v17-shape development database (ADR-0131
 * D10, development exception): a copy of the database and its `telemetry`
 * sibling first, then the ceremony's plan and the apply of that plan, both
 * with `--dev`; the server boots again only on the ceremony's own verdict:
 * "complete" with nothing left (`blocking` 0), the marker the boot guard reads.
 * The CLI runs are faked here — what they write is the ceremony's contract
 * (`--out` files), and the real runs are the command's own suites.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  isOrganizationOwnershipRequiredMessage,
  ORGANIZATION_OWNERSHIP_REQUIRED_MESSAGE,
  upgradeDevelopmentDatabase,
  type DevelopmentUpgradeInput,
} from './dev-organization-ownership-upgrade.js';

let dir: string;
let primary: string;
let calls: string[][];

const NOW = new Date('2026-10-16T10:00:00.000Z');
const BACKUP = (): string => join(dir, 'backups', 'organization-ownership-2026-10-16T10-00-00-000Z');

/** A fake CLI: answers `planCode`, and writes the files a real run writes. */
function fakeRun(opts: { planCode?: number; report?: Record<string, unknown> | null }): DevelopmentUpgradeInput['run'] {
  return (args, logFile) => {
    calls.push([...args]);
    const out = args[args.indexOf('--out') + 1]!;
    if (!args.includes('--apply')) {
      writeFileSync(logFile, opts.planCode ? '  ✗ Refused (sys_mystery): sys_mystery carries organization_id …\n' : 'planned\n', { flag: 'a' });
      if (!opts.planCode) writeFileSync(out, '{}');
      return opts.planCode ?? 0;
    }
    if (opts.report) writeFileSync(out, JSON.stringify(opts.report));
    return opts.report?.complete ? 0 : 1;
  };
}

const input = (run: DevelopmentUpgradeInput['run'], over: Partial<DevelopmentUpgradeInput> = {}): DevelopmentUpgradeInput => ({
  binPath: '/cli/bin/run.js',
  databaseUrl: `file:${primary}`,
  sqliteFile: primary,
  env: {},
  cwd: dir,
  now: NOW,
  run,
  ...over,
});

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'os-dev-upgrade-'));
  primary = join(dir, 'dev.db');
  writeFileSync(primary, 'primary');
  writeFileSync(`${primary}-wal`, 'primary-wal');
  writeFileSync(join(dir, 'dev.telemetry.db'), 'telemetry');
  calls = [];
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('os dev — the in-place upgrade of a v17-shape development database', () => {
  it('⭐ copies the database and its telemetry sibling, plans, applies that plan, and boots on "complete"', () => {
    const result = upgradeDevelopmentDatabase(input(fakeRun({ report: { complete: true, blocking: 0, warnings: ['8 shipped permission set row(s) …'], steps: [] } })));
    expect(result).toMatchObject({ ok: true, backupDir: BACKUP(), warnings: ['8 shipped permission set row(s) …'] });
    expect(readdirSync(BACKUP()).sort()).toEqual(['apply.json', 'ceremony.log', 'dev.db', 'dev.db-wal', 'dev.telemetry.db', 'plan.json']);
    expect(readFileSync(join(BACKUP(), 'dev.db-wal'), 'utf8')).toBe('primary-wal');
    expect(calls).toEqual([
      ['migrate', 'organization-ownership', '--dev', '--database-url', `file:${primary}`, '--out', join(BACKUP(), 'plan.json')],
      ['migrate', 'organization-ownership', '--dev', '--database-url', `file:${primary}`, '--apply', '--plan-file', join(BACKUP(), 'plan.json'), '--backup-taken', '--out', join(BACKUP(), 'apply.json')],
    ]);
  });

  it('a refused plan changes nothing and boots nothing: its refusal is printed, with the copy\'s location', () => {
    const result = upgradeDevelopmentDatabase(input(fakeRun({ planCode: 1 })));
    expect(result.ok).toBe(false);
    expect(calls).toHaveLength(1);
    expect(result.lines[0]).toContain('✗ Refused (sys_mystery)');
    expect(result.lines.at(-1)).toContain('nothing was changed');
    expect(result.lines.at(-1)).toContain(BACKUP());
    expect(result.lines.at(-1)).toContain('17.x release');
    expect(result.lines.at(-1)).not.toContain('--plan-file');
  });

  it('a blocked step boots nothing: each blocker is printed, and how to resume', () => {
    const result = upgradeDevelopmentDatabase(input(fakeRun({
      report: { complete: false, warnings: [], steps: [{ step: 'authored-conversion', status: 'blocked', blockers: ['The authored permission x differs …'] }] },
    })));
    expect(result.ok).toBe(false);
    expect(result.lines[0]).toBe('authored-conversion: The authored permission x differs …');
    expect(result.lines.at(-1)).toContain(`--apply --plan-file ${join(BACKUP(), 'plan.json')} --backup-taken`);
  });

  it('every step finished but the post-check holds an unattributable row: boots nothing, names the table, count and remedy', () => {
    const remedy = 'assign each row its organization …, or delete it by hand, then re-run --apply';
    const result = upgradeDevelopmentDatabase(input(fakeRun({
      report: {
        complete: true,
        blocking: 2,
        warnings: [],
        steps: [{ step: 'attribution', status: 'done', blockers: [] }],
        tables: [
          { object: 'sys_saved_report', remaining: 2, held: { rows: 2, remedy } },
          { object: 'sys_job', remaining: 0 },
        ],
      },
    })));
    expect(result.ok).toBe(false);
    expect(result.lines[0]).toBe(`sys_saved_report: 2 row(s) whose owner cannot be derived — ${remedy}`);
    expect(result.lines).toHaveLength(2);
    expect(result.lines.at(-1)).toContain('is not certified');
    expect(result.lines.at(-1)).toContain(`--apply --plan-file ${join(BACKUP(), 'plan.json')} --backup-taken`);
  });

  it('a database that is not a local SQLite file is not upgraded in place: 18.0\'s position is named instead', () => {
    const result = upgradeDevelopmentDatabase(input(fakeRun({}), { sqliteFile: null, databaseUrl: 'postgres://db/app' }));
    expect(result.ok).toBe(false);
    expect(calls).toEqual([]);
    expect(existsSync(join(dir, 'backups'))).toBe(false);
    expect(result.lines[0]).toContain('17.x release');
    // 18.0 refuses `os migrate organization-ownership` on every database: the way on names no step of it.
    expect(result.lines[0]).not.toContain('os migrate organization-ownership');
    expect(result.lines[0]).not.toContain('--plan-file');
  });

  it('the IPC message is recognised by its type alone', () => {
    expect(isOrganizationOwnershipRequiredMessage({ type: ORGANIZATION_OWNERSHIP_REQUIRED_MESSAGE, tables: ['sys_job'] })).toBe(true);
    expect(isOrganizationOwnershipRequiredMessage({ type: 'objectstack:listening', port: 3000 })).toBe(false);
    expect(isOrganizationOwnershipRequiredMessage(null)).toBe(false);
  });
});
