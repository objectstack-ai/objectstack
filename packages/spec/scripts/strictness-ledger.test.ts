// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Regression cover for the #4001 strictness-ledger gate's coverage walk.
 *
 * The gate protects the ledger from going stale. Nothing protected the gate,
 * and it shipped with a one-level-deep directory listing that hid
 * `data/driver/` — nine authorable sites — while reporting "no undeclared
 * schema files". The failure was invisible for the same reason the silent key
 * strip this whole campaign is about is invisible: a success signal covering an
 * omission.
 *
 * So these tests assert the gate can see the thing it once could not, rather
 * than only that it passes today. A green check that has never been shown to go
 * red proves nothing.
 *
 * MEASURED, and the reason this file is not redundant with the gate: with the
 * `data/driver/` rows now present in the ledger, reverting the walk to
 * non-recursive leaves `check:strictness-ledger` **passing** — a one-level walk
 * finds nothing missing once nothing nested is missing. The gate cannot detect
 * its own regression. These tests can, and did (`descends into subdirectories`
 * is the one that fails). Deleting them silently restores the blind spot.
 */

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { describe, expect, it } from 'vitest';

import { countSites, listSchemaFiles } from './lib/strictness-ledger';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const SPEC = path.resolve(HERE, '..');
const SRC = path.join(SPEC, 'src');
const LEDGER = path.resolve(SPEC, '../../docs/audits/2026-07-unknown-key-strictness-ledger.md');

/** The directories the ledger triages file-by-file. */
const TRIAGED = ['ui', 'data', 'automation', 'security', 'studio'] as const;

describe('strictness-ledger coverage walk', () => {
  it('descends into subdirectories', () => {
    const files = listSchemaFiles(path.join(SRC, 'data'));

    // The exact surface the non-recursive walk hid. If this ever fails because
    // the files moved, re-point it at whatever nested schema exists — do not
    // delete it, or the blind spot comes back unobserved.
    expect(files).toContain('driver/postgres.zod.ts');
    expect(files).toContain('driver/mongo.zod.ts');
    expect(files).toContain('driver/memory.zod.ts');
  });

  it('returns paths relative to the directory, as the ledger declares them', () => {
    for (const file of listSchemaFiles(path.join(SRC, 'data'))) {
      expect(file.startsWith('/')).toBe(false);
      expect(file).not.toContain('\\');
    }
  });

  it.each(TRIAGED)('declares every sited schema file under %s/', (dir) => {
    const ledger = fs.readFileSync(LEDGER, 'utf-8');
    const dirPath = path.join(SRC, dir);

    const undeclared = listSchemaFiles(dirPath)
      .filter((f) => countSites(path.join(dirPath, f)) > 0)
      // Backticked exactly as the triage tables write it.
      .filter((f) => !ledger.includes(`\`${f}\``));

    // A second, independent statement of the gate's coverage rule — deliberately
    // not sharing the gate's table parser, so a bug in that parser cannot make
    // both agree on a wrong answer.
    expect(undeclared).toEqual([]);
  });
});
