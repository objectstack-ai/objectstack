// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12811 — the enumeration of `useMetadata().objects` readers.
 *
 * Reading `objects` loads the whole object registry (`GET /api/v1/meta/object`,
 * 97 objects and 745 KB on the card's backend). A console open of an app's
 * object list now reads the app's object scope instead (`readObjectScope`),
 * so a reader that is mounted on that open and reads `objects` at render
 * brings the whole registry back onto it.
 *
 * This file finds every reader of the whole object list off the metadata
 * context in the packages' and the console's source (a `{ objects }`
 * destructured from `useMetadata()`, `useMetadata().objects`, `.objects` on a
 * binding of `useMetadata()`, or `getItemsByType('object')`, which holds the
 * same list as served), and fails on a reader the table below does not
 * classify, and on a row that names no reader. Each row says where the reader
 * runs:
 *
 *   - `scope`: on the open path, it reads `readObjectScope`, and `objects`
 *     only where no package scopes the read;
 *   - `action`: it reads `objects` only when an action needs it, after
 *     `ensureType('object')`;
 *   - `off`: it is not mounted on an app's object-list open, and keeps the
 *     whole registry (the control: its own pins stay unchanged).
 *
 * Measured once on HotCRM (a Chromium open of `/apps/crm_enterprise/crm_account`
 * with a stack-recording getter, and the request initiators): the readers
 * that touched the whole list were `AppContent`, `useActionModal` and
 * `useNavMemberGates`, and, once those no longer loaded it first,
 * `useServedViewItems` (the header's and the list's view-tab labels) and
 * `useObjectPresence` (the bell's activity feed). The `request` pin
 * beside this file (`AppContent.objectScope-12811.test.tsx`) re-derives the
 * requests; this one re-derives who reads.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..', '..', '..', '..');

type Kind = 'scope' | 'action' | 'off';

/** Every reader of `objects` off the metadata context, and where it runs. */
const OBJECTS_READERS: Record<string, { kind: Kind; why: string }> = {
  'packages/app-shell/src/console/AppContent.tsx': {
    kind: 'scope',
    why: 'the route, the chrome and the recent-items tracker read the scope on APP_OBJECT_SCOPE_ROUTES; a record overlay or another route reads objects',
  },
  'packages/app-shell/src/hooks/useNavMemberGates.ts': {
    kind: 'scope',
    why: "the capability gate reads the app's scope; with no app package (the home feeds) it reads objects",
  },
  'packages/app-shell/src/hooks/useServedViewItems.ts': {
    kind: 'scope',
    why: "the served object documents behind the view-tab labels (AppHeader, ObjectView) are the app scope's, until something loads the whole registry",
  },
  'packages/app-shell/src/hooks/useObjectPresence.ts': {
    kind: 'scope',
    why: "an object's presence (the bell's sys_activity feed) is asked by name through the app scope, until something loads the whole registry",
  },
  'packages/app-shell/src/hooks/useActionModal.tsx': {
    kind: 'action',
    why: "an object's form modal: the open waits for the whole list, whose subforms come from every object",
  },
  'packages/app-shell/src/hooks/useConsoleActionRuntime.tsx': { kind: 'off', why: 'read inside action handlers, when an action runs' },
  'packages/plugin-grid/src/ObjectGrid.tsx': { kind: 'off', why: 'read inside an action handler, when an action runs' },
  'packages/app-shell/src/hooks/useNavTargetLabel.ts': { kind: 'off', why: 'read when a label is resolved for a nav entry without its own label, or a view entry' },
  'packages/app-shell/src/hooks/useRecentItemLabel.ts': { kind: 'off', why: 'read when a recent object or view entry is labelled' },
  'packages/app-shell/src/layout/ActivityObjectLabel.tsx': { kind: 'off', why: "the inbox and the home rail's activity rows" },
  'packages/app-shell/src/chrome/CommandPalette.tsx': { kind: 'off', why: "the Studio scope's object list, read while the palette lists Studio entries" },
  'packages/app-shell/src/console/home/HomeLayout.tsx': { kind: 'off', why: 'the home page, outside any app' },
  'packages/app-shell/src/console/home/HomePage.tsx': { kind: 'off', why: 'the home page, outside any app' },
  'packages/app-shell/src/views/DashboardView.tsx': { kind: 'off', why: "a dashboard route: its widgets' objects" },
  'packages/app-shell/src/views/ReportView.tsx': { kind: 'off', why: "a report route: its columns' objects" },
  'packages/app-shell/src/views/PageView.tsx': {
    kind: 'scope',
    why: 'a page route reads the objects its page binds (objectui#12980), and a block\'s other object by name when it asks; a hand-rolled context reads objects',
  },
  'packages/app-shell/src/views/RecordFormPage.tsx': { kind: 'off', why: 'a record form route' },
  'packages/app-shell/src/views/SearchResultsPage.tsx': { kind: 'off', why: 'the search route: every searchable object' },
  'packages/app-shell/src/views/global-search-renderer.tsx': {
    kind: 'action',
    why: 'the global search block reads every object only once the user types, after ensureType(\'object\') (objectui#12980)',
  },
  'packages/app-shell/src/views/InterfaceListPage.tsx': {
    kind: 'scope',
    why: 'the interface page reads its source object by name (objectui#12980); a record overlay reads objects once opened',
  },
  'packages/app-shell/src/views/nav-menu-renderer.tsx': {
    kind: 'scope',
    why: "the nav:menu block's capability gate reads the objects the app's entries require, by name (objectui#12980)",
  },
  'packages/app-shell/src/views/metadata-admin/PositionHoldersSection.tsx': { kind: 'off', why: 'the metadata admin' },
  'packages/app-shell/src/views/metadata-admin/AssignedUsersSection.tsx': { kind: 'off', why: 'the metadata admin' },
  'packages/app-shell/src/views/metadata-admin/previews/ScreenPreview.tsx': { kind: 'off', why: "the metadata admin's form-screen preview" },
  'packages/app-shell/src/views/studio-design/ObjectListViewInspector.tsx': { kind: 'off', why: 'Studio' },
  'packages/app-shell/src/views/studio-design/studio-canvas-preview.tsx': { kind: 'off', why: 'Studio' },
  'packages/plugin-designer/src/pages/CreateAppPage.tsx': { kind: 'off', why: "the app designer's object pickers" },
  'packages/plugin-designer/src/pages/EditAppPage.tsx': { kind: 'off', why: "the app designer's object pickers" },
  'apps/console/src/pages/developer/FlowRunsPage.tsx': { kind: 'off', why: 'the flow runs page' },
  'apps/console/src/pages/system/AuditLogPage.tsx': { kind: 'off', why: 'the audit log page' },
};

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name === '__tests__') continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sourceFiles(path, out);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && !name.endsWith('.d.ts')) out.push(path);
  }
  return out;
}

