// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11252 — product source carries no hard-coded English `Select…`
 * placeholder. This is the family-closing pin.
 *
 * The family: a select whose placeholder was the English literal `Select…`, so
 * it read English under every locale. objectui#11220 (PR objectui#11250) fixed
 * the flow screen's `ScreenView`; objectui#11252 fixed the last three
 * (Studio's datasource config form, `ConfigFieldRenderer`, and the console's
 * `SettingsField`). Each site now reads a locale key. This file keeps the
 * literal from coming back anywhere in `packages/` or `apps/`.
 *
 * ## What counts as the literal, and where it is allowed
 *
 * `Select` followed by an ellipsis, either the U+2026 glyph or three full
 * stops. It may appear in product source only as translation VOCABULARY:
 *
 *   - `pack-row`: a value in a built-in locale pack (`packages/i18n/src/locales/`);
 *   - `table-row`: a value under a dotted translation key in a fallback table
 *     (`'common.select': …` in a `createSafeTranslation` defaults map, or a row
 *     of Studio's `metadata-admin/i18n.ts` table);
 *   - `inline-default`: the `defaultValue` of a translation call's options
 *     object (`t('common.select', { defaultValue: … })`).
 *
 * Anywhere else it is an offender: a JSX attribute or text, a `??` / `||`
 * fallback, an object property such as `placeholder:`, a template.
 *
 * ## Why the TypeScript scanner and not a regex
 *
 * The literal also appears in PROSE (comments that describe the placeholder).
 * The classifier reads only string, template and JSX-text tokens from the
 * TypeScript AST. Comments are trivia to that scanner, so prose is never read
 * as code and no comment stripper can drop real code from the scan. Only files
 * that contain the literal at all are parsed.
 *
 * ## Controls
 *
 *   - Lit control: every offender shape is planted in memory and must be found
 *     by the same classifier the tree scan uses; the allowed shapes and the
 *     prose must not be.
 *   - Population control: the tree scan must SEE the vocabulary (a pack row, a
 *     table row and an inline default). A walk that read nothing, or a
 *     classifier that saw nothing, cannot pass it.
 *
 * Tests are not product source and are skipped (this file plants the literal on
 * purpose).
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import ts from 'typescript';

/**
 * The repo root, derived from THIS file's own location, never from
 * `process.cwd()` (AGENTS.md; the spelling `common-search-retired-4392.test.ts`
 * uses).
 */
const SELF_DEPTH_BELOW_REPO_ROOT = 5; // packages / app-shell / src / __tests__ / this file
const REPO_ROOT = decodeURIComponent(new URL(import.meta.url).pathname)
  .split('/')
  .slice(0, -SELF_DEPTH_BELOW_REPO_ROOT)
  .join('/');

const SCAN_ROOTS = ['packages', 'apps'];

/** `Select` then an ellipsis: the U+2026 glyph or three full stops. */
const LITERAL = /Select(?:…|\.\.\.)/;

const SKIP_DIRS = new Set([
  'node_modules', 'dist', 'build', 'coverage',
  '__tests__', '__mocks__', 'test', 'tests', 'e2e',
]);
const SOURCE_FILE = /\.(?:tsx?|jsx?|mts|cts|mjs|cjs)$/;
const NOT_PRODUCT = /\.d\.ts$|\.(?:test|spec|stories)\.[cm]?[jt]sx?$/;
const PACK_DIR = 'packages/i18n/src/locales/';

type Kind = 'pack-row' | 'table-row' | 'inline-default' | 'offender';
interface Hit {
  file: string;
  line: number;
  kind: Kind;
  text: string;
}

function scriptKindOf(fileName: string): ts.ScriptKind {
  if (fileName.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (fileName.endsWith('.jsx')) return ts.ScriptKind.JSX;
  if (/\.[cm]?js$/.test(fileName)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function propertyNameText(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name)) return name.text;
  return undefined;
}

/** Where one literal-bearing token sits: vocabulary, or an offender. */
function classify(node: ts.Node, file: string): Kind {
  const parent = node.parent;
  if (!parent || !ts.isPropertyAssignment(parent) || parent.initializer !== node) return 'offender';
  const key = propertyNameText(parent.name);
  if (file.startsWith(PACK_DIR)) return 'pack-row';
  if (ts.isStringLiteral(parent.name) && parent.name.text.includes('.')) return 'table-row';
  if (key === 'defaultValue') {
    const options = parent.parent;
    if (ts.isObjectLiteralExpression(options) && options.parent && ts.isCallExpression(options.parent)) {
      return 'inline-default';
    }
  }
  return 'offender';
}

/** Every string / template / JSX-text token carrying the literal, classified. */
function scanSource(file: string, text: string): Hit[] {
  if (!LITERAL.test(text)) return [];
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, scriptKindOf(file));
  const hits: Hit[] = [];
  const visit = (node: ts.Node) => {
    if (
      (ts.isStringLiteral(node) ||
        ts.isNoSubstitutionTemplateLiteral(node) ||
        ts.isTemplateHead(node) ||
        ts.isTemplateMiddle(node) ||
        ts.isTemplateTail(node) ||
        ts.isJsxText(node)) &&
      LITERAL.test(node.text)
    ) {
      const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
      hits.push({ file, line, kind: classify(node, file), text: node.getText(source).trim() });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return hits;
}

function scanTree(): { filesRead: number; hits: Hit[] } {
  let filesRead = 0;
  const hits: Hit[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(full);
        continue;
      }
      if (!SOURCE_FILE.test(entry.name) || NOT_PRODUCT.test(entry.name)) continue;
      filesRead += 1;
      const rel = relative(REPO_ROOT, full).split(sep).join('/');
      hits.push(...scanSource(rel, readFileSync(full, 'utf8')));
    }
  };
  for (const root of SCAN_ROOTS) {
    const abs = join(REPO_ROOT, root);
    expect(existsSync(abs), `scan root missing: ${abs}`).toBe(true);
    walk(abs);
  }
  return { filesRead, hits };
}

const offendersIn = (file: string, text: string) =>
  scanSource(file, text).filter((h) => h.kind === 'offender');

describe('objectui#11252 — the literal scanner (lit control)', () => {
  it('finds every planted offender shape', () => {
    const planted: Array<[string, string]> = [
      ['a.tsx', '<SelectValue placeholder="Select…" />'],
      ['b.tsx', "<SelectValue placeholder={field.placeholder ?? 'Select…'} />"],
      ['c.tsx', "<SelectValue placeholder={field.placeholder || 'Select…'} />"],
      ['d.tsx', 'const el = <span>Select…</span>;'],
      ['e.ts', "const field = { type: 'select', placeholder: 'Select...' };"],
      ['f.ts', 'const p = `Select… ${hint}`;'],
      // A pack-shaped row OUTSIDE the packs is not vocabulary.
      ['packages/x/src/labels.ts', "export default { common: { select: 'Select…' } };"],
    ];
    for (const [file, text] of planted) {
      expect(offendersIn(file, text), `planted in ${file}: ${text}`).toHaveLength(1);
    }
  });

  it('leaves the vocabulary and the prose alone', () => {
    expect(scanSource('g.tsx', "t('common.select', { defaultValue: 'Select…' });").map((h) => h.kind))
      .toEqual(['inline-default']);
    expect(scanSource('h.ts', "const D = { 'common.select': 'Select…' };").map((h) => h.kind))
      .toEqual(['table-row']);
    expect(scanSource(`${PACK_DIR}xx.ts`, "export default { common: { select: 'Select…' } };").map((h) => h.kind))
      .toEqual(['pack-row']);
    // Prose is trivia: no token at all, so no hit of any kind.
    expect(scanSource('i.tsx', '// the bare "Select…" placeholder\n/** a "Select..." button */\nconst x = 1;'))
      .toEqual([]);
  });
});

describe('objectui#11252 — product source carries no hard-coded `Select…` placeholder', () => {
  let tree: ReturnType<typeof scanTree> | undefined;
  const scanned = () => (tree ??= scanTree());

  it('the walk reaches the vocabulary (population control)', () => {
    const { filesRead, hits } = scanned();
    expect(filesRead).toBeGreaterThan(0);
    const seen = new Set(hits.map((h) => h.kind));
    expect(seen.has('pack-row'), 'no locale pack row seen: the walk missed packages/i18n').toBe(true);
    expect(seen.has('table-row'), 'no fallback-table row seen').toBe(true);
    expect(seen.has('inline-default'), 'no inline translation default seen').toBe(true);
  });

  it('finds no offender', () => {
    const offenders = scanned()
      .hits
      .filter((h) => h.kind === 'offender')
      .map((h) => `${h.file}:${h.line}  ${h.text}`);
    expect(
      offenders,
      'A hard-coded English "Select…" is back in product source. Read a locale key ' +
        'instead: `common.select` through the package\'s translation hook (with its en ' +
        'word as the inline `defaultValue` or in a `createSafeTranslation` defaults map), ' +
        'or `engine.form.selectEllipsis` inside Studio (objectui#11252).',
    ).toEqual([]);
  });
});
