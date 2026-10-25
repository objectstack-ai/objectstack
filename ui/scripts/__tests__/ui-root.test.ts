/**
 * `scripts/ui-root.mjs` -- the objectui tree root, resolved from the helper's
 * own location so the same answer holds standalone and under the objectstack
 * monorepo's `ui/` (objectstack ruling D1). Its declaration twin
 * `ui-root.d.mts` is pinned to the module's real export surface, since a
 * hand-written declaration is the one thing here free to drift.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { stripComments } from '../js-comment-mask.mjs';
import { UI_ROOT, uiRoot } from '../ui-root.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

describe('uiRoot() (objectstack ruling D1: the objectui tree as `ui/`)', () => {
  it('is the directory two levels above this test file, absolute, with no trailing separator', () => {
    expect(uiRoot()).toBe(path.resolve(here, '../..'));
    expect(path.isAbsolute(uiRoot())).toBe(true);
    expect(uiRoot().endsWith(path.sep)).toBe(false);
    expect(UI_ROOT).toBe(uiRoot());
  });

  it('names the tree that holds this repository\'s own layout, not a marker it searched for', () => {
    // The helper reads nothing: the directory it names must simply BE the
    // objectui tree, which these three entries identify in both layouts.
    for (const entry of ['scripts/ui-root.mjs', 'packages/types/package.json', 'apps/console/package.json']) {
      expect(existsSync(path.join(uiRoot(), entry)), entry).toBe(true);
    }
    const manifest = JSON.parse(readFileSync(path.join(uiRoot(), 'package.json'), 'utf8')) as { name?: string };
    expect(manifest.name).toBe('object-ui-monorepo');
  });

  it('consults no marker, no git and no cwd -- the source is one path.resolve from import.meta.url', () => {
    const source = readFileSync(path.join(here, '..', 'ui-root.mjs'), 'utf8');
    const code = stripComments(source);
    expect(code).toContain("path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')");
    for (const forbidden of ['process.cwd', 'existsSync', 'rev-parse', 'pnpm-workspace.yaml', 'find-up']) {
      expect(code, `the helper must not spell ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('declares in ui-root.d.mts exactly the names ui-root.mjs exports', async () => {
    const declared = readFileSync(path.join(here, '..', 'ui-root.d.mts'), 'utf8');
    const declaredNames = [...declared.matchAll(/^export declare (?:const|function) (\w+)/gm)].map((m) => m[1]).sort();
    const exported = Object.keys(await import('../ui-root.mjs')).sort();
    expect(declaredNames).toEqual(exported);
    expect(exported).toEqual(['UI_ROOT', 'uiRoot']);
  });
});