const isObjectTypeArg = (node: ts.CallExpression): boolean =>
  node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text === 'object';

const isUseMetadataCall = (node: ts.Node | undefined): boolean =>
  !!node && ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'useMetadata';

/** Whether the module reads `objects` off the metadata context, by any of the three spellings. */
function readsObjects(path: string): boolean {
  const source = readFileSync(path, 'utf8');
  if (!source.includes('useMetadata(')) return false;
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, path.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const bindings = new Set<string>();
  let found = false;
  const collect = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && isUseMetadataCall(node.initializer)) {
      if (ts.isIdentifier(node.name)) bindings.add(node.name.text);
      else if (ts.isObjectBindingPattern(node.name)) {
        for (const el of node.name.elements) {
          const key = el.propertyName ?? el.name;
          if (ts.isIdentifier(key) && key.text === 'objects') found = true;
          if (ts.isIdentifier(key) && key.text === 'getItemsByType' && ts.isIdentifier(el.name)) bindings.add(`fn:${el.name.text}`);
        }
      }
    }
    ts.forEachChild(node, collect);
  };
  collect(file);
  const access = (node: ts.Node) => {
    if (ts.isPropertyAccessExpression(node) && node.name.text === 'objects') {
      const target = node.expression;
      if (isUseMetadataCall(target) || (ts.isIdentifier(target) && bindings.has(target.text))) found = true;
    }
    // `getItemsByType('object')`, called on a binding of `useMetadata()` or destructured from it.
    if (ts.isCallExpression(node) && isObjectTypeArg(node)) {
      const callee = node.expression;
      if (
        (ts.isPropertyAccessExpression(callee) && callee.name.text === 'getItemsByType' &&
          (isUseMetadataCall(callee.expression) || (ts.isIdentifier(callee.expression) && bindings.has(callee.expression.text)))) ||
        (ts.isIdentifier(callee) && bindings.has(`fn:${callee.text}`))
      ) found = true;
    }
    ts.forEachChild(node, access);
  };
  access(file);
  return found;
}

function discoveredReaders(): string[] {
  const roots = [
    ...readdirSync(join(REPO_ROOT, 'packages')).map((pkg) => join(REPO_ROOT, 'packages', pkg, 'src')),
    join(REPO_ROOT, 'apps', 'console', 'src'),
  ].filter((dir) => {
    try {
      return statSync(dir).isDirectory();
    } catch {
      return false;
    }
  });
  return roots
    .flatMap((dir) => sourceFiles(dir))
    .filter(readsObjects)
    .map((path) => relative(REPO_ROOT, path).split('\\').join('/'))
    .sort();
}

describe('the readers of `useMetadata().objects`, each classified (objectui#12811)', () => {
  const found = discoveredReaders();

  it('finds the readers it knows are there (the census reads source)', () => {
    expect(found).toContain('packages/app-shell/src/console/AppContent.tsx');
    expect(found).toContain('packages/plugin-designer/src/pages/CreateAppPage.tsx');
  });

  it('classifies every reader, and every row names a reader', () => {
    expect(found).toEqual(Object.keys(OBJECTS_READERS).sort());
  });

  it('an open-path reader reads the scope, and an action-time reader waits for the list', () => {
    for (const [path, { kind }] of Object.entries(OBJECTS_READERS)) {
      const source = readFileSync(join(REPO_ROOT, path), 'utf8');
      if (kind === 'scope') expect(source, path).toContain('readObjectScope');
      if (kind === 'action') expect(source, path).toContain("ensureType('object')");
    }
  });
});
