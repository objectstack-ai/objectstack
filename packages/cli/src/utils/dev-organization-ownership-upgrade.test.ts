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
  type CeremonyRunEnd,
  type DevelopmentUpgradeInput,
} from './dev-organization-ownership-upgrade.js';

let dir: string;
let primary: string;
let calls: string[][];

const NOW = new Date('2026-10-16T10:00:00.000Z');
const BACKUP = (): string => join(dir, 'backups', 'organization-ownership-2026-10-16T10-00-00-000Z');

/** A fake CLI: answers `planCode`, and writes the files a real run writes. */
function fakeRun(opts: {
  planCode?: number;
  report?: Record<string, unknown> | null;
  /** What the apply prints to its log, verbatim. */
  applyLog?: string;
  /** How the apply ends, when not by its report's verdict. */
  applyEnd?: CeremonyRunEnd;
  /** What the apply leaves at its `--out` path instead of a report. */
  applyFile?: string;
  /** The plan file the plan run writes. */
  plan?: Record<string, unknown>;
}): DevelopmentUpgradeInput['run'] {
  return (args, logFile) => {
    calls.push([...args]);
    const out = args[args.indexOf('--out') + 1]!;
    if (!args.includes('--apply')) {
      writeFileSync(logFile, opts.planCode ? '  ✗ Refused (sys_mystery): sys_mystery carries organization_id …\n' : 'planned\n', { flag: 'a' });
      if (!opts.planCode) writeFileSync(out, JSON.stringify(opts.plan ?? {}));
      return { status: opts.planCode ?? 0 };
    }
    if (opts.applyLog) writeFileSync(logFile, opts.applyLog, { flag: 'a' });
    if (opts.report) writeFileSync(out, JSON.stringify(opts.report));
    if (opts.applyFile !== undefined) writeFileSync(out, opts.applyFile);
    return opts.applyEnd ?? { status: opts.report?.complete ? 0 : 1 };
  };
}

