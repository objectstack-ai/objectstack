// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { spawnSync } from 'node:child_process';
import { closeSync, copyFileSync, existsSync, mkdirSync, openSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { stripVTControlCharacters } from 'node:util';
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
 *  - **Never a stop without its cause.** An upgrade that does not finish prints
 *    what stopped it: the ceremony's own refusal (its `✗` line, read with any
 *    colour stripped, so a `FORCE_COLOR` terminal reads the same words), each
 *    blocker of a blocked step, or — when the ceremony ended with no refusal of
 *    its own (an uncaught error, a crash, a signal) — how it ended and the end
 *    of its log. Then the exact command that carries on from the plan it wrote.
 *  - **Once per session.** A boot refused again after a finished upgrade ends
 *    `os dev`, naming the refusal; it never loops.
 *  - **No silent drop.** A stale `organization_id` the plan gives the
 *    column-drop fate is a column it accounts for (the object retired it, and
 *    the plan says its values go), so the upgrade proceeds; before the apply
 *    runs, it says per table how many stamped values the drop discards (the
 *    plan's `fateCounts.rowsLosingTheirStamp`), beside the copy that keeps
 *    them. A column the plan accounts for no fate of refuses the plan, which
 *    names the command (seat ruling 6446501014).
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
  /** Prints one line before the apply runs (what the plan's column drops discard). */
  announce?: (line: string) => void;
  /** Run one CLI invocation, its output appended to `logFile`; answers how it ended. Injected by tests. */
  run?: (args: readonly string[], logFile: string) => CeremonyRunEnd;
}

