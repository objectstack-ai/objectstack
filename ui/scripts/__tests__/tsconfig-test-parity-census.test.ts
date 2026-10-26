/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Pins for `scripts/tsconfig-test-parity-census.mjs` (objectui#8714).
 *
 * The card this census answers exists because three divergences were each
 * found by a developer tripping over them. The failure mode of the CURE is
 * the same shape as the disease: a census that reads zero because its
 * discovery glob is wrong is indistinguishable from a repo whose test
 * type-programs agree, and it prints that lie with exit 0.
 *
 * So the population is asserted FIRST and the emptiness leg is OBSERVED here
 * rather than reasoned about: `main` is run against a tree with no
 * `tsconfig.test.json` in it and must return non-zero. Without that leg every
 * other assertion in this file would still pass over an empty set.
 *
 * The rest pins the three readings a plain `diff` of the config text cannot
 * make, each of which was measured on this tree before it was encoded here:
 * spellings that are the same program, the jest-dom augmentation leaking
 * program-wide from one file's import, and Node globals arriving through a
 * `/// <reference types="node" />` instead of `compilerOptions.types`.
 */

import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  discoverTestProjects,
  buildMatrix,
  jestDomRoute,
  nodeTypesRoute,
  main,
  FALSE_BY_DEFAULT,
  NOT_AN_AXIS,
  DEFAULT_ROOT,
} from '../tsconfig-test-parity-census.mjs';

function tree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'parity-census-'));
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, body);
  }
  return root;
}

describe('the population is real before anything is said about it', () => {
  it('finds the workspace test projects, and names two the card turns on', () => {
    const found = discoverTestProjects(DEFAULT_ROOT);
    // A floor, not the exact count: packages are added often and this test is
    // not the place to relitigate that. What it refuses is a collapse.
    expect(found.length).toBeGreaterThan(20);
    expect(found).toContain('packages/plugin-map/tsconfig.test.json');
    expect(found).toContain('packages/plugin-timeline/tsconfig.test.json');
  });

  it('FAILS on an empty population instead of reporting a uniform repo', () => {
    // The whole reason this file exists. Every other assertion here passes
    // vacuously over an empty set; this is the one that does not.
    const empty = tree({ 'packages/only/tsconfig.json': '{}' });
    try {
      expect(discoverTestProjects(empty)).toEqual([]);
      expect(main(['--root', empty])).toBe(1);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});

describe('two spellings of the same program are not a divergence', () => {
  const project = (pkg: string, options: Record<string, unknown>) => ({
    project: `packages/${pkg}/tsconfig.test.json`,
    package: `packages/${pkg}`,
    options,
    include: ['src/**/*.test.ts'],
    exclude: undefined,
    fileNames: [],
  });

  it('reads an omitted `composite` and an explicit `false` as one program', () => {
    expect(FALSE_BY_DEFAULT.has('composite')).toBe(true);
    const [axis] = buildMatrix([project('a', { composite: false }), project('b', {})]);
    expect(axis.axis).toBe('composite');
    expect(axis.spellings).toBe(2);
    expect(axis.effective).toBe(1);
  });

  it('reads `types` as a SET — sibling packages spell the same pair both ways', () => {
    const axes = buildMatrix([
      project('a', { types: ['node', '@testing-library/jest-dom'] }),
      project('b', { types: ['@testing-library/jest-dom', 'node'] }),
    ]);
    expect(axes.find((a) => a.axis === 'types')).toMatchObject({ spellings: 2, effective: 1 });
  });

  it('does not report per-project paths as axes — they differ by construction', () => {
    expect(NOT_AN_AXIS.has('configFilePath')).toBe(true);
    const axes = buildMatrix([
      project('a', { configFilePath: '/x/a', lib: ['lib.es2020.d.ts'] }),
      project('b', { configFilePath: '/x/b', lib: ['lib.es2022.d.ts'] }),
    ]);
    expect(axes.map((a) => a.axis)).toEqual(['lib']);
  });
});

describe('the routes that are not in the tsconfig text', () => {
  it('counts files whose matchers are typed only by ANOTHER file s import', () => {
    const root = tree({
      'a.test.ts': "import '@testing-library/jest-dom';\nexpect(el).toBeInTheDocument();\n",
      // No import of its own. It compiles today only because `a.test.ts` is in
      // the same program — delete that file and this one turns TS2339.
      'b.test.ts': 'expect(el).toHaveTextContent("x");\n',
    });
    try {
      const p = { options: {}, fileNames: ['a.test.ts', 'b.test.ts'] };
      expect(jestDomRoute(root, p)).toMatchObject({
        route: 'side-effect import',
        matcherFiles: 2,
        importFiles: 1,
        matcherWithoutOwnImport: 1,
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('does not count leaning when `compilerOptions.types` names jest-dom', () => {
    const root = tree({ 'a.test.ts': 'expect(el).toBeInTheDocument();\n' });
    try {
      const p = { options: { types: ['@testing-library/jest-dom'] }, fileNames: ['a.test.ts'] };
      expect(jestDomRoute(root, p)).toMatchObject({
        route: 'compilerOptions.types',
        matcherWithoutOwnImport: 0,
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('sees Node globals arriving through a triple-slash directive', () => {
    const root = tree({
      'a.test.ts': '/// <reference types="node" />\nconst x = process.env.HOME;\n',
      'b.test.ts': 'const y = 1;\n',
    });
    try {
      const p = { options: {}, fileNames: ['a.test.ts', 'b.test.ts'] };
      expect(nodeTypesRoute(root, p)).toMatchObject({
        route: 'triple-slash reference in one file',
        directiveFiles: ['a.test.ts'],
      });
      const named = { options: { types: ['node'] }, fileNames: ['b.test.ts'] };
      expect(nodeTypesRoute(root, named).route).toBe('compilerOptions.types');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
