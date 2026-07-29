// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The occupancy gate shared by `os migrate plan` and `os migrate apply` (#3917).
 *
 * Resolving the target and probing it happens BEFORE the migrate stack boots —
 * once the stack is up, its own pooled connections are attached to the file and
 * every probe answers "busy" about ourselves.
 */

import type { SqliteOccupancy } from './sqlite-occupancy.js';
import { probeSqliteOccupancy } from './sqlite-occupancy.js';

/**
 * Probe whatever database this invocation would open. Resolution mirrors the
 * boot exactly (same config → the same `resolveStandaloneDatabase` the stack
 * uses), so the file probed is the file migrated.
 *
 * Non-SQLite targets return `not_applicable`: Postgres and MySQL take their own
 * locks and report their own `SQLITE_BUSY` equivalents server-side, and this
 * probe has nothing to say about them.
 */
export async function probeMigrationTarget(databaseUrl?: string): Promise<SqliteOccupancy> {
  try {
    const { resolveStandaloneDatabase } = await import('@objectstack/runtime');
    const target = resolveStandaloneDatabase({
      projectRoot: process.cwd(),
      ...(databaseUrl ? { databaseUrl } : {}),
    });
    return await probeSqliteOccupancy(target.sqliteFile);
  } catch {
    // An unresolvable URL is the boot's problem to report, with its own much
    // better message. Never let the probe be the thing that fails the command.
    return { status: 'not_applicable' };
  }
}

/** The operator-facing hint attached to every refusal and warning. */
export const OCCUPANCY_HINT =
  'Stop the process using it (a running "os dev"/"os serve" is the usual one) and re-run, ' +
  'or pass --force to migrate anyway.';
