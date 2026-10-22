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
import { isOrganizationOwnershipBootRefusal } from '@objectstack/runtime';
import { bootFixture } from './populate-fixture.js';
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

/** One change `os migrate plan --json` reports: the managed drift between the database and HEAD's objects. */
export interface SchemaPlanChange {
  table?: string;
  category: 'safe' | 'needs_confirm' | 'destructive';
  [key: string]: unknown;
}

/**
 * `os migrate plan --json` on `file`, the real binary in the showcase's
 * directory, as an operator reads the drift before serving a database. Writes
 * no row or table. The parsed document; throws, with the run's output, when it
 * exits non-zero.
 */
/** One tenant column `os migrate plan` lists as still nullable: its advisory, never drift (ADR-0131 D1). */
export interface NullableTenantColumn {
  table: string;
  column: string;
  database?: string;
  ceremony: 'tightens' | 'leaves';
  reason?: string;
}

export function runSchemaPlan(file: string): {
  total: number;
  changes: SchemaPlanChange[];
  pending: unknown[];
  nullableTenantColumns: { status: 'read'; remedy: string; columns: NullableTenantColumn[] } | { status: 'unreadable'; detail: string };
} {
  const plan = spawnSync(process.execPath, [CLI_BIN, 'migrate', 'plan', '--json', '--database-url', `file:${file}`], {
    cwd: SHOWCASE_DIR,
    encoding: 'utf8',
    timeout: 300_000,
    env: { ...process.env, NO_COLOR: '1' },
  });
  if (plan.status !== 0) throw new Error(`os migrate plan exited ${plan.status}:\n${plan.stdout}\n${plan.stderr}`);
  return JSON.parse(plan.stdout);
}

/**
 * A copy of the 18.0 fixture the ceremony has certified, at `dir/<tag>.db`,
 * ready to boot under the guard — reached the way an operator reaches it.
 * First a boot of this release over the 18.0 bytes: the guard refuses it, and
 * its schema sync has already created the tables this release added (the
 * sibling logs the ceremony's `sibling-moves` step moves rows into), which the
 * ceremony asks for rather than creates. Then the plan and its apply. The
 * ceremony runs on a working copy and the certified bytes are copied out, so
 * no boot ever opens the path the ceremony's process held (the stale-image
 * hazard the harness measured). Throws when the first boot is not refused by
 * the ownership guard.
 */
export async function ceremoniedFixture(dir: string, fixtureSql: string, tag: string): Promise<{ file: string; report: Record<string, unknown> }> {
  const work = join(dir, `${tag}.ceremony.db`);
  loadSqlIntoSqlite(fixtureSql, work);
  let refusal: unknown;
  try {
    const stack = await bootFixture(work);
    await stack.stop();
  } catch (error) {
    for (let e = error, depth = 0; !!e && typeof e === 'object' && depth < 8; e = (e as { cause?: unknown }).cause, depth++) {
      if (isOrganizationOwnershipBootRefusal(e)) refusal = e;
    }
    if (!refusal) throw error;
  }
  if (!refusal) throw new Error('the 18.0 fixture booted without the ceremony: the ownership guard did not refuse it');
  const report = runOwnershipCeremony(dir, work, tag);
  const file = join(dir, `${tag}.db`);
  copyFileSync(work, file);
  return { file, report };
}
