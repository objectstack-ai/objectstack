// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#11733] Nothing runs this command for you. That is the ruling, and this is
 * the pin that keeps it true.
 *
 * Ruled C on #11700 (maintainer, 2026-08-24): the platform warns and ships an
 * EXPLICIT, operator-run migration. Option A — unattended auto-migration — was
 * rejected, because it was the only route on which the platform alters a
 * customer's production table structure with nobody watching. The distance
 * between C and A is one import: a boot path that reaches for this module
 * converts the ruling without anyone re-deciding it, and it would do so
 * silently, because an auto-migration that works looks like nothing at all.
 *
 * ## A negative result is evidence only after the instrument has produced a
 * ## positive one
 *
 * "No file imports it" is also what a broken scanner says — a wrong root, a
 * changed extension, a typo in the needle. So every absence below is preceded
 * by the SAME scanner finding a call site that really exists, including one on
 * the boot path itself (`commands/serve.ts` reaching for the `kernel:ready`
 * migration gate, through a dynamic import, which is exactly the shape an
 * accidental auto-run would take).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** `packages/cli/src` — this package only; the scan never leaves it. */
const SRC_ROOT = fileURLToPath(new URL('../../', import.meta.url));

function everyTsFile(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      everyTsFile(full, out);
    } else if (entry.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

const ALL_FILES = everyTsFile(SRC_ROOT);
const relative = (file: string) => file.slice(SRC_ROOT.length).replaceAll('\\', '/');

/**
 * Files that reference `needle` in an import position — static `from '…'` or
 * dynamic `await import('…')`, both of which are how a boot path would reach
 * this command.
 */
function importersOf(needle: string): string[] {
  return ALL_FILES.filter((file) => {
    const src = readFileSync(file, 'utf8');
    return src.includes(`'${needle}'`) || src.includes(`"${needle}"`);
  }).map(relative);
}

const isTestFile = (path: string) => /\.test\.ts$/.test(path);

describe('the scanner works (positive controls) (#11733)', () => {
  it('finds the CLI’s own boot path reaching the kernel:ready migration gate — a DYNAMIC import', () => {
    // If the scanner could not see `await import('../utils/artifact-boot-migration.js')`,
    // it could not see an auto-run wired the same way, and every absence below
    // would be worthless.
    const importers = importersOf('../utils/artifact-boot-migration.js').filter((p) => !isTestFile(p));
    expect(importers).toContain('commands/serve.ts');
  });

  it('finds the many command files importing the shared schema-migrate boot', () => {
    const importers = importersOf('../../utils/schema-migrate.js').filter((p) => !isTestFile(p));
    expect(importers.length).toBeGreaterThan(3);
    expect(importers).toContain('commands/migrate/plan.ts');
  });

  it('the file population itself is real', () => {
    expect(ALL_FILES.length).toBeGreaterThan(100);
    expect(ALL_FILES.map(relative)).toContain('commands/migrate/multi-value-columns.ts');
  });
});

describe('nothing on the boot / reconcile path invokes this command (#11733)', () => {
  it('no source file imports the migration module — its own tests are the only readers', () => {
    const importers = [
      ...importersOf('./multi-value-columns.js'),
      ...importersOf('../commands/migrate/multi-value-columns.js'),
      ...importersOf('../../commands/migrate/multi-value-columns.js'),
    ];
    // Only this command's own suites. `commands/migrate/index.ts` deliberately
    // does NOT default to it either — the bare `os migrate` is the plan.
    expect(importers.filter((p) => !isTestFile(p))).toEqual([]);
    expect(importers.every((p) => p.startsWith('commands/migrate/multi-value-columns.'))).toBe(true);
  });

  it('the command never routes the remedy through the reconciler', () => {
    // `applyMigrationEntries` is where the boot gate applies drift
    // automatically. `manual_column_type_change` reaching an arm there is the
    // shape that converts C back into A, so this command must not be the thing
    // that calls it — it runs the engine's statement through the raw seam,
    // after an explicit `--apply`.
    //
    // Comments are stripped first, and that is not a convenience: the command's
    // own docstring EXPLAINS the reconciler's armlessness, and a reading that
    // counted prose went red for the documentation while a real call would have
    // looked identical. What is asserted is code.
    const code = (path: string) =>
      readFileSync(join(SRC_ROOT, path), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');

    // Positive control first: the symbol IS findable by this reading, in the
    // command whose whole job is to call it.
    expect(code('commands/migrate/apply.ts')).toContain('applyMigrationEntries');

    expect(code('commands/migrate/multi-value-columns.ts')).not.toContain('applyMigrationEntries');
  });

  it('the boot gate’s auto-apply set is not something this PR widened', () => {
    // The gate hands `category !== 'destructive'` to the driver, so this
    // finding (`needs_confirm`) DOES reach `applyMigrationEntries` at boot —
    // and is declined there, because the reconciler has no arm for the op. That
    // armless-by-design contract is `driver-sql`'s (#11720) and read-only here;
    // what this asserts is that the CLI half of the boot path is untouched by
    // this card: it still reads the category and nothing about this op.
    const gate = readFileSync(join(SRC_ROOT, 'utils/artifact-boot-migration.ts'), 'utf8');
    expect(gate).toContain("d.category === 'destructive'"); // the instrument sees the real filter
    expect(gate).not.toContain('manual_column_type_change');
    expect(gate).not.toContain('multi-value-columns');
  });
});
