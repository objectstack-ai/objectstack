/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `PartialSchema` stays RETIRED from `@object-ui/types` (objectui#11608,
 * enforce-or-remove).
 *
 * ## The ruling
 *
 * The alias was published through the `.` entry and had no reader. While
 * `BaseSchema` carried `[key: string]: any` it did not even do what its
 * docblock said: every instantiation declared `type` alone (objectui#6397).
 * objectui#8347 removed that signature, which made the alias work for the
 * first time, and handed the published-export question to this card. The triage
 * direction was retire unless a census at work time found a reader; it found
 * none, so the export and its docblock went, with no replacement alias.
 * ⛔ Putting it back is a published-contract decision, never a convenience.
 *
 * ## ⚠️ The limit this pin inherits and does NOT close
 *
 * The tree scan reads this repository's TRACKED files only: ⛔ not sibling
 * repositories, ⛔ not customer applications, ⛔ not untracked files. The
 * census behind the ruling also read the sibling repositories it could reach,
 * and its pull request names the leg it could not. An external TypeScript
 * consumer gets a compile error naming the symbol; the changeset's migration is
 * what it reads.
 *
 * ## Three instruments, and why the obvious fourth is absent
 *
 *   - `tsc -p tsconfig.test.json`, chained from this package's `type-check`
 *     script, reads the `@ts-expect-error` row on the root barrel and the rows
 *     that compile the changeset's TO spelling. vitest strips types, so those
 *     rows mean nothing unless `type-check` runs.
 *   - vitest reads `package.json`'s `exports` map and the SOURCE module behind
 *     every entry, so an entry added later is covered the day it lands. ⛔ Not
 *     `dist/`: the per-PR `test` job builds nothing before it runs, the
 *     constraint `package-exports-manifest.test.ts` records for this package.
 *   - vitest scans the whole TRACKED tree for the word, with a lit control on
 *     the same probe. This is the half that sees a re-export chain: an entry
 *     that forwards with `export *` names nothing itself, but whatever module
 *     declares the alias does, and that module is tracked.
 *   - ⛔ A runtime `name in module` leg is deliberately absent: the alias was
 *     `export type`, so it was never in a runtime namespace, and that leg would
 *     pass identically before and after this retirement.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ButtonSchema } from '../form';

/** Rooted at THIS file, never at `process.cwd()`: the two differ per invocation. */
const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(HERE, '../..');
const REPO_ROOT = resolve(HERE, '../../../..');

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Expect<T extends true> = T;

/* ── 1. The type face: the root barrel no longer exports the alias ────────── */

// @ts-expect-error objectui#11608 — `PartialSchema` is RETIRED from the published barrel, the `.` entry it shipped through. No replacement alias; the changeset carries the migration.
export type _RetiredFromTheRootBarrel = import('../index').PartialSchema<ButtonSchema>;

// ⭐ LIT CONTROL for the directive above, through the same import form with no
// directive: the sibling utility it was declared beside. An emptied or moved
// barrel would satisfy the directive on its own; it cannot satisfy this row.
export type _SiblingStillResolves = import('../index').SchemaByType<'button'>;

/* ── 2. The TO spelling the changeset hands a consumer, compiled ─────────── */

// The inline spelling keeps every declared member, `type` required and the
// rest optional, which is what the alias promised. `Partial` maps over the
// members it is given, so it has no `Omit`-over-`keyof` step to collapse.
type ButtonPatch = Partial<ButtonSchema> & { type: ButtonSchema['type'] };

export type _ToKeepsTheMembers = Expect<Equal<keyof ButtonPatch, keyof ButtonSchema>>;
export const patchButton: ButtonPatch = { type: 'button' };
// @ts-expect-error — `type` stays required on the inline spelling
export const patchWithoutType: ButtonPatch = { label: 'Save' };
export const patchMisspelled: ButtonPatch = {
  type: 'button',
  // @ts-expect-error — `labell` is no member of `ButtonSchema`; the key is `label`
  labell: 'Save',
};

describe('objectui#11608 — the migration off `PartialSchema` compiles (type-level rows)', () => {
  it('keeps the type-level rows alive — `tsc -p tsconfig.test.json` is their reader', () => {
    expect(patchButton.type).toBe('button');
    expect([patchWithoutType, patchMisspelled]).toHaveLength(2);
  });
});

