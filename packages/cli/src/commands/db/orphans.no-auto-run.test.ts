// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#24964] Nothing runs `os db orphans` for you. That is the ruling (record
 * 6303808312, constraint 1: an explicit operator command, and nothing on any
 * boot, upgrade, migrate or lifecycle-sweep path invokes it or may grow such a
 * caller), and this is the pin that keeps it true.
 *
 * The distance between an operator command and an auto-remedy is one import:
 * a boot path that reaches for this module, or for the plan it deletes from,
 * deletes business data with nobody watching. So the pin reads the source for
 * every way a caller could reach it — the command module, the plan module, and
 * the engine's cascade inspection the plan reads — and admits only this
 * command's own files and its tests.
 *
 * ## A negative result is evidence only after the instrument has produced a
 * ## positive one
 *
 * "No file imports it" is also what a broken scanner says. So every absence
 * below is preceded by the SAME scanner finding a call site that really
 * exists, including one on the boot path itself (`commands/serve.ts` reaching
 * the `kernel:ready` migration gate through a dynamic import, the shape an
 * accidental auto-run would take). The shape is `multi-value-columns.no-auto-run.test.ts`'s.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** `packages/cli/src` — this package only; the scan never leaves it. */
const SRC_ROOT = fileURLToPath(new URL('../../', import.meta.url));

function everyTsFile(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) everyTsFile(full, out);
    else if (entry.endsWith('.ts')) out.push(full);
  }
  return out;
}

const ALL_FILES = everyTsFile(SRC_ROOT);
const relative = (file: string) => file.slice(SRC_ROOT.length).replaceAll('\\', '/');
const isTestFile = (path: string) => /\.test\.ts$/.test(path);

/** A static `from '…'` or a dynamic `import('…')` specifier. Read over raw text: prose naming one is a loud false positive, never a hole. */
const IMPORT_SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*)['"]([^'"]+)['"]/g;

/** Files whose relative import RESOLVES to `target` (a path under `src/`), whatever the specifier's spelling. */
function importersOf(target: string): string[] {
  const wanted = join(SRC_ROOT, target);
  return ALL_FILES.filter((file) => {
    for (const m of readFileSync(file, 'utf8').matchAll(IMPORT_SPECIFIER)) {
      const spec = m[1]!;
      if (!spec.startsWith('.')) continue;
      if (resolve(dirname(file), spec).replace(/\.js$/, '.ts') === wanted) return true;
    }
    return false;
  }).map(relative);
}

const COMMAND = 'commands/db/orphans.ts';
const PLAN = 'utils/orphan-detail-sweep.ts';
/** The one-shot boot family's enumeration pin RUNS every bootSchemaStack caller's modes; a test, never a boot path. */
const FAMILY_PIN = 'utils/schema-migrate.one-shot-family.integration.test.ts';

describe('[#24964] the scanner works (positive controls)', () => {
  it('finds the CLI’s own boot path reaching the kernel:ready migration gate — a DYNAMIC import', () => {
    expect(importersOf('utils/artifact-boot-migration.ts').filter((p) => !isTestFile(p))).toContain('commands/serve.ts');
  });

  it('finds this command reaching its plan module, and the plan calling the cascade inspection', () => {
    expect(importersOf(PLAN)).toContain(COMMAND);
    expect(readFileSync(join(SRC_ROOT, PLAN), 'utf8')).toContain('.inspectCascadeDelete(');
  });

  it('tells this command apart from the two other `orphans.ts` commands', () => {
    // `./orphans.js` is also how `os secret orphans` and `os storage orphans` are imported by their tests.
    expect(importersOf('commands/secret/orphans.ts')).toContain('commands/secret/orphans.guards.test.ts');
    expect(importersOf(COMMAND)).not.toContain('commands/secret/orphans.guards.test.ts');
  });

  it('the file population itself is real', () => {
    expect(ALL_FILES.length).toBeGreaterThan(100);
    expect(ALL_FILES.map(relative)).toContain(COMMAND);
  });
});

describe('[#24964] nothing on a boot, upgrade, migrate or lifecycle path invokes this command', () => {
  it('no source file imports the command — its own tests and the family pin are the only readers', () => {
    const importers = importersOf(COMMAND);
    expect(importers.filter((p) => !isTestFile(p))).toEqual([]);
    expect(importers.every((p) => p.startsWith('commands/db/orphans.') || p === FAMILY_PIN), importers.join(', ')).toBe(true);
  });

  it('no source file but the command imports the plan it deletes from', () => {
    expect(importersOf(PLAN).filter((p) => !isTestFile(p))).toEqual([COMMAND]);
  });

  it('no source file but the command and its plan calls the engine’s cascade inspection', () => {
    const callers = ALL_FILES
      .filter((f) => !isTestFile(relative(f)) && readFileSync(f, 'utf8').includes('.inspectCascadeDelete('))
      .map(relative);
    expect(callers.sort()).toEqual([COMMAND, PLAN].sort());
  });
});
