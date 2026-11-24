// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Pins `planSlices()` and the weight it balances on (`../vitest-slices.ts`),
 * which `vitest.config.ts`'s `DeclarationReaderSequencer` uses to cut this
 * package's suite into Test Core's file-level slices.
 *
 * What a wrong slicer costs is silent: a file in no slice never runs and a
 * file in two runs twice, and every slice still goes green. So the first
 * battery holds the partition itself -- every file in exactly one slice, the
 * declaration readers in the reader slice -- on fixtures and on this
 * package's live test population; the balance and the weight read come after.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  BUDGET_HEADROOM,
  UNDECLARED_FILE_WEIGHT_SECONDS,
  declaredBudgetSeconds,
  fileWeight,
  planSlices,
  type SliceEntry,
} from '../vitest-slices.js';
import { integrationTestFiles, unitTestFiles } from '../vitest-tiers.js';

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// The reader list as the config declares it, read from its text: importing
// the config itself would run its load-time checks inside this suite.
const DECLARATION_READER_FILES: readonly string[] = (() => {
  const text = readFileSync(resolve(PKG, 'vitest.config.ts'), 'utf8');
  const m = /export const DECLARATION_READER_FILES = Object\.freeze\(\[([^\]]*)\]\)/.exec(text);
  if (!m) throw new Error('vitest.config.ts: no `export const DECLARATION_READER_FILES = Object.freeze([...])` to read');
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
})();

const entry = (path: string, weight: number, reader = false): SliceEntry => ({ path, weight, reader });

/** Each slice's members, by path, from a plan. */
function members(entries: readonly SliceEntry[], slices: readonly number[], count: number): string[][] {
  const out = Array.from({ length: count }, () => [] as string[]);
  slices.forEach((s, i) => out[s - 1].push(entries[i].path));
  return out;
}

const totals = (entries: readonly SliceEntry[], slices: readonly number[], count: number): number[] => {
  const out = new Array<number>(count).fill(0);
  slices.forEach((s, i) => (out[s - 1] += entries[i].weight));
  return out;
};

describe('planSlices: every file in exactly one slice', () => {
  const fixture: SliceEntry[] = [
    ...Array.from({ length: 40 }, (_, i) => entry(`test/f${String(i).padStart(2, '0')}.test.ts`, (i * 7919) % 97)),
    entry('test/reader-a.test.ts', 30, true),
    entry('test/reader-b.test.ts', 2, true),
  ];

  for (const count of [1, 2, 3, 4, 7]) {
    it(`at ${count} slice(s) the slices are disjoint and their union is the whole set`, () => {
      const slices = planSlices(fixture, count, 1);
      expect(slices).toHaveLength(fixture.length);
      for (const s of slices) expect(s >= 1 && s <= count).toBe(true);
      const all = members(fixture, slices, count).flat().sort();
      expect(all).toEqual(fixture.map((e) => e.path).sort());
      expect(new Set(all).size).toBe(fixture.length);
    });
  }

  it('puts every declaration reader in the reader slice, at any reader slice', () => {
    for (const readerSlice of [1, 2, 3]) {
      const slices = planSlices(fixture, 3, readerSlice);
      fixture.forEach((e, i) => {
        if (e.reader) expect(slices[i]).toBe(readerSlice);
      });
    }
  });

  it('answers the same plan whatever order the files arrive in, so every slice process agrees', () => {
    const plan = (list: readonly SliceEntry[]) => {
      const slices = planSlices(list, 3, 1);
      return new Map(list.map((e, i) => [e.path, slices[i]]));
    };
    const forward = plan(fixture);
    expect(plan([...fixture].reverse())).toEqual(forward);
    expect(plan([...fixture].sort((a, b) => (a.path < b.path ? 1 : -1)))).toEqual(forward);
  });

  it("holds on this package's live queue population at the configured three slices", () => {
    const integration = integrationTestFiles(PKG);
    const files = [...unitTestFiles(PKG, integration), ...integration];
    const readers = new Set<string>(DECLARATION_READER_FILES);
    const live = files.map((f) => entry(f, fileWeight(readFileSync(resolve(PKG, f), 'utf8')), readers.has(f)));
    expect(live.length).toBeGreaterThan(100);
    expect(live.filter((e) => e.reader)).toHaveLength(DECLARATION_READER_FILES.length);
    const slices = planSlices(live, 3, 1);
    const sets = members(live, slices, 3);
    expect(sets.flat().sort()).toEqual(files.slice().sort());
    for (const set of sets) expect(set.length).toBeGreaterThan(0);
    for (const r of DECLARATION_READER_FILES) expect(sets[0]).toContain(r);
  });

  it('refuses a slice count, reader slice or weight it cannot plan with', () => {
    expect(() => planSlices(fixture, 0, 1)).toThrow(/slice count 0/);
    expect(() => planSlices(fixture, 3, 4)).toThrow(/reader slice 4/);
    expect(() => planSlices([entry('test/x.test.ts', Number.NaN)], 2, 1)).toThrow(/test\/x\.test\.ts weighs NaN/);
  });
});

