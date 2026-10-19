// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [18.x step 6] The upgrade ceremony over a copy of the 18.0 fixture, as an
// operator runs it — the plan, then the apply of that reviewed plan file,
// through the real `os migrate organization-ownership` binary in the
// showcase's directory, so it composes what the deployment serves. Shared by
// the upgrade harness and every suite that boots the 18.0 fixture under the
// ownership boot guard: the guard refuses an 18.0 database until the ceremony
// has certified it.
import { spawnSync } from 'node:child_process';
import { copyFileSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSqlIntoSqlite } from './sqlite-text-dump.js';

const SHOWCASE_DIR = fileURLToPath(new URL('../../../../../examples/app-showcase/', import.meta.url));
const CLI_ROOT = dirname(createRequire(import.meta.url).resolve('@objectstack/cli/package.json'));
const CLI_BIN = join(CLI_ROOT, 'bin', 'run.js');

/** The ceremony's sys_migration row: its marker. */
export const OWNERSHIP_MARKER = 'adr-0131-organization-ownership';

/**
 * Run the ceremony on `file`: the plan into `dir/<tag>-plan.json`, then
 * `--apply --plan-file … --backup-taken`. The apply report. Throws, with both
 * runs' output, when either exits non-zero.
 */
export function runOwnershipCeremony(dir: string, file: string, tag: string): Record<string, unknown> {
  const run = (args: string[]) => spawnSync(process.execPath, [
    CLI_BIN, 'migrate', 'organization-ownership', '--database-url', `file:${file}`, ...args,
  ], { cwd: SHOWCASE_DIR, encoding: 'utf8', timeout: 300_000, env: { ...process.env, NO_COLOR: '1' } });
  const planFile = join(dir, `${tag}-plan.json`);
  const plan = run(['--out', planFile]);
  if (plan.status !== 0) throw new Error(`the ceremony's plan exited ${plan.status}:\n${plan.stdout}\n${plan.stderr}`);
  const reportFile = join(dir, `${tag}-apply.json`);
  const apply = run(['--apply', '--plan-file', planFile, '--backup-taken', '--out', reportFile, '--json']);
  if (apply.status !== 0) throw new Error(`the ceremony's apply exited ${apply.status}:\n${apply.stdout}\n${apply.stderr}`);
  return JSON.parse(readFileSync(reportFile, 'utf8')) as Record<string, unknown>;
}

/**
 * A copy of the 18.0 fixture the ceremony has certified, at `dir/<tag>.db`,
 * ready to boot under the guard. The ceremony runs on a working copy and the
 * certified bytes are copied out, so no boot ever opens the path the
 * ceremony's process held (the stale-image hazard the harness measured).
 */
export function ceremoniedFixture(dir: string, fixtureSql: string, tag: string): { file: string; report: Record<string, unknown> } {
  const work = join(dir, `${tag}.ceremony.db`);
  loadSqlIntoSqlite(fixtureSql, work);
  const report = runOwnershipCeremony(dir, work, tag);
  const file = join(dir, `${tag}.db`);
  copyFileSync(work, file);
  return { file, report };
}
