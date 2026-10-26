#!/usr/bin/env node
/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Test-`tsconfig` parity census (objectui#8714).
 *
 * ## What this answers
 *
 * Every workspace package hand-maintains its own `tsconfig.test.json`, and
 * until this script NOTHING compared them. Three divergences had been found,
 * each by a developer tripping over it rather than by any instrument:
 *
 *   - objectui#8691 — `lib` level (`packages/permissions` inherits `ES2020`,
 *     where `.at(-1)` is TS2550; `packages/app-shell` sets `ES2022`).
 *   - objectui#8710 — module resolution (Vite alias vs the `exports` map).
 *   - objectui#8714 — ambient types (`plugin-map` names
 *     `@testing-library/jest-dom`, `plugin-timeline` does not, so a matcher
 *     there is green under vitest and TS2339 under `tsc`).
 *
 * The shared failure shape is GREEN UNDER ONE TOOL, RED UNDER ANOTHER, so the
 * author's evidence and CI's disagree and nothing in the package says why.
 * This prints the whole matrix at once so the fourth axis is read off an
 * instrument instead of being discovered next month by the same accident.
 *
 * ## This is a REPORT, not a gate
 *
 * It asserts nothing about which values are correct and it never fails on a
 * divergence — some of them are deliberate and load-bearing (measured: adding
 * `src/**\/*.d.ts` to `plugin-view`'s `include`, which six siblings do carry,
 * turns that project RED with 7 errors, because its own `src/global.d.ts`
 * redeclares `process`). Deciding which rows are defects is triage's, and a
 * gate is a separate card. The one thing this DOES refuse is a silent zero:
 * an empty population exits non-zero, because a census that reads nothing
 * because it is blind is indistinguishable from a repo that is uniform.
 *
 * ## Why the tsconfig files are not the whole answer
 *
 * Two of the routes that decide a test program's ambient types are not in any
 * tsconfig, and both were measured on this tree:
 *
 *   - A bare `import '@testing-library/jest-dom'` registers the matcher
 *     augmentation PROGRAM-WIDE, so a file with no import of its own compiles
 *     because a DIFFERENT file in the same package has one. Four packages lean
 *     on that today for 54 files between them.
 *   - A `/// <reference types="node" />` in one test file does the same for
 *     Node globals: `sdui-parser` and `react-runtime` both leave `types`
 *     unset, and `process` resolves in one and is TS2591 in the other.
 *
 * So the census reads those routes off the resolved program files, not off the
 * config text. `scripts/__tests__/tsconfig-test-parity-census.test.ts` pins
 * the instrument against throwaway trees, including the empty-population case.
 *
 * ## Boundary — 38 is not the number of test type-programs
 *
 * This reads `tsconfig.test.json` files. Four packages have no such file and
 * compile their tests inside their ORDINARY `tsconfig.json` instead
 * (`packages/cli`, `packages/data-objectstack`, `packages/test-support`,
 * `apps/console`), so the workspace has 42 test type-programs and this census
 * sees 38 of them. `scripts/check-type-check-coverage.mjs` is the instrument
 * that asks whether every package's tests are compiled AT ALL; this one asks
 * whether the ones with a dedicated project agree with each other. Reading 38
 * as "every test program" is the mistake this paragraph exists to prevent.
 *
 * Run:  node scripts/tsconfig-test-parity-census.mjs [--json] [--root DIR]
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { globSync } from 'node:fs';
import ts from 'typescript';
import { isEntrypoint } from './invoked-as.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_ROOT = join(HERE, '..');

/**
 * Options whose absence is the same PROGRAM as an explicit `false`, so the two
 * spellings must not be reported as a divergence. Every entry is a TypeScript
 * default that does not depend on any other option (`useDefineForClassFields`
 * is deliberately absent — its default follows `target`).
 */
export const FALSE_BY_DEFAULT = new Set([
  'composite',
  'declaration',
  'declarationMap',
  'sourceMap',
  'allowJs',
  'checkJs',
]);

