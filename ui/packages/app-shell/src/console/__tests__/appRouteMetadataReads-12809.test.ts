// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12809 — the enumeration of route readers of the lazy metadata
 * buckets.
 *
 * `AppContent` no longer preloads `object`, `dashboard`, `report` and `page`
 * before every route. Each route waits for the buckets
 * `APP_ROUTE_METADATA_READS` declares for it, so a route missing from that
 * table would render against an empty bucket: an empty list or a "not found"
 * where a record should be. This file reads the `<Route path>` table out of
 * `AppContent.tsx` itself (both branches, nested routes joined) and fails on
 * any route the reads table does not declare, and on any row that names no
 * route. It also pins how a URL is matched to its row, ranked as `<Routes>`
 * ranks it, host routes included.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { Route } from 'react-router-dom';
import ts from 'typescript';
import {
  APP_ROUTE_METADATA_READS,
  ALL_LAZY_METADATA_TYPES,
  collectRoutePaths,
  metadataReadsForAppRoute,
} from '../appRouteMetadataReads';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_CONTENT = readFileSync(join(HERE, '..', 'AppContent.tsx'), 'utf8');
// Read from the source rather than imported: `AppContent` pulls the whole
// console module graph, and this pin only needs the route table's text.
const RECORD_NAMED_PAGE_ROUTE = /export const RECORD_NAMED_PAGE_ROUTE = '([^']+)'/.exec(APP_CONTENT)?.[1] ?? 'NOT FOUND';

/** Every `<Route>` path `AppContent.tsx` declares, nested paths joined. */
function declaredRoutePaths(source: string): string[] {
  const file = ts.createSourceFile('AppContent.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const out: string[] = [];
  const attr = (attrs: ts.JsxAttributes, name: string) =>
    attrs.properties.find((p): p is ts.JsxAttribute => ts.isJsxAttribute(p) && p.name.getText(file) === name);
  const pathOf = (attrs: ts.JsxAttributes): string | null => {
    const a = attr(attrs, 'path');
    if (!a?.initializer) return null;
    if (ts.isStringLiteral(a.initializer)) return a.initializer.text;
    const expr = ts.isJsxExpression(a.initializer) ? a.initializer.expression : undefined;
    if (expr && ts.isIdentifier(expr) && expr.text === 'RECORD_NAMED_PAGE_ROUTE') return RECORD_NAMED_PAGE_ROUTE;
    throw new Error(`unreadable <Route path> at ${a.getText(file)}`);
  };
  const visit = (node: ts.Node, parent: string) => {
    let opening: ts.JsxOpeningLikeElement | null = null;
    if (ts.isJsxElement(node)) opening = node.openingElement;
    else if (ts.isJsxSelfClosingElement(node)) opening = node;
    if (opening && opening.tagName.getText(file) === 'Route') {
      const own = pathOf(opening.attributes);
      const isIndex = !!attr(opening.attributes, 'index');
      const path = own ? (parent ? `${parent}/${own}` : own) : parent;
      if (own || isIndex) out.push(path === '/' || path === '' ? '/' : path);
      if (ts.isJsxElement(node)) node.children.forEach((c) => visit(c, path));
      return;
    }
    ts.forEachChild(node, (c) => visit(c, parent));
  };
  visit(file, '');
  return out;
}

const tablePaths = new Set(APP_ROUTE_METADATA_READS.map((r) => r.path));

describe('every route AppContent declares has its metadata reads declared (objectui#12809)', () => {
  const declared = declaredRoutePaths(APP_CONTENT);

  it('the source read finds the route table (positive control)', () => {
    expect(declared).toContain(':objectName');
    expect(declared).toContain('metadata/:type/:name/history');
    expect(declared).toContain('/');
    expect(declared).toContain(RECORD_NAMED_PAGE_ROUTE);
  });

  it('no route is missing from APP_ROUTE_METADATA_READS', () => {
    expect([...new Set(declared)].filter((p) => !tablePaths.has(p))).toEqual([]);
  });

  it('no row names a route AppContent does not declare', () => {
    const declaredSet = new Set(declared);
    expect([...tablePaths].filter((p) => !declaredSet.has(p))).toEqual([]);
  });
});

describe('a URL is matched to the reads of the route that renders it (objectui#12809)', () => {
  it.each([
    ['', ['object']],
    ['account', ['object']],
    ['account/view/all', ['object']],
    ['account/record/r1', ['object', 'page']],
    ['account/record/r1/page/print', ['object', 'page']],
    ['account/record/r1/edit', ['object']],
    ['dashboard/sales', ['dashboard', 'object']],
    ['report/pipeline', ['report', 'object']],
    ['page/welcome', ['page', 'object']],
    ['metadata/object/account', ['object']],
    ['metadata/package/x', []],
    ['system/marketplace', []],
    ['account/abc123def', []],
    ['component/ns/name/deep', ALL_LAZY_METADATA_TYPES],
  ])('%s → %j', (subPath, reads) => {
    expect(metadataReadsForAppRoute(subPath as string)).toEqual(reads);
  });

  it('a host route waits for every bucket, ranked above the generic object routes', () => {
    const host = collectRoutePaths(
      React.createElement(
        React.Fragment,
        null,
        React.createElement(Route, { path: 'system/settings' }),
        React.createElement(
          Route,
          { path: 'docs' },
          React.createElement(Route, { index: true }),
          React.createElement(Route, { path: ':slug' }),
        ),
      ),
    );
    expect(new Set(host)).toEqual(new Set(['system/settings', 'docs', 'docs/:slug']));
    // Without the host paths, `system/settings` would read as the record-id
    // redirect and `docs` as an object list.
    expect(metadataReadsForAppRoute('system/settings')).toEqual([]);
    expect(metadataReadsForAppRoute('system/settings', host)).toEqual(ALL_LAZY_METADATA_TYPES);
    expect(metadataReadsForAppRoute('docs', host)).toEqual(ALL_LAZY_METADATA_TYPES);
    expect(metadataReadsForAppRoute('docs/intro', host)).toEqual(ALL_LAZY_METADATA_TYPES);
  });
});