/* ── 3. The `exports` map: no entry's source module names the alias ──────── */

const WORD = /\bPartialSchema\b/;

type ExportsMap = Record<string, string | Record<string, string>>;

/** Every entry of the `exports` map, with the `src/` module its `types` target is emitted from. */
const entrySources = (): Array<{ entry: string; source: string }> => {
  const pkg = JSON.parse(readFileSync(resolve(PACKAGE_ROOT, 'package.json'), 'utf8')) as { exports?: ExportsMap };
  return Object.entries(pkg.exports ?? {}).map(([entry, conditions]) => {
    const target = typeof conditions === 'string' ? conditions : conditions.types;
    // `./dist/X.d.ts` is what `tsc` emits from `src/X.ts`, under this
    // package's `rootDir: ./src` and `outDir: ./dist`.
    const match = /^\.\/dist\/(.+)\.d\.ts$/.exec(target ?? '');
    expect(match, `entry ${entry} has no ./dist/*.d.ts types target`).not.toBeNull();
    return { entry, source: resolve(PACKAGE_ROOT, 'src', `${match![1]}.ts`) };
  });
};

describe('objectui#11608 — `PartialSchema` is published from no entry of the `exports` map', () => {
  it('every entry resolves to a source module this test can read', () => {
    const entries = entrySources();
    // The `.` entry is the one the alias shipped through: an enumeration
    // without it would make the next assertion vacuous where it matters most.
    expect(entries.map((e) => e.entry)).toContain('.');
    expect(entries.filter((e) => !existsSync(e.source)).map((e) => e.entry)).toEqual([]);
  });

  it('no entry source module names `PartialSchema`', () => {
    const naming = entrySources()
      .filter((e) => WORD.test(readFileSync(e.source, 'utf8')))
      .map((e) => `${e.entry} -> ${relative(REPO_ROOT, e.source)}`);
    expect(naming).toEqual([]);
  });

  it('LIT CONTROL — the same read finds `SchemaByType` in the `.` entry source', () => {
    const root = entrySources().find((e) => e.entry === '.');
    expect(/\bexport type SchemaByType\b/.test(readFileSync(root!.source, 'utf8'))).toBe(true);
  });
});

/* ── 4. The tracked tree: nothing names it ────────────────────────────────── */

describe('objectui#11608 — no tracked file outside the release record names `PartialSchema`', () => {
  /**
   * What is excluded, and why each row is here. ⛔ No allow-list FILE: a list
   * that lives on disk outlives the reason for each of its rows.
   *
   *  - `*CHANGELOG.md` — released notes, which must keep naming what shipped
   *    and what was later removed.
   *  - `.changeset/` — pending notes, the same record before a release folds
   *    it into a CHANGELOG. This retirement's own note has to name the alias.
   *  - this pin, which must write the word to probe for it.
   */
  const EXCLUDED = [
    ':!*CHANGELOG.md',
    ':!.changeset/',
    ':!packages/types/src/__tests__/partial-schema-retired-11608.test.ts',
  ];

  /** `git grep -nE PATTERN -- . EXCLUSIONS`, exit 1 (no match) normalised to an empty list. */
  const grepTree = (pattern: string): string[] => {
    try {
      const out = execFileSync('git', ['grep', '-nE', pattern, '--', '.', ...EXCLUDED], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
      });
      return out.split('\n').filter(Boolean);
    } catch (e) {
      // `git grep` exits 1 for "no matches", the PASS case here, told apart
      // from a real failure (exit > 1) rather than swallowed.
      const status = (e as { status?: number }).status;
      if (status === 1) return [];
      throw e;
    }
  };

  it('the symbol `PartialSchema` appears nowhere: no declaration, no re-export, no reader, no doc', () => {
    expect(grepTree('\\bPartialSchema\\b')).toEqual([]);
  });

  it('LIT CONTROL — the same probe finds `SchemaByType`, the sibling utility that stays', () => {
    // Without this, the zero above would also come from a broken `git grep`
    // invocation, a wrong cwd, or an exclusion list that swallowed the tree,
    // and a swallowed tree reads exactly like a clean retirement.
    expect(grepTree('\\bSchemaByType\\b').length).toBeGreaterThan(0);
  });
});
