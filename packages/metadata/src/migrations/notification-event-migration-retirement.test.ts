// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#16194] The ADR-0030 notification cut-over is RETIRED — the runner half.
 *
 * `migrateSysNotificationToEvent` had no way to be run. Every non-CHANGELOG
 * reference to it was the definition, its own usage docblock, one barrel line,
 * one comment in `./driver-exec.ts`, the id's docblock in `@objectstack/spec`
 * and three test files — zero production callers in `packages` / `apps` /
 * `examples`, with the instrument live in the same run (the symbol was in 17
 * files). Neither of the two ways to give it a caller was accepted: an
 * `os migrate notification-event` sub-command is a permanent operator surface
 * for a migration with no measured demand, and a boot-time invoker is an
 * unattended data rewrite.
 *
 * ⭐ **This file proves the removal is a REMOVAL, not a rename.** The module is
 * gone from disk, no file in this package imports it under any spelling, and
 * the barrel exports nothing named for it — while the sibling migrations that
 * share the directory and the barrel are asserted present in the same cases.
 * A probe that finds nothing everywhere is a dead probe, so every negative
 * below is paired with the positive that shows it looks in the right place.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, it, expect } from 'vitest';

// ⭐ Imported at MODULE TOP on purpose. This barrel pulls in the whole
// migrations surface, and paying that load inside a clocked `it()` made the
// case time out at 5s under a loaded box — a flake that reads as a retirement
// regression. A clocked window measures behaviour, never loading (AGENTS.md).
import * as migrationsBarrel from './index.js';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Every `.ts` file under this package's `src/`, walked once. */
function sourceFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.ts')) out.push(full);
    }
  };
  walk(root);
  return out;
}

const SRC_ROOT = join(HERE, '..');

describe('[#16194] migrateSysNotificationToEvent is retired from @objectstack/metadata', () => {
  it('the module is gone from disk; its directory siblings are not', () => {
    expect(
      existsSync(join(HERE, 'migrate-sys-notification-to-event.ts')),
      'the runner is back on disk — re-read #16194 before restoring it',
    ).toBe(false);
    expect(existsSync(join(HERE, 'migrate-sys-notification-to-event.test.ts'))).toBe(false);

    // Anti-vacuity: the probe looks in the right directory.
    expect(existsSync(join(HERE, 'migrate-project-id-to-environment-id.ts'))).toBe(true);
    expect(existsSync(join(HERE, 'drop-projection-tables.ts'))).toBe(true);
    expect(existsSync(join(HERE, 'driver-exec.ts'))).toBe(true);
  });

  it('nothing in this package imports or re-exports the module, under any spelling', () => {
    const importers: string[] = [];
    const survivors: string[] = [];
    for (const file of sourceFiles(SRC_ROOT)) {
      const src = readFileSync(file, 'utf-8');
      if (/(?:import|export)[^;]*['"][^'"]*migrate-sys-notification-to-event(?:\.js)?['"]/.test(src)) {
        importers.push(relative(SRC_ROOT, file));
      }
      if (/(?:import|export)[^;]*['"][^'"]*migrate-project-id-to-environment-id(?:\.js)?['"]/.test(src)) {
        survivors.push(relative(SRC_ROOT, file));
      }
    }
    expect(importers, 'a resurrected import means the retirement is being undone').toEqual([]);
    // The same regex shape, on a sibling that IS imported: proves the scan runs.
    expect(survivors.length, 'the import scan found nothing at all — it is dead').toBeGreaterThan(0);
  });

  it('the barrel exports no name derived from it, and still exports its siblings', () => {
    const names = Object.keys(migrationsBarrel);

    for (const gone of [
      'migrateSysNotificationToEvent',
      'SysNotificationMigrationResult',
      'SysNotificationMigrationOptions',
      'SysNotificationMigrationReceipt',
    ]) {
      expect(names, `the barrel re-exports ${gone}`).not.toContain(gone);
    }
    // No rename either: nothing named for the cut-over survives on the barrel.
    expect(names.filter((n) => /SysNotification|NotificationToEvent/i.test(n))).toEqual([]);

    // The control — the barrel is really loaded and really has exports.
    expect(names).toContain('migrateProjectIdToEnvironmentId');
    expect(names).toContain('migrateEnvIdToProjectId');
    expect(names).toContain('dropProjectionTables');
  });

  it('the barrel carries a tombstone, so the next author meets the ruling', () => {
    const barrel = readFileSync(join(HERE, 'index.ts'), 'utf-8');
    expect(barrel).toMatch(/TOMBSTONE/);
    expect(barrel).toMatch(/migrateSysNotificationToEvent/);
    expect(barrel).toMatch(/files-to-references/);
  });
});