describe('planSlices: balance by weight, not by file count', () => {
  it('spreads the heavy files that an equal-count cut would put in one slice', () => {
    // Six heavy files first in path order, then sixty light ones: cut into
    // three equal counts, the first slice would hold all six.
    const heavy = Array.from({ length: 6 }, (_, i) => entry(`test/a${i}.test.ts`, 300));
    const light = Array.from({ length: 60 }, (_, i) => entry(`test/z${String(i).padStart(2, '0')}.test.ts`, 2));
    const list = [...heavy, ...light];
    const slices = planSlices(list, 3, 1);
    const t = totals(list, slices, 3);
    expect(Math.max(...t) - Math.min(...t)).toBeLessThanOrEqual(2);
    for (let s = 1; s <= 3; s++) expect(heavy.filter((_, i) => slices[i] === s)).toHaveLength(2);
  });

  it('keeps every slice within one file of the mean when no single file dominates (LPT bound)', () => {
    const list = Array.from({ length: 200 }, (_, i) => entry(`test/f${i}.test.ts`, 1 + ((i * 31) % 50)));
    const slices = planSlices(list, 3, 1);
    const t = totals(list, slices, 3);
    const mean = t.reduce((a, b) => a + b, 0) / 3;
    const heaviest = Math.max(...list.map((e) => e.weight));
    expect(Math.max(...t)).toBeLessThanOrEqual(mean + heaviest);
  });

  it("counts the readers' weight against the reader slice before placing the rest", () => {
    const list = [entry('test/r.test.ts', 100, true), entry('test/a.test.ts', 60), entry('test/b.test.ts', 60)];
    expect(planSlices(list, 2, 1)).toEqual([1, 2, 2]);
  });
});

describe("fileWeight: the budget a file's header declares", () => {
  const budget = '// test-budget: 450 — spawns the real producer once per single-cause fixture: one spawn per case';

  it('weighs a declared file at its budget over the headroom it was rounded up with', () => {
    const text = `// Copyright (c) 2026 ObjectStack.\n\n${budget}\n\nimport { it } from 'vitest';\n`;
    expect(declaredBudgetSeconds(text)).toBe(450);
    expect(fileWeight(text)).toBe(450 / BUDGET_HEADROOM);
  });

  it('reads the header through block comments and a shebang', () => {
    expect(declaredBudgetSeconds(`#!/usr/bin/env node\n/**\n * header\n */\n${budget}\nconst x = 1;\n`)).toBe(450);
  });

  it('weighs a file with no declaration, or one below the header, as undeclared', () => {
    expect(fileWeight("import { it } from 'vitest';\n")).toBe(UNDECLARED_FILE_WEIGHT_SECONDS);
    expect(declaredBudgetSeconds(`// header\nimport { it } from 'vitest';\n${budget}\n`)).toBeNull();
    expect(declaredBudgetSeconds('// test-budget: abc — x: y\n')).toBeNull();
  });

  it('reads a real declaration from this package as the generator would', () => {
    const file = 'src/commands/migrate/data-commands.absent-database.integration.test.ts';
    const text = readFileSync(resolve(PKG, file), 'utf8');
    const seconds = declaredBudgetSeconds(text);
    expect(seconds).not.toBeNull();
    expect(text).toContain(`// test-budget: ${seconds} — `);
  });
});