/** How one ceremony run ended: its exit code, or the signal that ended it, or why it never started. */
export interface CeremonyRunEnd {
  status: number | null;
  signal?: string | null;
  /** The spawn itself failed (`spawnSync`'s `error`): the run never started. */
  error?: string;
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

function runCli(input: DevelopmentUpgradeInput): (args: readonly string[], logFile: string) => CeremonyRunEnd {
  return (args, logFile) => {
    const fd = openSync(logFile, 'a');
    try {
      const result = spawnSync(process.execPath, [input.binPath, ...args], {
        cwd: input.cwd,
        env: input.env,
        stdio: ['ignore', fd, fd],
      });
      return {
        status: result.status,
        signal: result.signal,
        ...(result.error ? { error: result.error.message } : {}),
      };
    } finally {
      closeSync(fd);
    }
  };
}

/** Where the next run's output starts in the shared log. */
function logOffset(logFile: string): number {
  return existsSync(logFile) ? statSync(logFile).size : 0;
}

/** One run's part of the ceremony's log, line by line, colour stripped and trimmed; empty lines dropped. */
function logLines(logFile: string, from: number): string[] {
  if (!existsSync(logFile)) return [];
  return readFileSync(logFile).subarray(from).toString('utf8')
    .split('\n')
    .map((line) => stripVTControlCharacters(line).trim())
    .filter((line) => line.length > 0);
}

/** The kernel's own timestamped log lines below a warning: boot narration, never the cause of a stop. */
const NARRATION = /^\d{4}-\d{2}-\d{2}T[\d:.]+Z (?:TRACE|DEBUG|INFO) /;
const TAIL_LINES = 8;

function describeEnd(end: CeremonyRunEnd): string {
  if (end.error) return `could not be started (${end.error})`;
  if (end.signal) return `was ended by ${end.signal}`;
  return `exited with code ${end.status ?? 'unknown'}`;
}

/**
 * What stopped a ceremony run, in its own words: the `✗` lines it printed (its
 * refusal; the glyph is the printer's), else how it ended and the end of its
 * log — an uncaught error or a crash prints no `✗` line of the ceremony's own.
 */
function stopCause(logFile: string, from: number, command: string, end: CeremonyRunEnd): string[] {
  const lines = logLines(logFile, from);
  const refusals = lines.filter((line) => line.startsWith('✗')).map((line) => line.slice(1).trim());
  if (refusals.length > 0) return refusals.slice(-5);
  const tail = lines.filter((line) => !NARRATION.test(line)).slice(-TAIL_LINES);
  return [
    `\`${command}\` ${describeEnd(end)} without a refusal of its own${tail.length ? '; the end of its log:' : ', and its log is empty.'}`,
    ...tail.map((line) => `  ${line}`),
  ];
}

/** The apply's `--out` file, as the dev upgrade reads it. */
type ApplyOutcome =
  | { kind: 'report'; report: ApplyReport }
  /** The file the apply reserves before its boot, still holding its reservation text: the run stopped before its report. */
  | { kind: 'reserved' }
  | { kind: 'absent' }
  | { kind: 'unreadable'; detail: string };

interface ApplyReport {
  kind?: string;
  complete?: boolean;
  blocking?: number;
  warnings?: string[];
  steps?: Array<{ step: string; status: string; blockers?: string[] }>;
  tables?: Array<{ object: string; remaining?: number; held?: { rows: number; remedy: string } }>;
}

function readApplyOutcome(applyFile: string): ApplyOutcome {
  if (!existsSync(applyFile)) return { kind: 'absent' };
  let parsed: ApplyReport;
  try {
    parsed = JSON.parse(readFileSync(applyFile, 'utf8')) as ApplyReport;
  } catch (error) {
    return { kind: 'unreadable', detail: (error as Error).message };
  }
  if (parsed?.kind === 'organization-ownership-apply-reservation') return { kind: 'reserved' };
  return { kind: 'report', report: parsed };
}

/**
 * What each column drop of the plan discards: a table given the column-drop
 * fate whose stale organization column still holds stamped values. Read from
 * the plan file the ceremony wrote; a plan it cannot read names nothing here
 * (the apply reads the same file and refuses it in its own words).
 */
function discardedStamps(planFile: string): Array<{ object: string; rows: number }> {
  let plan: { tables?: Array<{ object?: unknown; fate?: unknown; fateCounts?: { rowsLosingTheirStamp?: unknown } }> };
  try {
    plan = JSON.parse(readFileSync(planFile, 'utf8')) as typeof plan;
  } catch {
    return [];
  }
  return (plan.tables ?? []).flatMap((t) => {
    const rows = t.fateCounts?.rowsLosingTheirStamp;
    return t.fate === 'column-drop' && typeof t.object === 'string' && typeof rows === 'number' && rows > 0
      ? [{ object: t.object, rows }]
      : [];
  });
}

/**
 * Upgrade the development database in place: copy it, plan, apply the plan.
 * Synchronous on purpose — nothing else may open the files while it runs.
 */
export function upgradeDevelopmentDatabase(input: DevelopmentUpgradeInput): DevelopmentUpgradeResult {
  // The way on, when os dev does not upgrade the database itself: the ceremony,
  // run by hand (18.x step 6 opened it).
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

  const planArgs = [...CEREMONY, '--database-url', input.databaseUrl, '--out', planFile];
  const planned = run(planArgs, log);
  const applyFrom = logOffset(log);
  if (planned.status !== 0 || !existsSync(planFile)) {
    return {
      ok: false,
      backupDir,
      warnings: [],
      lines: [...stopCause(log, 0, `os ${planArgs.slice(0, 3).join(' ')}`, planned), `The upgrade plan was refused, and nothing was changed. ${kept} ${manual}`],
    };
  }
  // The exact command that carries on from the plan this upgrade wrote: the
  // apply resumes from its checkpoint, and finished steps are not repeated.
  const again =
    `\`os migrate organization-ownership --dev --database-url ${input.databaseUrl} --apply --plan-file ${planFile} --backup-taken\``;
  for (const { object, rows } of discardedStamps(planFile)) {
    input.announce?.(
      `${object}: the plan drops its retired organization_id column, discarding ${rows} stamped value(s); ` +
        `the copy in ${backupDir} keeps them.`,
    );
  }
  const applied = run([...CEREMONY, '--database-url', input.databaseUrl, '--apply', '--plan-file', planFile, '--backup-taken', '--out', applyFile], log);
  const outcome = readApplyOutcome(applyFile);
  if (outcome.kind !== 'report') {
    return {
      ok: false,
      backupDir,
      warnings: [],
      lines: [
        ...stopCause(log, applyFrom, 'os migrate organization-ownership --dev --apply', applied),
        ...(outcome.kind === 'unreadable' ? [`Its report file ${applyFile} could not be read: ${outcome.detail}.`] : []),
        `The upgrade did not run to a report. ${kept} Run ${again} to see the ceremony stop on this terminal, ` +
          'resolve what it names, and start os dev again — or restore the copy.',
      ],
    };
  }
  const { report } = outcome;
  const warnings = report.warnings ?? [];
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
  const blockers = (report.steps ?? [])
    .filter((s) => s.status === 'blocked')
    .flatMap((s) => (s.blockers ?? []).map((b) => `${s.step}: ${b}`));
  return {
    ok: false,
    backupDir,
    warnings,
    lines: [
      // A report that names no blocker still had a cause: the ceremony's log says it.
      ...(blockers.length > 0 ? blockers : stopCause(log, applyFrom, 'os migrate organization-ownership --dev --apply', applied)),
      `The upgrade stopped at a blocker (above); every finished step is checkpointed. ${kept} Resolve it, then run ` +
        `${again} — or restore the copy.`,
    ],
  };
}
