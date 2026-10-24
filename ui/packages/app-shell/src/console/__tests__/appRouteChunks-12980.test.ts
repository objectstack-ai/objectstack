// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12980 (part 2) — every lazy route view `AppContent` declares is
 * preloaded for its route.
 *
 * `AppContent` starts a route view's chunk import beside the route's metadata
 * reads, looked up in its `APP_ROUTE_CHUNKS` table by route path. A route whose
 * view is a `routeChunk.lazy(...)` declaration but has no row there still
 * renders, only late: its view suspends under the boot splash when the chrome
 * commits, which is the measured ~0.28 s this card removed. Nothing at runtime
 * would say so. This file reads the `<Route path>` table and the
 * `APP_ROUTE_CHUNKS` table out of `AppContent.tsx` itself (TypeScript's own
 * parser, so comments are never read as code) and fails on a lazy route view
 * without its row, a row naming another view, and a row naming no route.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = readFileSync(join(HERE, '..', 'AppContent.tsx'), 'utf8');
const FILE = ts.createSourceFile('AppContent.tsx', SOURCE, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const RECORD_NAMED_PAGE_ROUTE = /export const RECORD_NAMED_PAGE_ROUTE = '([^']+)'/.exec(SOURCE)?.[1] ?? 'NOT FOUND';

/** The names declared as `const NAME = routeChunk.lazy(...)`. */
function lazyViewNames(): Set<string> {
  const out = new Set<string>();
  const visit = (node: ts.Node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      ts.isCallExpression(node.initializer) &&
      node.initializer.expression.getText(FILE) === 'routeChunk.lazy'
    ) {
      out.add(node.name.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(FILE);
  return out;
}

/** `path -> view` for every `<Route>` whose element is a lazy view, nested paths joined. */
function lazyRouteViews(lazy: Set<string>): Map<string, string> {
  const out = new Map<string, string>();
  const attr = (attrs: ts.JsxAttributes, name: string) =>
    attrs.properties.find((p): p is ts.JsxAttribute => ts.isJsxAttribute(p) && p.name.getText(FILE) === name);
  const pathOf = (attrs: ts.JsxAttributes): string | null => {
    const a = attr(attrs, 'path');
    if (!a?.initializer) return null;
    if (ts.isStringLiteral(a.initializer)) return a.initializer.text;
    const expr = ts.isJsxExpression(a.initializer) ? a.initializer.expression : undefined;
    if (expr && ts.isIdentifier(expr) && expr.text === 'RECORD_NAMED_PAGE_ROUTE') return RECORD_NAMED_PAGE_ROUTE;
    throw new Error(`unreadable <Route path> at ${a.getText(FILE)}`);
  };
  const elementTag = (attrs: ts.JsxAttributes): string | null => {
    const a = attr(attrs, 'element');
    let expr = a?.initializer && ts.isJsxExpression(a.initializer) ? a.initializer.expression : undefined;
    while (expr && ts.isParenthesizedExpression(expr)) expr = expr.expression;
    if (!expr) return null;
    if (ts.isJsxSelfClosingElement(expr)) return expr.tagName.getText(FILE);
    if (ts.isJsxElement(expr)) return expr.openingElement.tagName.getText(FILE);
    return null;
  };
  const visit = (node: ts.Node, parent: string) => {
    let opening: ts.JsxOpeningLikeElement | null = null;
    if (ts.isJsxElement(node)) opening = node.openingElement;
    else if (ts.isJsxSelfClosingElement(node)) opening = node;
    if (opening && opening.tagName.getText(FILE) === 'Route') {
      const own = pathOf(opening.attributes);
      const path = own ? (parent ? `${parent}/${own}` : own) : parent;
      const tag = elementTag(opening.attributes);
      if (tag && lazy.has(tag)) {
        const seen = out.get(path);
        if (seen && seen !== tag) throw new Error(`route ${path} renders both ${seen} and ${tag}`);
        out.set(path, tag);
      }
      if (ts.isJsxElement(node)) node.children.forEach((c) => visit(c, path));
      return;
    }
    ts.forEachChild(node, (c) => visit(c, parent));
  };
  visit(FILE, '');
  return out;
}

/** `path -> view` as the `APP_ROUTE_CHUNKS` table spells it. */
function chunkTable(): Map<string, string> {
  const out = new Map<string, string>();
  const visit = (node: ts.Node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'APP_ROUTE_CHUNKS' &&
      node.initializer &&
      ts.isArrayLiteralExpression(node.initializer)
    ) {
      for (const row of node.initializer.elements) {
        if (!ts.isObjectLiteralExpression(row)) throw new Error(`unreadable row ${row.getText(FILE)}`);
        const prop = (name: string) =>
          row.properties.find((p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && p.name.getText(FILE) === name);
        const path = prop('path')?.initializer;
        const chunk = prop('chunk')?.initializer;
        if (!path || !ts.isStringLiteral(path) || !chunk || !ts.isIdentifier(chunk)) {
          throw new Error(`unreadable row ${row.getText(FILE)}`);
        }
        out.set(path.text, chunk.text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(FILE);
  return out;
}

describe('every lazy route view AppContent declares is preloaded for its route (objectui#12980)', () => {
  const lazy = lazyViewNames();
  const routes = lazyRouteViews(lazy);
  const table = chunkTable();

  it('the source read finds both tables (positive control)', () => {
    expect(lazy.has('PageView')).toBe(true);
    expect(lazy.has('DashboardView')).toBe(true);
    expect(routes.get('page/:pageName')).toBe('PageView');
    expect(routes.get('dashboard/:dashboardName')).toBe('DashboardView');
    expect(routes.get(RECORD_NAMED_PAGE_ROUTE)).toBe('RecordDetailView');
    expect(table.get('page/:pageName')).toBe('PageView');
    // objectui#13020: the app's report index preloads like every app route.
    expect(routes.get('reports')).toBe('AppReportIndexView');
    expect(table.get('reports')).toBe('AppReportIndexView');
  });

  it('a lazy route view has its row, naming the same view', () => {
    const missing = [...routes].filter(([path, view]) => table.get(path) !== view);
    expect(missing).toEqual([]);
  });

  it('every row names a lazy route view AppContent declares for that path', () => {
    const stale = [...table].filter(([path, view]) => routes.get(path) !== view);
    expect(stale).toEqual([]);
  });
});
