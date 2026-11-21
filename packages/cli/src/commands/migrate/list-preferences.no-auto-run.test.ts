// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Nothing runs `os migrate list-preferences` for you: it deletes stored rows,
 * so it stays an operator's command, and no boot, upgrade, migrate or
 * lifecycle path may import it.
 *
 * Every absence below is preceded by the SAME scanner finding a call site that
 * really exists (a dynamic import on the boot path), so an empty answer is
 * not a broken scanner. The shape is `../db/orphans.no-auto-run.test.ts`'s.
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

/** A static `from '…'` or a dynamic `import('…')` specifier. */
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

const COMMAND = 'commands/migrate/list-preferences.ts';
/** The one-shot boot family's enumeration pin RUNS every bootSchemaStack caller's modes; a test, never a boot path. */
const FAMILY_PIN = 'utils/schema-migrate.one-shot-family.integration.test.ts';

describe('the scanner works (positive controls)', () => {
  it('finds the CLI’s own boot path reaching the kernel:ready migration gate — a DYNAMIC import', () => {
    expect(importersOf('utils/artifact-boot-migration.ts').filter((p) => !isTestFile(p))).toContain('commands/serve.ts');
  });

  it('finds the family pin importing this command', () => {
    expect(importersOf(COMMAND)).toContain(FAMILY_PIN);
  });

  it('the file population itself is real', () => {
    expect(ALL_FILES.length).toBeGreaterThan(100);
    expect(ALL_FILES.map(relative)).toContain(COMMAND);
  });
});

describe('nothing on a boot, upgrade, migrate or lifecycle path invokes os migrate list-preferences', () => {
  it('no source file imports the command — its own tests and the family pin are the only readers', () => {
    const importers = importersOf(COMMAND);
    expect(importers.filter((p) => !isTestFile(p))).toEqual([]);
    expect(
      importers.every((p) => p.startsWith('commands/migrate/list-preferences.') || p === FAMILY_PIN),
      importers.join(', '),
    ).toBe(true);
  });

  it('the CLI barrel does not export it', () => {
    expect(readFileSync(join(SRC_ROOT, 'index.ts'), 'utf8')).not.toContain('list-preferences');
  });
});
