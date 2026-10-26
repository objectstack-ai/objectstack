/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Retirement pin — `ColumnWidthConfig` / `ColumnWidthConfigSchema` are DELETED
 * (objectui#10582, ADR-0049 enforce-or-remove: a declaration nothing pulls on
 * retires immediately).
 *
 * ## What stood behind the pair before the deletion
 *
 * Nothing. The one schema key that carried the type, the `'kanban'` arm's
 * `columnWidths`, retired with that arm (objectui#8802), and the arm's named
 * refusal now answers the whole `type: "kanban"` literal. The one reader,
 * `plugin-kanban`'s `useColumnWidths` hook, was removed by objectui#8522. What
 * was left was a published authoring type an author (or an AI) could build and
 * nothing would ever read.
 *
 * ## Why a deletion and not a tombstone
 *
 * A tombstone (`?: never`, `retirementTombstone()`) exists for a MEMBER KEY,
 * because `BaseSchema` is `.passthrough()` and a deleted member would be kept
 * unjudged. A standalone type has no such escape hatch: an importer of a
 * deleted name fails to compile with "has no exported member", which is the
 * loud refusal. That is the route objectui#7068 took for `ActionCallback` /
 * `ActionCallbackSchema` and objectui#7664 for the `DeclarativeKanban*` trio,
 * and the shape of this pin follows `action-callback-retired-7068.test.ts`.
 *
 * ## Tree-scoped, not file-scoped
 *
 * The last block walks every TypeScript source under `packages/`, `apps/` and
 * `examples/` for a DECLARATION or an EXPORT of either name — a re-declaration
 * in some other package would type-check cleanly and put the dead shape back,
 * and a file-scoped pin sees only the files its author thought of. Prose that
 * tells the story (docblocks, this file) is not a declaration and is not read
 * as one.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import * as complexZod from '../zod/complex.zod.js';
import * as zodBarrel from '../zod/index.zod.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../../..');
const SELF = fileURLToPath(import.meta.url);

const RETIRED = ['ColumnWidthConfig', 'ColumnWidthConfigSchema'] as const;
const RETIRED_TOKEN = /\bColumnWidthConfig(?:Schema)?\b/;

/** Every top-level name a source file DECLARES or EXPORTS, read off its AST. */
function declaredAndExportedNames(file: string): string[] {
  const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.ESNext, false, kind);
  const names: string[] = [];
  for (const s of sf.statements) {
    if (
      (ts.isInterfaceDeclaration(s) || ts.isTypeAliasDeclaration(s) || ts.isClassDeclaration(s)
        || ts.isFunctionDeclaration(s) || ts.isEnumDeclaration(s)) && s.name
    ) {
      names.push(s.name.text);
    } else if (ts.isVariableStatement(s)) {
      for (const d of s.declarationList.declarations) if (ts.isIdentifier(d.name)) names.push(d.name.text);
    } else if (ts.isExportDeclaration(s) && s.exportClause && ts.isNamedExports(s.exportClause)) {
      for (const e of s.exportClause.elements) names.push(e.name.text);
    }
  }
  return names;
}

/* ── the two entry points: neither exports either name ─────────────────── */

describe('`ColumnWidthConfig` / `ColumnWidthConfigSchema` are DELETED from both `@object-ui/types` entry points (objectui#10582)', () => {
  it('the Zod mirror is exported from neither `complex.zod.ts` nor the `@object-ui/types/zod` barrel', () => {
    expect('ColumnWidthConfigSchema' in complexZod).toBe(false);
    expect('ColumnWidthConfigSchema' in zodBarrel).toBe(false);
    // Lit control: the sibling mirror declared beside it still exports through both.
    expect('CardTemplateSchema' in complexZod).toBe(true);
    expect('CardTemplateSchema' in zodBarrel).toBe(true);
  });

  it('`complex.ts` declares no `ColumnWidthConfig` — read off the AST, so the docblock that tells the story does not count', () => {
    const names = declaredAndExportedNames(resolve(HERE, '../complex.ts'));
    expect(names).not.toContain('ColumnWidthConfig');
    expect(names).toContain('CardTemplate'); // lit control
  });

  it.each([
    ['the root entry `index.ts`', '../index.ts', 'ColumnWidthConfig', 'CardTemplate'],
    ['the zod entry `zod/index.zod.ts`', '../zod/index.zod.ts', 'ColumnWidthConfigSchema', 'CardTemplateSchema'],
  ])('%s exports no retired name, and still exports its sibling', (_label, file, retired, sibling) => {
    const names = declaredAndExportedNames(resolve(HERE, file));
    expect(names).not.toContain(retired);
    expect(names).toContain(sibling); // lit control
  });
});

/* ── tree-scoped: no source anywhere declares or exports either name ───── */

describe('no source under packages/, apps/ or examples/ declares or exports a retired name (objectui#10582)', () => {
  const SKIP = new Set(['node_modules', 'dist', 'build', 'coverage', '.turbo', '.next', 'out']);
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      if (SKIP.has(name)) return [];
      const p = join(dir, name);
      if (statSync(p).isDirectory()) return walk(p);
      return /\.(?:ts|tsx|mts|cts)$/.test(name) && !name.endsWith('.d.ts') ? [p] : [];
    });
  const sources = ['packages', 'apps', 'examples'].flatMap((d) => walk(resolve(ROOT, d)));

  it('no declaration and no export specifier of either name, in any file', () => {
    const offenders = sources
      .filter((f) => f !== SELF && RETIRED_TOKEN.test(readFileSync(f, 'utf8')))
      .flatMap((f) =>
        declaredAndExportedNames(f)
          .filter((n) => (RETIRED as readonly string[]).includes(n))
          .map((n) => `${relative(ROOT, f)}: ${n}`),
      );
    expect(offenders).toEqual([]);
  });

  it('the walk can see the corpus and the reader can find a live export (non-vacuity)', () => {
    const rel = new Set(sources.map((f) => relative(ROOT, f)));
    expect(rel.has('packages/plugin-kanban/src/types.ts')).toBe(true);
    expect(rel.has('packages/types/src/zod/complex.zod.ts')).toBe(true);
    // The same reader, on the files the retired names used to leave through,
    // still sees the sibling that did not retire.
    expect(declaredAndExportedNames(resolve(ROOT, 'packages/plugin-kanban/src/types.ts'))).toContain('CardTemplate');
    expect(declaredAndExportedNames(resolve(ROOT, 'packages/plugin-kanban/src/index.tsx'))).toContain('CardTemplate');
    expect(declaredAndExportedNames(resolve(ROOT, 'packages/types/src/zod/complex.zod.ts'))).toContain('CardTemplateSchema');
  });
});
