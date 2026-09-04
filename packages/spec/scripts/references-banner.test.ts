// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Pins the "do not edit" banner across the WHOLE generated references tree.
 *
 * `content/docs/references/**` is claimed by `manageDir(DOCS_ROOT, …)`, so
 * `flush()` deletes what it owns before rewriting: a hand edit to any page in
 * that tree is discarded by the next `gen:docs` run with no gate red and no
 * conflict — `check:docs` re-derives the tree and then reports it current. The
 * banner is the ONLY in-page signal a contributor gets before they spend an
 * afternoon on a page that cannot keep their words.
 *
 * It was carried by 200 of the tree's 214 pages. The 14 without it were the
 * per-category overviews, built by a template in `build-docs.ts` §2.5 that
 * simply never emitted the line §2 emits for every schema page — the ownership
 * was never in doubt, only the warning. Nothing was red, because no check had
 * ever asked the question of the tree as a whole; each template was only ever
 * read against itself.
 *
 * So this asks it of the tree, not of a template: every `.mdx` under
 * `content/docs/references/`, banner or no banner. A future template that
 * forgets the line — a new category shape, a new page kind, a refactor that
 * drops the constant from one call site — lands as a red here on the very first
 * regeneration, instead of as a second silent population of pages.
 *
 * Two guards keep the assertion from degrading into a vacuous green, which is
 * the failure mode a tree-walking pin actually has:
 *
 *  - a floor on the page count, so a glob that stops matching (a moved tree, a
 *    renamed extension) reads as broken rather than as "all zero pages pass";
 *  - a check that the banner constant still SAYS something, so emptying it
 *    cannot make every page trivially contain it.
 *
 * The banner text itself is imported, never re-typed: a copy here would be the
 * second spelling this pin exists to prevent (the generator's two emission
 * sites already share one constant).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { AUTO_GENERATED_BANNER } from './lib/generated-output';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(packageRoot, '../..');
const referencesRoot = resolve(repoRoot, 'content/docs/references');

/**
 * How far into the page the banner has to be. Both templates put it directly
 * after the frontmatter; 25 lines is slack for a longer frontmatter, not room
 * for the line to sink below what a reader sees on opening the file.
 */
const BANNER_WITHIN_LINES = 25;

/** The line as it appears on the page — the constant minus its trailing blank. */
const BANNER_LINE = AUTO_GENERATED_BANNER.trim();

function mdxPagesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...mdxPagesUnder(abs));
    else if (entry.isFile() && entry.name.endsWith('.mdx')) out.push(abs);
  }
  return out;
}

describe('content/docs/references/** (the committed generated tree)', () => {
  const pages = mdxPagesUnder(referencesRoot).sort();

  it('the banner constant still carries a warning', () => {
    // Without this, emptying `AUTO_GENERATED_BANNER` would turn the assertion
    // below into "every page contains the empty string" — green, and blind.
    expect(BANNER_LINE).toContain('DO NOT EDIT');
    expect(BANNER_LINE).toContain('build-docs.ts');
  });

  it('finds the generated tree at all', () => {
    // 214 pages when this pin was written. The floor is deliberately far below
    // that: it is here to catch a glob that matched NOTHING, not to ratchet a
    // page count that legitimately moves with every schema file added or
    // retired.
    expect(pages.length, `no .mdx pages found under ${referencesRoot}`).toBeGreaterThan(100);
  });

  it('every page says it is generated, in its first lines', () => {
    const missing = pages.filter(abs => {
      const head = readFileSync(abs, 'utf8').split('\n').slice(0, BANNER_WITHIN_LINES).join('\n');
      return !head.includes(BANNER_LINE);
    });

    expect(
      missing.map(p => relative(repoRoot, p)),
      `${missing.length} of ${pages.length} generated reference page(s) carry no "do not edit" banner in ` +
        `their first ${BANNER_WITHIN_LINES} lines.\n\n` +
        'Every page under content/docs/references/ is written by ' +
        'packages/spec/scripts/build-docs.ts, and the tree is regenerated wholesale — a page ' +
        'without the banner invites an edit that the next `gen:docs` run silently discards.\n' +
        'Fix the TEMPLATE that emits the page (it should append AUTO_GENERATED_BANNER after the ' +
        'frontmatter) and regenerate; do not hand-edit the page.',
    ).toEqual([]);

    // The same fact from the other side: banner-carrying count == total. Stated
    // separately so a mistake in the filter above cannot hide behind an empty
    // list.
    expect(pages.length - missing.length).toBe(pages.length);
  });
});
