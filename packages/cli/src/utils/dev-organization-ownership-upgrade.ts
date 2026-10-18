// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { spawnSync } from 'node:child_process';
import { closeSync, copyFileSync, existsSync, mkdirSync, openSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { resolveTelemetryDbPath } from './telemetry-datasource.js';

/**
 * `os dev`'s in-place upgrade of a development database still in the v17
 * organization-ownership shape — the ADR-0131 D10 development exception
 * (ADR-0131, amendment 2026-10-16).
 *
 * ## Why `os dev` runs the ceremony, and `os serve` / `os start` never do
 *
 * The ceremony is an operator's act on a production database: its plan is
 * reviewed, a backup is the operator's to take, and the boot refuses until it
 * has run (`OrganizationOwnershipBootGuardPlugin`). A development database is
 * a local file of working data. Making a developer stop, read a plan and
 * hand-run two commands to keep working on it is the cost the ruling removed:
 * when the `serve --dev` child `os dev` spawns is refused by the guard, the
 * child says so on the IPC channel ({@link ORGANIZATION_OWNERSHIP_REQUIRED_MESSAGE})
 * and exits; `os dev` then runs the very same ceremony — plan, then apply with
 * that plan, both with `--dev` — and boots the server again.
 *
 * ## What it guarantees
 *
 *  - **A copy first.** Before the plan runs, the database file and its
 *    `telemetry` sibling (each with its `-wal` / `-shm`) are copied, closed —
 *    the refused child has exited — into
 *    `<data dir>/backups/organization-ownership-<timestamp>/`, beside which the
 *    plan, the apply report and the ceremony's log are kept.
 *  - **Only a local SQLite file.** Any other database (PostgreSQL, a remote
 *    libSQL, `:memory:`) is not copied by a file copy, so it is not upgraded
 *    here: the operator runs the ceremony, as in production.
 *  - **The ceremony's own verdict.** The server boots again only when every
 *    step finished and the post-check found nothing left (`report.complete`
 *    and `report.blocking === 0` — the marker the boot guard reads). A blocked
 *    step is printed, and so is each table the post-check holds (a row whose
 *    owner cannot be derived among them, with its remedy), with where the copy
 *    and the report are; nothing is guessed around it.
 *  - **Once per session.** A boot refused again after a finished upgrade ends
 *    `os dev`, naming the refusal; it never loops.
 *  - **The warnings.** What the ceremony decided on the developer's behalf
 *    (the plan's warnings) is printed, as the production ceremony prints it.
 */

/** The IPC message a refused `serve --dev` child sends its `os dev` parent before exiting. */
export const ORGANIZATION_OWNERSHIP_REQUIRED_MESSAGE = 'objectstack:organization-ownership-required' as const;

export interface OrganizationOwnershipRequiredMessage {
  type: typeof ORGANIZATION_OWNERSHIP_REQUIRED_MESSAGE;
  /**
   * The tables the guard found still carrying a physical organization column;
   * empty when none is left and the ceremony's marker is not verified.
   */
  tables: string[];
}

export function isOrganizationOwnershipRequiredMessage(message: unknown): message is OrganizationOwnershipRequiredMessage {
  return !!message && typeof message === 'object' && (message as { type?: unknown }).type === ORGANIZATION_OWNERSHIP_REQUIRED_MESSAGE;
}

export interface DevelopmentUpgradeInput {
  /** The CLI entry the ceremony runs through (`process.argv[1]` of `os dev`). */
  binPath: string;
  /** The database URL the dev boot opens (`OS_DATABASE_URL` of the serve child). */
  databaseUrl: string;
  /** The local SQLite file that URL opens, or `null` when it is not one. */
  sqliteFile: string | null;
  /** The serve child's environment: the ceremony boots as the server did. */
  env: NodeJS.ProcessEnv;
  cwd: string;
  now?: Date;
  /** Run one CLI invocation, its output appended to `logFile`; answers the exit code. Injected by tests. */
  run?: (args: readonly string[], logFile: string) => number;
}

export interface DevelopmentUpgradeResult {
  /** Every ceremony step finished: boot the server again. */
  ok: boolean;
  /** Where the copy, the plan, the report and the log are. */
  backupDir?: string;
  /** What to print, in order: the warnings, then the verdict. */
  warnings: string[];
  lines: string[];
}

const CEREMONY = ['migrate', 'organization-ownership', '--dev'] as const;

function runCli(input: DevelopmentUpgradeInput): (args: readonly string[], logFile: string) => number {
  return (args, logFile) => {
    const fd = openSync(logFile, 'a');
    try {
      const result = spawnSync(process.execPath, [input.binPath, ...args], {
        cwd: input.cwd,
        env: input.env,
        stdio: ['ignore', fd, fd],
      });
      return result.status ?? 1;
    } finally {
      closeSync(fd);
    }
  };
}

/** The `✗` lines the ceremony printed: its refusal, in its own words. */
function refusalLines(logFile: string): string[] {
  if (!existsSync(logFile)) return [];
  return readFileSync(logFile, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('✗'))
    .slice(-5);
}

/**
 * Upgrade the development database in place: copy it, plan, apply the plan.
 * Synchronous on purpose — nothing else may open the files while it runs.
 */
export function upgradeDevelopmentDatabase(input: DevelopmentUpgradeInput): DevelopmentUpgradeResult {
  const manual =
    'Run `os migrate organization-ownership --dev` (review its plan), then the same command with --apply ' +
    '--plan-file FILE --backup-taken, and start os dev again.';
  if (!input.sqliteFile) {
    return {
      ok: false,
      warnings: [],
      lines: [`This development database is not a local SQLite file, so os dev cannot keep a copy of it and does not upgrade it in place. ${manual}`],
    };
  }
  const sibling = resolveTelemetryDbPath({ primaryPath: input.sqliteFile, env: input.env, dev: true });
  const stamp = (input.now ?? new Date()).toISOString().replace(/[:.]/g, '-');
  const backupDir = join(dirname(input.sqliteFile), 'backups', `organization-ownership-${stamp}`);
  mkdirSync(backupDir, { recursive: true });
  for (const file of [input.sqliteFile, ...(sibling ? [sibling] : [])]) {
    for (const suffix of ['', '-wal', '-shm']) {
      if (existsSync(`${file}${suffix}`)) copyFileSync(`${file}${suffix}`, join(backupDir, `${basename(file)}${suffix}`));
    }
  }
  const run = input.run ?? runCli(input);
  const log = join(backupDir, 'ceremony.log');
  const planFile = join(backupDir, 'plan.json');
  const applyFile = join(backupDir, 'apply.json');
  const kept = `The database as it was before the upgrade is copied to ${backupDir}, beside the ceremony's log.`;

  const planned = run([...CEREMONY, '--database-url', input.databaseUrl, '--out', planFile], log);
  if (planned !== 0 || !existsSync(planFile)) {
    return {
      ok: false,
      backupDir,
      warnings: [],
      lines: [...refusalLines(log), `The upgrade plan was refused, and nothing was changed. ${kept} ${manual}`],
    };
  }
  run([...CEREMONY, '--database-url', input.databaseUrl, '--apply', '--plan-file', planFile, '--backup-taken', '--out', applyFile], log);
  if (!existsSync(applyFile)) {
    return {
      ok: false,
      backupDir,
      warnings: [],
      lines: [...refusalLines(log), `The upgrade did not run to a report. ${kept} ${manual}`],
    };
  }
  const report = JSON.parse(readFileSync(applyFile, 'utf8')) as {
    complete?: boolean;
    blocking?: number;
    warnings?: string[];
    steps?: Array<{ step: string; status: string; blockers?: string[] }>;
    tables?: Array<{ object: string; remaining?: number; held?: { rows: number; remedy: string } }>;
  };
  const warnings = report.warnings ?? [];
  const again = `\`os migrate organization-ownership --dev --apply --plan-file ${planFile} --backup-taken\``;
  if (report.complete && report.blocking !== 0) {
    // Every step finished and the post-check still holds rows: the marker is
    // not verified, so the guard would refuse the boot again.
    const holds = (report.tables ?? []).filter((t) => (t.remaining ?? 0) > 0);
    return {
      ok: false,
      backupDir,
      warnings,
      lines: [
        ...holds.map((t) =>
          t.held
            ? `${t.object}: ${t.held.rows} row(s) whose owner cannot be derived — ${t.held.remedy}`
            : `${t.object}: ${t.remaining} row(s) remaining (the report names each)`,
        ),
        `Every step finished, and the post-check found ${report.blocking ?? 'some'} row(s) left (above), so the ` +
          `database is not certified. ${kept} Resolve them, then run ${again} — or restore the copy.`,
      ],
    };
  }
  if (report.complete) {
    return {
      ok: true,
      backupDir,
      warnings,
      lines: [`Upgraded the development database to the v18 organization ownership. ${kept} The plan and the report are there too.`],
    };
  }
  const blocked = (report.steps ?? []).filter((s) => s.status === 'blocked');
  return {
    ok: false,
    backupDir,
    warnings,
    lines: [
      ...blocked.flatMap((s) => (s.blockers ?? []).map((b) => `${s.step}: ${b}`)),
      `The upgrade stopped at a blocker (above); every finished step is checkpointed. ${kept} Resolve it, then run ` +
        `${again} — or restore the copy.`,
    ],
  };
}
