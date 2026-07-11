// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { Command, Flags } from '@oclif/core';
import { statSync, existsSync } from 'node:fs';
import chalk from 'chalk';
import { printError } from '../../utils/format.js';
import { resolveDefaultDevDbUrl } from '../dev.js';
import { resolveTelemetryDbPath } from '../../utils/telemetry-datasource.js';

/**
 * `os db clean` — one-time SQLite space reclamation (ADR-0057 §3.4).
 *
 * The platform LifecycleService reclaims space incrementally
 * (`auto_vacuum=INCREMENTAL` + `PRAGMA incremental_vacuum` after sweeps) —
 * but `auto_vacuum` only changes the page layout of a FRESH database, so a
 * file created before the ADR-0057 default stays pinned at its high-water
 * mark until one full `VACUUM` rebuilds it. This command runs exactly that:
 * set the pragma, `VACUUM`, report the reclaimed bytes. Non-destructive —
 * every row survives; only free pages are returned to the OS.
 */
export default class DbClean extends Command {
  static override description =
    'Reclaim SQLite free space (one-time VACUUM) so legacy files adopt auto_vacuum=INCREMENTAL — ADR-0057 §3.4';

  static override examples = [
    '$ os db clean',
    '$ os db clean --database file:./.objectstack/data/dev.db',
  ];

  static override flags = {
    database: Flags.string({
      char: 'd',
      description: 'SQLite database URL/path (defaults to $OS_DATABASE_URL, then the per-project dev DB)',
      env: 'OS_DATABASE_URL',
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(DbClean);

    const raw =
      flags.database?.trim() ||
      resolveDefaultDevDbUrl({ env: process.env, cwd: process.cwd() }) ||
      '';
    const primary = raw.replace(/^file:/i, '').replace(/^sqlite:/i, '');

    if (!primary || primary === ':memory:' || primary.startsWith(':')) {
      printError('No file-backed SQLite database to clean (in-memory databases reclaim nothing).');
      this.exit(1);
      return;
    }
    if (!/\.(db|sqlite3|sqlite)$/i.test(primary) && !existsSync(primary)) {
      printError(`Not a SQLite database path: ${primary}`);
      this.exit(1);
      return;
    }

    // Clean the telemetry sibling too when one exists (ADR-0057 §3.6).
    const telemetrySibling = resolveTelemetryDbPath({ primaryPath: primary, env: process.env, dev: true });
    const targets = [primary, telemetrySibling].filter(
      (p): p is string => !!p && existsSync(p),
    );
    if (targets.length === 0) {
      printError(`Database file not found: ${primary}`);
      this.exit(1);
      return;
    }

    const { resolveSqliteDriver } = await import('@objectstack/service-datasource');

    let failed = false;
    for (const file of targets) {
      const before = statSync(file).size;
      try {
        const resolved = await resolveSqliteDriver({
          filename: file,
          dev: true, // allow the wasm step-down; memory fallback is rejected below
          warn: (m) => console.warn(chalk.yellow(m)),
        });
        if (resolved.engine === 'memory') {
          throw new Error('no SQLite engine available (native and wasm both failed to load)');
        }
        // Order matters: the pragma must be set BEFORE the VACUUM so the
        // rebuilt file carries auto_vacuum=INCREMENTAL from here on.
        await resolved.driver.execute('PRAGMA auto_vacuum = INCREMENTAL');
        await resolved.driver.execute('VACUUM');
        await resolved.driver.disconnect();

        const after = statSync(file).size;
        const saved = before - after;
        const fmt = (n: number) => `${(n / 1024 / 1024).toFixed(2)} MB`;
        console.log(
          `${chalk.green('✓')} ${file}: ${fmt(before)} → ${fmt(after)}` +
            (saved > 0 ? chalk.dim(` (reclaimed ${fmt(saved)})`) : chalk.dim(' (already compact)')),
        );
      } catch (error: any) {
        failed = true;
        printError(`VACUUM failed for ${file}: ${error?.message ?? error}`);
      }
    }
    if (failed) this.exit(1);
  }
}
