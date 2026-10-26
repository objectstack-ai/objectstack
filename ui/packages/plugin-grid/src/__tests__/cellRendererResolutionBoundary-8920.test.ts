/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#8920 — `plugin-grid` reaches a cell renderer through ONE module.
 *
 * ## Why a source scan rather than a rendering test
 *
 * `formatHintedColumnRenderer-8920.test.tsx` renders every path and proves the
 * hint is honoured today. It cannot see the property this file guards: a
 * SEVENTH call site added tomorrow, spelled `getCellRenderer(field.type)`,
 * renders perfectly for every type that carries no `format` hint — which is
 * most of them — and nothing observable distinguishes it from a correct one
 * until an author writes the hint. That is exactly how four sites survived: the
 * defect is *which resolve was spelled*, and the source is where that is
 * measurable.
 *
 * The bound is therefore structural: `packages/plugin-grid/src` calls
 * `getCellRenderer` / `resolveCellRendererType` from `cellRendererResolution.ts`
 * and nowhere else. Adding a site is still easy; adding one that picks its own
 * convention is not.
 *
 * ## Anti-vacuity — the expected answer OUTSIDE the helper is ZERO
 *
 * A zero and a broken scanner render identically, so three controls guard it,
 * each able to fail on its own:
 *
 *   1. the population is enumerated and asserted non-trivial BY COUNT, and the
 *      helper module and `ObjectGrid.tsx` are both asserted present in it —
 *      a scan over an empty or wrong directory fails here, loudly;
 *   2. the matcher is proved able to find a direct call on a synthetic input
 *      whose answer is known, in both directions;
 *   3. the matcher is proved able to find direct calls in a REAL file at real
 *      scale — necessarily `cellRendererResolution.ts`, since it is now the
 *      only place they may appear. ⛔ If that module ever stops calling them,
 *      do not delete this control: the bound it guards has gone with it and
 *      this whole file needs rewriting, which is what its failure will say.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
// packages/plugin-grid/src/__tests__ -> packages/plugin-grid/src
const SRC = path.resolve(here, '..');
const HELPER = 'cellRendererResolution.ts';
const GRID = 'ObjectGrid.tsx';

/**
 * Every non-test source file under `packages/plugin-grid/src`, as repo-relative
 * paths from `src`. Tooling directories are excluded the way this repo spells
 * that exclusion everywhere else — by DIRECTORY (`__tests__`, `__mocks__`), not
 * by filename pattern — plus the `*.test.*` files that sit beside their
 * subjects in this package.
 */
function sourceFiles(dir = SRC, prefix = ''): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === '__mocks__' || entry.name === '__benchmarks__') continue;
      out.push(...sourceFiles(path.join(dir, entry.name), rel));
      continue;
    }
    if (!/\.(ts|tsx)$/.test(entry.name)) continue;
    if (/\.test\.tsx?$/.test(entry.name)) continue;
    out.push(rel);
  }
  return out;
}

/**
 * The symbol immediately followed by `(` — a CALL SHAPE, wherever it appears.
 *
 * ⚠️ Deliberately NOT comment-aware, and the bound is stated to match: prose
 * inside the guarded files may NAME either resolver but must not spell it with
 * a trailing `(`. Two reasons this is the right trade rather than a shortcut.
 * A comment stripper written for TypeScript has to tokenise strings, templates
 * and regex literals to be correct, and every wrong version of it fails toward
 * a FALSE NEGATIVE — a real call swallowed by a mis-parsed line, reported as a
 * clean zero, which is precisely the reading this file exists to make
 * trustworthy. And the rule it costs is one this card wants anyway: a comment
 * that spells `getCellRenderer(field.type)` inside the grid is re-teaching the
 * convention that dropped the hint. Name it without the parenthesis.
 *
 * The helper module is exempt by construction — it is scanned only by control
 * 3, which reads the SET of symbols found, so its prose may quote the calls it
 * is documenting.
 */
const DIRECT_CALL_RE = /\b(getCellRenderer|resolveCellRendererType)\s*\(/g;

function directCalls(source: string): string[] {
  return [...source.matchAll(DIRECT_CALL_RE)].map((m) => m[1]);
}

const FILES = sourceFiles();
const read = (rel: string) => readFileSync(path.join(SRC, rel), 'utf8');

describe('objectui#8920 — one owner for the grid\'s cell-renderer resolution', () => {
  it('the population is enumerated and non-trivial (anti-vacuity control 1)', () => {
    // Every "no such call" claim below is worthless if this list is empty or
    // points at the wrong tree, so it is asserted first and BY COUNT.
    expect(FILES.length).toBeGreaterThan(20);
    expect(FILES).toContain(HELPER);
    expect(FILES).toContain(GRID);
    expect(read(GRID).length).toBeGreaterThan(100_000);
  });

  it('the matcher finds a direct call, and only a call (anti-vacuity control 2)', () => {
    expect(directCalls('const R = getCellRenderer(t);')).toEqual(['getCellRenderer']);
    expect(directCalls('resolveCellRendererType({ type, format })')).toEqual(['resolveCellRendererType']);
    // A bare mention is not a call shape — this is the direction that keeps the
    // bound satisfiable while the guarded source still explains itself in prose.
    expect(directCalls('// getCellRenderer is deliberately not imported here')).toEqual([]);
    expect(directCalls('import { getCellRenderer } from "@object-ui/fields";')).toEqual([]);
    // …and the documented cost, asserted so nobody has to rediscover it from a
    // confusing failure: parenthesised prose DOES count.
    expect(directCalls('// was: getCellRenderer(field.type)')).toEqual(['getCellRenderer']);
  });

  it('the matcher finds real calls at real scale (anti-vacuity control 3)', () => {
    // The helper is now the only place these calls may appear, so it is the
    // only real-file control available — and that is not a weakness: if it
    // stops calling them, the bound below has nothing left to mean.
    // The SET, not the multiset: the helper's own documentation quotes the two
    // calls it wraps, and counting those quotations would pin prose.
    expect(
      [...new Set(directCalls(read(HELPER)))].sort(),
      `Anti-vacuity control 3 has lost its anchor: \`${HELPER}\` no longer calls ` +
        'either published resolver, so the matcher is not proved able to find ' +
        'anything at real scale and every "no direct call" claim in this file ' +
        'is a green no-op. ⛔ Do not delete this control — rewrite the bound ' +
        'it guards (objectui#8920).',
    ).toEqual(['getCellRenderer', 'resolveCellRendererType']);
  });

  it('⭐ ObjectGrid.tsx makes no direct resolver call', () => {
    // The card's own subject: six sites in this one file, three conventions.
    expect(
      directCalls(read(GRID)),
      'ObjectGrid.tsx called a published resolver directly. That is how a ' +
        '`format`-hinted textual column lost its renderer in four of six ' +
        'sites (objectui#8920): `getCellRenderer(field.type)` type-checks and ' +
        'renders correctly for every unhinted type, so nothing else can catch ' +
        'it. Route through `./cellRendererResolution` instead.',
    ).toEqual([]);
  });

  it('⭐ no file under plugin-grid/src outside the helper makes one either', () => {
    const offenders = FILES.filter((f) => f !== HELPER).filter((f) => directCalls(read(f)).length > 0);
    expect(
      offenders,
      'These files resolve a cell renderer without going through ' +
        `\`${HELPER}\`. One owner is what stops a seventh site from picking a ` +
        'convention of its own (objectui#8920).',
    ).toEqual([]);
  });
});
