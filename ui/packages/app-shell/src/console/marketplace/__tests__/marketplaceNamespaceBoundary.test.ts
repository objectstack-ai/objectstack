// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#30588 — which `marketplace.*` keys may live in the lazy
 * `marketplace` namespace, read off the sources rather than off a list.
 *
 * The namespace (`@object-ui/i18n/namespaces/marketplace`) is fetched by
 * `MarketplaceNamespaceGate`, which the two marketplace pages wrap their
 * bodies in. A key that is only in the namespace therefore renders only under
 * that frame; read anywhere else it is a raw key (no catalogue fetched at all)
 * or English in a translated console (only `en` fetched by an earlier visit).
 *
 * This directory is not only those two pages: Studio's packages page imports
 * `MarketplaceRowActions.tsx`, `dependencyMissing.ts`, `protocolCheckSkipped.ts`
 * and more from here, outside the frame. So this file:
 *
 *   1. finds every file in `ui/packages/<pkg>/src` and `ui/apps/<app>/src` that
 *      imports a module of this directory from outside it — the doors in;
 *   2. holds that the two pages behind the frame wrap their exported component
 *      in `<MarketplaceNamespaceGate>`;
 *   3. walks every OTHER door's relative imports inside this directory
 *      (transitively) and holds that every `marketplace.*` key those files
 *      spell is in the RESIDENT pack — the package entry's `en`, which holds no
 *      namespace key.
 *
 * TypeScript's own parser reads the sources, so a key or an import written in
 * a comment is never read as code.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { en } from '@object-ui/i18n';

const HERE = dirname(fileURLToPath(import.meta.url));
const MARKETPLACE_DIR = resolve(HERE, '..');
const UI_ROOT = resolve(MARKETPLACE_DIR, '../../../../..');
const rel = (file: string) => relative(UI_ROOT, file).split(sep).join('/');

/** The pages behind the frame: what reaches them is gated by construction. */
const GATED_PAGES = ['MarketplacePage.tsx', 'MarketplacePackagePage.tsx'].map((f) => join(MARKETPLACE_DIR, f));

const isSource = (name: string) =>
  /\.(ts|tsx)$/.test(name) && !/\.(test|spec)\.(ts|tsx)$/.test(name) && !name.endsWith('.d.ts');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name === '__tests__') continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (isSource(name)) out.push(full);
  }
  return out;
}

/** Every `src/` tree under `ui/packages/*` and `ui/apps/*`. */
function allSources(): string[] {
  const roots: string[] = [];
  for (const group of ['packages', 'apps']) {
    for (const name of readdirSync(join(UI_ROOT, group))) {
      const src = join(UI_ROOT, group, name, 'src');
      if (existsSync(src) && statSync(src).isDirectory()) roots.push(src);
    }
  }
  return roots.flatMap((root) => walk(root));
}

const parsed = new Map<string, ts.SourceFile>();
function parse(file: string): ts.SourceFile {
  let sf = parsed.get(file);
  if (!sf) {
    const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
    sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, kind);
    parsed.set(file, sf);
  }
  return sf;
}