/**
 * Options TypeScript injects or resolves to an absolute path. They differ per
 * project BY CONSTRUCTION — reporting them would bury the four real axes under
 * 38 rows of "this file is at a different path than that file".
 */
export const NOT_AN_AXIS = new Set(['configFilePath', 'pathsBasePath', 'baseUrl', 'outDir', 'rootDir', 'typeRoots']);

const JEST_DOM_MATCHER =
  /\.(toBeInTheDocument|toHaveTextContent|toHaveClass|toHaveAttribute|toBeVisible|toBeDisabled|toBeEnabled|toBeChecked|toHaveValue|toHaveFocus|toBeEmptyDOMElement|toContainElement|toContainHTML|toHaveStyle|toBeRequired|toBeInvalid|toBeValid|toHaveAccessibleName|toHaveAccessibleDescription|toHaveDisplayValue|toBePartiallyChecked|toHaveErrorMessage|toHaveRole|toHaveAccessibleErrorMessage|toHaveSelection)\(/;
const JEST_DOM_IMPORT = /import\s+['"]@testing-library\/jest-dom(\/vitest)?['"]/;
const NODE_TRIPLE_SLASH = /\/\/\/\s*<reference\s+types=["']node["']\s*\/>/;

/**
 * Every `tsconfig.test.json` under the workspace, repo-relative and sorted.
 *
 * Discovered from disk rather than listed, for the reason
 * `check-type-check-coverage.mjs` records: a list is a thing to forget, and a
 * package that lands outside the census reads exactly like a package that
 * agrees with its siblings.
 */
export function discoverTestProjects(root = DEFAULT_ROOT) {
  return globSync(['packages/*/tsconfig.test.json', 'apps/*/tsconfig.test.json', 'examples/*/tsconfig.test.json'], {
    cwd: root,
  })
    .map((p) => p.split(sep).join('/'))
    .sort();
}

/** Flatten one project's `extends` chain through TypeScript's own resolver. */
export function resolveProject(root, relPath) {
  const abs = join(root, relPath);
  const host = {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: (d) => {
      throw new Error(ts.flattenDiagnosticMessageText(d.messageText, ' '));
    },
  };
  const parsed = ts.getParsedCommandLineOfConfigFile(abs, {}, host);
  if (!parsed) throw new Error(`could not parse ${relPath}`);
  return {
    project: relPath,
    package: dirname(relPath),
    options: parsed.options,
    include: parsed.raw?.include,
    exclude: parsed.raw?.exclude,
    fileNames: parsed.fileNames.map((f) => relative(root, f).split(sep).join('/')),
  };
}

/**
 * How this program gets jest-dom's matcher types, and how many of its files
 * would lose them if the last importing file went away.
 */
export function jestDomRoute(root, project) {
  const named = (project.options.types ?? []).includes('@testing-library/jest-dom');
  let matcherFiles = 0;
  let importFiles = 0;
  let matcherWithoutOwnImport = 0;
  for (const f of project.fileNames) {
    const p = join(root, f);
    if (!existsSync(p)) continue;
    const text = readFileSync(p, 'utf8');
    const usesMatcher = JEST_DOM_MATCHER.test(text);
    const imports = JEST_DOM_IMPORT.test(text);
    if (usesMatcher) matcherFiles += 1;
    if (imports) importFiles += 1;
    if (usesMatcher && !imports && !named) matcherWithoutOwnImport += 1;
  }
  const route = named ? 'compilerOptions.types' : importFiles > 0 ? 'side-effect import' : 'none';
  return { route, named, matcherFiles, importFiles, matcherWithoutOwnImport };
}

/** How this program gets Node globals: the `types` field, or one file's directive. */
export function nodeTypesRoute(root, project) {
  if ((project.options.types ?? []).includes('node')) return { route: 'compilerOptions.types', directiveFiles: [] };
  const directiveFiles = project.fileNames.filter((f) => {
    const p = join(root, f);
    return existsSync(p) && NODE_TRIPLE_SLASH.test(readFileSync(p, 'utf8'));
  });
  if (project.options.types === undefined && directiveFiles.length > 0) {
    return { route: 'triple-slash reference in one file', directiveFiles };
  }
  return { route: 'none', directiveFiles };
}

const spell = (v) => (v === undefined ? '<unset>' : JSON.stringify(v));

/** Group projects by the value they give each axis; flag same-program spellings. */
export function buildMatrix(projects) {
  const keys = new Set();
  for (const p of projects) for (const k of Object.keys(p.options)) if (!NOT_AN_AXIS.has(k)) keys.add(k);
  const axes = [];
  const read = (p, k) => (k === 'include' || k === 'exclude' ? p[k] : p.options[k]);
  for (const k of [...keys, 'include', 'exclude'].sort()) {
    const byValue = new Map();
    for (const p of projects) {
      const v = spell(read(p, k));
      if (!byValue.has(v)) byValue.set(v, []);
      byValue.get(v).push(p.package);
    }
    if (byValue.size < 2) continue;
    const effective = new Set(
      [...byValue.keys()].map((v) => {
        if (v === '<unset>') return FALSE_BY_DEFAULT.has(k) ? 'false' : v;
        const parsed = JSON.parse(v);
        return Array.isArray(parsed) ? JSON.stringify([...parsed].map(String).sort()) : v;
      }),
    );
    axes.push({ axis: k, spellings: byValue.size, effective: effective.size, byValue: [...byValue] });
  }
  return axes.sort((a, b) => b.effective - a.effective || a.axis.localeCompare(b.axis));
}

/** CLI entry. Exported so the emptiness leg can be OBSERVED failing in a test. */
export function main(argv) {
  const rootFlag = argv.indexOf('--root');
  const root = rootFlag === -1 ? DEFAULT_ROOT : argv[rootFlag + 1];
  const files = discoverTestProjects(root);
  if (files.length === 0) {
    console.error(
      'tsconfig-test-parity-census: found NO tsconfig.test.json under packages/*, apps/* or examples/*.\n' +
        'That is a blind instrument, not a uniform repo — check --root and the workspace layout.',
    );
    return 1;
  }
  const projects = files.map((f) => resolveProject(root, f));
  const axes = buildMatrix(projects);
  const rows = projects.map((p) => ({
    package: p.package,
    programFiles: p.fileNames.length,
    lib: p.options.lib,
    types: p.options.types,
    jestDom: jestDomRoute(root, p),
    node: nodeTypesRoute(root, p),
  }));

  if (argv.includes('--json')) {
    console.log(JSON.stringify({ population: files.length, axes, projects: rows }, null, 2));
    return 0;
  }

  console.log(`# test-tsconfig parity census — ${files.length} projects, ${projects.reduce((a, p) => a + p.fileNames.length, 0)} program files\n`);
  console.log(`## divergent axes (${axes.length})\n`);
  for (const a of axes) {
    const note = a.effective === 1 ? '  [same program, different spelling]' : '';
    console.log(`### ${a.axis} — ${a.spellings} spellings, ${a.effective} effective${note}`);
    for (const [value, pkgs] of a.byValue.sort((x, y) => y[1].length - x[1].length)) {
      console.log(`    ${value}  x${pkgs.length}`);
      console.log(`        ${pkgs.join(' ')}`);
    }
    console.log('');
  }
  console.log('## ambient-type route per project (not visible in the tsconfig text)\n');
  console.log(
    `${'package'.padEnd(32)}${'files'.padStart(6)}  ${'jest-dom route'.padEnd(22)}${'leaning'.padStart(8)}  node route`,
  );
  for (const r of rows) {
    console.log(
      `${r.package.padEnd(32)}${String(r.programFiles).padStart(6)}  ${r.jestDom.route.padEnd(22)}${String(r.jestDom.matcherWithoutOwnImport).padStart(8)}  ${r.node.route}`,
    );
  }
  return 0;
}

if (isEntrypoint(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