/** The exact command every failed apply ends on: the plan this upgrade wrote, the database it opened. */
const AGAIN = (): string =>
  `os migrate organization-ownership --dev --database-url file:${primary} --apply --plan-file ${join(BACKUP(), 'plan.json')} --backup-taken`;

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
    // The ceremony's own words; the `✗` glyph is the printer's, never doubled.
    expect(result.lines[0]).toBe('Refused (sys_mystery): sys_mystery carries organization_id …');
    expect(result.lines.at(-1)).toContain('nothing was changed');
    expect(result.lines.at(-1)).toContain(BACKUP());
    // The ceremony is open (18.x step 6): the way on is running it by hand.
    expect(result.lines.at(-1)).toContain('os migrate organization-ownership --dev');
    expect(result.lines.at(-1)).not.toContain('17.x');
  });

  it('a blocked step boots nothing: each blocker is printed, and how to resume', () => {
    const result = upgradeDevelopmentDatabase(input(fakeRun({
      report: { complete: false, warnings: [], steps: [{ step: 'authored-conversion', status: 'blocked', blockers: ['The authored permission x differs …'] }] },
    })));
    expect(result.ok).toBe(false);
    expect(result.lines[0]).toBe('authored-conversion: The authored permission x differs …');
    expect(result.lines.at(-1)).toContain(AGAIN());
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

  it('a database that is not a local SQLite file is not upgraded in place: the ceremony is named instead', () => {
    const result = upgradeDevelopmentDatabase(input(fakeRun({}), { sqliteFile: null, databaseUrl: 'postgres://db/app' }));
    expect(result.ok).toBe(false);
    expect(calls).toEqual([]);
    expect(existsSync(join(dir, 'backups'))).toBe(false);
    expect(result.lines[0]).toContain('os migrate organization-ownership --dev');
    expect(result.lines[0]).not.toContain('17.x');
  });

  it('⭐ a column drop that discards stamped values is said, per table, before the apply runs, and the upgrade completes', () => {
    const announced: Array<{ line: string; callsSoFar: number }> = [];
    const stamps = (rowsLosingTheirStamp: number) => ({ columnPresent: true, rowsLosingTheirStamp, rowsWithNullOrganization: 0 });
    const result = upgradeDevelopmentDatabase(input(
      fakeRun({
        plan: {
          tables: [
            { object: 'sys_flow_credential', fate: 'column-drop', fateCounts: stamps(0) },
            { object: 'sys_secret', fate: 'column-drop', fateCounts: stamps(3) },
            // Attribution keeps every stamp: nothing is discarded there.
            { object: 'sys_job', fate: 'attribution', fateCounts: stamps(9) },
          ],
        },
        report: { complete: true, blocking: 0, warnings: [], steps: [] },
      }),
      { announce: (line) => announced.push({ line, callsSoFar: calls.length }) },
    ));
    expect(result.ok).toBe(true);
    expect(announced.map((a) => a.line)).toEqual([
      `sys_secret: the plan drops its retired organization_id column, discarding 3 stamped value(s); the copy in ${BACKUP()} keeps them.`,
    ]);
    // Said after the plan and before the apply.
    expect(announced[0]!.callsSoFar).toBe(1);
    expect(calls).toHaveLength(2);
  });

  describe('an apply that writes no report still names its cause, and the exact command that carries on', () => {
    // A `FORCE_COLOR` terminal: chalk colours the refusal even into the log file.
    const COLOURED = '\u001b[31m  ✗ Refused: The plan file … was computed for the database A, and this run opened B.\u001b[39m\n';

    it('⭐ a refusal printed in colour is read in the ceremony\'s own words', () => {
      const result = upgradeDevelopmentDatabase(input(fakeRun({ applyLog: COLOURED, applyEnd: { status: 1 } })));
      expect(result.ok).toBe(false);
      expect(result.lines[0]).toBe('Refused: The plan file … was computed for the database A, and this run opened B.');
      expect(result.lines.at(-1)).toContain('The upgrade did not run to a report.');
      expect(result.lines.at(-1)).toContain(AGAIN());
      expect(result.lines.at(-1)).toContain(BACKUP());
    });

    it('an apply that stopped with no refusal of its own (an uncaught error) names how it ended and the end of its log', () => {
      const log =
        '2026-10-27T10:08:09.000Z INFO Bootstrap complete\n' +
        '  → step column-drops…\n' +
        '2026-10-27T10:08:10.000Z INFO Graceful shutdown started\n' +
        '    Error: SQLITE_ERROR: error in index idx_sys_secret_organization_id after drop column\n';
      const result = upgradeDevelopmentDatabase(input(fakeRun({ applyLog: log, applyEnd: { status: 1 } })));
      expect(result.ok).toBe(false);
      expect(result.lines[0]).toContain('exited with code 1 without a refusal of its own');
      expect(result.lines).toContain('  Error: SQLITE_ERROR: error in index idx_sys_secret_organization_id after drop column');
      expect(result.lines).toContain('  → step column-drops…');
      // The kernel's INFO narration is not the cause.
      expect(result.lines.some((l) => l.includes('Bootstrap complete'))).toBe(false);
      expect(result.lines.at(-1)).toContain(AGAIN());
    });

    it('an apply ended by a signal says so', () => {
      const result = upgradeDevelopmentDatabase(input(fakeRun({ applyEnd: { status: null, signal: 'SIGKILL' } })));
      expect(result.lines[0]).toContain('was ended by SIGKILL without a refusal of its own, and its log');
      expect(result.lines.at(-1)).toContain('The upgrade did not run to a report.');
    });

    it('a report file still holding the apply\'s reservation text is no report: the cause is printed, not "a blocker (above)"', () => {
      const reservation = JSON.stringify({ kind: 'organization-ownership-apply-reservation', reservedAt: '2026-10-27T10:08:09.000Z', note: '…' });
      const result = upgradeDevelopmentDatabase(input(fakeRun({
        applyLog: '    Error: the stack shut down mid-step\n',
        applyEnd: { status: 1 },
        applyFile: reservation,
      })));
      expect(result.ok).toBe(false);
      expect(result.lines).toContain('  Error: the stack shut down mid-step');
      expect(result.lines.at(-1)).toContain('The upgrade did not run to a report.');
      expect(result.lines.join('\n')).not.toContain('a blocker (above)');
    });

    it('a report file that does not parse is named, never thrown', () => {
      const result = upgradeDevelopmentDatabase(input(fakeRun({ applyEnd: { status: 1 }, applyFile: '{"kind":"organization-own' })));
      expect(result.ok).toBe(false);
      expect(result.lines.some((l) => l.startsWith(`Its report file ${join(BACKUP(), 'apply.json')} could not be read`))).toBe(true);
    });

    it('a blocked report that names no blocker prints the log\'s cause instead of an empty "above"', () => {
      const result = upgradeDevelopmentDatabase(input(fakeRun({
        report: { complete: false, warnings: [], steps: [{ step: 'column-drops', status: 'blocked', blockers: [] }] },
        applyLog: '  ✗ The ceremony stopped at a blocker (above). Resolve it and re-run --apply; finished steps are not repeated. Report: …\n',
      })));
      expect(result.lines[0]).toContain('The ceremony stopped at a blocker');
      expect(result.lines.at(-1)).toContain(AGAIN());
    });
  });

  it('the IPC message is recognised by its type alone', () => {
    expect(isOrganizationOwnershipRequiredMessage({ type: ORGANIZATION_OWNERSHIP_REQUIRED_MESSAGE, tables: ['sys_job'] })).toBe(true);
    expect(isOrganizationOwnershipRequiredMessage({ type: 'objectstack:listening', port: 3000 })).toBe(false);
    expect(isOrganizationOwnershipRequiredMessage(null)).toBe(false);
  });
});
