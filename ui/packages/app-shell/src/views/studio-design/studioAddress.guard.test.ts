// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36895 — no Studio address is built by hand anywhere under `ui/`.
 *
 * The Studio redesign (epic #36890) switches each item type from its pillar
 * address to its metadata address in ONE place, `STUDIO_ITEM_PILLAR` in
 * `studioAddress.ts`. That holds only while every producer calls the builders
 * there: a `/studio/...` string written out anywhere else keeps the old
 * address after the switch, and the area's redirect then sends it in a loop.
 *
 * This pin parses every non-test source under `ui/packages/<pkg>/src` and
 * `ui/apps/<app>/src` (comments are not literals, so prose is free to name an
 * address) and refuses:
 *
 *  - a string or template literal that starts with `/studio` (followed by its
 *    end, `/`, `?` or `#`), and
 *  - a path composed onto the root constant (`` `${STUDIO_ROOT_PATH}/…` ``,
 *    `STUDIO_ROOT_PATH + '/…'`), the same hand-build one step removed.
 *
 * A route PATTERN is not an address: `<Route path="/studio">` declares what
 * the console serves, and builds no link. It stays a plain literal, because
 * the console's route table is read as source text
 * (`useConsoleActionRuntime.onSuccessNavigateHost-13379.test.tsx` reads every
 * top-level `path="/…"`), so the string initializer of a `<Route>`'s `path`
 * attribute is spared. Every other spelling, including a `<Link to="/studio">`
 * or a `path` on anything but a `<Route>`, is refused.
 *
 * `studioAddress.ts` is the one file allowed to spell the root (and the
 * mapping table beside it, which spells shapes, not links). The server's
 * two review links are held by the same kind of pin in `@objectstack/types`
 * (`studio-review-links.callers.test.ts`), which also holds the skill evals'
 * literals equal to the builder's output.
 */

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { uiRoot } from '../../../../../scripts/ui-root.mjs';

const UI_ROOT: string = uiRoot();

/**
 * The one file that spells the root, and the mapping table, whose strings are
 * address SHAPES with `<…>` placeholders that no link is built from
 * (`studioAddress.test.ts` holds them to the builders).
 */
const ALLOWED = new Set([
  'packages/app-shell/src/views/studio-design/studioAddress.ts',
  'packages/app-shell/src/views/studio-design/studioAddressTable.ts',
]);

/** The root's names, as a composed path would start from them. */
const ROOT_NAMES = new Set(['STUDIO_ROOT_PATH']);

const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage', '.turbo', '__tests__', '__mocks__']);

const SOURCE = /\.(?:ts|tsx|mts)$/;
const NOT_SOURCE = /(?:\.test|\.spec|\.stories|\.d)\.(?:ts|tsx|mts)$/;

/** A literal's text that is a Studio address. */
const STUDIO_LITERAL = /^\/studio(?:$|[/?#])/;

function sourcesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (!SKIP_DIRS.has(entry)) out.push(...sourcesUnder(full));
    } else if (SOURCE.test(entry) && !NOT_SOURCE.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/** Every `src` tree of the ui workspace's packages and apps. */
function uiSources(): string[] {
  const out: string[] = [];
  for (const group of ['packages', 'apps']) {
    for (const member of readdirSync(path.join(UI_ROOT, group))) {
      const src = path.join(UI_ROOT, group, member, 'src');
      try {
        if (statSync(src).isDirectory()) out.push(...sourcesUnder(src));
      } catch {
        // A member without a `src` tree has no sources to judge.
      }
    }
  }
  return out;
}

/** The hand-built addresses in one source text, as `line: text`. */
function handBuiltStudioAddresses(fileName: string, text: string): string[] {
  const kind = fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, kind);
  const hits: string[] = [];
  const hit = (node: ts.Node) => {
    const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
    hits.push(`${line + 1}: ${node.getText(source).replace(/\s+/g, ' ').slice(0, 120)}`);
  };
  const isRoot = (node: ts.Node) => ts.isIdentifier(node) && ROOT_NAMES.has(node.text);
  // `<Route path="/studio">`: a route pattern the console serves, not a link.
  const isRoutePattern = (node: ts.Node) =>
    ts.isStringLiteral(node) &&
    ts.isJsxAttribute(node.parent) &&
    node.parent.name.getText(source) === 'path' &&
    ts.isJsxAttributes(node.parent.parent) &&
    node.parent.parent.parent.tagName.getText(source) === 'Route';
  const visit = (node: ts.Node): void => {
    if (isRoutePattern(node)) {
      // Spared: see the header.
    } else if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && STUDIO_LITERAL.test(node.text)) {
      hit(node);
    } else if (ts.isTemplateExpression(node)) {
      if (STUDIO_LITERAL.test(node.head.text) || (node.head.text === '' && isRoot(node.templateSpans[0].expression))) {
        hit(node);
      }
    } else if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken && isRoot(node.left)) {
      hit(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return hits;
}

describe('no Studio address is built by hand under ui/ (objectstack#36895)', () => {
  it('the matcher sees each spelling and spares prose and look-alikes', () => {
    const scan = (text: string) => handBuiltStudioAddresses('x.tsx', text);
    expect(scan("const a = '/studio';")).toHaveLength(1);
    expect(scan('const b = `/studio/${pkg}/data`;')).toHaveLength(1);
    expect(scan('const c = "/studio?new=package";')).toHaveLength(1);
    expect(scan('const d = <Link to="/studio" />;')).toHaveLength(1);
    expect(scan('const d2 = <Tab path="/studio" />;')).toHaveLength(1);
    expect(scan('const d3 = <Route path={`/studio/${pkg}`} />;')).toHaveLength(1);
    expect(scan('const e = `${STUDIO_ROOT_PATH}/${pkg}`;')).toHaveLength(1);
    expect(scan("const f = STUDIO_ROOT_PATH + '/' + pkg;")).toHaveLength(1);
    // Not an address.
    expect(scan("const g = '/studios';")).toEqual([]);
    expect(scan("const h = '/api/v1/studio/runtime-config';")).toEqual([]);
    expect(scan("const i = 'studio:builder';")).toEqual([]);
    expect(scan('// opens /studio/crm/data\nconst j = 1;')).toEqual([]);
    expect(scan('/** `/studio/<package>/metadata` */\nconst k = 1;')).toEqual([]);
    // A route pattern is a declaration, not a link.
    expect(scan('const m = <Route path="/studio" element={<X />} />;')).toEqual([]);
    expect(scan('const n = <Route path="/studio/:packageId"><Route index /></Route>;')).toEqual([]);
    // The builder's output is not a literal.
    expect(scan('const l = studioHomePath(pkg);')).toEqual([]);
  });

  it('no ui source outside the builder spells one', () => {
    const files = uiSources();
    const rel = (file: string) => path.relative(UI_ROOT, file).split(path.sep).join('/');
    const names = new Set(files.map(rel));
    // Controls: the walk reaches the packages and the console app, and the
    // matcher fires on the one file allowed to spell the root.
    expect(names.has('packages/app-shell/src/views/studio-design/StudioDesignSurface.tsx')).toBe(true);
    expect(names.has('apps/console/src/components/StudioRoute.tsx')).toBe(true);
    const builder = path.join(UI_ROOT, 'packages/app-shell/src/views/studio-design/studioAddress.ts');
    expect(handBuiltStudioAddresses(builder, readFileSync(builder, 'utf8')).length).toBeGreaterThan(0);

    const offenders = files
      .filter((file) => !ALLOWED.has(rel(file)))
      .flatMap((file) => handBuiltStudioAddresses(file, readFileSync(file, 'utf8')).map((h) => `${rel(file)}:${h}`));
    expect(offenders).toEqual([]);
  });
});