/** A relative specifier resolved to a source file, or null (a package, an asset). */
function resolveSpecifier(from: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null;
  const base = resolve(dirname(from), specifier).replace(/\.js$/, '');
  for (const candidate of [`${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/** Every module `file` imports or re-exports through a relative specifier, static or `import()`. */
function importsOf(file: string): string[] {
  const out: string[] = [];
  const visit = (node: ts.Node) => {
    let specifier: ts.Expression | undefined;
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
      specifier = node.moduleSpecifier;
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      specifier = node.arguments[0];
    }
    if (specifier && ts.isStringLiteralLike(specifier)) {
      const target = resolveSpecifier(file, specifier.text);
      if (target) out.push(target);
    }
    ts.forEachChild(node, visit);
  };
  visit(parse(file));
  return out;
}

const inMarketplaceDir = (file: string) => file.startsWith(`${MARKETPLACE_DIR}${sep}`);

/** `marketplace.*` keys a file spells: whole keys, and the fixed head of a template key. */
function keysOf(file: string): { keys: string[]; prefixes: string[] } {
  const keys: string[] = [];
  const prefixes: string[] = [];
  const visit = (node: ts.Node) => {
    if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && /^marketplace\.[\w.-]+$/.test(node.text)) {
      keys.push(node.text);
    } else if (ts.isTemplateHead(node) && node.text.startsWith('marketplace.')) {
      prefixes.push(node.text.replace(/\.$/, ''));
    }
    ts.forEachChild(node, visit);
  };
  visit(parse(file));
  return { keys, prefixes };
}

function lookup(pack: unknown, path: string): unknown {
  let node: unknown = pack;
  for (const segment of path.split('.')) {
    if (typeof node !== 'object' || node === null || !Object.prototype.hasOwnProperty.call(node, segment)) return undefined;
    node = (node as Record<string, unknown>)[segment];
  }
  return node;
}

/** A key the resident pack answers: a leaf, or a plural base whose `_other` form is a leaf. */
const residentLeaf = (key: string) =>
  typeof lookup(en, key) === 'string' || typeof lookup(en, `${key}_other`) === 'string';
const residentGroup = (key: string) => {
  const node = lookup(en, key);
  return typeof node === 'object' && node !== null;
};

// -- the census ---------------------------------------------------------------

const doors = new Map<string, Set<string>>(); // marketplace file -> outside importers
for (const file of allSources()) {
  if (inMarketplaceDir(file)) continue;
  for (const target of importsOf(file)) {
    if (!inMarketplaceDir(target)) continue;
    if (!doors.has(target)) doors.set(target, new Set());
    doors.get(target)!.add(rel(file));
  }
}

/** Every file in this directory reachable from an ungated door, following relative imports inside it. */
const ungated = new Set<string>();
{
  const queue = [...doors.keys()].filter((file) => !GATED_PAGES.includes(file));
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (ungated.has(file) || GATED_PAGES.includes(file)) continue;
    ungated.add(file);
    for (const target of importsOf(file)) if (inMarketplaceDir(target)) queue.push(target);
  }
}

describe('the marketplace namespace boundary (objectstack#30588)', () => {
  it('finds the doors into this directory (the census is not over nothing)', () => {
    const names = [...doors.keys()].map((file) => rel(file));
    // Lit controls: the two gated pages, and Studio's packages page's own imports.
    expect(names).toEqual(
      expect.arrayContaining([
        'packages/app-shell/src/console/marketplace/MarketplacePage.tsx',
        'packages/app-shell/src/console/marketplace/MarketplacePackagePage.tsx',
        'packages/app-shell/src/console/marketplace/MarketplaceRowActions.tsx',
        'packages/app-shell/src/console/marketplace/dependencyMissing.ts',
        'packages/app-shell/src/console/marketplace/protocolCheckSkipped.ts',
      ]),
    );
    expect([...doors.get(join(MARKETPLACE_DIR, 'MarketplaceRowActions.tsx'))!]).toContain(
      'packages/app-shell/src/views/metadata-admin/PackagesPage.tsx',
    );
  });

  it.each(GATED_PAGES.map((file) => [rel(file), file]))(
    '%s renders its body under <MarketplaceNamespaceGate>',
    (_name, file) => {
      const sf = parse(file);
      const exported = sf.statements.find(
        (s): s is ts.FunctionDeclaration =>
          ts.isFunctionDeclaration(s) &&
          !!s.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) &&
          /^Marketplace(Package)?Page$/.test(s.name?.text ?? ''),
      );
      expect(exported, 'the exported page component').toBeDefined();
      const returns = exported!.body!.statements.filter(ts.isReturnStatement);
      expect(returns).toHaveLength(1);
      let expr = returns[0].expression!;
      while (ts.isParenthesizedExpression(expr)) expr = expr.expression;
      expect(ts.isJsxElement(expr) && expr.openingElement.tagName.getText(sf)).toBe('MarketplaceNamespaceGate');
    },
  );

  it('every marketplace key a file outside the frame can render is a resident pack key', () => {
    const outside: string[] = [];
    let read = 0;
    for (const file of ungated) {
      const { keys, prefixes } = keysOf(file);
      read += keys.length + prefixes.length;
      for (const key of keys) if (!residentLeaf(key)) outside.push(`${key} (${rel(file)})`);
      for (const prefix of prefixes) if (!residentGroup(prefix)) outside.push(`${prefix}.* (${rel(file)})`);
    }
    // Lit control: the walk reads the row actions' and the refusal readers' keys.
    expect(read).toBeGreaterThan(15);
    expect(outside).toEqual([]);
  });

  it('the probe key the frame waits on is NOT resident (the pack really is lighter)', () => {
    expect(lookup(en, 'marketplace.title')).toBeUndefined();
    expect(typeof lookup(en, 'marketplace.action.uninstall')).toBe('string');
  });
});
