// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36895 — no server package builds a Studio address by hand, and
 * the review links the `objectstack-mcp-build` skill's evals quote are the
 * ones this package builds.
 *
 * ── Why ──────────────────────────────────────────────────────────────────────
 *
 * The Studio redesign (epic #36890) moves Studio's addresses one item type at
 * a time. A `/studio/...` string written out in a server package would keep
 * the old address after the move, and an AI handed it would send a person to
 * the wrong page. `studio-review-links.ts` is the one place a server spells
 * one; the Console's builder (`studioAddress.ts` in the app-shell package)
 * is held by the same kind of pin in the ui workspace.
 *
 * ── What it judges ───────────────────────────────────────────────────────────
 *
 *  1. Every `.ts` source under `packages/` (tests, declaration files and build
 *     output excepted), parsed: a string or template literal that starts with
 *     `/studio` (then its end, `/`, `?` or `#`) is a hand-built address. Prose
 *     in comments is free.
 *  2. The eval file of the published skill (it is governed: it is read, never
 *     edited here): every Studio address it quotes equals what
 *     `studioChangesReviewLink` / `studioItemReviewLink` return for the
 *     package, type and name the address names, so the two cannot drift.
 *
 * ── Controls ─────────────────────────────────────────────────────────────────
 *
 * The walk must reach the two server producers, the matcher must fire on the
 * one allowed file, and the eval file must yield its quoted addresses (seven
 * on the commit this landed: five Changes links, two item reviews). Zero in
 * any of them means the instrument is broken, not that the tree is clean.
 *
 * The radius: `packages/**` `.ts` (already this package's declared glob, the
 * extension boundary is the one `driver-error-classification.callers.test.ts`
 * records) plus the one eval file, declared beside it.
 */

import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import ts from 'typescript';
import { studioChangesReviewLink, studioItemReviewLink } from './studio-review-links.js';

/**
 * This package is CJS-typed, so `import.meta` is not available: walk up from
 * the CWD to this package's own manifest (`driver-error-classification.callers.test.ts`
 * says why), then reach the repo root by arithmetic.
 */
function findUp(marker: (dir: string) => boolean, what: string): string {
  let dir = process.cwd();
  for (;;) {
    if (marker(dir)) return dir;
    const parent = dirname(dir);
    if (parent === dir) throw new Error(`could not locate ${what} walking up from ${process.cwd()}`);
    dir = parent;
  }
}

const PACKAGE_ROOT = findUp((dir) => {
  const manifest = join(dir, 'package.json');
  if (!existsSync(manifest)) return false;
  const { name } = JSON.parse(readFileSync(manifest, 'utf8')) as { name?: string };
  return name === '@objectstack/types';
}, 'the @objectstack/types package root');

const REPO_ROOT = resolve(PACKAGE_ROOT, '../..');

const SCANNED_TREE = join(REPO_ROOT, 'packages');

/** The skill eval whose quoted review links must equal the builder's. */
const EVAL_FILE = join(REPO_ROOT, 'skills/objectstack-mcp-build/evals/draft-door-procedure.json');

/** The one server file that spells a Studio address. */
const ALLOWED = 'packages/types/src/studio-review-links.ts';

const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage', '.turbo', '.next', '__tests__']);

const SOURCE_FILE = (name: string): boolean =>
  name.endsWith('.ts') && !name.endsWith('.d.ts') && !/\.(?:test|spec)\.ts$/.test(name);

const STUDIO_LITERAL = /^\/studio(?:$|[/?#])/;

function sourceFilesUnder(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(join(dir, entry.name));
        continue;
      }
      if (entry.isFile() && SOURCE_FILE(entry.name)) out.push(join(dir, entry.name));
    }
  };
  walk(root);
  return out;
}

function handBuiltStudioAddresses(fileName: string, text: string): string[] {
  if (!text.includes('/studio')) return [];
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const hits: string[] = [];
  const visit = (node: ts.Node): void => {
    const literalText =
      ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
        ? node.text
        : ts.isTemplateExpression(node)
          ? node.head.text
          : null;
    if (literalText !== null && STUDIO_LITERAL.test(literalText)) {
      const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
      hits.push(`${line + 1}: ${node.getText(source).replace(/\s+/g, ' ').slice(0, 120)}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return hits;
}

/** Every Studio address quoted in a text, up to the first quote, space, backtick or paren. */
function quotedStudioAddresses(text: string): string[] {
  return [...text.matchAll(/\/studio\/[^\s"'`)]+/g)].map((m) => m[0]);
}

/** What the builder returns for the package, type and name an address names. */
function rebuilt(address: string): string | null {
  const changes = /^\/studio\/([^/?#]+)\/data\?changes=review$/.exec(address);
  if (changes) return studioChangesReviewLink(decodeURIComponent(changes[1]));
  const item = /^\/studio\/([^/?#]+)\/metadata\/([^/?#]+)\/([^/?#]+)\?review=1$/.exec(address);
  if (item) {
    return studioItemReviewLink(decodeURIComponent(item[1]), decodeURIComponent(item[2]), decodeURIComponent(item[3]));
  }
  return null;
}

describe('no server package builds a Studio address by hand (objectstack#36895)', () => {
  it('the matcher sees each spelling and spares prose and look-alikes', () => {
    const scan = (text: string) => handBuiltStudioAddresses('x.ts', text);
    expect(scan("const a = '/studio';")).toHaveLength(1);
    expect(scan('const b = `/studio/${pkg}/data?changes=review`;')).toHaveLength(1);
    expect(scan("const c = 'see (/studio/x)';")).toEqual([]);
    expect(scan("const d = '/api/v1/studio/runtime-config';")).toEqual([]);
    expect(scan('// links to /studio/crm/data\nconst e = 1;')).toEqual([]);
    expect(scan("const f = '/studios';")).toEqual([]);
  });

  it('only the shared module spells one', () => {
    const files = sourceFilesUnder(SCANNED_TREE);
    const rel = (file: string) => relative(REPO_ROOT, file).split(sep).join('/');
    const names = new Set(files.map(rel));
    // Controls: the walk reaches both server producers, and the matcher fires
    // on the allowed module.
    expect(names.has('packages/runtime/src/domains/mcp-authoring.ts')).toBe(true);
    expect(names.has('packages/cli/src/commands/meta/register.ts')).toBe(true);
    expect(handBuiltStudioAddresses(ALLOWED, readFileSync(join(REPO_ROOT, ALLOWED), 'utf8')).length).toBe(2);

    const offenders = files
      .filter((file) => rel(file) !== ALLOWED)
      .flatMap((file) => handBuiltStudioAddresses(file, readFileSync(file, 'utf8')).map((hit) => `${rel(file)}:${hit}`));
    expect(offenders).toEqual([]);
  });

  it("the skill evals quote the builder's review links, byte for byte", () => {
    const quoted = quotedStudioAddresses(readFileSync(EVAL_FILE, 'utf8'));
    // Control: the eval file still quotes its review links.
    expect(quoted.length).toBeGreaterThanOrEqual(7);
    for (const address of quoted) expect(rebuilt(address), address).toBe(address);
  });
});
